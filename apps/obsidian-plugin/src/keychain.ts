import { validateProviderSecret } from "@chat2vault/core";
import { createRequire } from "node:module";
import { posix } from "node:path";

export const KEYCHAIN_SERVICE = "com.chat2vault.obsidian.openai-compatible";
export const KEYCHAIN_ACCOUNT_PREFIX = "installation/";

type CredentialState = "unknown" | "configured" | "missing" | "unavailable";
type NativeStatus =
  { tag: "configured" } | { tag: "missing" } | { tag: "unavailable" };
type NativeRead = NativeStatus | { tag: "configured"; secret: string };
type NativeMutation =
  | {
      tag: "success";
      state: "configured" | "missing";
      effect: "created" | "replaced" | "deleted" | "already-missing";
    }
  | {
      tag: "failed";
      state: "unknown";
      stage: "mutation" | "verification";
      mayHaveChanged: boolean;
    };

interface NativeKeychain {
  abiVersion: 1;
  credentialStatus(service: string, account: string): NativeStatus;
  readCredential(service: string, account: string): NativeRead;
  setCredential(
    service: string,
    account: string,
    secret: string,
  ): NativeMutation;
  deleteCredential(service: string, account: string): NativeMutation;
}

export type CredentialReadResult =
  | { ok: true; secret: string }
  | {
      ok: false;
      code:
        | "KEYCHAIN_UNAVAILABLE"
        | "KEYCHAIN_MISSING"
        | "KEYCHAIN_STATUS_UNKNOWN"
        | "KEYCHAIN_OPERATION_STALE";
    };
export type CredentialStatusResult =
  | { ok: true; status: Exclude<CredentialState, "unknown"> }
  | { ok: false; code: "KEYCHAIN_OPERATION_IN_PROGRESS" };
export type CredentialMutationResult =
  | { ok: true; status: "configured" | "missing" }
  | {
      ok: false;
      code:
        | "KEYCHAIN_INPUT_INVALID"
        | "KEYCHAIN_OPERATION_IN_PROGRESS"
        | "KEYCHAIN_SAVE_FAILED"
        | "KEYCHAIN_DELETE_FAILED"
        | "KEYCHAIN_VERIFICATION_FAILED";
    };
export interface KeychainHooks {
  invalidateProviderOwnerAndAbort?: () => void;
  onCredentialState?: (state: CredentialState) => void;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NATIVE_KEYS = [
  "abiVersion",
  "credentialStatus",
  "readCredential",
  "setCredential",
  "deleteCredential",
] as const;
const loadNative = createRequire(__filename);
type NativeLoader = (nativePath: string) => unknown;
type NativeRuntime = Readonly<{ platform: string; arch: string }>;

let nativeKeychain: NativeKeychain | undefined;
let account: string | undefined;
let state: CredentialState = "unknown";
let credentialMutex = false;
let credentialGeneration = 0;
let hooks: KeychainHooks = {};

function descriptorValue(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor !== undefined && "value" in descriptor
    ? (descriptor.value as unknown)
    : undefined;
}

function dataOnlyExactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, PropertyDescriptor> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const names = Object.getOwnPropertyNames(value);
    if (
      names.length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key))
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      )
        return undefined;
    }
    return descriptors;
  } catch {
    return undefined;
  }
}

function nativeModuleDescriptors(
  value: unknown,
): Record<string, PropertyDescriptor> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const names = Object.getOwnPropertyNames(value);
    if (
      names.length !== NATIVE_KEYS.length ||
      !NATIVE_KEYS.every((key) => Object.hasOwn(value, key))
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return NATIVE_KEYS.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && "value" in descriptor;
    })
      ? descriptors
      : undefined;
  } catch {
    return undefined;
  }
}

function validNativeModule(value: unknown): value is NativeKeychain {
  const descriptors = nativeModuleDescriptors(value);
  return (
    descriptors !== undefined &&
    descriptorValue(descriptors.abiVersion) === 1 &&
    typeof descriptorValue(descriptors.credentialStatus) === "function" &&
    typeof descriptorValue(descriptors.readCredential) === "function" &&
    typeof descriptorValue(descriptors.setCredential) === "function" &&
    typeof descriptorValue(descriptors.deleteCredential) === "function"
  );
}

function deriveKeychainAccount(installationId: string): string | undefined {
  return UUID_V4.test(installationId)
    ? `${KEYCHAIN_ACCOUNT_PREFIX}${installationId}`
    : undefined;
}

function validNativePath(nativePath: unknown): nativePath is string {
  if (
    typeof nativePath !== "string" ||
    nativePath.includes("\0") ||
    !posix.isAbsolute(nativePath) ||
    posix.normalize(nativePath) !== nativePath ||
    posix.basename(nativePath) !== "keychain.node"
  )
    return false;
  const nativeDirectory = posix.dirname(nativePath);
  const pluginRoot = posix.dirname(nativeDirectory);
  return (
    posix.basename(nativeDirectory) === "native" &&
    pluginRoot !== "/" &&
    pluginRoot !== "."
  );
}

