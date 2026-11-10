import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { isM03WellFormedString } from "@chat2vault/core";
import {
  isCapturePhysicalIdentity,
  isCaptureTemporaryName,
  projectCapturePhysicalIdentity,
} from "./capture-identifiers.js";
import type {
  MacOSMountPointProbe,
  MacOSMountPointEvidence,
  PlatformAliasCapabilityState,
  WindowsReparsePointProbe,
} from "./containment.js";

interface NativeResult {
  kind: string;
  mountPath?: unknown;
  fatalUtf8?: unknown;
  returnedVolumeAttributes?: unknown;
  attrDataOffset?: unknown;
  attrLength?: unknown;
  rawMountBytesHex?: unknown;
}
interface NativeObserver {
  observeMacOSMountPoint(path: string): NativeResult;
  observeWindowsReparsePoint(path: string): NativeResult;
  readVaultFileBounded(
    root: string,
    path: string,
    maxBytes: number,
  ): Promise<unknown>;
  observeVaultIdentity(root: string, path: string): unknown;
  publishVaultFileExclusive(
    root: string,
    parentPath: string,
    targetName: string,
    configPath: string,
    bytes: Uint8Array,
    rootDevice: string,
    rootInode: string,
    parentDevice: string,
    parentInode: string,
    configDevice: string,
    configInode: string,
  ): Promise<unknown>;
}

export interface NativeVaultIdentity {
  device: string;
  inode: string;
}

export interface NativeTemporaryArtifact {
  path: string;
  ownership: "unverified";
  identity?: NativeVaultIdentity;
}

export interface NativeVaultPublishRequest {
  basePath: string;
  parentPath: string;
  targetName: string;
  configPath: string;
  bytes: Uint8Array;
  vaultIdentity: NativeVaultIdentity;
  parentIdentity: NativeVaultIdentity;
  configIdentity: NativeVaultIdentity;
}

export type NativeVaultPublishResult =
  | { kind: "published" }
  | { kind: "collision" }
  | { kind: "failed" }
  | { kind: "uncertain"; effect: "published" }
  | {
      kind: "uncertain";
      effect: "temporary";
      temporaryArtifact: NativeTemporaryArtifact;
    };

let observer: NativeObserver | undefined;
const loadNative = createRequire(__filename);

export function configureNativeObserver(absolutePath: string): boolean {
  observer = undefined;
  if (!isM03WellFormedString(absolutePath)) return false;
  try {
    const candidate = loadNative(absolutePath) as Partial<NativeObserver>;
    if (
      typeof candidate.observeMacOSMountPoint !== "function" ||
      typeof candidate.observeWindowsReparsePoint !== "function" ||
      typeof candidate.readVaultFileBounded !== "function" ||
      typeof candidate.observeVaultIdentity !== "function" ||
      typeof candidate.publishVaultFileExclusive !== "function"
    )
      return false;
    observer = candidate as NativeObserver;
    return true;
  } catch {
    observer = undefined;
    return false;
  }
}

/** Native descriptor-relative read; an unavailable or malformed result is never a fallback. */
export async function readNativeVaultFileBounded(
  basePath: string,
  path: string,
  maxBytes: number,
): Promise<Uint8Array> {
  if (
    process.platform !== "darwin" ||
    observer === undefined ||
    !isM03WellFormedString(basePath) ||
    !basePath.startsWith("/") ||
    !isM03WellFormedString(path) ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > 1_064_960
  )
    throw new Error("Bounded vault read unavailable");
  try {
    const result = await observer.readVaultFileBounded(
      basePath,
      path,
      maxBytes,
    );
    if (!Buffer.isBuffer(result) || result.length > maxBytes + 1)
      throw new Error("Bounded vault read unsafe");
    return new Uint8Array(result);
  } catch {
    throw new Error("Bounded vault read unsafe");
  }
}

