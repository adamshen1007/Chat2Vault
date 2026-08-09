import { deflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function write32(target: Uint8Array, offset: number, value: number): void {
  write16(target, offset, value & 0xffff);
  write16(target, offset + 2, value >>> 16);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function createStoredZip(entries: readonly ZipEntry[]): Uint8Array {
  return createZip(entries, "store");
}

export function createZip(
  entries: readonly ZipEntry[],
  compression: "store" | "deflate",
): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const compressed =
      compression === "deflate" ? deflateRawSync(entry.data) : entry.data;
    const method = compression === "deflate" ? 8 : 0;
    const local = new Uint8Array(30 + name.length + compressed.length);
    write32(local, 0, 0x04034b50);
    write16(local, 4, 20);
    write16(local, 6, 0x0800);
    write16(local, 8, method);
    write32(local, 14, checksum);
    write32(local, 18, compressed.length);
    write32(local, 22, entry.data.length);
    write16(local, 26, name.length);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    write32(central, 0, 0x02014b50);
    write16(central, 4, 20);
    write16(central, 6, 20);
    write16(central, 8, 0x0800);
    write16(central, 10, method);
    write32(central, 16, checksum);
    write32(central, 20, compressed.length);
    write32(central, 24, entry.data.length);
    write16(central, 28, name.length);
    write32(central, 42, localOffset);
    central.set(name, 46);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralSize = centrals.reduce(
    (total, entry) => total + entry.length,
    0,
  );
  const end = new Uint8Array(22);
  write32(end, 0, 0x06054b50);
  write16(end, 8, entries.length);
  write16(end, 10, entries.length);
  write32(end, 12, centralSize);
  write32(end, 16, localOffset);
  return concat([...locals, ...centrals, end]);
}
