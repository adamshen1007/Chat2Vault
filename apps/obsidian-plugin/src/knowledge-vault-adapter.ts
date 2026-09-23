import { join } from "node:path";
import {
  compareSourcePaths,
  isChat2VaultLikeMalformed,
  isM03WellFormedString,
  m06Diagnostic,
  normalizeSourceRoot,
  parseSourceRegistryEntry,
  pathCollisionKey,
  type KnowledgeTargetObservation,
  type M06Diagnostic,
  type ResolvedKnowledgeSource,
  type ReviewedKnowledgeCandidate,
  type SourceRef,
  type SourceRegistryEntry,
} from "@chat2vault/core";
import {
  verifyNativeComponent,
  type NativeContainmentAdapter,
  type NativeComponentVerification,
} from "./containment.js";
import type { SourceVaultIO } from "./source-vault-adapter.js";

export interface KnowledgeVaultAdapter {
  resolveKnowledgeSources(
    candidate: ReviewedKnowledgeCandidate,
  ): Promise<KnowledgeSourceResolution>;
  observeKnowledgeTarget(path: string): Promise<KnowledgeTargetObservation>;
  checkpointKnowledgeTarget(path: string): Promise<KnowledgeTargetCheckpoint>;
  createKnowledgeNote(resolvedPath: string, content: string): Promise<void>;
  readKnowledgeNote(path: string): Promise<Uint8Array>;
}

export type KnowledgeSourceResolution =
  | { ok: true; sources: readonly ResolvedKnowledgeSource[] }
  | { ok: false; diagnostics: readonly M06Diagnostic[] };

export type KnowledgeTargetCheckpoint =
  | { status: "absent-safe"; resolvedPath: string }
  | { status: "changed" }
  | { status: "unsafe" };

interface ExistingRoot {
  logicalRoot: string;
  resolvedRoot: string;
  vaultRealPath: string;
}

interface AdapterContext {
  io: SourceVaultIO;
  native: NativeContainmentAdapter | undefined;
  sourceRoot: () => string;
  knowledgeRoot: () => string;
  platform: NodeJS.Platform;
  arch: string;
}

type TargetState =
  | { status: "absent"; resolvedPath: string }
  | { status: "regular-file"; bytes: Uint8Array }
  | { status: "obstructed" }
  | { status: "unsafe" };

const FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;

function directName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function nativePath(io: SourceVaultIO, vaultPath: string): string {
  return vaultPath === ""
    ? io.basePath
    : join(io.basePath, ...vaultPath.split("/"));
}

