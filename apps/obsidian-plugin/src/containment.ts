import { isM03WellFormedString } from "@chat2vault/core";
import { lstat, realpath } from "node:fs/promises";
import {
  nativeAliasCapability,
  observeMacOSMountPoint,
  observeWindowsReparsePoint,
} from "./native-observer.js";

export type NativeObjectKind =
  "directory" | "regular-file" | "symbolic-link" | "other";

export type NativeLstatProbe =
  | { kind: "present"; objectKind: NativeObjectKind }
  | { kind: "absent" }
  | { kind: "indeterminate" };

export type NativeRealpathProbe =
  | { kind: "resolved"; realPath: string }
  | { kind: "absent" }
  | { kind: "indeterminate" };

export type WindowsReparsePointProbe =
  | { kind: "reparse-point" }
  | { kind: "not-reparse-point" }
  | { kind: "indeterminate" };

export type MacOSMountPointProbe =
  | { kind: "mount-point"; evidence?: MacOSMountPointEvidence }
  | { kind: "not-mount-point"; evidence?: MacOSMountPointEvidence }
  | { kind: "indeterminate" };

export interface MacOSMountPointEvidence {
  requestedCommonAttributes: number;
  requestedVolumeAttributes: number;
  requestedOptions: number;
  returnedVolumeAttributes: number;
  attrDataOffset: number;
  attrLength: number;
  rawMountBytesHex: string;
  fatalUtf8: true;
  mountPath: string;
  resolvedMountPath: string;
  objectRealPath: string;
}

export type PlatformAliasCapabilityState =
  | {
      kind: "available";
      capability: "windows-reparse-point" | "macos-mount-point";
    }
  | {
      kind: "unavailable";
      capability: "windows-reparse-point" | "macos-mount-point";
    };

export type NativeAliasObservation =
  | {
      kind: "alias";
      aliasKind:
        "symbolic-link" | "windows-reparse-point" | "macos-mount-point";
    }
  | { kind: "not-alias" }
  | { kind: "indeterminate" };

export interface NativeContainmentAdapter {
  platform: "darwin" | "win32";
  separator: "/" | "\\";
  aliasCapability(vaultRealPath: string): Promise<PlatformAliasCapabilityState>;
  lstat(path: string): Promise<NativeLstatProbe>;
  realpath(path: string): Promise<NativeRealpathProbe>;
  observeWindowsReparsePoint(path: string): Promise<WindowsReparsePointProbe>;
  observeMacOSMountPoint(
    path: string,
    objectRealPath: string,
  ): Promise<MacOSMountPointProbe>;
}

export type NativeComponentVerification =
  | {
      status: "trusted";
      objectKind: "directory" | "regular-file";
      realPath: string;
    }
  | { status: "absent" }
  | { status: "obstructed"; objectKind: "other" }
  | { status: "outside-vault" }
  | { status: "external-path-invalid" }
  | { status: "capability-unavailable" }
  | { status: "indeterminate" }
  | {
      status: "alias";
      aliasKind:
        "symbolic-link" | "windows-reparse-point" | "macos-mount-point";
    };

export function classifyNativeAlias(
  platform: "darwin" | "win32",
  windows: WindowsReparsePointProbe | undefined,
  macos: MacOSMountPointProbe | undefined,
): NativeAliasObservation {
  if (platform === "win32") {
    if (windows?.kind === "reparse-point")
      return { kind: "alias", aliasKind: "windows-reparse-point" };
    if (windows?.kind === "not-reparse-point") return { kind: "not-alias" };
    return { kind: "indeterminate" };
  }
  if (macos?.kind === "mount-point")
    return { kind: "alias", aliasKind: "macos-mount-point" };
  if (macos?.kind === "not-mount-point") return { kind: "not-alias" };
  return { kind: "indeterminate" };
}

function stripTrailingSeparators(value: string, separator: "/" | "\\"): string {
  if (value === separator) return value;
  if (separator === "\\" && /^[A-Za-z]:\\$/u.test(value)) return value;
  let result = value;
  while (result.endsWith(separator)) result = result.slice(0, -1);
  return result;
}

