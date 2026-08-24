import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { isM03WellFormedString } from "@chat2vault/core";
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
}

let observer: NativeObserver | undefined;
const loadNative = createRequire(__filename);

export function configureNativeObserver(absolutePath: string): boolean {
  if (!isM03WellFormedString(absolutePath)) return false;
  try {
    const candidate = loadNative(absolutePath) as Partial<NativeObserver>;
    if (
      typeof candidate.observeMacOSMountPoint !== "function" ||
      typeof candidate.observeWindowsReparsePoint !== "function"
    )
      return false;
    observer = candidate as NativeObserver;
    return true;
  } catch {
    observer = undefined;
    return false;
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
