import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { FileSystemAdapter, type App } from "obsidian";
import {
  compareSourcePaths,
  isChat2VaultLikeMalformed,
  isM03WellFormedString,
  normalizeSourceRoot,
  parseSourceRegistryEntry,
  pathCollisionKey,
  planSourceWrite,
  sha256,
  sourceWritePreRegistryGate,
  sourceWritePreRootGate,
  type CanonicalConversation,
  type SourceDescriptor,
  type SourcePlannerInput,
  type SourceRegistryEntry,
  type SourceWritePlan,
  type SourceWriterDiagnosticCode,
} from "@chat2vault/core";
import {
  verifyNativeComponent,
  type NativeContainmentAdapter,
} from "./containment.js";
import type {
  MutationCheckpoint,
  SafetyCheckpoint,
  SourceMutationAdapter,
  VerificationResult,
} from "./source-executor.js";

export interface VaultPathEntry {
  path: string;
  kind: "folder" | "file";
}

export class SourceExternalPathInvalidUnicodeError extends Error {
  public readonly code = "SOURCE_EXTERNAL_PATH_INVALID_UNICODE";

  public constructor() {
    super("External Vault/native path is not a well-formed Unicode string");
    this.name = "SourceExternalPathInvalidUnicodeError";
  }
}

export function pairVaultNativeListing(
  parent: unknown,
  visible: readonly VaultPathEntry[],
  nativeNames: readonly unknown[],
): VaultPathEntry[] {
  if (
    !isM03WellFormedString(parent) ||
    visible.some((entry) => !isM03WellFormedString(entry.path)) ||
    nativeNames.some((name) => !isM03WellFormedString(name))
  )
    throw new SourceExternalPathInvalidUnicodeError();

  const raw = nativeNames.map((name): VaultPathEntry => {
    if (!isM03WellFormedString(name))
      throw new SourceExternalPathInvalidUnicodeError();
    const rawPath = `${parent === "" ? "" : `${parent}/`}${name}`;
    const matches = visible.filter(
      (candidate) =>
        candidate.path.normalize("NFC") === rawPath.normalize("NFC"),
    );
    const visibleMatch = matches[0];
    if (matches.length !== 1 || visibleMatch === undefined)
      throw new Error("Vault/native enumeration mismatch");
    return { path: rawPath, kind: visibleMatch.kind };
  });
  if (raw.length !== visible.length)
    throw new Error("Vault/native enumeration mismatch");
  return raw;
}

function listFailureCode(
  error: unknown,
  fallback: SourceWriterDiagnosticCode,
): SourceWriterDiagnosticCode {
  return error instanceof SourceExternalPathInvalidUnicodeError
    ? "SOURCE_EXTERNAL_PATH_INVALID_UNICODE"
    : fallback;
}

export interface SourceVaultIO {
  configDir: string;
  basePath: string;
  list(path: string): Promise<VaultPathEntry[]>;
  lookup(path: string): Promise<VaultPathEntry | undefined>;
  readBinary(path: string): Promise<Uint8Array>;
  createFolder(path: string): Promise<void>;
  create(path: string, content: string): Promise<void>;
}

export function createObsidianSourceVaultIO(app: App): SourceVaultIO {
  const adapter = app.vault.adapter;
  const basePath =
    typeof FileSystemAdapter === "function" &&
    adapter instanceof FileSystemAdapter
      ? adapter.getBasePath()
      : "";
  return {
    configDir: app.vault.configDir,
    basePath,
    list: async (path) => {
      if (!isM03WellFormedString(path) || !isM03WellFormedString(basePath))
        throw new SourceExternalPathInvalidUnicodeError();
      const listing = await adapter.list(path);
      if (
        listing.folders.some((rawPath) => !isM03WellFormedString(rawPath)) ||
        listing.files.some((rawPath) => !isM03WellFormedString(rawPath))
      )
        throw new SourceExternalPathInvalidUnicodeError();
      const visible = [
        ...listing.folders.map((rawPath) => ({
          path: rawPath,
          kind: "folder" as const,
        })),
        ...listing.files.map((rawPath) => ({
          path: rawPath,
          kind: "file" as const,
        })),
      ];
      if (basePath === "") return visible;
      const native = await readdir(join(basePath, ...path.split("/")), {
        withFileTypes: true,
      });
      return pairVaultNativeListing(
        path,
        visible,
        native.map((entry) => entry.name),
      );
    },
    lookup: async (path) => {
      const entry = await adapter.stat(path);
      if (entry?.type === "folder") return { path, kind: "folder" };
      if (entry?.type === "file") return { path, kind: "file" };
      return undefined;
    },
    readBinary: async (path) => new Uint8Array(await adapter.readBinary(path)),
    createFolder: async (path) => {
      await app.vault.createFolder(path);
    },
    create: async (path, content) => {
      await app.vault.create(path, content);
    },
  };
}

