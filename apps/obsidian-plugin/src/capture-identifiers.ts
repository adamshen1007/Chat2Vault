const UINT64_MAX = 18_446_744_073_709_551_615n;
const TEMPORARY_PREFIX = ".chat2vault-private-";

export function isCanonicalUint64Decimal(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 20 ||
    !/^(?:0|[1-9][0-9]*)$/u.test(value)
  )
    return false;
  try {
    return BigInt(value) <= UINT64_MAX;
  } catch {
    return false;
  }
}

export function isCaptureTemporaryName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(TEMPORARY_PREFIX) &&
    isCanonicalUint64Decimal(value.slice(TEMPORARY_PREFIX.length))
  );
}

export function projectCapturePhysicalIdentity(
  value: unknown,
): { device: string; inode: string } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length !== 0
    )
      return undefined;
    const names = Object.getOwnPropertyNames(value);
    if (
      names.length !== 2 ||
      !names.includes("device") ||
      !names.includes("inode")
    )
      return undefined;
    const device = Object.getOwnPropertyDescriptor(value, "device");
    const inode = Object.getOwnPropertyDescriptor(value, "inode");
    if (
      device === undefined ||
      inode === undefined ||
      !device.enumerable ||
      !inode.enumerable ||
      !("value" in device) ||
      !("value" in inode) ||
      !isCanonicalUint64Decimal(device.value) ||
      !isCanonicalUint64Decimal(inode.value)
    )
      return undefined;
    return { device: device.value, inode: inode.value };
  } catch {
    return undefined;
  }
}

export function isCapturePhysicalIdentity(
  value: unknown,
): value is { device: string; inode: string } {
  return projectCapturePhysicalIdentity(value) !== undefined;
}
