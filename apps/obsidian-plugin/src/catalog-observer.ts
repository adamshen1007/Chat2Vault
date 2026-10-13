import { join } from "node:path";
import {
  compareSourcePaths,
  isChat2VaultLikeMalformed,
  isM03WellFormedString,
  normalizeSourceRoot,
  parseSourceRegistryEntry,
  pathCollisionKey,
  sha256,
  type SourceRegistryEntry,
} from "@chat2vault/core";
import {
  verifyNativeComponent,
  type NativeContainmentAdapter,
  type NativeComponentVerification,
} from "./containment.js";

/** A copied read-only capability; deliberately independent of SourceVaultIO. */
export interface CatalogVaultReadIO {
  configDir: string;
  basePath: string;
  list(
    path: string,
  ): Promise<readonly { path: string; kind: "folder" | "file" }[]>;
  readBinary(path: string): Promise<Uint8Array>;
  readBinaryBounded?(path: string, maxBytes: number): Promise<Uint8Array>;
}

export type KnowledgeCatalogObservation =
  | {
      status: "ready";
      listing: readonly { path: string; kind: "folder" | "file" }[];
      files: readonly {
        path: string;
        resolvedPath: string;
        bytes: Uint8Array;
      }[];
      sources: readonly SourceRegistryEntry[];
      sourceByteDigests: readonly { path: string; digest: string }[];
    }
  | {
      status: "blocked";
      code:
        | "M07_CATALOG_UNAVAILABLE"
        | "M07_CATALOG_UNSAFE"
        | "M07_CATALOG_INCOMPLETE";
    };

interface ExistingRoot {
  logicalRoot: string;
  resolvedRoot: string;
  vaultRealPath: string;
  components: readonly RootComponent[];
}

interface RootComponent {
  logicalPath: string;
  resolvedPath: string;
  realPath: string;
}

interface ObservedSourceRegistryEntry {
  entry: SourceRegistryEntry;
  resolvedPath: string;
  bytes: Uint8Array;
}

interface ObservedSourceRegistry {
  initial: readonly { path: string; kind: "folder" | "file" }[];
  entries: readonly ObservedSourceRegistryEntry[];
}

interface RegistryCandidateSnapshot {
  logicalPath: string;
  resolvedPath: string;
  bytes: Uint8Array;
}

interface AdapterContext {
  io: CatalogVaultReadIO;
  native: NativeContainmentAdapter | undefined;
  sourceRoot: () => string;
  knowledgeRoot: () => string;
  platform: NodeJS.Platform;
  arch: string;
}

function directName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function nativePath(io: CatalogVaultReadIO, vaultPath: string): string {
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
  const components: RootComponent[] = [];
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
    components.push({
      logicalPath: logical,
      resolvedPath: match.path,
      realPath: physical.realPath,
    });
    resolvedParent = match.path;
  }
  return {
    logicalRoot,
    resolvedRoot: resolvedParent,
    vaultRealPath: vault.realPath,
    components,
  };
}

async function verifyExistingRootSnapshot(
  context: AdapterContext,
  root: ExistingRoot,
): Promise<boolean> {
  const { io, native } = context;
  if (native === undefined) return false;
  const vault = await native.realpath(io.basePath).catch(() => ({
    kind: "indeterminate" as const,
  }));
  if (vault.kind !== "resolved" || vault.realPath !== root.vaultRealPath)
    return false;

  let resolvedParent = "";
  for (const component of root.components) {
    const children = await io.list(resolvedParent).catch(() => undefined);
    if (
      children === undefined ||
      children.some((entry) => !isM03WellFormedString(entry.path))
    )
      return false;
    const collisions = children.filter(
      (entry) =>
        pathCollisionKey(entry.path) ===
        pathCollisionKey(component.resolvedPath),
    );
    const match = collisions[0];
    if (
      collisions.length !== 1 ||
      match?.kind !== "folder" ||
      match.path !== component.resolvedPath ||
      match.path.normalize("NFC") !== component.logicalPath
    )
      return false;
    const physical = await verifyNativeComponent(
      native,
      root.vaultRealPath,
      nativePath(io, match.path),
    );
    if (
      physical.status !== "trusted" ||
      physical.objectKind !== "directory" ||
      physical.realPath !== component.realPath
    )
      return false;
    resolvedParent = match.path;
  }
  return resolvedParent === root.resolvedRoot;
}

