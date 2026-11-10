import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { validateCapture } from "@chat2vault/core";
import type { NativeContainmentAdapter } from "../src/containment.js";
import {
  ObsidianCaptureVaultAdapter,
  type CaptureReconciliationService,
  type CaptureVaultIO,
} from "../src/capture-vault-adapter.js";
import {
  configureNativeObserver,
  nativeAliasCapability,
  observeNativeVaultIdentity,
  parseNativeVaultPublishResult,
  observeMacOSMountPoint,
  publishNativeVaultFileExclusive,
  readNativeVaultFileBounded,
} from "../src/native-observer.js";
import {
  readSettings,
  SettingsController,
  type Chat2VaultSettingsV5,
} from "../src/settings-model.js";

interface RawTestNativeObserver {
  observeVaultIdentity(
    root: string,
    path: string,
  ): { kind: string; device?: string; inode?: string };
  readVaultFileBounded(
    root: string,
    path: string,
    maxBytes: number,
    fault?: string,
  ): Promise<unknown>;
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
    fault?: string,
  ): Promise<unknown>;
  nativeTestBarrierState(): { kind: string };
  nativeTestReleaseBarrier(): { kind: string };
}

function loadRaw(name: string): Record<string, unknown> {
  return createRequire(import.meta.url)(
    join(process.cwd(), "native", name),
  ) as Record<string, unknown>;
}

function loadTestNative(): RawTestNativeObserver {
  return loadRaw(
    "source_observer_test.node",
  ) as unknown as RawTestNativeObserver;
}

async function waitForBarrier(raw: RawTestNativeObserver): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (raw.nativeTestBarrierState().kind === "waiting") return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("native test barrier was not reached");
}

function publishWithFault(
  raw: RawTestNativeObserver,
  root: string,
  targetName: string,
  bytes: Uint8Array,
  fault: string,
): Promise<unknown> {
  const vault = raw.observeVaultIdentity(root, "");
  const parent = raw.observeVaultIdentity(root, "Sources");
  const config = raw.observeVaultIdentity(root, ".obsidian");
  if (
    vault.kind !== "identity" ||
    parent.kind !== "identity" ||
    config.kind !== "identity" ||
    vault.device === undefined ||
    vault.inode === undefined ||
    parent.device === undefined ||
    parent.inode === undefined ||
    config.device === undefined ||
    config.inode === undefined
  )
    throw new Error("expected test-native identities");
  return raw.publishVaultFileExclusive(
    root,
    "Sources",
    targetName,
    ".obsidian",
    bytes,
    vault.device,
    vault.inode,
    parent.device,
    parent.inode,
    config.device,
    config.inode,
    fault,
  );
}