export function isNativePathContained(
  vaultRealPath: string,
  candidateRealPath: string,
  separator: "/" | "\\",
): boolean {
  const vault = stripTrailingSeparators(vaultRealPath, separator);
  const candidate = stripTrailingSeparators(candidateRealPath, separator);
  if (candidate === vault) return true;
  const boundary = vault.endsWith(separator) ? vault : `${vault}${separator}`;
  return candidate.startsWith(boundary);
}

export async function verifyNativeComponent(
  adapter: NativeContainmentAdapter,
  vaultRealPath: string,
  candidatePath: string,
): Promise<NativeComponentVerification> {
  if (
    !isM03WellFormedString(vaultRealPath) ||
    !isM03WellFormedString(candidatePath)
  )
    return { status: "external-path-invalid" };
  let capability: PlatformAliasCapabilityState;
  try {
    capability = await adapter.aliasCapability(vaultRealPath);
  } catch {
    return { status: "capability-unavailable" };
  }
  if (capability.kind !== "available")
    return { status: "capability-unavailable" };
  let lstat: NativeLstatProbe;
  try {
    lstat = await adapter.lstat(candidatePath);
  } catch {
    return { status: "indeterminate" };
  }
  if (lstat.kind === "absent") return { status: "absent" };
  if (lstat.kind === "indeterminate") return { status: "indeterminate" };
  if (lstat.objectKind === "symbolic-link")
    return { status: "alias", aliasKind: "symbolic-link" };

  if (adapter.platform === "win32") {
    const observation = classifyNativeAlias(
      "win32",
      await adapter
        .observeWindowsReparsePoint(candidatePath)
        .catch(() => ({ kind: "indeterminate" as const })),
      undefined,
    );
    if (observation.kind === "alias")
      return { status: "alias", aliasKind: observation.aliasKind };
    if (observation.kind === "indeterminate")
      return { status: "indeterminate" };
  }

  let realpath: NativeRealpathProbe;
  try {
    realpath = await adapter.realpath(candidatePath);
  } catch {
    return { status: "indeterminate" };
  }
  if (realpath.kind !== "resolved") return { status: "indeterminate" };
  if (!isM03WellFormedString(realpath.realPath))
    return { status: "external-path-invalid" };

  if (adapter.platform === "darwin") {
    const observation = classifyNativeAlias(
      "darwin",
      undefined,
      await adapter
        .observeMacOSMountPoint(candidatePath, realpath.realPath)
        .catch(() => ({ kind: "indeterminate" as const })),
    );
    if (observation.kind === "alias")
      return { status: "alias", aliasKind: observation.aliasKind };
    if (observation.kind === "indeterminate")
      return { status: "indeterminate" };
  }

  if (
    !isNativePathContained(vaultRealPath, realpath.realPath, adapter.separator)
  )
    return { status: "outside-vault" };
  if (lstat.objectKind !== "directory" && lstat.objectKind !== "regular-file")
    return { status: "obstructed", objectKind: "other" };
  return {
    status: "trusted",
    objectKind: lstat.objectKind,
    realPath: realpath.realPath,
  };
}

export function nativeProbeFailureKind(
  error: unknown,
): "absent" | "indeterminate" {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
    ? "absent"
    : "indeterminate";
}

export function createDesktopNativeAdapter(
  platform: NodeJS.Platform = process.platform,
): NativeContainmentAdapter | undefined {
  if (platform !== "darwin" && platform !== "win32") return undefined;
  return {
    platform,
    separator: platform === "win32" ? "\\" : "/",
    aliasCapability: (vaultRealPath) =>
      nativeAliasCapability(platform, vaultRealPath),
    lstat: async (path) => {
      try {
        const value = await lstat(path);
        const objectKind: NativeObjectKind = value.isSymbolicLink()
          ? "symbolic-link"
          : value.isDirectory()
            ? "directory"
            : value.isFile()
              ? "regular-file"
              : "other";
        return { kind: "present", objectKind };
      } catch (error) {
        return { kind: nativeProbeFailureKind(error) };
      }
    },
    realpath: async (path) => {
      try {
        const resolved = await realpath(path);
        return { kind: "resolved", realPath: resolved };
      } catch (error) {
        return { kind: nativeProbeFailureKind(error) };
      }
    },
    observeWindowsReparsePoint: (path) =>
      Promise.resolve(observeWindowsReparsePoint(path)),
    observeMacOSMountPoint,
  };
}
