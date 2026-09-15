import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  configureKeychain,
  credentialStatus,
  deleteCredential,
  KEYCHAIN_ACCOUNT_PREFIX,
  KEYCHAIN_SERVICE,
  readCredentialForOperation,
  setCredential,
} from "./keychain.js";

interface NativeKeychain {
  abiVersion: number;
  credentialStatus(service: string, account: string): unknown;
  readCredential(service: string, account: string): unknown;
  setCredential(service: string, account: string, secret: string): unknown;
  deleteCredential(service: string, account: string): unknown;
}

const loadNative = createRequire(__filename);

function exactNative(value: unknown): value is NativeKeychain {
  if (value === null || typeof value !== "object") return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.getOwnPropertyNames(value);
  return (
    Object.getOwnPropertySymbols(value).length === 0 &&
    names.length === 5 &&
    [
      "abiVersion",
      "credentialStatus",
      "readCredential",
      "setCredential",
      "deleteCredential",
    ].every((name) => Object.hasOwn(descriptors, name)) &&
    descriptors.abiVersion?.value === 1 &&
    typeof descriptors.credentialStatus?.value === "function" &&
    typeof descriptors.readCredential?.value === "function" &&
    typeof descriptors.setCredential?.value === "function" &&
    typeof descriptors.deleteCredential?.value === "function"
  );
}

function tag(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "tag");
  return descriptor !== undefined && "value" in descriptor
    ? (descriptor.value as string)
    : undefined;
}

export function syntheticAccountHash(account: string): string {
  return createHash("sha256").update(account).digest("hex");
}

export function loadRuntimeKeychain(nativePath: string): NativeKeychain {
  const candidate: unknown = loadNative(nativePath);
  if (!exactNative(candidate)) throw new Error("runtime keychain ABI mismatch");
  return candidate;
}

export function runRuntimeKeychainLifecycle(input: {
  nativePath: string;
  installationId: string;
  account: string;
  secret: string;
}): {
  accountHash: string;
  isolationAccountHash: string;
  operations: number;
  finalAbsent: boolean;
  isolationFinalAbsent: boolean;
} {
  const native = loadRuntimeKeychain(input.nativePath);
  if (input.account !== `${KEYCHAIN_ACCOUNT_PREFIX}${input.installationId}`)
    throw new Error("runtime keychain identity/account mismatch");
  const isolationInstallationId = `${input.installationId.slice(0, -1)}${input.installationId.endsWith("0") ? "1" : "0"}`;
  const isolationAccount = `${KEYCHAIN_ACCOUNT_PREFIX}${isolationInstallationId}`;
  let operations = 0;
  try {
    native.deleteCredential(KEYCHAIN_SERVICE, input.account);
    native.deleteCredential(KEYCHAIN_SERVICE, isolationAccount);
    operations += 2;
    if (!configureKeychain(input.nativePath, input.installationId))
      throw new Error("runtime keychain configuration failed");
    const initialStatus = credentialStatus();
    if (!initialStatus.ok || initialStatus.status !== "missing")
      throw new Error("synthetic keychain precondition failed");
    operations += 1;
    const created = setCredential(input.secret);
    if (!created.ok || created.status !== "configured")
      throw new Error("synthetic keychain create failed");
    operations += 1;
    const read = readCredentialForOperation(() => true);
    if (!read.ok || read.secret !== input.secret)
      throw new Error("synthetic keychain read failed");
    operations += 1;
    const replaced = setCredential(`${input.secret}-replacement`);
    if (!replaced.ok || replaced.status !== "configured")
      throw new Error("synthetic keychain replace failed");
    operations += 1;
    if (!configureKeychain(input.nativePath, isolationInstallationId))
      throw new Error("runtime isolation keychain configuration failed");
    const isolatedMissing = credentialStatus();
    if (!isolatedMissing.ok || isolatedMissing.status !== "missing")
      throw new Error("runtime keychain cross-identity isolation failed");
    operations += 1;
    const isolatedCreated = setCredential(`${input.secret}-isolated`);
    if (!isolatedCreated.ok || isolatedCreated.status !== "configured")
      throw new Error("runtime isolated keychain create failed");
    operations += 1;
    const isolatedDeleted = deleteCredential();
    if (!isolatedDeleted.ok || isolatedDeleted.status !== "missing")
      throw new Error("runtime isolated keychain delete failed");
    operations += 1;
    if (!configureKeychain(input.nativePath, input.installationId))
      throw new Error("runtime primary keychain reconfiguration failed");
    const primaryConfigured = credentialStatus();
    if (!primaryConfigured.ok || primaryConfigured.status !== "configured")
      throw new Error("runtime primary keychain was changed by isolation row");
    operations += 1;
    const primaryRead = readCredentialForOperation(() => true);
    if (!primaryRead.ok || primaryRead.secret !== `${input.secret}-replacement`)
      throw new Error("runtime primary keychain isolation read failed");
    operations += 1;
    const deleted = deleteCredential();
    if (!deleted.ok || deleted.status !== "missing")
      throw new Error("synthetic keychain delete failed");
    operations += 1;
  } finally {
    native.deleteCredential(KEYCHAIN_SERVICE, input.account);
    native.deleteCredential(KEYCHAIN_SERVICE, isolationAccount);
    operations += 2;
  }
  const finalAbsent =
    tag(native.credentialStatus(KEYCHAIN_SERVICE, input.account)) === "missing";
  const isolationFinalAbsent =
    tag(native.credentialStatus(KEYCHAIN_SERVICE, isolationAccount)) ===
    "missing";
  operations += 2;
  if (!finalAbsent || !isolationFinalAbsent)
    throw new Error("synthetic keychain cleanup failed");
  return {
    accountHash: syntheticAccountHash(input.account),
    isolationAccountHash: syntheticAccountHash(isolationAccount),
    operations,
    finalAbsent,
    isolationFinalAbsent,
  };
}