describe.runIf(process.platform === "darwin")(
  "M03 Darwin native observer",
  () => {
    test("rejects malformed, oversized, and non-canonical native temporary identifiers", () => {
      const invalidArtifacts = [
        {
          path: "Sources/.chat2vault-private-01",
          ownership: "unverified",
        },
        {
          path: "Sources/.chat2vault-private-18446744073709551616",
          ownership: "unverified",
        },
        {
          path: "Sources/.chat2vault-private-1;echo-injected",
          ownership: "unverified",
        },
        {
          path: `Sources/.chat2vault-private-${"9".repeat(10_000)}`,
          ownership: "unverified",
        },
        {
          path: "Sources/.chat2vault-private-42",
          ownership: "unverified",
          identity: { device: "1", inode: "01" },
        },
        {
          path: "Sources/.chat2vault-private-42",
          ownership: "unverified",
          identity: { device: "-1", inode: "2" },
        },
        {
          path: "Sources/.chat2vault-private-42",
          ownership: "unverified",
          identity: { device: "1", inode: "18446744073709551616" },
        },
        {
          path: "Sources/.chat2vault-private-42",
          ownership: "unverified",
          identity: {
            device: "1",
            inode: "2",
            capturedText: "must not cross parser",
          },
        },
      ];
      for (const temporaryArtifact of invalidArtifacts)
        expect(
          parseNativeVaultPublishResult(
            {
              kind: "uncertain",
              effect: "temporary",
              temporaryArtifact,
            },
            "Sources",
          ),
        ).toEqual({ kind: "uncertain", effect: "published" });

      expect(
        parseNativeVaultPublishResult(
          {
            kind: "uncertain",
            effect: "temporary",
            temporaryArtifact: {
              path: "Sources/.chat2vault-private-18446744073709551615",
              ownership: "unverified",
              identity: {
                device: "0",
                inode: "18446744073709551615",
              },
            },
          },
          "Sources",
        ),
      ).toEqual({
        kind: "uncertain",
        effect: "temporary",
        temporaryArtifact: {
          path: "Sources/.chat2vault-private-18446744073709551615",
          ownership: "unverified",
          identity: { device: "0", inode: "18446744073709551615" },
        },
      });

      const callerOwned = {
        kind: "uncertain",
        effect: "temporary",
        temporaryArtifact: {
          path: "Sources/.chat2vault-private-42",
          ownership: "unverified",
          identity: { device: "1", inode: "2" },
        },
      };
      const parsed = parseNativeVaultPublishResult(callerOwned, "Sources");
      callerOwned.temporaryArtifact.identity.device = "99";
      expect(parsed).toEqual({
        kind: "uncertain",
        effect: "temporary",
        temporaryArtifact: {
          path: "Sources/.chat2vault-private-42",
          ownership: "unverified",
          identity: { device: "1", inode: "2" },
        },
      });
    });
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
          Buffer.alloc(1_064_960, 97),
        );
        await writeFile(
          join(root, "Knowledge", "large.md"),
          Buffer.alloc(1_064_961, 98),
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
          readNativeVaultFileBounded(root, "Knowledge/exact.md", 1_064_960),
        ).resolves.toHaveLength(1_064_960);
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/large.md", 1_064_960),
        ).resolves.toHaveLength(1_064_961);
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/alias.md", 1_064_960),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(root, "alias-dir/exact.md", 1_064_960),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(root, "outside-dir/outside.md", 1_064_960),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(root, "../outside.md", 1_064_960),
        ).rejects.toThrow();
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/exact.md", 1_064_961),
        ).rejects.toThrow();
        expect(
          configureNativeObserver(
            join(process.cwd(), "native", "keychain.node"),
          ),
        ).toBe(false);
        await expect(
          readNativeVaultFileBounded(root, "Knowledge/exact.md", 1_064_960),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    });
    test("publishes verified temporary bytes exclusively and rejects collisions and alias parents", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-create-"));
      const outside = await mkdtemp(
        join(tmpdir(), "c2v-native-create-outside-"),
      );
      try {
        await mkdir(join(root, "Sources"));
        await symlink(outside, join(root, "alias-parent"));
        expect(
          configureNativeObserver(
            join(process.cwd(), "native", "source_observer.node"),
          ),
        ).toBe(true);
        const exact = Buffer.from("exact synthetic bytes", "utf8");
        await mkdir(join(root, ".obsidian"));
        const vaultIdentity = observeNativeVaultIdentity(root, "");
        const parentIdentity = observeNativeVaultIdentity(root, "Sources");
        const configIdentity = observeNativeVaultIdentity(root, ".obsidian");
        if (
          vaultIdentity === undefined ||
          parentIdentity === undefined ||
          configIdentity === undefined
        )
          throw new Error("expected identities");
        const request = {
          basePath: root,
          parentPath: "Sources",
          targetName: "capture.md",
          configPath: ".obsidian",
          bytes: exact,
          vaultIdentity,
          parentIdentity,
          configIdentity,
        };
        await expect(publishNativeVaultFileExclusive(request)).resolves.toEqual(
          {
            kind: "published",
          },
        );
        await expect(
          readNativeVaultFileBounded(root, "Sources/capture.md", exact.length),
        ).resolves.toEqual(new Uint8Array(exact));
        expect(
          (await stat(join(root, "Sources", "capture.md"))).mode & 0o777,
        ).toBe(0o600);
        const collision = await publishNativeVaultFileExclusive({
          ...request,
          bytes: Buffer.from("replacement", "utf8"),
        });
        await expect(
          publishNativeVaultFileExclusive({
            ...request,
            parentPath: "alias-parent",
            targetName: "outside.md",
          }),
        ).resolves.toEqual({ kind: "failed" });
        await expect(
          readNativeVaultFileBounded(root, "Sources/capture.md", exact.length),
        ).resolves.toEqual(new Uint8Array(exact));
        const privateNames = (await readdir(join(root, "Sources"))).filter(
          (name) => name.startsWith(".chat2vault-private-"),
        );
        expect(privateNames).toHaveLength(1);
        const retainedName = privateNames[0];
        if (retainedName === undefined)
          throw new Error("expected retained collision candidate");
        const retained = await stat(join(root, "Sources", retainedName));
        expect(collision).toEqual({
          kind: "uncertain",
          effect: "temporary",
          temporaryArtifact: {
            path: `Sources/${retainedName}`,
            ownership: "unverified",
            identity: {
              device: String(retained.dev),
              inode: String(retained.ino),
            },
          },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    });
    test("binds queued root and parent identity replacements", async () => {
      const container = await mkdtemp(join(tmpdir(), "c2v-native-identity-"));
      const root = join(container, "vault");
      const oldRoot = join(container, "old-vault");
      try {
        await mkdir(join(root, "Sources"), { recursive: true });
        await mkdir(join(root, ".obsidian"));
        expect(
          configureNativeObserver(
            join(process.cwd(), "native", "source_observer.node"),
          ),
        ).toBe(true);
        const vaultIdentity = observeNativeVaultIdentity(root, "");
        const parentIdentity = observeNativeVaultIdentity(root, "Sources");
        const configIdentity = observeNativeVaultIdentity(root, ".obsidian");
        if (!vaultIdentity || !parentIdentity || !configIdentity)
          throw new Error("expected identities");
        await rename(root, oldRoot);
        await mkdir(join(root, "Sources"), { recursive: true });
        await mkdir(join(root, ".obsidian"));
        await expect(
          publishNativeVaultFileExclusive({
            basePath: root,
            parentPath: "Sources",
            targetName: "capture.md",
            configPath: ".obsidian",
            bytes: Buffer.from("exact", "utf8"),
            vaultIdentity,
            parentIdentity,
            configIdentity,
          }),
        ).resolves.toEqual({ kind: "failed" });
        await expect(
          readFile(join(root, "Sources", "capture.md")),
        ).rejects.toThrow();
      } finally {
        await rm(container, { recursive: true, force: true });
      }
    });
    test("production addon excludes all native fault and barrier controls", async () => {
      const production = loadRaw("source_observer.node");
      expect(production).not.toHaveProperty("nativeTestBarrierState");
      expect(production).not.toHaveProperty("nativeTestReleaseBarrier");
      const root = await mkdtemp(join(tmpdir(), "c2v-native-production-"));
      try {
        await mkdir(join(root, "Sources"));
        await mkdir(join(root, ".obsidian"));
        await expect(
          publishWithFault(
            production as unknown as RawTestNativeObserver,
            root,
            "capture.md",
            Buffer.from("exact synthetic bytes", "utf8"),
            "partial-write",
          ),
        ).resolves.toEqual({ kind: "unavailable" });
        expect(await readdir(join(root, "Sources"))).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    test.each([
      "partial-write",
      "file-fsync",
      "directory-fsync",
      "temporary-readback",
    ])(
      "test-only native %s failure retains its exact reconciliation candidate",
      async (fault) => {
        const root = await mkdtemp(join(tmpdir(), "c2v-native-fault-"));
        try {
          await mkdir(join(root, "Sources"));
          await mkdir(join(root, ".obsidian"));
          const raw = loadTestNative();
          const result = await publishWithFault(
            raw,
            root,
            `${fault}.md`,
            Buffer.from("exact synthetic bytes", "utf8"),
            fault,
          );
          await expect(
            readFile(join(root, "Sources", `${fault}.md`)),
          ).rejects.toThrow();
          const entries = await readdir(join(root, "Sources"));
          expect(entries).toHaveLength(1);
          const retainedName = entries[0];
          if (retainedName === undefined)
            throw new Error("expected one retained temporary file");
          const retained = await stat(join(root, "Sources", retainedName));
          expect(retained.isFile()).toBe(true);
          expect(retained.mode & 0o777).toBe(0o600);
          expect(result).toEqual({
            kind: "uncertain",
            effect: "temporary",
            temporaryArtifact: {
              path: `Sources/${retainedName}`,
              ownership: "unverified",
              identity: {
                device: String(retained.dev),
                inode: String(retained.ino),
              },
            },
          });
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    );
    test("test-only cleanup failure reports the retained private effect precisely", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-cleanup-"));
      try {
        await mkdir(join(root, "Sources"));
        await mkdir(join(root, ".obsidian"));
        const raw = loadTestNative();
        const result = await publishWithFault(
          raw,
          root,
          "capture.md",
          Buffer.from("exact synthetic bytes", "utf8"),
          "cleanup",
        );
        await expect(
          readFile(join(root, "Sources", "capture.md")),
        ).rejects.toThrow();
        const entries = await readdir(join(root, "Sources"));
        expect(entries).toHaveLength(1);
        const retainedName = entries[0];
        if (retainedName === undefined)
          throw new Error("expected one retained temporary file");
        expect(retainedName).toMatch(/^\.chat2vault-private-[0-9]+$/u);
        const retained = await stat(join(root, "Sources", retainedName));
        expect(result).toEqual({
          kind: "uncertain",
          effect: "temporary",
          temporaryArtifact: {
            path: `Sources/${retainedName}`,
            ownership: "unverified",
            identity: {
              device: String(retained.dev),
              inode: String(retained.ino),
            },
          },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    test("test-only pre-identity failure reports the exact unverified retained candidate", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-identity-gap-"));
      try {
        await mkdir(join(root, "Sources"));
        await mkdir(join(root, ".obsidian"));
        const result = await publishWithFault(
          loadTestNative(),
          root,
          "capture.md",
          Buffer.from("exact synthetic bytes", "utf8"),
          "temporary-identity",
        );
        const entries = await readdir(join(root, "Sources"));
        expect(entries).toHaveLength(1);
        const retainedName = entries[0];
        if (retainedName === undefined)
          throw new Error("expected one retained temporary candidate");
        expect(retainedName).toMatch(/^\.chat2vault-private-[0-9]+$/u);
        expect(result).toEqual({
          kind: "uncertain",
          effect: "temporary",
          temporaryArtifact: {
            path: `Sources/${retainedName}`,
            ownership: "unverified",
          },
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    test("test-only substitution barrier writes no bytes into or removes the replacement", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-substitute-"));
      try {
        await mkdir(join(root, "Sources"));
        await mkdir(join(root, ".obsidian"));
        const raw = loadTestNative();
        const publish = publishWithFault(
          raw,
          root,
          "capture.md",
          Buffer.from("exact synthetic bytes", "utf8"),
          "barrier-after-temporary-mkdir",
        );
        await waitForBarrier(raw);
        const entries = await readdir(join(root, "Sources"));
        expect(entries).toHaveLength(1);
        const candidateName = entries[0];
        if (candidateName === undefined)
          throw new Error("expected temporary candidate at barrier");
        const candidatePath = join(root, "Sources", candidateName);
        const original = await stat(candidatePath);
        await rm(candidatePath, { recursive: true });
        const replacement = Buffer.from("unrelated replacement", "utf8");
        await writeFile(candidatePath, replacement);
        const replacementBeforeRelease = await stat(candidatePath);
        expect(raw.nativeTestReleaseBarrier()).toEqual({ kind: "released" });
        await expect(publish).resolves.toEqual({
          kind: "uncertain",
          effect: "temporary",
          temporaryArtifact: {
            path: `Sources/${candidateName}`,
            ownership: "unverified",
            identity: {
              device: String(original.dev),
              inode: String(original.ino),
            },
          },
        });
        expect(await readFile(candidatePath)).toEqual(replacement);
        const replacementAfterPublish = await stat(candidatePath);
        expect({
          device: replacementAfterPublish.dev,
          inode: replacementAfterPublish.ino,
        }).toEqual({
          device: replacementBeforeRelease.dev,
          inode: replacementBeforeRelease.ino,
        });
        await expect(
          readFile(join(root, "Sources", "capture.md")),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    test("compiled substitution uncertainty persists through adapter reload until explicit acknowledgment", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-integrated-"));
      try {
        await mkdir(join(root, "Sources"));
        await mkdir(join(root, "Knowledge"));
        await mkdir(join(root, ".obsidian"));
        const testAddonPath = join(
          process.cwd(),
          "native",
          "source_observer_test.node",
        );
        expect(configureNativeObserver(testAddonPath)).toBe(true);
        const raw = loadTestNative();
        const vaultPath = (path: string) =>
          path === "" ? root : join(root, ...path.split("/"));
        const io: CaptureVaultIO = {
          configDir: ".obsidian",
          basePath: root,
          list: async (path) =>
            (await readdir(vaultPath(path), { withFileTypes: true })).map(
              (entry) => ({
                path: `${path === "" ? "" : `${path}/`}${entry.name}`,
                kind: entry.isDirectory() ? "folder" : "file",
              }),
            ),
          lookup: async (path) => {
            try {
              const observed = await lstat(vaultPath(path));
              return {
                path,
                kind: observed.isDirectory() ? "folder" : "file",
              };
            } catch {
              return undefined;
            }
          },
          readBinaryBounded: async (path, maxBytes) =>
            new Uint8Array(
              (await readFile(vaultPath(path))).subarray(0, maxBytes + 1),
            ),
          observeIdentity: (path) =>
            Promise.resolve(observeNativeVaultIdentity(root, path)),
          publishExclusive: async (request) =>
            parseNativeVaultPublishResult(
              await raw.publishVaultFileExclusive(
                root,
                request.parentPath,
                request.targetName,
                request.configPath,
                request.bytes,
                request.vaultIdentity.device,
                request.vaultIdentity.inode,
                request.parentIdentity.device,
                request.parentIdentity.inode,
                request.configIdentity.device,
                request.configIdentity.inode,
                "barrier-after-temporary-mkdir",
              ),
              request.parentPath,
            ),
        };
        const native: NativeContainmentAdapter = {
          platform: "darwin",
          separator: "/",
          aliasCapability: () =>
            Promise.resolve({
              kind: "available" as const,
              capability: "macos-mount-point" as const,
            }),
          lstat: async (path) => {
            try {
              const observed = await lstat(path);
              return {
                kind: "present",
                objectKind: observed.isDirectory()
                  ? "directory"
                  : "regular-file",
              };
            } catch {
              return { kind: "absent" };
            }
          },
          realpath: async (path) => ({
            kind: "resolved",
            realPath: await realpath(path),
          }),
          observeWindowsReparsePoint: () =>
            Promise.resolve({ kind: "not-reparse-point" }),
          observeMacOSMountPoint: () =>
            Promise.resolve({ kind: "not-mount-point" }),
        };
        const initial = {
          schemaVersion: 4 as const,
          installationId: "123e4567-e89b-42d3-a456-426614174000",
          previewMessagesPerPage: 25 as const,
          sourceRoot: "Sources",
          knowledgeRoot: "Knowledge",
          provider: {
            endpoint: "https://example.test/v1/chat/completions",
            model: "synthetic-model",
            timeoutMs: 60_000 as const,
            maxOutputTokens: 4_096,
            cloudDisclosureAccepted: true,
          },
        };
        let persisted: Chat2VaultSettingsV5 | undefined;
        const createController = (value: unknown) =>
          new SettingsController(
            readSettings(value),
            (next) => {
              persisted = structuredClone(next) as Chat2VaultSettingsV5;
              return Promise.resolve();
            },
            () => undefined,
            {},
            () => "223e4567-e89b-42d3-a456-426614174000",
          );
        const createService = (
          controller: SettingsController,
        ): CaptureReconciliationService => ({
          current: () => controller.captureReconciliation,
          prepare: (input) => controller.prepareCaptureReconciliation(input),
          markUncertain: (token, effect, candidate) =>
            controller.markCaptureReconciliationUncertain(
              token,
              effect,
              candidate,
            ),
          clearKnownOutcome: (token) =>
            controller.clearKnownCaptureReconciliation(token),
          acknowledge: () => controller.acknowledgeCaptureReconciliation(),
        });
        const controller = createController(initial);
        const adapter = new ObsidianCaptureVaultAdapter(
          io,
          native,
          {
            sourceRoot: () => "Sources",
            knowledgeRoot: () => "Knowledge",
            settingsPending: () => false,
            platform: "darwin",
            arch: "x64",
          },
          createService(controller),
        );
        const validated = validateCapture({
          method: "manual-paste",
          text: "Synthetic integrated capture text",
        });
        if (!validated.ok) throw new Error(validated.code);
        const input = {
          draft: validated.draft,
          source: {
            kind: "manual" as const,
            fingerprint: validated.draft.fingerprint,
          },
        };
        const plan = await adapter.plan(input);
        expect(plan.disposition).toBe("create");
        if (plan.disposition !== "create")
          throw new Error("expected create plan");

        const save = adapter.save(plan, input);
        await waitForBarrier(raw);
        const candidates = (await readdir(join(root, "Sources"))).filter(
          (name) => name.startsWith(".chat2vault-private-"),
        );
        expect(candidates).toHaveLength(1);
        const candidateName = candidates[0];
        if (candidateName === undefined) throw new Error("missing candidate");
        const candidatePath = join(root, "Sources", candidateName);
        const original = await stat(candidatePath);
        await rm(candidatePath);
        const replacement = Buffer.from("unrelated replacement", "utf8");
        await writeFile(candidatePath, replacement);
        const replacementBefore = await stat(candidatePath);
        expect(raw.nativeTestReleaseBarrier()).toEqual({ kind: "released" });

        await expect(save).resolves.toEqual({
          status: "blocked",
          code: "CAPTURE_EFFECT_UNCERTAIN",
          effect: "temporary",
          temporaryArtifact: {
            path: `Sources/${candidateName}`,
            ownership: "unverified",
            identity: {
              device: String(original.dev),
              inode: String(original.ino),
            },
          },
        });
        expect(await readFile(candidatePath)).toEqual(replacement);
        const replacementAfter = await stat(candidatePath);
        expect({
          dev: replacementAfter.dev,
          ino: replacementAfter.ino,
        }).toEqual({ dev: replacementBefore.dev, ino: replacementBefore.ino });
        await expect(readFile(vaultPath(plan.targetPath))).rejects.toThrow();
        expect(persisted?.captureReconciliation).toMatchObject({
          state: "temporary-uncertain",
          temporaryCandidate: {
            name: candidateName,
            ownership: "unverified",
            identity: {
              device: String(original.dev),
              inode: String(original.ino),
            },
          },
        });

        if (persisted === undefined) throw new Error("missing durable record");
        const reloadedController = createController(persisted);
        const reloaded = new ObsidianCaptureVaultAdapter(
          io,
          native,
          {
            sourceRoot: () => "Sources",
            knowledgeRoot: () => "Knowledge",
            settingsPending: () => false,
            platform: "darwin",
            arch: "x64",
          },
          createService(reloadedController),
        );
        await expect(reloaded.save(plan, input)).resolves.toEqual({
          status: "blocked",
          code: "CAPTURE_RECONCILIATION_REQUIRED",
        });
        await expect(reloaded.acknowledgeReconciliation()).resolves.toEqual({
          status: "cleared",
        });
        expect(reloaded.reconciliation()).toEqual({ status: "clear" });
        expect(persisted.captureReconciliation).toBeNull();
      } finally {
        loadTestNative().nativeTestReleaseBarrier();
        await rm(root, { recursive: true, force: true });
      }
    });
    test("test-only published readback mismatch keeps the exact target and reports reconciliation", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-published-"));
      const exact = Buffer.from("exact synthetic bytes", "utf8");
      try {
        await mkdir(join(root, "Sources"));
        await mkdir(join(root, ".obsidian"));
        const raw = loadTestNative();
        await expect(
          publishWithFault(
            raw,
            root,
            "capture.md",
            exact,
            "published-readback",
          ),
        ).resolves.toEqual({ kind: "uncertain", effect: "published" });
        await expect(
          readFile(join(root, "Sources", "capture.md")),
        ).resolves.toEqual(exact);
        expect(await readdir(join(root, "Sources"))).toEqual(["capture.md"]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    test("test-only barrier detects an independent parent relocation before publication", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-relocate-"));
      try {
        await mkdir(join(root, "Sources"));
        await mkdir(join(root, ".obsidian"));
        const raw = loadTestNative();
        const publish = publishWithFault(
          raw,
          root,
          "capture.md",
          Buffer.from("exact synthetic bytes", "utf8"),
          "barrier-before-publish",
        );
        await waitForBarrier(raw);
        await rename(join(root, "Sources"), join(root, "Sources-relocated"));
        await mkdir(join(root, "Sources"));
        expect(raw.nativeTestReleaseBarrier()).toEqual({ kind: "released" });
        const entries = await readdir(join(root, "Sources-relocated"));
        expect(entries).toHaveLength(1);
        const retainedName = entries[0];
        if (retainedName === undefined)
          throw new Error("expected retained relocated candidate");
        const retained = await stat(
          join(root, "Sources-relocated", retainedName),
        );
        await expect(publish).resolves.toEqual({
          kind: "uncertain",
          effect: "temporary",
          temporaryArtifact: {
            path: `Sources/${retainedName}`,
            ownership: "unverified",
            identity: {
              device: String(retained.dev),
              inode: String(retained.ino),
            },
          },
        });
        expect(await readdir(join(root, "Sources"))).toEqual([]);
        expect(
          await readFile(join(root, "Sources-relocated", retainedName)),
        ).toEqual(Buffer.from("exact synthetic bytes", "utf8"));
      } finally {
        const raw = loadTestNative();
        raw.nativeTestReleaseBarrier();
        await rm(root, { recursive: true, force: true });
      }
    });
    test("test-only queue failures settle both promises without filesystem effects", async () => {
      const root = await mkdtemp(join(tmpdir(), "c2v-native-queue-"));
      try {
        await mkdir(join(root, "Sources"));
        await mkdir(join(root, ".obsidian"));
        await writeFile(join(root, "note.md"), "synthetic");
        const raw = loadTestNative();
        await expect(
          raw.readVaultFileBounded(root, "note.md", 128, "queue-failure"),
        ).resolves.toEqual({ kind: "unavailable" });
        await expect(
          publishWithFault(
            raw,
            root,
            "capture.md",
            Buffer.from("exact synthetic bytes", "utf8"),
            "queue-failure",
          ),
        ).resolves.toEqual({ kind: "failed" });
        expect(await readdir(join(root, "Sources"))).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
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
