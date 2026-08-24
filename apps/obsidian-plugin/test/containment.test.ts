import { describe, expect, test } from "vitest";
import {
  classifyNativeAlias,
  isNativePathContained,
  nativeProbeFailureKind,
  verifyNativeComponent,
  type NativeContainmentAdapter,
} from "../src/containment.js";

describe("M03 native containment", () => {
  const native = (
    platform: "darwin" | "win32" = "darwin",
  ): NativeContainmentAdapter => ({
    platform,
    separator: platform === "win32" ? "\\" : "/",
    aliasCapability: () =>
      Promise.resolve({
        kind: "available",
        capability:
          platform === "win32" ? "windows-reparse-point" : "macos-mount-point",
      }),
    lstat: () => Promise.resolve({ kind: "present", objectKind: "directory" }),
    realpath: (path) => Promise.resolve({ kind: "resolved", realPath: path }),
    observeWindowsReparsePoint: () =>
      Promise.resolve({ kind: "not-reparse-point" }),
    observeMacOSMountPoint: () => Promise.resolve({ kind: "not-mount-point" }),
  });

  test("treats Windows reparse and macOS mount-point observations as aliases before type trust", () => {
    expect(
      classifyNativeAlias("win32", { kind: "reparse-point" }, undefined),
    ).toEqual({ kind: "alias", aliasKind: "windows-reparse-point" });
    expect(
      classifyNativeAlias("darwin", undefined, { kind: "mount-point" }),
    ).toEqual({ kind: "alias", aliasKind: "macos-mount-point" });
    expect(
      classifyNativeAlias("darwin", undefined, { kind: "not-mount-point" }),
    ).toEqual({ kind: "not-alias" });
  });

  test("contains separator-terminated roots without prefix confusion", () => {
    expect(isNativePathContained("/vault", "/vault/Sources/note.md", "/")).toBe(
      true,
    );
    expect(isNativePathContained("/vault", "/vault2/note.md", "/")).toBe(false);
    expect(isNativePathContained("C:\\", "C:\\Vault", "\\")).toBe(true);
    expect(isNativePathContained("C:\\Vault", "C:\\Vaultish", "\\")).toBe(
      false,
    );
    expect(
      isNativePathContained(
        "\\\\server\\share\\",
        "\\\\server\\share\\Sources",
        "\\",
      ),
    ).toBe(true);
    expect(
      isNativePathContained(
        "\\\\server\\share\\",
        "\\\\server\\share2\\Sources",
        "\\",
      ),
    ).toBe(false);
  });

  test("fails closed when platform capability or a concrete probe is unavailable", async () => {
    const base: NativeContainmentAdapter = {
      platform: "darwin",
      separator: "/",
      aliasCapability: () =>
        Promise.resolve({
          kind: "unavailable",
          capability: "macos-mount-point",
        }),
      lstat: () =>
        Promise.resolve({ kind: "present", objectKind: "directory" }),
      realpath: () =>
        Promise.resolve({
          kind: "resolved",
          realPath: "/vault/Sources",
        }),
      observeWindowsReparsePoint: () =>
        Promise.resolve({ kind: "not-reparse-point" }),
      observeMacOSMountPoint: () =>
        Promise.resolve({ kind: "not-mount-point" }),
    };
    await expect(
      verifyNativeComponent(base, "/vault", "/vault/Sources"),
    ).resolves.toEqual({
      status: "capability-unavailable",
    });
    const indeterminate = {
      ...base,
      aliasCapability: () =>
        Promise.resolve({
          kind: "available" as const,
          capability: "macos-mount-point" as const,
        }),
      observeMacOSMountPoint: () =>
        Promise.resolve({ kind: "indeterminate" as const }),
    };
    await expect(
      verifyNativeComponent(indeterminate, "/vault", "/vault/Sources"),
    ).resolves.toEqual({
      status: "indeterminate",
    });
  });

  test("blocks a contained realpath when the authoritative macOS probe reports a mount point", async () => {
    const adapter: NativeContainmentAdapter = {
      platform: "darwin",
      separator: "/",
      aliasCapability: () =>
        Promise.resolve({
          kind: "available",
          capability: "macos-mount-point",
        }),
      lstat: () =>
        Promise.resolve({ kind: "present", objectKind: "directory" }),
      realpath: () =>
        Promise.resolve({ kind: "resolved", realPath: "/vault/Mounted" }),
      observeWindowsReparsePoint: () =>
        Promise.resolve({ kind: "not-reparse-point" }),
      observeMacOSMountPoint: () => Promise.resolve({ kind: "mount-point" }),
    };
    await expect(
      verifyNativeComponent(adapter, "/vault", "/vault/Mounted"),
    ).resolves.toEqual({
      status: "alias",
      aliasKind: "macos-mount-point",
    });
  });

  test("normalizes native throws and invalid returned paths into the closed probe algebra", async () => {
    const base: NativeContainmentAdapter = {
      platform: "darwin",
      separator: "/",
      aliasCapability: () =>
        Promise.resolve({
          kind: "available",
          capability: "macos-mount-point",
        }),
      lstat: () =>
        Promise.resolve({ kind: "present", objectKind: "regular-file" }),
      realpath: () =>
        Promise.resolve({ kind: "resolved", realPath: "bad\ud800path" }),
      observeWindowsReparsePoint: () =>
        Promise.resolve({ kind: "not-reparse-point" }),
      observeMacOSMountPoint: () =>
        Promise.resolve({ kind: "not-mount-point" }),
    };
    await expect(
      verifyNativeComponent(base, "/vault", "/vault/note.md"),
    ).resolves.toEqual({ status: "external-path-invalid" });
    await expect(
      verifyNativeComponent(
        {
          ...base,
          realpath: () => Promise.reject(new Error("native throw")),
        },
        "/vault",
        "/vault/note.md",
      ),
    ).resolves.toEqual({ status: "indeterminate" });
    await expect(
      verifyNativeComponent(
        {
          ...base,
          aliasCapability: () => Promise.reject(new Error("load failure")),
        },
        "/vault",
        "/vault/note.md",
      ),
    ).resolves.toEqual({ status: "capability-unavailable" });
  });

  test.each([
    ["ENOENT", "absent"],
    ["ENOTDIR", "indeterminate"],
    ["EACCES", "indeterminate"],
    ["EPERM", "indeterminate"],
    ["EIO", "indeterminate"],
    ["ENOSYS", "indeterminate"],
    ["CAPABILITY_UNAVAILABLE", "indeterminate"],
    ["UNKNOWN", "indeterminate"],
  ] as const)(
    "maps native lstat/realpath rejection %s to %s",
    (code, expected) => {
      expect(nativeProbeFailureKind({ code })).toBe(expected);
      expect(
        nativeProbeFailureKind(Object.assign(new Error(code), { code })),
      ).toBe(expected);
    },
  );

  test("maps non-object and code-less unknown rejections to indeterminate", () => {
    for (const rejection of [undefined, null, "ENOENT", 7, {}, new Error("x")])
      expect(nativeProbeFailureKind(rejection)).toBe("indeterminate");
  });

  test.each([
    {
      probe: { kind: "absent" as const },
      expected: { status: "absent" },
    },
    {
      probe: { kind: "indeterminate" as const },
      expected: { status: "indeterminate" },
    },
    {
      probe: { kind: "present" as const, objectKind: "symbolic-link" as const },
      expected: { status: "alias", aliasKind: "symbolic-link" },
    },
    {
      probe: { kind: "present" as const, objectKind: "other" as const },
      expected: { status: "obstructed", objectKind: "other" },
    },
    {
      probe: { kind: "present" as const, objectKind: "regular-file" as const },
      expected: {
        status: "trusted",
        objectKind: "regular-file",
        realPath: "/vault/object",
      },
    },
  ])(
    "settles lstat object algebra for $probe.kind",
    async ({ probe, expected }) => {
      await expect(
        verifyNativeComponent(
          { ...native(), lstat: () => Promise.resolve(probe) },
          "/vault",
          "/vault/object",
        ),
      ).resolves.toEqual(expected);
    },
  );

  test.each([
    {
      probe: { kind: "absent" as const },
      expected: { status: "indeterminate" },
    },
    {
      probe: { kind: "indeterminate" as const },
      expected: { status: "indeterminate" },
    },
    {
      probe: { kind: "resolved" as const, realPath: "/outside/object" },
      expected: { status: "outside-vault" },
    },
    {
      probe: { kind: "resolved" as const, realPath: "bad\ud800path" },
      expected: { status: "external-path-invalid" },
    },
  ])(
    "settles required-object realpath algebra for $probe.kind",
    async ({ probe, expected }) => {
      await expect(
        verifyNativeComponent(
          { ...native(), realpath: () => Promise.resolve(probe) },
          "/vault",
          "/vault/object",
        ),
      ).resolves.toEqual(expected);
    },
  );

  test.each([
    {
      observation: "reparse-point" as const,
      expected: { status: "alias", aliasKind: "windows-reparse-point" },
    },
    {
      observation: "not-reparse-point" as const,
      expected: {
        status: "trusted",
        objectKind: "directory",
        realPath: "C:\\Vault\\Object",
      },
    },
    {
      observation: "indeterminate" as const,
      expected: { status: "indeterminate" },
    },
  ])(
    "settles Windows generic reparse observation $observation before type trust",
    async ({ observation, expected }) => {
      const adapter = native("win32");
      adapter.realpath = () =>
        Promise.resolve({
          kind: "resolved",
          realPath: "C:\\Vault\\Object",
        });
      adapter.observeWindowsReparsePoint = () =>
        Promise.resolve({ kind: observation });
      await expect(
        verifyNativeComponent(adapter, "C:\\Vault", "C:\\Vault\\Object"),
      ).resolves.toEqual(expected);
    },
  );
});
