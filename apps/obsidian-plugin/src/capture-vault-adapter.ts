import { join } from "node:path";
import type { App } from "obsidian";
import {
  CAPTURE_STAGING_MAX_BYTES,
  isChat2VaultLikeMalformed,
  isM03WellFormedString,
  normalizeSourceRoot,
  parseCaptureSource,
  parseSourceRegistryEntry,
  parseStagingCapture,
  pathCollisionKey,
  renderCaptureSource,
  safeSourceTitle,
  sha256,
  validateCapture,
  type CaptureDraft,
  type CaptureSourceRegistryEntry,
} from "@chat2vault/core";
import {
  isNativePathContained,
  verifyNativeComponent,
  type NativeContainmentAdapter,
} from "./containment.js";
import {
  observeNativeVaultIdentity,
  publishNativeVaultFileExclusive,
  type NativeTemporaryArtifact,
  type NativeVaultIdentity,
  type NativeVaultPublishRequest,
  type NativeVaultPublishResult,
} from "./native-observer.js";
import {
  createObsidianSourceVaultIO,
  type SourceVaultIO,
  type VaultPathEntry,
} from "./source-vault-adapter.js";
import type {
  CaptureReconciliationClearResult,
  CaptureReconciliationService,
  CaptureReconciliationStatus,
  CaptureReconciliationToken,
  CaptureTemporaryCandidate,
} from "./capture-reconciliation.js";

export type {
  CaptureReconciliationService,
  CaptureReconciliationStatus,
  CaptureReconciliationToken,
} from "./capture-reconciliation.js";

const encoder = new TextEncoder();
const CAPTURE_REGISTRY_MAX_ENTRIES = 10_000;

export interface CaptureVaultIO extends Pick<
  SourceVaultIO,
  "configDir" | "basePath" | "list" | "lookup" | "readBinaryBounded"
> {
  observeIdentity(path: string): Promise<NativeVaultIdentity | undefined>;
  publishExclusive(
    request: Omit<NativeVaultPublishRequest, "basePath">,
  ): Promise<NativeVaultPublishResult>;
}

export function createObsidianCaptureVaultIO(app: App): CaptureVaultIO {
  const io = createObsidianSourceVaultIO(app);
  return {
    configDir: io.configDir,
    basePath: io.basePath,
    list: io.list.bind(io),
    lookup: io.lookup.bind(io),
    ...(io.readBinaryBounded === undefined
      ? {}
      : { readBinaryBounded: io.readBinaryBounded.bind(io) }),
    observeIdentity: (path) =>
      Promise.resolve(observeNativeVaultIdentity(io.basePath, path)),
    publishExclusive: (request) =>
      publishNativeVaultFileExclusive({ ...request, basePath: io.basePath }),
  };
}

export interface CapturePlanInput {
  draft: CaptureDraft;
  source:
    | { kind: "staging"; path: string; digest: string }
    | { kind: "manual"; fingerprint: string };
}

interface RootIdentity {
  logicalPath: string;
  resolvedPath: string;
  realPath: string;
  physicalIdentity: NativeVaultIdentity;
}

interface CapturePlanBase {
  sourceRoot: RootIdentity;
  vaultIdentity: NativeVaultIdentity;
  configIdentity: NativeVaultIdentity;
  sourceInputFingerprint: string;
  stagingPath?: string;
  settingsFingerprint: string;
  targetPath: string;
  markdown: string;
  outputDigest: string;
}

export type CaptureWritePlan =
  | (CapturePlanBase & { disposition: "create" })
  | (CapturePlanBase & {
      disposition: "existing-identical";
      existingPath: string;
    })
  | {
      disposition: "blocked";
      code: string;
      sourceInputFingerprint: string;
    };

export type CaptureSaveResult =
  | { status: "saved"; path: string }
  | { status: "existing-identical"; path: string }
  | { status: "blocked"; code: string; effect?: undefined }
  | { status: "blocked"; code: string; effect: "published" }
  | {
      status: "blocked";
      code: string;
      effect: "temporary";
      temporaryArtifact: NativeTemporaryArtifact;
    };