interface RootSnapshot {
  status: "existing" | "partially-missing" | "fully-missing" | "blocked";
  error?: SourceWriterDiagnosticCode;
  foldersToCreate: string[];
  resolvedRoot?: string;
  resolvedFolders: Map<string, string>;
  vaultRealPath?: string;
}

function blocked(error: SourceWriterDiagnosticCode): RootSnapshot {
  return {
    status: "blocked",
    error,
    foldersToCreate: [],
    resolvedFolders: new Map(),
  };
}

function directName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export class ObsidianSourceMutationAdapter implements SourceMutationAdapter {
  private capabilityVaultRealPath: string | undefined;
  public constructor(
    private readonly io: SourceVaultIO,
    private readonly native: NativeContainmentAdapter | undefined,
    private readonly source: SourceDescriptor,
    private readonly conversation: CanonicalConversation,
    private readonly sourceRoot: () => string,
    private readonly settingsPending: () => boolean,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly lifecycleOpen: () => boolean = () => true,
  ) {}

  private nativePath(vaultPath: string): string {
    return vaultPath === ""
      ? this.io.basePath
      : join(this.io.basePath, ...vaultPath.split("/"));
  }

  private nativeError(
    result: Awaited<ReturnType<typeof verifyNativeComponent>>,
  ): SourceWriterDiagnosticCode | undefined {
    if (result.status === "external-path-invalid")
      return "SOURCE_EXTERNAL_PATH_INVALID_UNICODE";
    if (result.status === "capability-unavailable")
      return "SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE";
    if (result.status === "indeterminate" || result.status === "absent")
      return "SOURCE_NATIVE_PROBE_INDETERMINATE";
    if (result.status === "alias" || result.status === "outside-vault")
      return "SOURCE_ROOT_PHYSICAL_ALIAS";
    if (result.status === "obstructed") return "SOURCE_PATH_OBSTRUCTED";
    return undefined;
  }

  private verifyComponent(
    vaultRealPath: string,
    candidatePath: string,
  ): ReturnType<typeof verifyNativeComponent> {
    if (this.native === undefined)
      return Promise.resolve({ status: "capability-unavailable" });
    const native = this.native;
    return verifyNativeComponent(
      {
        ...native,
        aliasCapability: () =>
          Promise.resolve(
            this.capabilityVaultRealPath === vaultRealPath
              ? {
                  kind: "available",
                  capability:
                    native.platform === "win32"
                      ? "windows-reparse-point"
                      : "macos-mount-point",
                }
              : {
                  kind: "unavailable",
                  capability:
                    native.platform === "win32"
                      ? "windows-reparse-point"
                      : "macos-mount-point",
                },
          ),
      },
      vaultRealPath,
      candidatePath,
    );
  }

  private async rootSnapshot(): Promise<RootSnapshot> {
    try {
      return await this.rootSnapshotUnchecked();
    } catch {
      return blocked("SOURCE_NATIVE_PROBE_INDETERMINATE");
    }
  }

  private async rootSnapshotUnchecked(): Promise<RootSnapshot> {
    this.capabilityVaultRealPath = undefined;
    const normalized = normalizeSourceRoot(this.sourceRoot());
    if (normalized.status === "unconfigured")
      return blocked("SOURCE_ROOT_UNCONFIGURED");
    if (normalized.status === "invalid") return blocked("INVALID_SOURCE_ROOT");
    const sourceRoot = normalized.sourceRoot;
    if (
      !isM03WellFormedString(this.io.configDir) ||
      !isM03WellFormedString(this.io.basePath)
    )
      return blocked("SOURCE_EXTERNAL_PATH_INVALID_UNICODE");
    const config = this.io.configDir.normalize("NFC");
    const sourceRootKey = pathCollisionKey(sourceRoot);
    const configKey = pathCollisionKey(config);
    if (
      sourceRootKey === configKey ||
      sourceRootKey.startsWith(`${configKey}/`)
    )
      return blocked("SOURCE_ROOT_CONFIG_DIR");

    const segments = sourceRoot.split("/");
    const observed: {
      logical: string;
      intended: string;
      match?: VaultPathEntry;
    }[] = [];
    let resolvedParent = "";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === undefined) return blocked("INVALID_SOURCE_ROOT");
      const logical = segments.slice(0, index + 1).join("/");
      let children: VaultPathEntry[];
      try {
        children = await this.io.list(resolvedParent);
      } catch (error) {
        return blocked(
          listFailureCode(error, "SOURCE_REGISTRY_ENUMERATION_FAILED"),
        );
      }
      if (children.some((entry) => !isM03WellFormedString(entry.path)))
        return blocked("SOURCE_EXTERNAL_PATH_INVALID_UNICODE");
      const intended = `${resolvedParent === "" ? "" : `${resolvedParent}/`}${segment}`;
      const collisions = children.filter(
        (entry) => pathCollisionKey(entry.path) === pathCollisionKey(intended),
      );
      const exact = collisions.filter(
        (entry) => entry.path.normalize("NFC") === logical,
      );
      if (
        collisions.length > 1 ||
        (collisions.length === 1 && exact.length !== 1)
      )
        return blocked("SOURCE_ROOT_NAME_COLLISION");
      const match = exact[0];
      observed.push({ logical, intended, ...(match && { match }) });
      if (match?.kind !== "folder") break;
      resolvedParent = match.path;
    }

    if (this.native === undefined)
      return blocked("SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE");
    const vaultReal = await this.native.realpath(this.io.basePath);
    if (vaultReal.kind !== "resolved")
      return blocked("SOURCE_NATIVE_PROBE_INDETERMINATE");
    if (!isM03WellFormedString(vaultReal.realPath))
      return blocked("SOURCE_EXTERNAL_PATH_INVALID_UNICODE");
    const capability = await this.native.aliasCapability(vaultReal.realPath);
    if (capability.kind !== "available")
      return blocked("SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE");
    this.capabilityVaultRealPath = vaultReal.realPath;
    const foldersToCreate: string[] = [];
    const resolvedFolders = new Map<string, string>();
    resolvedParent = "";
    for (let index = 0; index < observed.length; index += 1) {
      const state = observed[index];
      if (state === undefined) return blocked("INVALID_SOURCE_ROOT");
      const { logical, intended, match } = state;
      if (match === undefined) {
        const probe = await this.native.lstat(this.nativePath(intended));
        if (probe.kind === "indeterminate")
          return blocked("SOURCE_NATIVE_PROBE_INDETERMINATE");
        if (probe.kind === "present") {
          const physical = await this.verifyComponent(
            vaultReal.realPath,
            this.nativePath(intended),
          );
          const error = this.nativeError(physical);
          if (error !== undefined) return blocked(error);
          return blocked(
            physical.status === "trusted" && physical.objectKind === "directory"
              ? "SOURCE_ROOT_NOT_VAULT_VISIBLE"
              : "SOURCE_PATH_OBSTRUCTED",
          );
        }
        for (let missing = index; missing < segments.length; missing += 1) {
          const missingLogical = segments.slice(0, missing + 1).join("/");
          const missingResolved = `${resolvedParent === "" ? "" : `${resolvedParent}/`}${segments.slice(index, missing + 1).join("/")}`;
          foldersToCreate.push(missingLogical);
          resolvedFolders.set(missingLogical, missingResolved);
        }
        const resolvedRoot = resolvedFolders.get(sourceRoot);
        if (resolvedRoot === undefined)
          return blocked("SOURCE_NATIVE_PROBE_INDETERMINATE");
        return {
          status: index === 0 ? "fully-missing" : "partially-missing",
          foldersToCreate,
          resolvedRoot,
          resolvedFolders,
          vaultRealPath: vaultReal.realPath,
        };
      }
      const physical = await this.verifyComponent(
        vaultReal.realPath,
        this.nativePath(match.path),
      );
      const error = this.nativeError(physical);
      if (error !== undefined) return blocked(error);
      if (
        match.kind !== "folder" ||
        physical.status !== "trusted" ||
        physical.objectKind !== "directory"
      )
        return blocked("SOURCE_PATH_OBSTRUCTED");
      resolvedParent = match.path;
      resolvedFolders.set(logical, resolvedParent);
    }
    if (observed.length !== segments.length)
      return blocked("SOURCE_PATH_OBSTRUCTED");
    return {
      status: "existing",
      foldersToCreate,
      resolvedRoot: resolvedParent,
      resolvedFolders,
      vaultRealPath: vaultReal.realPath,
    };
  }

  public async plan(): Promise<SourceWritePlan> {
    const early = sourceWritePreRootGate({
      source: this.source,
      conversation: this.conversation,
      platform: this.platform,
      settingsPending: this.settingsPending(),
    });
    if (early !== undefined) return early;
    const root = await this.rootSnapshot();
    const preRegistry = sourceWritePreRegistryGate(
      this.input(root, [], [], []),
    );
    if (preRegistry !== undefined) return preRegistry;
    const registry = await this.discoverRegistry(root);
    if (!registry.ok)
      return planSourceWrite(this.input(blocked(registry.error), [], [], []));
    let plan = planSourceWrite(
      this.input(
        root,
        registry.registryEntries,
        registry.occupiedPaths,
        registry.malformedRegistryPaths,
      ),
    );
    if (
      root.status !== "existing" ||
      root.resolvedRoot === undefined ||
      this.native === undefined
    )
      return plan;
    const occupied = [...registry.occupiedPaths];
    for (let attempts = 0; attempts < 4; attempts += 1) {
      if (plan.disposition !== "new" && plan.disposition !== "new-version")
        return plan;
      const resolvedTarget = `${root.resolvedRoot}/${directName(plan.targetPath)}`;
      let vaultEntry: VaultPathEntry | undefined;
      try {
        vaultEntry = await this.io.lookup(resolvedTarget);
      } catch {
        return planSourceWrite(
          this.input(blocked("SOURCE_REGISTRY_ENUMERATION_FAILED"), [], [], []),
        );
      }
      if (vaultEntry !== undefined && !isM03WellFormedString(vaultEntry.path))
        return planSourceWrite(
          this.input(
            blocked("SOURCE_EXTERNAL_PATH_INVALID_UNICODE"),
            [],
            [],
            [],
          ),
        );
      let nativeTarget: Awaited<ReturnType<NativeContainmentAdapter["lstat"]>>;
      try {
        nativeTarget = await this.native.lstat(this.nativePath(resolvedTarget));
      } catch {
        return planSourceWrite(
          this.input(blocked("SOURCE_NATIVE_PROBE_INDETERMINATE"), [], [], []),
        );
      }
      if (nativeTarget.kind === "indeterminate")
        return planSourceWrite(
          this.input(blocked("SOURCE_NATIVE_PROBE_INDETERMINATE"), [], [], []),
        );
      if (vaultEntry === undefined && nativeTarget.kind === "absent")
        return plan;
      occupied.push(plan.targetPath);
      plan = planSourceWrite(
        this.input(
          root,
          registry.registryEntries,
          occupied,
          registry.malformedRegistryPaths,
        ),
      );
    }
    return plan;
  }

  private async discoverRegistry(root: RootSnapshot): Promise<
    | {
        ok: true;
        registryEntries: SourceRegistryEntry[];
        malformedRegistryPaths: string[];
        occupiedPaths: string[];
      }
    | { ok: false; error: SourceWriterDiagnosticCode }
  > {
    const registryEntries: SourceRegistryEntry[] = [];
    const malformedRegistryPaths: string[] = [];
    const occupiedPaths: string[] = [];
    if (root.status !== "existing")
      return {
        ok: true,
        registryEntries,
        malformedRegistryPaths,
        occupiedPaths,
      };
    if (
      root.resolvedRoot === undefined ||
      root.vaultRealPath === undefined ||
      this.native === undefined
    )
      return {
        ok: false,
        error: "SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE",
      };
    let children: VaultPathEntry[];
    try {
      children = await this.io.list(root.resolvedRoot);
    } catch (error) {
      return {
        ok: false,
        error: listFailureCode(error, "SOURCE_REGISTRY_ENUMERATION_FAILED"),
      };
    }
    const candidates: { resolvedPath: string; logicalPath: string }[] = [];
    for (const child of children) {
      if (!isM03WellFormedString(child.path))
        return { ok: false, error: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE" };
      const logicalPath = child.path.normalize("NFC");
      occupiedPaths.push(logicalPath);
      if (child.kind === "file" && directName(child.path).endsWith(".md"))
        candidates.push({ resolvedPath: child.path, logicalPath });
    }
    if (
      new Set(candidates.map(({ logicalPath }) => logicalPath)).size !==
      candidates.length
    )
      return { ok: false, error: "SOURCE_REGISTRY_ENUMERATION_FAILED" };
    candidates.sort((left, right) =>
      compareSourcePaths(left.logicalPath, right.logicalPath),
    );
    for (const candidate of candidates) {
      const before = await this.verifyComponent(
        root.vaultRealPath,
        this.nativePath(candidate.resolvedPath),
      );
      const beforeError = this.registryPhysicalError(before, false);
      if (beforeError !== undefined) return { ok: false, error: beforeError };
      let bytes: Uint8Array;
      try {
        bytes = await this.io.readBinary(candidate.resolvedPath);
      } catch (error) {
        return {
          ok: false,
          error: listFailureCode(error, "SOURCE_REGISTRY_READ_FAILED"),
        };
      }
      let fresh: VaultPathEntry[];
      try {
        fresh = await this.io.list(root.resolvedRoot);
      } catch (error) {
        return {
          ok: false,
          error: listFailureCode(error, "SOURCE_REGISTRY_READ_FAILED"),
        };
      }
      if (fresh.some((entry) => !isM03WellFormedString(entry.path)))
        return { ok: false, error: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE" };
      const same = fresh.filter(
        (entry) =>
          entry.kind === "file" &&
          entry.path === candidate.resolvedPath &&
          entry.path.normalize("NFC") === candidate.logicalPath,
      );
      if (same.length !== 1)
        return { ok: false, error: "SOURCE_REGISTRY_READ_FAILED" };
      const after = await this.verifyComponent(
        root.vaultRealPath,
        this.nativePath(candidate.resolvedPath),
      );
      const afterError = this.registryPhysicalError(after, true);
      if (afterError !== undefined) return { ok: false, error: afterError };
      const entry = parseSourceRegistryEntry(bytes, candidate.logicalPath);
      if (entry !== undefined) registryEntries.push(entry);
      else if (isChat2VaultLikeMalformed(bytes))
        malformedRegistryPaths.push(candidate.logicalPath);
    }
    return { ok: true, registryEntries, malformedRegistryPaths, occupiedPaths };
  }

  private registryPhysicalError(
    result: Awaited<ReturnType<typeof verifyNativeComponent>>,
    afterRead: boolean,
  ): SourceWriterDiagnosticCode | undefined {
    if (result.status === "trusted" && result.objectKind === "regular-file")
      return undefined;
    if (result.status === "external-path-invalid")
      return "SOURCE_EXTERNAL_PATH_INVALID_UNICODE";
    if (result.status === "capability-unavailable")
      return afterRead
        ? "SOURCE_NATIVE_PROBE_INDETERMINATE"
        : "SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE";
    if (result.status === "indeterminate")
      return "SOURCE_NATIVE_PROBE_INDETERMINATE";
    if (afterRead) return "SOURCE_REGISTRY_READ_FAILED";
    if (result.status === "alias" || result.status === "outside-vault")
      return "SOURCE_REGISTRY_PHYSICAL_ALIAS";
    if (result.status === "absent") return "SOURCE_NATIVE_PROBE_INDETERMINATE";
    return "SOURCE_REGISTRY_READ_FAILED";
  }

  private input(
    root: RootSnapshot,
    registryEntries: SourceRegistryEntry[],
    occupiedPaths: string[],
    malformedRegistryPaths: string[],
    forcedError?: SourceWriterDiagnosticCode,
  ): SourcePlannerInput {
    return {
      source: this.source,
      conversation: this.conversation,
      sourceRoot: this.sourceRoot(),
      platform: this.platform,
      settingsPending: this.settingsPending(),
      rootStatus: forcedError === undefined ? root.status : "blocked",
      ...(forcedError === undefined
        ? root.error === undefined
          ? {}
          : { rootError: root.error }
        : { rootError: forcedError }),
      foldersToCreate: root.foldersToCreate,
      registryEntries,
      occupiedPaths,
      malformedRegistryPaths,
    };
  }

  public async checkpointFolder(
    logicalPath: string,
  ): Promise<MutationCheckpoint> {
    const root = await this.rootSnapshot();
    if (root.status === "blocked")
      return {
        status: "blocked",
        indeterminate: root.error === "SOURCE_NATIVE_PROBE_INDETERMINATE",
      };
    if (!root.foldersToCreate.includes(logicalPath))
      return { status: "exact-directory-present" };
    const resolvedPath = root.resolvedFolders.get(logicalPath);
    return resolvedPath === undefined
      ? { status: "blocked" }
      : { status: "missing-safe", resolvedPath };
  }

  public async createFolder(resolvedPath: string): Promise<void> {
    await this.io.createFolder(resolvedPath);
  }

  public async verifyFolder(logicalPath: string): Promise<SafetyCheckpoint> {
    const root = await this.rootSnapshot();
    if (root.status === "blocked")
      return {
        status: "blocked",
        indeterminate: root.error === "SOURCE_NATIVE_PROBE_INDETERMINATE",
      };
    return root.resolvedFolders.has(logicalPath) &&
      !root.foldersToCreate.includes(logicalPath)
      ? { status: "safe" }
      : { status: "blocked" };
  }

  public async checkpointFinalParent(
    plan: Extract<SourceWritePlan, { disposition: "new" | "new-version" }>,
  ): Promise<SafetyCheckpoint> {
    const root = await this.rootSnapshot();
    if (root.status !== "existing" || root.resolvedRoot === undefined)
      return {
        status: "blocked",
        indeterminate: root.error === "SOURCE_NATIVE_PROBE_INDETERMINATE",
      };
    if (this.native === undefined) return { status: "blocked" };
    const resolvedTargetPath = `${root.resolvedRoot}/${directName(plan.targetPath)}`;
    let children: VaultPathEntry[];
    try {
      children = await this.io.list(root.resolvedRoot);
    } catch (error) {
      return error instanceof SourceExternalPathInvalidUnicodeError
        ? {
            status: "blocked",
            diagnostic: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE",
          }
        : { status: "blocked" };
    }
    if (children.some((entry) => !isM03WellFormedString(entry.path)))
      return {
        status: "blocked",
        diagnostic: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE",
      };
    if (
      children.some(
        (entry) =>
          pathCollisionKey(entry.path.normalize("NFC")) ===
          pathCollisionKey(plan.targetPath),
      )
    )
      return { status: "blocked" };
    let visible: VaultPathEntry | undefined;
    try {
      visible = await this.io.lookup(resolvedTargetPath);
    } catch {
      return { status: "blocked" };
    }
    if (visible !== undefined) {
      if (!isM03WellFormedString(visible.path))
        return {
          status: "blocked",
          diagnostic: "SOURCE_EXTERNAL_PATH_INVALID_UNICODE",
        };
      return { status: "blocked" };
    }
    let physical: Awaited<ReturnType<NativeContainmentAdapter["lstat"]>>;
    try {
      physical = await this.native.lstat(this.nativePath(resolvedTargetPath));
    } catch {
      return { status: "blocked", indeterminate: true };
    }
    if (physical.kind === "indeterminate")
      return { status: "blocked", indeterminate: true };
    if (physical.kind === "present") return { status: "blocked" };
    return { status: "safe", resolvedTargetPath };
  }

  public async createNote(
    resolvedPath: string,
    content: string,
  ): Promise<void> {
    await this.io.create(resolvedPath, content);
  }

  private async parentCheckpoint(): Promise<RootSnapshot | undefined> {
    const root = await this.rootSnapshot();
    return root.status === "existing" ? root : undefined;
  }

  public async verifyCreatedNote(
    plan: Extract<SourceWritePlan, { disposition: "new" | "new-version" }>,
  ): Promise<VerificationResult> {
    if (!this.lifecycleOpen()) return { status: "not-completed" };
    const a = await this.parentCheckpoint();
    if (!this.lifecycleOpen()) return { status: "not-completed" };
    if (
      a?.resolvedRoot === undefined ||
      a.vaultRealPath === undefined ||
      this.native === undefined
    )
      return { status: "verification-failed" };
    let children: VaultPathEntry[];
    try {
      children = await this.io.list(a.resolvedRoot);
    } catch {
      return { status: "verification-failed" };
    }
    if (!this.lifecycleOpen()) return { status: "not-completed" };
    if (children.some((entry) => !isM03WellFormedString(entry.path)))
      return { status: "verification-failed" };
    const matches = children.filter(
      (entry) =>
        entry.kind === "file" &&
        entry.path.normalize("NFC") === plan.targetPath,
    );
    if (matches.length !== 1) return { status: "verification-failed" };
    const created = matches[0];
    if (
      created === undefined ||
      parentPath(created.path) !== a.resolvedRoot ||
      !isM03WellFormedString(created.path)
    )
      return { status: "verification-failed" };
    const physical = await this.verifyComponent(
      a.vaultRealPath,
      this.nativePath(created.path),
    );
    if (!this.lifecycleOpen()) return { status: "not-completed" };
    if (physical.status !== "trusted" || physical.objectKind !== "regular-file")
      return { status: "verification-failed" };
    if ((await this.parentCheckpoint()) === undefined)
      return { status: "verification-failed" };
    if (!this.lifecycleOpen()) return { status: "not-completed" };
    let bytes: Uint8Array;
    try {
      bytes = await this.io.readBinary(created.path);
    } catch {
      return { status: "verification-failed" };
    }
    if (!this.lifecycleOpen()) return { status: "not-completed" };
    const plannedBytes = new TextEncoder().encode(plan.noteContent);
    if (
      bytes.length !== plannedBytes.length ||
      !bytes.every((byte, index) => byte === plannedBytes[index]) ||
      sha256(bytes) !== plan.noteContentFingerprint
    )
      return { status: "verification-failed" };
    const c = await this.parentCheckpoint();
    if (!this.lifecycleOpen()) return { status: "not-completed" };
    if (c === undefined) return { status: "verification-failed" };
    const rediscovered = await this.discoverRegistry(c);
    if (!this.lifecycleOpen()) return { status: "not-completed" };
    if (!rediscovered.ok) return { status: "verification-failed" };
    const trustedMatches = rediscovered.registryEntries.filter(
      (entry) => entry.path === plan.targetPath,
    );
    if (trustedMatches.length !== 1) return { status: "verification-failed" };
    const trusted = trustedMatches[0];
    if (
      trusted?.path !== plan.targetPath ||
      trusted.provider !== this.conversation.provider ||
      trusted.providerConversationId !==
        (this.conversation.providerConversationId === ""
          ? undefined
          : this.conversation.providerConversationId) ||
      trusted.contentFingerprint !== this.conversation.contentFingerprint ||
      trusted.importFingerprint !== this.source.sourceFileFingerprint
    )
      return { status: "verification-failed" };
    return { status: "verified" };
  }
}