function trustedRegularFile(
  result: NativeComponentVerification,
): result is Extract<NativeComponentVerification, { status: "trusted" }> {
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

async function observeContainedRegularFile(
  context: AdapterContext,
  root: ExistingRoot,
  resolvedPath: string,
  maxBytes?: number,
): Promise<
  | { status: "regular-file"; bytes: Uint8Array }
  | { status: "unsafe" }
  | { status: "unavailable" }
> {
  const native = context.native;
  const bounded = context.io.readBinaryBounded?.bind(context.io);
  if (native === undefined || (maxBytes !== undefined && bounded === undefined))
    return { status: "unavailable" };
  const physicalPath =
    resolvedPath === ""
      ? context.io.basePath
      : join(context.io.basePath, ...resolvedPath.split("/"));
  const before = await verifyNativeComponent(
    native,
    root.vaultRealPath,
    physicalPath,
  );
  if (!trustedRegularFile(before)) return { status: "unsafe" };
  const read = () =>
    maxBytes === undefined
      ? context.io.readBinary(resolvedPath)
      : (bounded?.(resolvedPath, maxBytes) ??
        Promise.reject(new Error("Bounded read unavailable")));
  const first = await read().catch(() => undefined);
  if (
    first === undefined ||
    (maxBytes !== undefined && first.length > maxBytes + 1)
  )
    return { status: "unavailable" };
  const middle = await verifyNativeComponent(
    native,
    root.vaultRealPath,
    physicalPath,
  );
  if (!trustedRegularFile(middle) || before.realPath !== middle.realPath)
    return { status: "unsafe" };
  const second = await read().catch(() => undefined);
  if (
    second === undefined ||
    (maxBytes !== undefined && second.length > maxBytes + 1) ||
    !bytesEqual(first, second)
  )
    return { status: "unavailable" };
  const after = await verifyNativeComponent(
    native,
    root.vaultRealPath,
    physicalPath,
  );
  return trustedRegularFile(after) && middle.realPath === after.realPath
    ? { status: "regular-file", bytes: new Uint8Array(second) }
    : { status: "unsafe" };
}

async function discoverSourceRegistry(
  context: AdapterContext,
  root: ExistingRoot,
): Promise<ObservedSourceRegistry | undefined> {
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

  const entries: ObservedSourceRegistryEntry[] = [];
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
    if (entry !== undefined)
      entries.push({
        entry,
        resolvedPath: candidate.resolvedPath,
        bytes: new Uint8Array(confirmedBytes),
      });
    else if (isChat2VaultLikeMalformed(sourceBytes)) return undefined;
  }
  return { initial, entries };
}

