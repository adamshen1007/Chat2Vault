import { describe, expect, test, vi } from "vitest";
import {
  configureKeychainFromPathForTest,
  configureKeychainForTest,
  credentialGenerationForTest,
  credentialStatus,
  deleteCredential,
  refreshCredentialStatus,
  readCredentialForOperation,
  setCredential,
} from "../src/keychain.js";

const INSTALLATION_ID = "123e4567-e89b-42d3-a456-426614174000";

function loadableNative() {
  return {
    abiVersion: 1,
    credentialStatus: vi.fn(() => ({ tag: "configured" })),
    readCredential: vi.fn(() => ({
      tag: "configured",
      secret: "synthetic-key",
    })),
    setCredential: vi.fn(() => ({
      tag: "success",
      state: "configured",
      effect: "created",
    })),
    deleteCredential: vi.fn(() => ({
      tag: "success",
      state: "missing",
      effect: "deleted",
    })),
  };
}

describe("M05 Keychain native path binding", () => {
  const nativePath =
    "/Users/synthetic/Vault/.obsidian/plugins/chat2vault/native/keychain.node";

  test("loads only the exact absolute composition-root path without bundle-relative rebasing", () => {
    const candidate = loadableNative();
    const loader = vi.fn(() => candidate);

    expect(
      configureKeychainFromPathForTest(nativePath, INSTALLATION_ID, loader, {
        platform: "darwin",
        arch: "x64",
      }),
    ).toBe(true);
    expect(loader).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith(nativePath);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
  });

  test("rejects malformed, relative, traversing, and sibling paths without loading", () => {
    const rejectedPaths = [
      "native/keychain.node",
      "/Users/synthetic/plugin/native/../native/keychain.node",
      "/Users/synthetic/plugin/keychain.node",
      "/Users/synthetic/plugin/sibling/keychain.node",
      "/Users/synthetic/plugin/native/other.node",
      "/Users/synthetic/plugin/native//keychain.node",
      "/native/keychain.node",
      "/Users/synthetic/plugin/native/keychain.node\0ignored",
    ];

    for (const rejectedPath of rejectedPaths) {
      const loader = vi.fn(() => loadableNative());
      expect(
        configureKeychainFromPathForTest(
          rejectedPath,
          INSTALLATION_ID,
          loader,
          { platform: "darwin", arch: "x64" },
        ),
      ).toBe(false);
      expect(loader).not.toHaveBeenCalled();
      expect(credentialStatus()).toEqual({ ok: true, status: "unavailable" });
    }
  });

  test("preserves the macOS x86_64 gate before loading", () => {
    for (const runtime of [
      { platform: "linux", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ]) {
      const loader = vi.fn(() => loadableNative());
      expect(
        configureKeychainFromPathForTest(
          nativePath,
          INSTALLATION_ID,
          loader,
          runtime,
        ),
      ).toBe(false);
      expect(loader).not.toHaveBeenCalled();
    }
  });
});

describe("M05 Keychain wrapper", () => {
  test("binds the fixed service and the persisted installation identity", () => {
    const native = {
      abiVersion: 1,
      credentialStatus: vi.fn(() => ({ tag: "configured" })),
      readCredential: vi.fn(() => ({
        tag: "configured",
        secret: "synthetic-key",
      })),
      setCredential: vi.fn(() => ({
        tag: "success",
        state: "configured",
        effect: "created",
      })),
      deleteCredential: vi.fn(() => ({
        tag: "success",
        state: "missing",
        effect: "deleted",
      })),
    };

    expect(configureKeychainForTest(native, INSTALLATION_ID)).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    expect(readCredentialForOperation()).toEqual({
      ok: true,
      secret: "synthetic-key",
    });
    expect(native.readCredential).toHaveBeenCalledWith(
      "com.chat2vault.obsidian.openai-compatible",
      "installation/123e4567-e89b-42d3-a456-426614174000",
    );
  });
});

describe("M05 Keychain ABI and state machine", () => {
  function native(overrides: Record<string, unknown> = {}) {
    return {
      abiVersion: 1,
      credentialStatus: vi.fn(() => ({ tag: "configured" })),
      readCredential: vi.fn(() => ({
        tag: "configured",
        secret: "synthetic-key",
      })),
      setCredential: vi.fn(() => ({
        tag: "success",
        state: "configured",
        effect: "created",
      })),
      deleteCredential: vi.fn(() => ({
        tag: "success",
        state: "missing",
        effect: "deleted",
      })),
      ...overrides,
    };
  }

  test("rejects missing, extra, accessor, symbol, prototype, and wrong-ABI native shapes", () => {
    const shapes: unknown[] = [
      { abiVersion: 2 },
      { ...native(), extra: true },
      Object.create(native()),
      Object.defineProperty(native(), "abiVersion", {
        get: () => 1,
        enumerable: true,
      }),
      Object.assign(native(), { [Symbol("synthetic")]: true }),
    ];
    for (const shape of shapes) {
      expect(configureKeychainForTest(shape, INSTALLATION_ID)).toBe(false);
      expect(credentialStatus()).toEqual({ ok: true, status: "unavailable" });
    }
  });

  test("rejects every malformed status/read object and normalizes throws to unavailable", () => {
    const invalidate = vi.fn();
    for (const outcome of [
      { tag: "configured", extra: true },
      Object.defineProperty({}, "tag", {
        get: () => "configured",
        enumerable: true,
      }),
      Object.assign(Object.create(null), {
        tag: "configured",
        [Symbol("x")]: true,
      }),
    ]) {
      const fake = native({ credentialStatus: vi.fn((): unknown => outcome) });
      expect(
        configureKeychainForTest(fake, INSTALLATION_ID, {
          invalidateProviderOwnerAndAbort: invalidate,
        }),
      ).toBe(true);
      expect(credentialStatus()).toEqual({ ok: true, status: "unavailable" });
    }
    const fake = native({
      readCredential: vi.fn(() => ({
        tag: "configured",
        secret: "bad secret",
      })),
    });
    expect(
      configureKeychainForTest(fake, INSTALLATION_ID, {
        invalidateProviderOwnerAndAbort: invalidate,
      }),
    ).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    expect(readCredentialForOperation()).toEqual({
      ok: false,
      code: "KEYCHAIN_UNAVAILABLE",
    });
    expect(invalidate).toHaveBeenCalled();
  });

  test("rejects exact-result shape attacks before reading values", () => {
    const badStatusShapes: unknown[] = [
      {},
      { tag: "configured", extra: true },
      Object.defineProperty({}, "tag", {
        get: () => "configured",
        enumerable: true,
      }),
      Object.assign(Object.create({}), { tag: "configured" }),
      Object.assign(Object.create(null), {
        tag: "configured",
        [Symbol("synthetic")]: true,
      }),
    ];
    for (const shape of badStatusShapes) {
      expect(
        configureKeychainForTest(
          native({ credentialStatus: vi.fn((): unknown => shape) }),
          INSTALLATION_ID,
        ),
      ).toBe(true);
      expect(credentialStatus()).toEqual({ ok: true, status: "unavailable" });
    }

    const badReadShapes: unknown[] = [
      { tag: "configured" },
      { tag: "configured", secret: "synthetic-key", extra: true },
      Object.defineProperty({ tag: "configured" }, "secret", {
        get: () => "synthetic-key",
        enumerable: true,
      }),
    ];
    for (const shape of badReadShapes) {
      expect(
        configureKeychainForTest(
          native({ readCredential: vi.fn((): unknown => shape) }),
          INSTALLATION_ID,
        ),
      ).toBe(true);
      expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
      expect(readCredentialForOperation()).toEqual({
        ok: false,
        code: "KEYCHAIN_UNAVAILABLE",
      });
    }
  });

  test("uses a non-queuing refresh mutex and only changes generations for changed observations", () => {
    const fake = native();
    expect(configureKeychainForTest(fake, INSTALLATION_ID)).toBe(true);
    expect(credentialGenerationForTest()).toBe(0);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    expect(credentialGenerationForTest()).toBe(1);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    expect(credentialGenerationForTest()).toBe(1);
    expect(refreshCredentialStatus()).toEqual({
      ok: true,
      status: "configured",
    });
  });

  test("shares one non-queuing mutex across status and mutation entry", () => {
    let statusDuringMutation: unknown;
    let refreshDuringMutation: unknown;
    const fake = native({
      setCredential: vi.fn(() => {
        statusDuringMutation = credentialStatus();
        refreshDuringMutation = refreshCredentialStatus();
        return {
          tag: "success",
          state: "configured",
          effect: "replaced",
        };
      }),
    });
    expect(configureKeychainForTest(fake, INSTALLATION_ID)).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    const generation = credentialGenerationForTest();

    expect(setCredential("synthetic-key")).toEqual({
      ok: true,
      status: "configured",
    });
    expect(statusDuringMutation).toEqual({
      ok: false,
      code: "KEYCHAIN_OPERATION_IN_PROGRESS",
    });
    expect(refreshDuringMutation).toEqual({
      ok: false,
      code: "KEYCHAIN_OPERATION_IN_PROGRESS",
    });
    expect(fake.credentialStatus).toHaveBeenCalledTimes(1);
    expect(credentialGenerationForTest()).toBe(generation + 1);
  });

  test("drops a configured secret when its accepted Provider owner becomes stale during read", () => {
    let current = true;
    const invalidate = vi.fn();
    const fake = native({
      readCredential: vi.fn(() => {
        current = false;
        return { tag: "configured", secret: "synthetic-key" };
      }),
    });
    expect(
      configureKeychainForTest(fake, INSTALLATION_ID, {
        invalidateProviderOwnerAndAbort: invalidate,
      }),
    ).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    const generation = credentialGenerationForTest();
    invalidate.mockClear();

    expect(readCredentialForOperation(() => current)).toEqual({
      ok: false,
      code: "KEYCHAIN_OPERATION_STALE",
    });
    expect(credentialGenerationForTest()).toBe(generation);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test("rejects invalid Set before touching native state or generation", () => {
    const fake = native();
    expect(configureKeychainForTest(fake, INSTALLATION_ID)).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    const generation = credentialGenerationForTest();
    expect(setCredential("invalid secret")).toEqual({
      ok: false,
      code: "KEYCHAIN_INPUT_INVALID",
    });
    expect(fake.setCredential).not.toHaveBeenCalled();
    expect(credentialGenerationForTest()).toBe(generation);
    expect(readCredentialForOperation()).toEqual({
      ok: true,
      secret: "synthetic-key",
    });
  });

  test("invalidates before a valid mutation when the module is unavailable", () => {
    expect(configureKeychainForTest({ abiVersion: 1 }, INSTALLATION_ID)).toBe(
      false,
    );
    const generation = credentialGenerationForTest();
    expect(setCredential("synthetic-key")).toEqual({
      ok: false,
      code: "KEYCHAIN_VERIFICATION_FAILED",
    });
    expect(credentialGenerationForTest()).toBe(generation + 1);
    expect(readCredentialForOperation()).toEqual({
      ok: false,
      code: "KEYCHAIN_STATUS_UNKNOWN",
    });
  });

  test("restores only a well-formed no-change mutation failure and otherwise remains unknown", () => {
    const noChange = native({
      setCredential: vi.fn(() => ({
        tag: "failed",
        state: "unknown",
        stage: "mutation",
        mayHaveChanged: false,
      })),
    });
    expect(configureKeychainForTest(noChange, INSTALLATION_ID)).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    expect(setCredential("synthetic-key")).toEqual({
      ok: false,
      code: "KEYCHAIN_SAVE_FAILED",
    });
    expect(readCredentialForOperation()).toEqual({
      ok: true,
      secret: "synthetic-key",
    });

    const indeterminate = native({
      deleteCredential: vi.fn(() => ({
        tag: "failed",
        state: "unknown",
        stage: "verification",
        mayHaveChanged: true,
      })),
    });
    expect(configureKeychainForTest(indeterminate, INSTALLATION_ID)).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    expect(deleteCredential()).toEqual({
      ok: false,
      code: "KEYCHAIN_VERIFICATION_FAILED",
    });
    expect(readCredentialForOperation()).toEqual({
      ok: false,
      code: "KEYCHAIN_STATUS_UNKNOWN",
    });
  });

  test("treats malformed or throwing mutations as indeterminate and enforces success effect cross-products", () => {
    const malformed = native({
      setCredential: vi.fn(() => ({
        tag: "success",
        state: "missing",
        effect: "deleted",
      })),
    });
    expect(configureKeychainForTest(malformed, INSTALLATION_ID)).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    expect(setCredential("synthetic-key")).toEqual({
      ok: false,
      code: "KEYCHAIN_VERIFICATION_FAILED",
    });

    const throws = native({
      deleteCredential: vi.fn(() => {
        throw new Error("synthetic");
      }),
    });
    expect(configureKeychainForTest(throws, INSTALLATION_ID)).toBe(true);
    expect(credentialStatus()).toEqual({ ok: true, status: "configured" });
    expect(deleteCredential()).toEqual({
      ok: false,
      code: "KEYCHAIN_VERIFICATION_FAILED",
    });
  });
});
