import { inflateRawSync } from "node:zlib";

import type {
  ArchiveLimits,
  ChatGptExportFile,
  ImportDiagnostic,
} from "../domain/contracts.js";

interface CentralEntry {
  fileName: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  checksum: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 1_000,
  maxCompressedBytes: 64 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxJsonBytes: 64 * 1024 * 1024,
};

export class ArchiveError extends Error {
  public constructor(
    public readonly code: ImportDiagnostic["code"],
    safeMessage: string,
  ) {
    super(safeMessage);
  }
}

function u16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function u32(data: Uint8Array, offset: number): number {
  return (u16(data, offset) | (u16(data, offset + 2) << 16)) >>> 0;
}

function findEndRecord(data: Uint8Array): number {
  const minimum = Math.max(0, data.length - 65_557);
  for (let index = data.length - 22; index >= minimum; index -= 1) {
    if (
      u32(data, index) === 0x06054b50 &&
      index + 22 + u16(data, index + 20) === data.length
    )
      return index;
  }
  throw new ArchiveError(
    "INVALID_ARCHIVE",
    "ZIP end-of-central-directory record is missing.",
  );
}

function isUnsafePath(fileName: string): boolean {
  const normalized = fileName.replaceAll("\\", "/");
  const pathWithoutDirectoryMarker = normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
  let hasControlCharacter = false;
  for (const character of pathWithoutDirectoryMarker) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      hasControlCharacter = true;
      break;
    }
  }
  return (
    pathWithoutDirectoryMarker.length === 0 ||
    hasControlCharacter ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    pathWithoutDirectoryMarker
      .split("/")
      .some((segment) => segment === ".." || segment === "")
  );
}

function readEntries(data: Uint8Array, limits: ArchiveLimits): CentralEntry[] {
  if (data.length > limits.maxCompressedBytes) {
    throw new ArchiveError(
      "ARCHIVE_SIZE_LIMIT_EXCEEDED",
      "ZIP compressed-size limit exceeded.",
    );
  }
  const end = findEndRecord(data);
  if (u16(data, end + 4) !== 0 || u16(data, end + 6) !== 0) {
    throw new ArchiveError(
      "UNSUPPORTED_ARCHIVE_ENTRY",
      "Multi-disk ZIP archives are not supported.",
    );
  }
  const entryCount = u16(data, end + 10);
  if (u16(data, end + 8) !== entryCount) {
    throw new ArchiveError(
      "INVALID_ARCHIVE",
      "ZIP entry counts are inconsistent.",
    );
  }
  const centralSize = u32(data, end + 12);
  const centralOffset = u32(data, end + 16);
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ArchiveError(
      "UNSUPPORTED_ARCHIVE_ENTRY",
      "ZIP64 archives are not supported.",
    );
  }
  if (entryCount > limits.maxEntries) {
    throw new ArchiveError(
      "ARCHIVE_ENTRY_LIMIT_EXCEEDED",
      "ZIP entry-count limit exceeded.",
    );
  }
  if (centralOffset + centralSize > end || centralOffset > data.length) {
    throw new ArchiveError(
      "INVALID_ARCHIVE",
      "ZIP central directory is outside the archive bounds.",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: CentralEntry[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > data.length || u32(data, cursor) !== 0x02014b50) {
      throw new ArchiveError(
        "INVALID_ARCHIVE",
        "ZIP central-directory entry is invalid.",
      );
    }
    const fileNameLength = u16(data, cursor + 28);
    const extraLength = u16(data, cursor + 30);
    const commentLength = u16(data, cursor + 32);
    const endOfEntry =
      cursor + 46 + fileNameLength + extraLength + commentLength;
    if (endOfEntry > centralOffset + centralSize) {
      throw new ArchiveError(
        "INVALID_ARCHIVE",
        "ZIP entry metadata is truncated.",
      );
    }
    let fileName: string;
    try {
      fileName = decoder.decode(
        data.subarray(cursor + 46, cursor + 46 + fileNameLength),
      );
    } catch {
      throw new ArchiveError(
        "INVALID_ARCHIVE",
        "ZIP entry name is not valid UTF-8.",
      );
    }
    if (isUnsafePath(fileName)) {
      throw new ArchiveError(
        "INVALID_ARCHIVE_PATH",
        "ZIP contains an unsafe entry path.",
      );
    }
    const uncompressedSize = u32(data, cursor + 24);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxUncompressedBytes) {
      throw new ArchiveError(
        "ARCHIVE_SIZE_LIMIT_EXCEEDED",
        "ZIP uncompressed-size limit exceeded.",
      );
    }
    entries.push({
      fileName,
      flags: u16(data, cursor + 8),
      method: u16(data, cursor + 10),
      compressedSize: u32(data, cursor + 20),
      uncompressedSize,
      localHeaderOffset: u32(data, cursor + 42),
      checksum: u32(data, cursor + 16),
    });
    cursor = endOfEntry;
  }
  if (cursor !== centralOffset + centralSize) {
    throw new ArchiveError(
      "INVALID_ARCHIVE",
      "ZIP central-directory size is inconsistent.",
    );
  }
  return entries;
}