function installState(next: CredentialState): void {
  state = next;
  hooks.onCredentialState?.(next);
}

function applyObservation(next: Exclude<CredentialState, "unknown">): void {
  if (state !== next) {
    ++credentialGeneration;
    hooks.invalidateProviderOwnerAndAbort?.();
  }
  installState(next);
}

function unavailable(): void {
  applyObservation("unavailable");
}

function statusResult(
  value: unknown,
): Exclude<CredentialState, "unknown"> | undefined {
  const descriptors = dataOnlyExactObject(value, ["tag"]);
  const tag = descriptorValue(descriptors?.tag);
  return tag === "configured" || tag === "missing" || tag === "unavailable"
    ? tag
    : undefined;
}

function readResult(
  value: unknown,
):
  | { state: "configured"; secret: string }
  | { state: "missing" | "unavailable" }
  | undefined {
  const status = statusResult(value);
  if (status === "missing" || status === "unavailable")
    return { state: status };
  const descriptors = dataOnlyExactObject(value, ["tag", "secret"]);
  if (descriptorValue(descriptors?.tag) !== "configured") return undefined;
  const secret = descriptorValue(descriptors?.secret);
  return typeof secret === "string"
    ? { state: "configured", secret }
    : undefined;
}

function mutationResult(
  value: unknown,
  operation: "set" | "delete",
): "success" | "failed" | "failed-no-change" | undefined {
  const success = dataOnlyExactObject(value, ["tag", "state", "effect"]);
  if (success?.tag?.value === "success") {
    const configured =
      operation === "set" &&
      success.state?.value === "configured" &&
      (success.effect?.value === "created" ||
        success.effect?.value === "replaced");
    const missing =
      operation === "delete" &&
      success.state?.value === "missing" &&
      (success.effect?.value === "deleted" ||
        success.effect?.value === "already-missing");
    return configured || missing ? "success" : undefined;
  }
  const failed = dataOnlyExactObject(value, [
    "tag",
    "state",
    "stage",
    "mayHaveChanged",
  ]);
  return failed?.tag?.value === "failed" &&
    failed.state?.value === "unknown" &&
    (failed.stage?.value === "mutation" ||
      failed.stage?.value === "verification") &&
    typeof failed.mayHaveChanged?.value === "boolean"
    ? failed.mayHaveChanged.value
      ? "failed"
      : "failed-no-change"
    : undefined;
}

function configuredNative(): NativeKeychain | undefined {
  return nativeKeychain === undefined || account === undefined
    ? undefined
    : nativeKeychain;
}

function configure(
  candidate: unknown,
  installationId: string,
  nextHooks: KeychainHooks,
): boolean {
  const derived = deriveKeychainAccount(installationId);
  hooks = nextHooks;
  credentialMutex = false;
  credentialGeneration = 0;
  if (!validNativeModule(candidate) || derived === undefined) {
    nativeKeychain = undefined;
    account = undefined;
    installState("unavailable");
    return false;
  }
  nativeKeychain = candidate;
  account = derived;
  installState("unknown");
  return true;
}

function configureFromNativePath(
  nativePath: unknown,
  installationId: string,
  nextHooks: KeychainHooks,
  loader: NativeLoader,
  runtime: NativeRuntime,
): boolean {
  if (
    runtime.platform !== "darwin" ||
    runtime.arch !== "x64" ||
    deriveKeychainAccount(installationId) === undefined ||
    !validNativePath(nativePath)
  )
    return configure(undefined, installationId, nextHooks);
  try {
    return configure(loader(nativePath), installationId, nextHooks);
  } catch {
    return configure(undefined, installationId, nextHooks);
  }
}

/** Configures the production binding from the composition root's exact path. */
export function configureKeychain(
  nativePath: string,
  installationId: string,
  nextHooks: KeychainHooks = {},
): boolean {
  return configureFromNativePath(
    nativePath,
    installationId,
    nextHooks,
    loadNative,
    process,
  );
}

/** Unit tests exercise the production path and platform gates without native I/O. */
export function configureKeychainFromPathForTest(
  nativePath: unknown,
  installationId: string,
  loader: NativeLoader,
  runtime: NativeRuntime,
  nextHooks: KeychainHooks = {},
): boolean {
  return configureFromNativePath(
    nativePath,
    installationId,
    nextHooks,
    loader,
    runtime,
  );
}

/** Runtime tests inject a descriptor-checked synthetic module, never an account. */
export function configureKeychainForTest(
  candidate: unknown,
  installationId: string,
  nextHooks: KeychainHooks = {},
): boolean {
  return configure(candidate, installationId, nextHooks);
}