function validRelativePath(path: string, allowEmpty = false): boolean {
  return (
    (allowEmpty ? typeof path === "string" : isM03WellFormedString(path)) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    (path === "" ||
      !path
        .split("/")
        .some((part) => part === "" || part === "." || part === ".."))
  );
}

function validIdentity(value: unknown): value is NativeVaultIdentity {
  return isCapturePhysicalIdentity(value);
}

function temporaryArtifact(
  value: unknown,
  parentPath: string,
): NativeTemporaryArtifact | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.path !== "string" ||
    !validRelativePath(candidate.path) ||
    candidate.ownership !== "unverified" ||
    (candidate.identity !== undefined && !validIdentity(candidate.identity))
  )
    return undefined;
  const prefix = `${parentPath}/`;
  if (!candidate.path.startsWith(prefix)) return undefined;
  const name = candidate.path.slice(prefix.length);
  if (!isCaptureTemporaryName(name)) return undefined;
  const identity =
    candidate.identity === undefined
      ? undefined
      : projectCapturePhysicalIdentity(candidate.identity);
  if (candidate.identity !== undefined && identity === undefined)
    return undefined;
  return {
    path: candidate.path,
    ownership: "unverified",
    ...(identity === undefined ? {} : { identity }),
  };
}

export function parseNativeVaultPublishResult(
  value: unknown,
  parentPath: string,
): NativeVaultPublishResult {
  if (value === null || typeof value !== "object" || !("kind" in value))
    return { kind: "uncertain", effect: "published" };
  const result = value as Record<string, unknown>;
  if (
    result.kind === "published" ||
    result.kind === "collision" ||
    result.kind === "failed"
  )
    return { kind: result.kind };
  if (result.kind === "uncertain") {
    if (result.effect === "published")
      return { kind: "uncertain", effect: "published" };
    if (result.effect === "temporary") {
      const artifact = temporaryArtifact(result.temporaryArtifact, parentPath);
      if (artifact !== undefined)
        return {
          kind: "uncertain",
          effect: "temporary",
          temporaryArtifact: artifact,
        };
    }
  }
  return { kind: "uncertain", effect: "published" };
}

/** Observe the physical identity of the vault root or a contained object. */
export function observeNativeVaultIdentity(
  basePath: string,
  path: string,
): NativeVaultIdentity | undefined {
  if (
    process.platform !== "darwin" ||
    observer === undefined ||
    !isM03WellFormedString(basePath) ||
    !basePath.startsWith("/") ||
    !validRelativePath(path, true)
  )
    return undefined;
  try {
    const result = observer.observeVaultIdentity(basePath, path);
    if (
      result === null ||
      typeof result !== "object" ||
      !("kind" in result) ||
      result.kind !== "identity" ||
      !("device" in result) ||
      !("inode" in result)
    )
      return undefined;
    const identity = { device: result.device, inode: result.inode };
    return validIdentity(identity) ? identity : undefined;
  } catch {
    return undefined;
  }
}

/** Publish exact bytes without replacing an existing target. */
export async function publishNativeVaultFileExclusive(
  request: NativeVaultPublishRequest,
): Promise<NativeVaultPublishResult> {
  if (
    process.platform !== "darwin" ||
    observer === undefined ||
    !isM03WellFormedString(request.basePath) ||
    !request.basePath.startsWith("/") ||
    !validRelativePath(request.parentPath) ||
    !isM03WellFormedString(request.targetName) ||
    request.targetName.includes("/") ||
    request.targetName.includes("\\") ||
    !validRelativePath(request.configPath) ||
    !(request.bytes instanceof Uint8Array) ||
    request.bytes.length > 1_064_960 ||
    !validIdentity(request.vaultIdentity) ||
    !validIdentity(request.parentIdentity) ||
    !validIdentity(request.configIdentity)
  )
    return { kind: "failed" };
  try {
    const result = await observer.publishVaultFileExclusive(
      request.basePath,
      request.parentPath,
      request.targetName,
      request.configPath,
      Buffer.from(request.bytes),
      request.vaultIdentity.device,
      request.vaultIdentity.inode,
      request.parentIdentity.device,
      request.parentIdentity.inode,
      request.configIdentity.device,
      request.configIdentity.inode,
    );
    return parseNativeVaultPublishResult(result, request.parentPath);
  } catch {
    return { kind: "uncertain", effect: "published" };
  }
}