async function readCompleteRegistrySnapshot(
  context: AdapterContext,
  root: ExistingRoot,
  initial: readonly { path: string; kind: "folder" | "file" }[],
): Promise<readonly RegistryCandidateSnapshot[] | undefined> {
  const { io, native } = context;
  if (
    native === undefined ||
    !(await verifyExistingRootSnapshot(context, root))
  )
    return undefined;
  const before = await io.list(root.resolvedRoot).catch(() => undefined);
  if (
    before === undefined ||
    before.some(
      (entry) =>
        !isM03WellFormedString(entry.path) ||
        parentPath(entry.path) !== root.resolvedRoot,
    ) ||
    !listingStable(initial, before)
  )
    return undefined;

  const candidates = before
    .filter(
      (entry) =>
        entry.kind === "file" && directName(entry.path).endsWith(".md"),
    )
    .map((entry) => ({
      logicalPath: entry.path.normalize("NFC"),
      resolvedPath: entry.path,
    }));
  if (
    new Set(candidates.map(({ logicalPath }) => pathCollisionKey(logicalPath)))
      .size !== candidates.length
  )
    return undefined;
  candidates.sort((left, right) =>
    compareSourcePaths(left.logicalPath, right.logicalPath),
  );

  const snapshot: RegistryCandidateSnapshot[] = [];
  for (const candidate of candidates) {
    const physicalBefore = await verifyNativeComponent(
      native,
      root.vaultRealPath,
      nativePath(io, candidate.resolvedPath),
    );
    if (!trustedRegularFile(physicalBefore)) return undefined;
    const bytes = await io
      .readBinary(candidate.resolvedPath)
      .catch(() => undefined);
    if (bytes === undefined) return undefined;
    const physicalAfter = await verifyNativeComponent(
      native,
      root.vaultRealPath,
      nativePath(io, candidate.resolvedPath),
    );
    if (!trustedRegularFile(physicalAfter)) return undefined;
    snapshot.push({
      ...candidate,
      bytes: new Uint8Array(bytes),
    });
  }

  const after = await io.list(root.resolvedRoot).catch(() => undefined);
  if (
    after === undefined ||
    after.some(
      (entry) =>
        !isM03WellFormedString(entry.path) ||
        parentPath(entry.path) !== root.resolvedRoot,
    ) ||
    !listingStable(initial, after) ||
    !(await verifyExistingRootSnapshot(context, root))
  )
    return undefined;
  return snapshot;
}

function registrySnapshotsEqual(
  left: readonly RegistryCandidateSnapshot[],
  right: readonly RegistryCandidateSnapshot[],
): boolean {
  return (
    left.length === right.length &&
    left.every((candidate, index) => {
      const other = right[index];
      return (
        candidate.logicalPath === other?.logicalPath &&
        candidate.resolvedPath === other.resolvedPath &&
        bytesEqual(candidate.bytes, other.bytes)
      );
    })
  );
}

async function establishFinalRegistry(
  context: AdapterContext,
  root: ExistingRoot,
  registry: ObservedSourceRegistry,
  selected: readonly ObservedSourceRegistryEntry[],
): Promise<ObservedSourceRegistry | undefined> {
  const first = await readCompleteRegistrySnapshot(
    context,
    root,
    registry.initial,
  );
  if (first === undefined) return undefined;
  const second = await readCompleteRegistrySnapshot(
    context,
    root,
    registry.initial,
  );
  if (second === undefined || !registrySnapshotsEqual(first, second))
    return undefined;

  const finalByPath = new Map(
    second.map((candidate) => [candidate.resolvedPath, candidate] as const),
  );
  for (const source of selected) {
    const final = finalByPath.get(source.resolvedPath);
    if (final === undefined || !bytesEqual(source.bytes, final.bytes))
      return undefined;
  }

  const entries: ObservedSourceRegistryEntry[] = [];
  for (const candidate of second) {
    const entry = parseSourceRegistryEntry(
      candidate.bytes,
      candidate.logicalPath,
    );
    if (entry !== undefined)
      entries.push({
        entry,
        resolvedPath: candidate.resolvedPath,
        bytes: new Uint8Array(candidate.bytes),
      });
    else if (isChat2VaultLikeMalformed(candidate.bytes)) return undefined;
  }
  return { initial: registry.initial, entries };
}