function supported(context: AdapterContext): boolean {
  return (
    context.platform === "darwin" &&
    context.arch === "x64" &&
    context.native?.platform === "darwin"
  );
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

function normalizedRoots(
  context: AdapterContext,
): { sourceRoot: string; knowledgeRoot: string } | undefined {
  const source = normalizeSourceRoot(context.sourceRoot());
  const knowledge = normalizeSourceRoot(context.knowledgeRoot());
  if (
    source.status !== "configured" ||
    knowledge.status !== "configured" ||
    rootsOverlap(source.sourceRoot, knowledge.sourceRoot)
  )
    return undefined;
  return {
    sourceRoot: source.sourceRoot,
    knowledgeRoot: knowledge.sourceRoot,
  };
}

function configContainsRoot(configDir: string, root: string): boolean {
  const configKey = pathCollisionKey(configDir.normalize("NFC"));
  const rootKey = pathCollisionKey(root);
  return rootKey === configKey || rootKey.startsWith(`${configKey}/`);
}

async function verifyExistingRoot(
  context: AdapterContext,
  logicalRoot: string,
): Promise<ExistingRoot | undefined> {
  const { io, native } = context;
  if (
    !supported(context) ||
    native === undefined ||
    !isM03WellFormedString(io.configDir) ||
    !isM03WellFormedString(io.basePath) ||
    configContainsRoot(io.configDir, logicalRoot)
  )
    return undefined;

  const vault = await native.realpath(io.basePath).catch(() => ({
    kind: "indeterminate" as const,
  }));
  if (vault.kind !== "resolved" || !isM03WellFormedString(vault.realPath))
    return undefined;
  const capability = await native.aliasCapability(vault.realPath).catch(() => ({
    kind: "unavailable" as const,
    capability: "macos-mount-point" as const,
  }));
  if (capability.kind !== "available") return undefined;

  const segments = logicalRoot.split("/");
  let resolvedParent = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) return undefined;
    const logical = segments.slice(0, index + 1).join("/");
    const children = await io.list(resolvedParent).catch(() => undefined);
    if (
      children === undefined ||
      children.some((entry) => !isM03WellFormedString(entry.path))
    )
      return undefined;
    const intended = `${resolvedParent === "" ? "" : `${resolvedParent}/`}${segment}`;
    const collisions = children.filter(
      (entry) => pathCollisionKey(entry.path) === pathCollisionKey(intended),
    );
    const exact = collisions.filter(
      (entry) => entry.path.normalize("NFC") === logical,
    );
    const match = exact[0];
    if (collisions.length !== 1 || exact.length !== 1 || match === undefined)
      return undefined;
    const physical = await verifyNativeComponent(
      native,
      vault.realPath,
      nativePath(io, match.path),
    );
    if (
      match.kind !== "folder" ||
      physical.status !== "trusted" ||
      physical.objectKind !== "directory"
    )
      return undefined;
    resolvedParent = match.path;
  }
  return {
    logicalRoot,
    resolvedRoot: resolvedParent,
    vaultRealPath: vault.realPath,
  };
}

function trustedRegularFile(result: NativeComponentVerification): boolean {
  return result.status === "trusted" && result.objectKind === "regular-file";
}

function listingStable(
  before: readonly { path: string; kind: "folder" | "file" }[],
  after: readonly { path: string; kind: "folder" | "file" }[],
): boolean {
  if (before.length !== after.length) return false;
  const canonical = (entries: typeof before) =>
    entries
      .map((entry) => `${entry.kind}\u0000${entry.path}`)
      .sort(compareSourcePaths);
  const left = canonical(before);
  const right = canonical(after);
  return left.every((entry, index) => entry === right[index]);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function strictSourceRefs(
  candidate: ReviewedKnowledgeCandidate,
): SourceRef[] | undefined {
  const rawRefs: unknown = candidate.sourceRefs;
  if (!Array.isArray(rawRefs) || rawRefs.length === 0) return undefined;
  const values: readonly unknown[] = rawRefs;
  const refs: SourceRef[] = [];
  for (const value of values) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const reference = value as Partial<SourceRef>;
    const rawFingerprints: unknown = reference.messageFingerprints;
    if (!Array.isArray(rawFingerprints)) return undefined;
    const messageFingerprints: readonly unknown[] = rawFingerprints;
    if (
      reference.provider !== "chatgpt" ||
      typeof reference.conversationFingerprint !== "string" ||
      !FINGERPRINT.test(reference.conversationFingerprint) ||
      (reference.providerConversationId !== undefined &&
        (!isM03WellFormedString(reference.providerConversationId) ||
          reference.providerConversationId.length === 0)) ||
      messageFingerprints.length > 64 ||
      messageFingerprints.some(
        (fingerprint) =>
          typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint),
      ) ||
      new Set(messageFingerprints).size !== messageFingerprints.length
    )
      return undefined;
    refs.push({
      provider: reference.provider,
      ...(reference.providerConversationId === undefined
        ? {}
        : { providerConversationId: reference.providerConversationId }),
      conversationFingerprint: reference.conversationFingerprint,
      messageFingerprints: messageFingerprints as string[],
    });
  }
  return refs;
}