export function credentialStatus(): CredentialStatusResult {
  if (credentialMutex)
    return { ok: false, code: "KEYCHAIN_OPERATION_IN_PROGRESS" };
  credentialMutex = true;
  try {
    const result = observeCredentialStatus();
    return {
      ok: true,
      status: result.status === "unknown" ? "unavailable" : result.status,
    };
  } finally {
    credentialMutex = false;
  }
}

function observeCredentialStatus(): { status: CredentialState } {
  if (configuredNative() === undefined || account === undefined) {
    unavailable();
    return { status: state };
  }
  try {
    const observed = statusResult(
      nativeKeychain?.credentialStatus(KEYCHAIN_SERVICE, account),
    );
    if (observed === undefined) unavailable();
    else applyObservation(observed);
  } catch {
    unavailable();
  }
  return { status: state };
}

export function refreshCredentialStatus(): CredentialStatusResult {
  return credentialStatus();
}

export function readCredentialForOperation(
  operationCurrent: () => boolean = () => true,
): CredentialReadResult {
  if (credentialMutex || state === "unknown")
    return { ok: false, code: "KEYCHAIN_STATUS_UNKNOWN" };
  if (
    configuredNative() === undefined ||
    account === undefined ||
    state === "unavailable"
  )
    return { ok: false, code: "KEYCHAIN_UNAVAILABLE" };
  if (state === "missing") return { ok: false, code: "KEYCHAIN_MISSING" };
  try {
    if (!operationCurrent())
      return { ok: false, code: "KEYCHAIN_OPERATION_STALE" };
  } catch {
    return { ok: false, code: "KEYCHAIN_OPERATION_STALE" };
  }
  try {
    const observed = readResult(
      nativeKeychain?.readCredential(KEYCHAIN_SERVICE, account),
    );
    if (observed?.state === "configured") {
      if (!validateProviderSecret(observed.secret).ok) {
        unavailable();
        return { ok: false, code: "KEYCHAIN_UNAVAILABLE" };
      }
      try {
        if (!operationCurrent())
          return { ok: false, code: "KEYCHAIN_OPERATION_STALE" };
      } catch {
        return { ok: false, code: "KEYCHAIN_OPERATION_STALE" };
      }
      return { ok: true, secret: observed.secret };
    }
    if (observed?.state === "missing") {
      applyObservation("missing");
      return { ok: false, code: "KEYCHAIN_MISSING" };
    }
    unavailable();
    return { ok: false, code: "KEYCHAIN_UNAVAILABLE" };
  } catch {
    unavailable();
    return { ok: false, code: "KEYCHAIN_UNAVAILABLE" };
  }
}

function mutate(
  operation: "set" | "delete",
  secret?: string,
): CredentialMutationResult {
  if (credentialMutex)
    return { ok: false, code: "KEYCHAIN_OPERATION_IN_PROGRESS" };
  credentialMutex = true;
  const prior = state;
  ++credentialGeneration;
  hooks.invalidateProviderOwnerAndAbort?.();
  installState("unknown");
  try {
    const native = configuredNative();
    if (
      native === undefined ||
      account === undefined ||
      (operation === "set" && secret === undefined)
    )
      return { ok: false, code: "KEYCHAIN_VERIFICATION_FAILED" };
    let result: ReturnType<typeof mutationResult>;
    if (operation === "set") {
      if (secret === undefined)
        return { ok: false, code: "KEYCHAIN_VERIFICATION_FAILED" };
      result = mutationResult(
        native.setCredential(KEYCHAIN_SERVICE, account, secret),
        operation,
      );
    } else {
      result = mutationResult(
        native.deleteCredential(KEYCHAIN_SERVICE, account),
        operation,
      );
    }
    if (result === "success") {
      installState(operation === "set" ? "configured" : "missing");
      return { ok: true, status: state as "configured" | "missing" };
    }
    if (result === "failed-no-change") {
      installState(prior);
      return {
        ok: false,
        code:
          operation === "set"
            ? "KEYCHAIN_SAVE_FAILED"
            : "KEYCHAIN_DELETE_FAILED",
      };
    }
    return { ok: false, code: "KEYCHAIN_VERIFICATION_FAILED" };
  } catch {
    return { ok: false, code: "KEYCHAIN_VERIFICATION_FAILED" };
  } finally {
    credentialMutex = false;
  }
}

export function setCredential(secret: unknown): CredentialMutationResult {
  const valid = validateProviderSecret(secret);
  return valid.ok
    ? mutate("set", valid.secret)
    : { ok: false, code: "KEYCHAIN_INPUT_INVALID" };
}

export function deleteCredential(): CredentialMutationResult {
  return mutate("delete");
}

export function credentialGenerationForTest(): number {
  return credentialGeneration;
}
