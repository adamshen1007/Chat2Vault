import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import {
  configureNativeObserver,
  nativeAliasCapability,
  observeMacOSMountPoint,
  readNativeVaultFileBounded,
} from "../src/native-observer.js";

describe.runIf(process.platform === "darwin")(
  "M03 Darwin native observer",
  () => {
    test("establishes ATTR_VOL_MOUNTPOINT capability and distinguishes contained objects from mount points", async () => {
      expect(
        configureNativeObserver(
          join(process.cwd(), "native", "source_observer.node"),
        ),
      ).toBe(true);
      await expect(
        nativeAliasCapability(process.platform, await realpath(process.cwd())),
      ).resolves.toEqual({
        kind: "available",
        capability: "macos-mount-point",
      });
      const workspace = process.cwd();
      await expect(
        observeMacOSMountPoint(workspace, await realpath(workspace)),
      ).resolves.toMatchObject({
        kind: "not-mount-point",
        evidence: {
          requestedCommonAttributes: 0x80000000,
          requestedVolumeAttributes: 0x80001000,
          requestedOptions: 0x00000804,
          fatalUtf8: true,
        },
      });
      await expect(
        observeMacOSMountPoint("/", await realpath("/")),
      ).resolves.toMatchObject({ kind: "mount-point" });
    });
    test("bounded native read enforces the sentinel and rejects path aliases", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-read-"));
      const outside = await mkdtemp(join(tmpdir(), "c2v-native-outside-"));
      try {
        await mkdir(join(root, "Knowledge"));
        await writeFile(
          join(root, "Knowledge", "exact.md"),
          Buffer.alloc(128 * 1024, 97),
        );
        await writeFile(
          join(root, "Knowledge", "large.md"),
          Buffer.alloc(128 * 1024 + 8, 98),
        );
        await symlink("exact.md", join(root, "Knowledge", "alias.md"));
        await symlink("Knowledge", join(root, "alias-dir"));
        await writeFile(join(outside, "outside.md"), "outside");
        await symlink(outside, join(root, "outside-dir"));
        expect(
          configureNativeObserver(
            join(process.cwd(), "native", "source_observer.node"),
          ),
        ).toBe(true);
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/exact.md", 128 * 1024),
        ).resolves.toHaveLength(128 * 1024);
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/large.md", 128 * 1024),
        ).resolves.toHaveLength(128 * 1024 + 1);
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/alias.md", 128 * 1024),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(root, "alias-dir/exact.md", 128 * 1024),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(
            root,
            "outside-dir/outside.md",
            128 * 1024,
          ),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(root, "../outside.md", 128 * 1024),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(
            root,
            "Knowledge/exact.md",
            128 * 1024 + 1,
          ),
        ).rejects.toThrow();
        expect(
          configureNativeObserver(
            join(process.cwd(), "native", "keychain.node"),
          ),
        ).toBe(false);
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/exact.md", 128 * 1024),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    });
    test("raw bounded reads return a real Promise and yield to the event loop under load", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-yield-"));
      try {
        await writeFile(join(root, "note.md"), Buffer.alloc(128 * 1024, 97));
        const raw = createRequire(import.meta.url)(
          join(process.cwd(), "native", "source_observer.node"),
        ) as {
          readVaultFileBounded(
            root: string,
            path: string,
            maxBytes: number,
          ): unknown;
        };
        const timer = new Promise<"timer">((resolve) =>
          setTimeout(() => resolve("timer"), 0),
        );
        const reads = Array.from({ length: 256 }, () =>
          raw.readVaultFileBounded(root, "note.md", 128 * 1024),
        );
        expect(reads.every((value) => value instanceof Promise)).toBe(true);
        const allReads = Promise.all(reads);
        expect(
          await Promise.race([timer, allReads.then(() => "reads" as const)]),
        ).toBe("timer");
        const results = await allReads;
        expect(
          results.every(
            (value) => Buffer.isBuffer(value) && value.length === 128 * 1024,
          ),
        ).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    test("raw addon rejects non-finite limits and unpaired UTF-16 before path conversion", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-input-"));
      try {
        await writeFile(join(root, "\ufffd.md"), "replacement");
        await mkdir(`${root}\ufffd`);
        await writeFile(join(`${root}\ufffd`, "note.md"), "replacement root");
        const raw = createRequire(import.meta.url)(
          join(process.cwd(), "native", "source_observer.node"),
        ) as {
          readVaultFileBounded(
            root: string,
            path: string,
            maxBytes: number,
          ): unknown;
        };
        for (const limit of [
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          1.5,
        ]) {
          expect(
            Buffer.isBuffer(
              await Promise.resolve(
                raw.readVaultFileBounded(root, "\ufffd.md", limit),
              ),
            ),
          ).toBe(false);
        }
        expect(
          Buffer.isBuffer(
            await Promise.resolve(
              raw.readVaultFileBounded(root, "\ud800.md", 128 * 1024),
            ),
          ),
        ).toBe(false);
        expect(
          Buffer.isBuffer(
            await Promise.resolve(
              raw.readVaultFileBounded(`${root}\ud800`, "note.md", 128 * 1024),
            ),
          ),
        ).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(`${root}\ufffd`, { recursive: true, force: true });
      }
    });
  },
);