async function discoverSourceRegistry(
  context: AdapterContext,
  root: ExistingRoot,
): Promise<SourceRegistryEntry[] | undefined> {
  const { io, native } = context;
  if (native === undefined) return undefined;
  const initial = await io.list(root.resolvedRoot).catch(() => undefined);
  if (
    initial === undefined ||
    initial.some(
      (entry) =>
        !isM03WellFormedString(entry.path) ||
        parentPath(entry.path) !== root.resolvedRoot,
    ) ||
    new Set(initial.map(({ path }) => pathCollisionKey(path))).size !==
      initial.length
  )
    return undefined;
  const candidates = initial
    .filter(
      (entry) =>
        entry.kind === "file" && directName(entry.path).endsWith(".md"),
    )
    .map((entry) => ({
      resolvedPath: entry.path,
      logicalPath: entry.path.normalize("NFC"),
    }));
  if (
    new Set(candidates.map(({ logicalPath }) => pathCollisionKey(logicalPath)))
      .size !== candidates.length
  )
    return undefined;
  candidates.sort((left, right) =>
    compareSourcePaths(left.logicalPath, right.logicalPath),
  );

  const entries: SourceRegistryEntry[] = [];
  for (const candidate of candidates) {
    const before = await verifyNativeComponent(
      native,
      root.vaultRealPath,
      nativePath(io, candidate.resolvedPath),
    );
    if (!trustedRegularFile(before)) return undefined;
    const sourceBytes = await io
      .readBinary(candidate.resolvedPath)
      .catch(() => undefined);
    if (sourceBytes === undefined) return undefined;
    const fresh = await io.list(root.resolvedRoot).catch(() => undefined);
    if (
      fresh === undefined ||
      fresh.some((entry) => !isM03WellFormedString(entry.path)) ||
      !listingStable(initial, fresh) ||
      fresh.filter(
        (entry) =>
          entry.kind === "file" &&
          entry.path === candidate.resolvedPath &&
          entry.path.normalize("NFC") === candidate.logicalPath,
      ).length !== 1
    )
      return undefined;
    const after = await verifyNativeComponent(
      native,
      root.vaultRealPath,
      nativePath(io, candidate.resolvedPath),
    );
    if (!trustedRegularFile(after)) return undefined;
    const confirmedBytes = await io
      .readBinary(candidate.resolvedPath)
      .catch(() => undefined);
    if (
      confirmedBytes === undefined ||
      !bytesEqual(sourceBytes, confirmedBytes)
    )
      return undefined;
    const settled = await io.list(root.resolvedRoot).catch(() => undefined);
    if (
      settled === undefined ||
      settled.some((entry) => !isM03WellFormedString(entry.path)) ||
      !listingStable(initial, settled) ||
      settled.filter(
        (entry) =>
          entry.kind === "file" &&
          entry.path === candidate.resolvedPath &&
          entry.path.normalize("NFC") === candidate.logicalPath,
      ).length !== 1
    )
      return undefined;
    const final = await verifyNativeComponent(
      native,
      root.vaultRealPath,
      nativePath(io, candidate.resolvedPath),
    );
    if (!trustedRegularFile(final)) return undefined;
    const entry = parseSourceRegistryEntry(
      confirmedBytes,
      candidate.logicalPath,
    );
    if (entry !== undefined) entries.push(entry);
    else if (isChat2VaultLikeMalformed(sourceBytes)) return undefined;
  }
  return entries;
}

function sourceIdentityEqual(
  entry: SourceRegistryEntry,
  ref: SourceRef,
): boolean {
  return (
    entry.provider === ref.provider &&
    entry.providerConversationId === ref.providerConversationId
  );
}

function sourceExact(entry: SourceRegistryEntry, ref: SourceRef): boolean {
  return (
    sourceIdentityEqual(entry, ref) &&
    entry.contentFingerprint === ref.conversationFingerprint
  );
}