export async function nativeAliasCapability(
  platform: NodeJS.Platform,
  vaultRealPath: string,
): Promise<PlatformAliasCapabilityState> {
  const capability =
    platform === "win32" ? "windows-reparse-point" : "macos-mount-point";
  if (observer === undefined || !isM03WellFormedString(vaultRealPath))
    return { kind: "unavailable", capability };
  if (platform === "darwin") {
    const probe = await observeMacOSMountPoint(vaultRealPath, vaultRealPath);
    return probe.kind === "indeterminate"
      ? { kind: "unavailable", capability }
      : { kind: "available", capability };
  }
  if (platform === "win32") {
    const probe = observeWindowsReparsePoint(vaultRealPath);
    return probe.kind === "indeterminate"
      ? { kind: "unavailable", capability }
      : { kind: "available", capability };
  }
  return { kind: "unavailable", capability: "macos-mount-point" };
}

export function observeWindowsReparsePoint(
  path: string,
): WindowsReparsePointProbe {
  if (
    observer === undefined ||
    process.platform !== "win32" ||
    !isM03WellFormedString(path)
  )
    return { kind: "indeterminate" };
  let result: NativeResult;
  try {
    result = observer.observeWindowsReparsePoint(path);
  } catch {
    return { kind: "indeterminate" };
  }
  return result.kind === "reparse-point"
    ? { kind: "reparse-point" }
    : result.kind === "not-reparse-point"
      ? { kind: "not-reparse-point" }
      : { kind: "indeterminate" };
}

export async function observeMacOSMountPoint(
  path: string,
  objectRealPath: string,
): Promise<MacOSMountPointProbe> {
  if (
    observer === undefined ||
    process.platform !== "darwin" ||
    !isM03WellFormedString(path) ||
    !isM03WellFormedString(objectRealPath)
  )
    return { kind: "indeterminate" };
  let result: NativeResult;
  try {
    result = observer.observeMacOSMountPoint(path);
  } catch {
    return { kind: "indeterminate" };
  }
  if (
    result.kind !== "mount-path" ||
    typeof result.mountPath !== "string" ||
    !isM03WellFormedString(result.mountPath) ||
    result.fatalUtf8 !== true ||
    typeof result.returnedVolumeAttributes !== "number" ||
    (result.returnedVolumeAttributes & 0x00001000) === 0 ||
    !Number.isInteger(result.attrDataOffset) ||
    !Number.isInteger(result.attrLength) ||
    (result.attrLength as number) < 1 ||
    typeof result.rawMountBytesHex !== "string" ||
    !/^(?:[0-9a-f]{2})*$/u.test(result.rawMountBytesHex)
  )
    return { kind: "indeterminate" };
  try {
    const resolvedMount = await realpath(result.mountPath);
    if (!isM03WellFormedString(resolvedMount)) return { kind: "indeterminate" };
    const evidence: MacOSMountPointEvidence = {
      requestedCommonAttributes: 0x80000000,
      requestedVolumeAttributes: 0x80001000,
      requestedOptions: 0x00000804,
      returnedVolumeAttributes: result.returnedVolumeAttributes,
      attrDataOffset: result.attrDataOffset as number,
      attrLength: result.attrLength as number,
      rawMountBytesHex: result.rawMountBytesHex,
      fatalUtf8: true,
      mountPath: result.mountPath,
      resolvedMountPath: resolvedMount,
      objectRealPath,
    };
    return resolvedMount === objectRealPath
      ? { kind: "mount-point", evidence }
      : { kind: "not-mount-point", evidence };
  } catch {
    return { kind: "indeterminate" };
  }
}