/** Complete read-only observation; no catalog parsing or write capability. */
export async function observeKnowledgeCatalog(
  io: CatalogVaultReadIO,
  native: NativeContainmentAdapter | undefined,
  sourceRoot: () => string,
  knowledgeRoot: () => string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<KnowledgeCatalogObservation> {
  const unavailable = {
    status: "blocked",
    code: "M07_CATALOG_UNAVAILABLE",
  } as const;
  const unsafe = { status: "blocked", code: "M07_CATALOG_UNSAFE" } as const;
  const incomplete = {
    status: "blocked",
    code: "M07_CATALOG_INCOMPLETE",
  } as const;
  try {
    const context: AdapterContext = {
      io,
      native,
      sourceRoot,
      knowledgeRoot,
      platform,
      arch,
    };
    const roots = normalizedRoots(context);
    if (roots === undefined || !supported(context) || native === undefined)
      return unsafe;
    const knowledge = await verifyExistingRoot(context, roots.knowledgeRoot);
    if (knowledge === undefined) return unavailable;
    const initial = await io
      .list(knowledge.resolvedRoot)
      .catch(() => undefined);
    if (initial === undefined) return unavailable;
    if (
      initial.some(
        (entry) =>
          !isM03WellFormedString(entry.path) ||
          parentPath(entry.path) !== knowledge.resolvedRoot,
      )
    )
      return incomplete;
    if (
      new Set(initial.map(({ path }) => pathCollisionKey(path))).size !==
      initial.length
    )
      return incomplete;
    const candidates = initial.filter(({ path }) =>
      directName(path).endsWith(".md"),
    );
    if (candidates.length > 10_000) return incomplete;
    candidates.sort((a, b) =>
      compareSourcePaths(a.path.normalize("NFC"), b.path.normalize("NFC")),
    );
    const files: { path: string; resolvedPath: string; bytes: Uint8Array }[] =
      [];
    for (const candidate of candidates) {
      if (candidate.kind !== "file") return unsafe;
      const observed = await observeContainedRegularFile(
        context,
        knowledge,
        candidate.path,
        128 * 1024,
      );
      if (observed.status === "unsafe") return unsafe;
      if (observed.status !== "regular-file") return incomplete;
      files.push({
        path: candidate.path.normalize("NFC"),
        resolvedPath: candidate.path,
        bytes: observed.bytes,
      });
    }
    const final = await io.list(knowledge.resolvedRoot).catch(() => undefined);
    if (
      final === undefined ||
      !listingStable(initial, final) ||
      !(await verifyExistingRootSnapshot(context, knowledge))
    )
      return incomplete;
    const source = await verifyExistingRoot(context, roots.sourceRoot);
    if (source === undefined) return incomplete;
    const registry = await discoverSourceRegistry(context, source);
    if (registry === undefined) return incomplete;
    const finalRegistry = await establishFinalRegistry(
      context,
      source,
      registry,
      registry.entries,
    );
    if (finalRegistry === undefined) return incomplete;
    const last = await io.list(knowledge.resolvedRoot).catch(() => undefined);
    if (
      last === undefined ||
      !listingStable(initial, last) ||
      !(await verifyExistingRootSnapshot(context, knowledge))
    )
      return incomplete;
    for (const file of files) {
      const latest = await observeContainedRegularFile(
        context,
        knowledge,
        file.resolvedPath,
        128 * 1024,
      );
      if (latest.status === "unsafe") return unsafe;
      if (
        latest.status !== "regular-file" ||
        !bytesEqual(file.bytes, latest.bytes)
      )
        return incomplete;
    }
    const settled = await io
      .list(knowledge.resolvedRoot)
      .catch(() => undefined);
    if (
      settled === undefined ||
      !listingStable(initial, settled) ||
      !(await verifyExistingRootSnapshot(context, knowledge))
    )
      return incomplete;
    return {
      status: "ready",
      listing: initial.map(({ path, kind }) => ({
        path: path.normalize("NFC"),
        kind,
      })),
      files,
      sources: finalRegistry.entries.map(({ entry }) => entry),
      sourceByteDigests: finalRegistry.entries.map(({ entry, bytes }) => ({
        path: entry.path,
        digest: sha256(bytes),
      })),
    };
  } catch {
    return incomplete;
  }
}