async function targetState(
  context: AdapterContext,
  requestedPath: string,
  readExisting: boolean,
): Promise<TargetState> {
  try {
    const roots = normalizedRoots(context);
    const normalizedPath = normalizeSourceRoot(requestedPath);
    if (
      roots === undefined ||
      normalizedPath.status !== "configured" ||
      !normalizedPath.sourceRoot.endsWith(".md") ||
      pathCollisionKey(parentPath(normalizedPath.sourceRoot)) !==
        pathCollisionKey(roots.knowledgeRoot) ||
      parentPath(normalizedPath.sourceRoot) !== roots.knowledgeRoot
    )
      return { status: "unsafe" };
    const root = await verifyExistingRoot(context, roots.knowledgeRoot);
    if (root === undefined || context.native === undefined)
      return { status: "unsafe" };
    const resolvedPath = `${root.resolvedRoot}/${directName(normalizedPath.sourceRoot)}`;
    const children = await context.io
      .list(root.resolvedRoot)
      .catch(() => undefined);
    if (
      children === undefined ||
      children.some(
        (entry) =>
          !isM03WellFormedString(entry.path) ||
          parentPath(entry.path) !== root.resolvedRoot,
      )
    )
      return { status: "unsafe" };
    const collisions = children.filter(
      (entry) =>
        pathCollisionKey(entry.path) ===
        pathCollisionKey(normalizedPath.sourceRoot),
    );
    const exact = collisions.filter(
      (entry) => entry.path.normalize("NFC") === normalizedPath.sourceRoot,
    );
    if (
      collisions.length > 1 ||
      (collisions.length === 1 && exact.length !== 1)
    )
      return { status: "unsafe" };
    const visible = exact[0];
    if (visible === undefined) {
      const physical = await context.native
        .lstat(nativePath(context.io, resolvedPath))
        .catch(() => ({ kind: "indeterminate" as const }));
      if (physical.kind !== "absent") return { status: "unsafe" };
      const refreshedRoot = await verifyNativeComponent(
        context.native,
        root.vaultRealPath,
        nativePath(context.io, root.resolvedRoot),
      );
      return refreshedRoot.status === "trusted" &&
        refreshedRoot.objectKind === "directory"
        ? { status: "absent", resolvedPath }
        : { status: "unsafe" };
    }
    const before = await verifyNativeComponent(
      context.native,
      root.vaultRealPath,
      nativePath(context.io, visible.path),
    );
    if (
      before.status === "trusted" &&
      before.objectKind === "directory" &&
      visible.kind === "folder"
    )
      return { status: "obstructed" };
    if (visible.kind !== "file" || !trustedRegularFile(before))
      return { status: "unsafe" };
    if (!readExisting) return { status: "obstructed" };
    const observedBytes = await context.io
      .readBinary(visible.path)
      .catch(() => undefined);
    if (observedBytes === undefined) return { status: "unsafe" };
    const fresh = await context.io
      .list(root.resolvedRoot)
      .catch(() => undefined);
    const freshCollisions = fresh?.filter(
      (entry) =>
        pathCollisionKey(entry.path) ===
        pathCollisionKey(normalizedPath.sourceRoot),
    );
    const freshCollision =
      freshCollisions?.length === 1 ? freshCollisions[0] : undefined;
    if (
      fresh === undefined ||
      fresh.some(
        (entry) =>
          !isM03WellFormedString(entry.path) ||
          parentPath(entry.path) !== root.resolvedRoot,
      ) ||
      freshCollision?.kind !== "file" ||
      freshCollision.path !== visible.path
    )
      return { status: "unsafe" };
    const after = await verifyNativeComponent(
      context.native,
      root.vaultRealPath,
      nativePath(context.io, visible.path),
    );
    return trustedRegularFile(after)
      ? { status: "regular-file", bytes: new Uint8Array(observedBytes) }
      : { status: "unsafe" };
  } catch {
    return { status: "unsafe" };
  }
}