function readEntry(
  data: Uint8Array,
  entry: CentralEntry,
  limits: ArchiveLimits,
): Uint8Array {
  if ((entry.flags & 1) !== 0) {
    throw new ArchiveError(
      "UNSUPPORTED_ARCHIVE_ENTRY",
      "Encrypted ZIP entries are not supported.",
    );
  }
  if (entry.uncompressedSize > limits.maxJsonBytes) {
    throw new ArchiveError(
      "JSON_SIZE_LIMIT_EXCEEDED",
      "Conversation JSON size limit exceeded.",
    );
  }
  const offset = entry.localHeaderOffset;
  if (offset + 30 > data.length || u32(data, offset) !== 0x04034b50) {
    throw new ArchiveError(
      "INVALID_ARCHIVE",
      "ZIP local file header is invalid.",
    );
  }
  const dataOffset =
    offset + 30 + u16(data, offset + 26) + u16(data, offset + 28);
  const compressedEnd = dataOffset + entry.compressedSize;
  if (compressedEnd > data.length) {
    throw new ArchiveError("INVALID_ARCHIVE", "ZIP entry data is truncated.");
  }
  const compressed = data.subarray(dataOffset, compressedEnd);
  let result: Uint8Array;
  if (entry.method === 0) {
    result = compressed.slice();
  } else if (entry.method === 8) {
    try {
      result = inflateRawSync(compressed, {
        maxOutputLength: limits.maxJsonBytes,
      });
    } catch {
      throw new ArchiveError(
        "INVALID_ARCHIVE",
        "ZIP entry decompression failed safely.",
      );
    }
  } else {
    throw new ArchiveError(
      "UNSUPPORTED_ARCHIVE_ENTRY",
      "ZIP compression method is not supported.",
    );
  }
  if (result.length !== entry.uncompressedSize) {
    throw new ArchiveError(
      "INVALID_ARCHIVE",
      "ZIP entry size does not match its metadata.",
    );
  }
  if (crc32(result) !== entry.checksum) {
    throw new ArchiveError(
      "INVALID_ARCHIVE",
      "ZIP entry checksum validation failed.",
    );
  }
  return result;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isConversationCandidate(fileName: string): boolean {
  const baseName = fileName.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return (
    baseName === "conversations.json" ||
    /^conversation(?:s)?[-_]?\d+\.json$/iu.test(baseName)
  );
}

export function readConversationFilesFromZip(
  data: Uint8Array,
  limits: ArchiveLimits,
): { files: ChatGptExportFile[]; ignoredEntryCount: number } {
  const entries = readEntries(data, limits);
  const candidates = entries.filter((entry) =>
    isConversationCandidate(entry.fileName),
  );
  return {
    files: candidates.map((entry) => ({
      fileName: entry.fileName,
      data: readEntry(data, entry, limits),
    })),
    ignoredEntryCount: entries.length - candidates.length,
  };
}