export interface CaptureVaultAdapter {
  reconciliation(): CaptureReconciliationStatus;
  acknowledgeReconciliation(): Promise<CaptureReconciliationClearResult>;
  readActiveStaging(
    path: string,
  ): Promise<{ bytes: Uint8Array; digest: string } | { code: string }>;
  plan(draft: CapturePlanInput): Promise<CaptureWritePlan>;
  save(
    plan: CaptureWritePlan,
    current: CapturePlanInput,
  ): Promise<CaptureSaveResult>;
}

interface AdapterOptions {
  sourceRoot(): string;
  knowledgeRoot(): string;
  settingsPending(): boolean;
  platform?: NodeJS.Platform;
  arch?: string;
}

interface RootSet {
  source: RootIdentity;
  knowledge: RootIdentity;
  config: RootIdentity;
  vaultRealPath: string;
  vaultIdentity: NativeVaultIdentity;
  settingsFingerprint: string;
}

interface RegistrySnapshot {
  listing: VaultPathEntry[];
  captures: CaptureSourceRegistryEntry[];
  occupiedKeys: Set<string>;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function directName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function rootsOverlap(left: string, right: string): boolean {
  const leftKey = pathCollisionKey(left);
  const rightKey = pathCollisionKey(right);
  return (
    leftKey === rightKey ||
    leftKey.startsWith(`${rightKey}/`) ||
    rightKey.startsWith(`${leftKey}/`)
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameIdentity(
  left: NativeVaultIdentity,
  right: NativeVaultIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function stableListing(
  left: VaultPathEntry[],
  right: VaultPathEntry[],
): boolean {
  const normalize = (values: VaultPathEntry[]) =>
    values
      .map(({ path, kind }) => `${kind}:${path}`)
      .sort((a, b) => a.localeCompare(b));
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function blocked(
  code: string,
  sourceInputFingerprint = "unavailable",
): CaptureWritePlan {
  return { disposition: "blocked", code, sourceInputFingerprint };
}

export class ObsidianCaptureVaultAdapter implements CaptureVaultAdapter {
  public constructor(
    private readonly io: CaptureVaultIO,
    private readonly native: NativeContainmentAdapter | undefined,
    private readonly options: AdapterOptions,
    private readonly reconciliationService: CaptureReconciliationService,
  ) {}

  public reconciliation(): CaptureReconciliationStatus {
    return this.reconciliationService.current();
  }

  public acknowledgeReconciliation(): Promise<CaptureReconciliationClearResult> {
    return this.reconciliationService.acknowledge();
  }

  private nativePath(vaultPath: string): string {
    return vaultPath === ""
      ? this.io.basePath
      : join(this.io.basePath, ...vaultPath.split("/"));
  }

  private supported(): boolean {
    return (
      (this.options.platform ?? process.platform) === "darwin" &&
      (this.options.arch ?? process.arch) === "x64" &&
      this.native?.platform === "darwin"
    );
  }

  private async verifyExactPath(
    logicalPath: string,
    vaultRealPath: string,
    leafKind: "directory" | "regular-file",
  ): Promise<RootIdentity | undefined> {
    if (this.native === undefined) return undefined;
    const segments = logicalPath.split("/");
    let resolvedParent = "";
    let realPath = vaultRealPath;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === undefined) return undefined;
      const logical = segments.slice(0, index + 1).join("/");
      const entries = await this.io.list(resolvedParent).catch(() => undefined);
      if (
        entries === undefined ||
        entries.some(
          (entry) =>
            !isM03WellFormedString(entry.path) ||
            parentPath(entry.path) !== resolvedParent,
        )
      )
        return undefined;
      const intended = `${resolvedParent === "" ? "" : `${resolvedParent}/`}${segment}`;
      const collisions = entries.filter(
        (entry) => pathCollisionKey(entry.path) === pathCollisionKey(intended),
      );
      const exact = collisions.filter(
        (entry) => entry.path.normalize("NFC") === logical,
      );
      const match = exact[0];
      if (collisions.length !== 1 || exact.length !== 1 || match === undefined)
        return undefined;
      const expected = index + 1 === segments.length ? leafKind : "directory";
      const physical = await verifyNativeComponent(
        this.native,
        vaultRealPath,
        this.nativePath(match.path),
      );
      if (
        physical.status !== "trusted" ||
        physical.objectKind !== expected ||
        match.kind !== (expected === "directory" ? "folder" : "file")
      )
        return undefined;
      resolvedParent = match.path;
      realPath = physical.realPath;
    }
    const physicalIdentity = await this.io
      .observeIdentity(resolvedParent)
      .catch(() => undefined);
    if (physicalIdentity === undefined) return undefined;
    return {
      logicalPath,
      resolvedPath: resolvedParent,
      realPath,
      physicalIdentity,
    };
  }

  private async roots(): Promise<RootSet | undefined> {
    if (
      this.options.settingsPending() ||
      !this.supported() ||
      this.native === undefined ||
      !isM03WellFormedString(this.io.basePath) ||
      !isM03WellFormedString(this.io.configDir)
    )
      return undefined;
    const source = normalizeSourceRoot(this.options.sourceRoot());
    const knowledge = normalizeSourceRoot(this.options.knowledgeRoot());
    const configPath = this.io.configDir.normalize("NFC");
    if (
      source.status !== "configured" ||
      knowledge.status !== "configured" ||
      configPath.length === 0 ||
      configPath.startsWith("/") ||
      configPath.includes("\\") ||
      configPath
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") ||
      rootsOverlap(source.sourceRoot, knowledge.sourceRoot) ||
      rootsOverlap(source.sourceRoot, configPath) ||
      rootsOverlap(knowledge.sourceRoot, configPath)
    )
      return undefined;
    const vault = await this.native.realpath(this.io.basePath).catch(() => ({
      kind: "indeterminate" as const,
    }));
    if (vault.kind !== "resolved" || !isM03WellFormedString(vault.realPath))
      return undefined;
    const capability = await this.native
      .aliasCapability(vault.realPath)
      .catch(() => ({
        kind: "unavailable" as const,
        capability: "macos-mount-point" as const,
      }));
    if (capability.kind !== "available") return undefined;
    const vaultIdentity = await this.io
      .observeIdentity("")
      .catch(() => undefined);
    if (vaultIdentity === undefined) return undefined;
    const sourceIdentity = await this.verifyExactPath(
      source.sourceRoot,
      vault.realPath,
      "directory",
    );
    const knowledgeIdentity = await this.verifyExactPath(
      knowledge.sourceRoot,
      vault.realPath,
      "directory",
    );
    if (sourceIdentity === undefined || knowledgeIdentity === undefined)
      return undefined;
    if (
      isNativePathContained(
        sourceIdentity.realPath,
        knowledgeIdentity.realPath,
        "/",
      ) ||
      isNativePathContained(
        knowledgeIdentity.realPath,
        sourceIdentity.realPath,
        "/",
      )
    )
      return undefined;
    const configIdentity = await this.verifyExactPath(
      configPath,
      vault.realPath,
      "directory",
    );
    if (
      configIdentity === undefined ||
      [sourceIdentity, knowledgeIdentity].some(
        (root) =>
          isNativePathContained(root.realPath, configIdentity.realPath, "/") ||
          isNativePathContained(configIdentity.realPath, root.realPath, "/"),
      )
    )
      return undefined;
    const settingsFingerprint = sha256(
      encoder.encode(
        JSON.stringify({
          source: sourceIdentity,
          knowledge: knowledgeIdentity,
          configDir: configPath,
          vaultRealPath: vault.realPath,
          vaultIdentity,
        }),
      ),
    );
    return {
      source: sourceIdentity,
      knowledge: knowledgeIdentity,
      config: configIdentity,
      vaultRealPath: vault.realPath,
      vaultIdentity,
      settingsFingerprint,
    };
  }

  private stagingPathSafe(path: string, roots: RootSet): boolean {
    const normalized = normalizeSourceRoot(path);
    if (
      normalized.status !== "configured" ||
      !normalized.sourceRoot.endsWith(".md") ||
      normalized.sourceRoot !== path.normalize("NFC")
    )
      return false;
    return ![
      roots.source.logicalPath,
      roots.knowledge.logicalPath,
      this.io.configDir.normalize("NFC"),
    ].some((root) => {
      const pathKey = pathCollisionKey(normalized.sourceRoot);
      const rootKey = pathCollisionKey(root);
      return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
    });
  }

  public async readActiveStaging(
    path: string,
  ): Promise<{ bytes: Uint8Array; digest: string } | { code: string }> {
    try {
      const roots = await this.roots();
      if (roots === undefined || !this.stagingPathSafe(path, roots))
        return { code: "CAPTURE_STAGING_PATH_UNSAFE" };
      const logicalPath = path.normalize("NFC");
      const before = await this.verifyExactPath(
        logicalPath,
        roots.vaultRealPath,
        "regular-file",
      );
      if (before === undefined) return { code: "CAPTURE_STAGING_READ_FAILED" };
      if (
        [roots.source, roots.knowledge, roots.config].some(
          (root) =>
            isNativePathContained(root.realPath, before.realPath, "/") ||
            isNativePathContained(before.realPath, root.realPath, "/"),
        )
      )
        return { code: "CAPTURE_STAGING_PATH_UNSAFE" };
      if (this.io.readBinaryBounded === undefined)
        return { code: "CAPTURE_STAGING_READ_FAILED" };
      const value = await this.io.readBinaryBounded(
        before.resolvedPath,
        CAPTURE_STAGING_MAX_BYTES,
      );
      if (value.length > CAPTURE_STAGING_MAX_BYTES)
        return { code: "CAPTURE_STAGING_TOO_LARGE" };
      const after = await this.verifyExactPath(
        logicalPath,
        roots.vaultRealPath,
        "regular-file",
      );
      if (
        after?.resolvedPath !== before.resolvedPath ||
        after.realPath !== before.realPath ||
        !sameIdentity(after.physicalIdentity, before.physicalIdentity)
      )
        return { code: "CAPTURE_STAGING_READ_FAILED" };
      const copied = new Uint8Array(value);
      return { bytes: copied, digest: sha256(copied) };
    } catch {
      return { code: "CAPTURE_STAGING_READ_FAILED" };
    }
  }

  private sourceFingerprint(input: CapturePlanInput): string {
    return input.source.kind === "staging"
      ? input.source.digest
      : input.source.fingerprint;
  }

  private canonicalDraft(draft: CaptureDraft): CaptureDraft | undefined {
    // Runtime callers can bypass the TypeScript shape.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (draft === null || typeof draft !== "object") return undefined;
    const expectedKeys = ["fingerprint", "method", "scope", "text"];
    if (draft.sourceUrl !== undefined) expectedKeys.push("sourceUrl");
    if (draft.title !== undefined) expectedKeys.push("title");
    const actualKeys = Object.keys(draft).sort();
    expectedKeys.sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    )
      return undefined;
    const validation = validateCapture({
      method: draft.method,
      text: draft.text,
      ...(draft.sourceUrl === undefined ? {} : { sourceUrl: draft.sourceUrl }),
      ...(draft.title === undefined ? {} : { title: draft.title }),
    });
    if (!validation.ok) return undefined;
    const canonical = validation.draft;
    // Keep every persisted field runtime-bound even where current unions narrow it.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return draft.scope === canonical.scope &&
      draft.method === canonical.method &&
      draft.text === canonical.text &&
      draft.sourceUrl === canonical.sourceUrl &&
      draft.title === canonical.title &&
      draft.fingerprint === canonical.fingerprint
      ? canonical
      : undefined;
  }

  private async validateInput(input: CapturePlanInput): Promise<boolean> {
    const canonical = this.canonicalDraft(input.draft);
    if (canonical === undefined) return false;
    if (input.source.kind === "manual")
      return input.source.fingerprint === canonical.fingerprint;
    const observed = await this.readActiveStaging(input.source.path);
    if ("code" in observed || observed.digest !== input.source.digest)
      return false;
    const parsed = parseStagingCapture(observed.bytes);
    return (
      parsed.ok &&
      parsed.draft.method === canonical.method &&
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      parsed.draft.scope === canonical.scope &&
      parsed.draft.text === canonical.text &&
      parsed.draft.sourceUrl === canonical.sourceUrl &&
      parsed.draft.title === canonical.title &&
      parsed.draft.fingerprint === canonical.fingerprint
    );
  }

  private async registry(
    roots: RootSet,
  ): Promise<RegistrySnapshot | undefined> {
    if (this.io.readBinaryBounded === undefined) return undefined;
    const initial = await this.io
      .list(roots.source.resolvedPath)
      .catch(() => undefined);
    if (
      initial === undefined ||
      initial.length > CAPTURE_REGISTRY_MAX_ENTRIES ||
      initial.some(
        (entry) =>
          !isM03WellFormedString(entry.path) ||
          parentPath(entry.path) !== roots.source.resolvedPath,
      ) ||
      new Set(initial.map((entry) => pathCollisionKey(entry.path))).size !==
        initial.length
    )
      return undefined;
    const captures: CaptureSourceRegistryEntry[] = [];
    let aggregateBytes = 0;
    for (const entry of initial) {
      if (entry.kind !== "file" || !entry.path.endsWith(".md")) continue;
      const before = await this.verifyExactPath(
        entry.path.normalize("NFC"),
        roots.vaultRealPath,
        "regular-file",
      );
      if (before === undefined) return undefined;
      const value = await this.io
        .readBinaryBounded(before.resolvedPath, CAPTURE_STAGING_MAX_BYTES)
        .catch(() => undefined);
      if (value === undefined || value.length > CAPTURE_STAGING_MAX_BYTES)
        return undefined;
      aggregateBytes += value.length;
      if (aggregateBytes > 16 * CAPTURE_STAGING_MAX_BYTES) return undefined;
      const after = await this.verifyExactPath(
        entry.path.normalize("NFC"),
        roots.vaultRealPath,
        "regular-file",
      );
      if (
        before.resolvedPath !== after?.resolvedPath ||
        before.realPath !== after.realPath ||
        !sameIdentity(before.physicalIdentity, after.physicalIdentity)
      )
        return undefined;
      const capture = parseCaptureSource(value, entry.path.normalize("NFC"));
      if (capture.ok) captures.push(capture.entry);
      else if (
        parseSourceRegistryEntry(value, entry.path.normalize("NFC")) ===
          undefined &&
        isChat2VaultLikeMalformed(value)
      )
        return undefined;
    }
    const final = await this.io
      .list(roots.source.resolvedPath)
      .catch(() => undefined);
    if (final === undefined || !stableListing(initial, final)) return undefined;
    return {
      listing: initial,
      captures,
      occupiedKeys: new Set(
        initial.map((entry) => pathCollisionKey(entry.path)),
      ),
    };
  }

  private candidatePath(
    draft: CaptureDraft,
    root: RootIdentity,
    occupiedKeys: Set<string>,
  ): string | undefined {
    const title = safeSourceTitle(draft.title ?? "ChatGPT capture");
    const hex = draft.fingerprint.slice("sha256:".length);
    const candidate = `${root.logicalPath}/${title} - ${hex.slice(0, 12)}.md`;
    return occupiedKeys.has(pathCollisionKey(candidate))
      ? undefined
      : candidate;
  }

  public async plan(input: CapturePlanInput): Promise<CaptureWritePlan> {
    const sourceInputFingerprint = this.sourceFingerprint(input);
    try {
      if (!(await this.validateInput(input)))
        return blocked("CAPTURE_INPUT_INVALID", sourceInputFingerprint);
      const roots = await this.roots();
      if (roots === undefined)
        return blocked("CAPTURE_ROOTS_UNSAFE", sourceInputFingerprint);
      const registry = await this.registry(roots);
      if (registry === undefined)
        return blocked("CAPTURE_REGISTRY_UNSAFE", sourceInputFingerprint);
      const markdown = renderCaptureSource(input.draft);
      const outputBytes = encoder.encode(markdown);
      if (outputBytes.length > CAPTURE_STAGING_MAX_BYTES)
        return blocked("CAPTURE_OUTPUT_TOO_LARGE", sourceInputFingerprint);
      const outputDigest = sha256(outputBytes);
      const duplicates = registry.captures.filter(
        (entry) => entry.contentFingerprint === input.draft.fingerprint,
      );
      if (duplicates.length > 1)
        return blocked("CAPTURE_REGISTRY_UNSAFE", sourceInputFingerprint);
      const duplicate = duplicates[0];
      const targetPath =
        duplicate?.path ??
        this.candidatePath(input.draft, roots.source, registry.occupiedKeys);
      if (targetPath === undefined)
        return blocked("CAPTURE_TARGET_COLLISION", sourceInputFingerprint);
      const base: CapturePlanBase = {
        sourceRoot: roots.source,
        vaultIdentity: roots.vaultIdentity,
        configIdentity: roots.config.physicalIdentity,
        sourceInputFingerprint,
        ...(input.source.kind === "staging"
          ? { stagingPath: input.source.path.normalize("NFC") }
          : {}),
        settingsFingerprint: roots.settingsFingerprint,
        targetPath,
        markdown,
        outputDigest,
      };
      return duplicate === undefined
        ? { ...base, disposition: "create" }
        : {
            ...base,
            disposition: "existing-identical",
            existingPath: duplicate.path,
          };
    } catch {
      return blocked("CAPTURE_PLAN_FAILED", sourceInputFingerprint);
    }
  }

  private plansEqual(left: CaptureWritePlan, right: CaptureWritePlan): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  public async save(
    plan: CaptureWritePlan,
    current: CapturePlanInput,
  ): Promise<CaptureSaveResult> {
    if (this.reconciliationService.current().status !== "clear")
      return {
        status: "blocked",
        code: "CAPTURE_RECONCILIATION_REQUIRED",
      };
    if (plan.disposition === "blocked")
      return { status: "blocked", code: plan.code };
    const refreshed = await this.plan(current);
    if (!this.plansEqual(plan, refreshed))
      return { status: "blocked", code: "CAPTURE_REPLAN_REQUIRED" };
    if (plan.disposition === "existing-identical")
      return { status: "existing-identical", path: plan.existingPath };
    let writeAheadPrepared = false;
    let publishAttempted = false;
    let reconciliationToken: CaptureReconciliationToken | undefined;
    try {
      const roots = await this.roots();
      if (
        roots?.settingsFingerprint !== plan.settingsFingerprint ||
        roots.source.realPath !== plan.sourceRoot.realPath ||
        !sameIdentity(roots.vaultIdentity, plan.vaultIdentity) ||
        !sameIdentity(
          roots.source.physicalIdentity,
          plan.sourceRoot.physicalIdentity,
        ) ||
        !sameIdentity(roots.config.physicalIdentity, plan.configIdentity)
      )
        return { status: "blocked", code: "CAPTURE_REPLAN_REQUIRED" };
      const registry = await this.registry(roots);
      if (
        registry === undefined ||
        registry.occupiedKeys.has(pathCollisionKey(plan.targetPath))
      )
        return { status: "blocked", code: "CAPTURE_REPLAN_REQUIRED" };
      const expectedResolved = `${roots.source.resolvedPath}/${directName(plan.targetPath)}`;
      const visible = await this.io
        .lookup(expectedResolved)
        .catch(() => undefined);
      const physical = await this.native
        ?.lstat(this.nativePath(expectedResolved))
        .catch(() => ({ kind: "indeterminate" as const }));
      if (visible !== undefined || physical?.kind !== "absent")
        return { status: "blocked", code: "CAPTURE_REPLAN_REQUIRED" };

      const prepared = await this.reconciliationService.prepare({
        targetPathDigest: sha256(encoder.encode(plan.targetPath)),
        targetLocator: current.draft.fingerprint
          .slice("sha256:".length)
          .slice(0, 12),
        sourceRootPathDigest: sha256(encoder.encode(roots.source.logicalPath)),
        sourceRootIdentity: { ...roots.source.physicalIdentity },
      });
      if (prepared.status === "failed")
        return { status: "blocked", code: prepared.code };
      reconciliationToken = prepared.token;
      writeAheadPrepared = true;
      publishAttempted = true;
      const published = await this.io
        .publishExclusive({
          parentPath: roots.source.resolvedPath,
          targetName: directName(plan.targetPath),
          configPath: roots.config.resolvedPath,
          bytes: encoder.encode(plan.markdown),
          vaultIdentity: roots.vaultIdentity,
          parentIdentity: roots.source.physicalIdentity,
          configIdentity: roots.config.physicalIdentity,
        })
        .catch(() => ({ kind: "uncertain", effect: "published" }) as const);
      if (published.kind === "collision" || published.kind === "failed") {
        const cleared =
          await this.reconciliationService.clearKnownOutcome(
            reconciliationToken,
          );
        if (cleared.status === "failed")
          return { status: "blocked", code: cleared.code };
        return published.kind === "collision"
          ? { status: "blocked", code: "CAPTURE_REPLAN_REQUIRED" }
          : { status: "blocked", code: "CAPTURE_CREATE_FAILED" };
      }
      if (published.kind === "uncertain") {
        if (published.effect === "temporary") {
          const temporaryCandidate: CaptureTemporaryCandidate = {
            name: directName(published.temporaryArtifact.path),
            ownership: "unverified",
            ...(published.temporaryArtifact.identity === undefined
              ? {}
              : { identity: { ...published.temporaryArtifact.identity } }),
          };
          await this.reconciliationService.markUncertain(
            reconciliationToken,
            "temporary",
            temporaryCandidate,
          );
          return {
            status: "blocked",
            code: "CAPTURE_EFFECT_UNCERTAIN",
            effect: "temporary",
            temporaryArtifact: published.temporaryArtifact,
          };
        }
        await this.reconciliationService.markUncertain(
          reconciliationToken,
          "published",
        );
        return {
          status: "blocked",
          code: "CAPTURE_EFFECT_UNCERTAIN",
          effect: "published",
        };
      }
      const created = await this.verifyExactPath(
        plan.targetPath,
        roots.vaultRealPath,
        "regular-file",
      );
      if (created === undefined) {
        await this.reconciliationService.markUncertain(
          reconciliationToken,
          "published",
        );
        return {
          status: "blocked",
          code: "CAPTURE_EFFECT_UNCERTAIN",
          effect: "published",
        };
      }
      const readback = await this.io
        .readBinaryBounded?.(created.resolvedPath, CAPTURE_STAGING_MAX_BYTES)
        .catch(() => undefined);
      const planned = encoder.encode(plan.markdown);
      if (
        readback === undefined ||
        readback.length > CAPTURE_STAGING_MAX_BYTES ||
        !sameBytes(readback, planned) ||
        sha256(readback) !== plan.outputDigest
      ) {
        await this.reconciliationService.markUncertain(
          reconciliationToken,
          "published",
        );
        return {
          status: "blocked",
          code: "CAPTURE_EFFECT_UNCERTAIN",
          effect: "published",
        };
      }
      const finalRoots = await this.roots();
      if (
        finalRoots?.settingsFingerprint !== plan.settingsFingerprint ||
        !sameIdentity(finalRoots.vaultIdentity, plan.vaultIdentity) ||
        !sameIdentity(
          finalRoots.source.physicalIdentity,
          plan.sourceRoot.physicalIdentity,
        ) ||
        !sameIdentity(finalRoots.config.physicalIdentity, plan.configIdentity)
      ) {
        await this.reconciliationService.markUncertain(
          reconciliationToken,
          "published",
        );
        return {
          status: "blocked",
          code: "CAPTURE_EFFECT_UNCERTAIN",
          effect: "published",
        };
      }
      const finalRegistry = await this.registry(finalRoots);
      const exact = finalRegistry?.captures.filter(
        (entry) =>
          entry.path === plan.targetPath &&
          entry.contentFingerprint === current.draft.fingerprint,
      );
      if (exact?.length !== 1) {
        await this.reconciliationService.markUncertain(
          reconciliationToken,
          "published",
        );
        return {
          status: "blocked",
          code: "CAPTURE_EFFECT_UNCERTAIN",
          effect: "published",
        };
      }
      const cleared =
        await this.reconciliationService.clearKnownOutcome(reconciliationToken);
      if (cleared.status === "failed")
        return {
          status: "blocked",
          code: cleared.code,
          effect: "published",
        };
      return { status: "saved", path: plan.targetPath };
    } catch {
      if (
        writeAheadPrepared &&
        publishAttempted &&
        reconciliationToken !== undefined
      ) {
        await this.reconciliationService
          .markUncertain(reconciliationToken, "published")
          .catch(() => undefined);
        return {
          status: "blocked",
          code: "CAPTURE_EFFECT_UNCERTAIN",
          effect: "published",
        };
      }
      return { status: "blocked", code: "CAPTURE_CREATE_FAILED" };
    }
  }
}