function sourceFailure(
  code:
    | "KNOWLEDGE_SOURCE_UNRESOLVED"
    | "KNOWLEDGE_SOURCE_AMBIGUOUS"
    | "KNOWLEDGE_SOURCE_STALE",
): KnowledgeSourceResolution {
  return { ok: false, diagnostics: [m06Diagnostic(code)] };
}

export class ObsidianKnowledgeVaultAdapter implements KnowledgeVaultAdapter {
  readonly #context: AdapterContext;

  public constructor(
    io: SourceVaultIO,
    native: NativeContainmentAdapter | undefined,
    sourceRoot: () => string,
    knowledgeRoot: () => string,
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
  ) {
    this.#context = {
      io,
      native,
      sourceRoot,
      knowledgeRoot,
      platform,
      arch,
    };
  }

  public async resolveKnowledgeSources(
    candidate: ReviewedKnowledgeCandidate,
  ): Promise<KnowledgeSourceResolution> {
    try {
      const context = this.#context;
      const roots = normalizedRoots(context);
      const refs = strictSourceRefs(candidate);
      if (roots === undefined || refs === undefined || !supported(context))
        return sourceFailure("KNOWLEDGE_SOURCE_STALE");
      const root = await verifyExistingRoot(context, roots.sourceRoot);
      if (root === undefined) return sourceFailure("KNOWLEDGE_SOURCE_STALE");
      const registry = await discoverSourceRegistry(context, root);
      if (registry === undefined)
        return sourceFailure("KNOWLEDGE_SOURCE_STALE");
      const resolved: ResolvedKnowledgeSource[] = [];
      for (const ref of refs) {
        const matches = registry.filter((entry) => sourceExact(entry, ref));
        if (matches.length > 1)
          return sourceFailure("KNOWLEDGE_SOURCE_AMBIGUOUS");
        const match = matches[0];
        if (match === undefined)
          return sourceFailure(
            registry.some((entry) => sourceIdentityEqual(entry, ref))
              ? "KNOWLEDGE_SOURCE_STALE"
              : "KNOWLEDGE_SOURCE_UNRESOLVED",
          );
        resolved.push({
          provider: ref.provider,
          ...(ref.providerConversationId === undefined
            ? {}
            : { providerConversationId: ref.providerConversationId }),
          conversationFingerprint: ref.conversationFingerprint,
          messageFingerprints: [...ref.messageFingerprints],
          sourceNotePath: match.path,
        });
      }
      return { ok: true, sources: resolved };
    } catch {
      return sourceFailure("KNOWLEDGE_SOURCE_STALE");
    }
  }

  public async observeKnowledgeTarget(
    path: string,
  ): Promise<KnowledgeTargetObservation> {
    const state = await targetState(this.#context, path, true);
    if (state.status === "absent") return { status: "absent" };
    if (state.status === "regular-file")
      return { status: "regular-file", bytes: state.bytes };
    return { status: state.status };
  }

  public async checkpointKnowledgeTarget(
    path: string,
  ): Promise<KnowledgeTargetCheckpoint> {
    const state = await targetState(this.#context, path, false);
    if (state.status === "absent")
      return { status: "absent-safe", resolvedPath: state.resolvedPath };
    return { status: state.status === "unsafe" ? "unsafe" : "changed" };
  }

  public async createKnowledgeNote(
    resolvedPath: string,
    content: string,
  ): Promise<void> {
    const checkpoint = await this.checkpointKnowledgeTarget(resolvedPath);
    if (
      checkpoint.status !== "absent-safe" ||
      checkpoint.resolvedPath !== resolvedPath
    )
      throw new Error("Knowledge target is not absent-safe");
    await this.#context.io.create(resolvedPath, content);
  }

  public async readKnowledgeNote(path: string): Promise<Uint8Array> {
    const observed = await targetState(this.#context, path, true);
    if (observed.status !== "regular-file")
      throw new Error("Knowledge note is not safely readable");
    return observed.bytes;
  }
}
