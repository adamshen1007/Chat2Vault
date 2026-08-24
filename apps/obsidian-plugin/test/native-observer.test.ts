import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  configureNativeObserver,
  nativeAliasCapability,
  observeMacOSMountPoint,
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
  },
);
