import type {
  ArchiveLimits,
  ChatGptExportFile,
  ImportDiagnostic,
  ImportOptions,
  ImportResult,
  SourceDescriptor,
} from "../../domain/contracts.js";
import {
  compareStableStrings,
  fingerprint,
  sha256,
} from "../../fingerprint/stable-json.js";
import {
  ArchiveError,
  DEFAULT_ARCHIVE_LIMITS,
  readConversationFilesFromZip,
} from "../archive.js";
import { normalizeConversation } from "./normalize.js";
import type { ProviderConversation } from "./types.js";

function diagnostic(
  code: ImportDiagnostic["code"],
  message: string,
): ImportDiagnostic {
  return { code, severity: "error", message };
}

function sourceFor(
  files: readonly ChatGptExportFile[],
  importFormat: string,
  importedAt: string,
): SourceDescriptor {
  const sourceIdentity = files
    .map((file) => ({
      fileName: file.fileName,
      contentHash: sha256(file.data),
    }))
    .sort((left, right) => compareStableStrings(left.fileName, right.fileName));
  return {
    provider: "chatgpt",
    importFormat,
    sourceFileName: files
      .map((file) => file.fileName)
      .sort(compareStableStrings)
      .join(","),
    sourceFileFingerprint: fingerprint(sourceIdentity),
    importedAt,
  };
}

function asConversations(value: unknown): ProviderConversation[] | undefined {
  const candidate =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).conversations)
      ? (value as Record<string, unknown>).conversations
      : value;
  if (Array.isArray(candidate)) {
    return candidate.every(
      (item): item is ProviderConversation =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        "mapping" in item,
    )
      ? candidate
      : undefined;
  }
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    "mapping" in candidate
  ) {
    return [candidate];
  }
  return undefined;
}

function parseJsonFiles(
  files: readonly ChatGptExportFile[],
  limits: ArchiveLimits,
): { conversations: ProviderConversation[]; diagnostics: ImportDiagnostic[] } {
  const conversations: ProviderConversation[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const file of files) {
    if (file.data.length > limits.maxJsonBytes) {
      diagnostics.push(
        diagnostic(
          "JSON_SIZE_LIMIT_EXCEEDED",
          "Conversation JSON size limit exceeded.",
        ),
      );
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(file.data)) as unknown;
    } catch {
      diagnostics.push(
        diagnostic(
          "MALFORMED_JSON",
          "Conversation JSON could not be decoded and parsed safely.",
        ),
      );
      continue;
    }
    const parsed = asConversations(value);
    if (parsed === undefined) {
      diagnostics.push(
        diagnostic(
          "UNSUPPORTED_JSON_SHAPE",
          "JSON does not contain a supported ChatGPT conversation structure.",
        ),
      );
      continue;
    }
    conversations.push(...parsed);
  }
  return { conversations, diagnostics };
}

function limitsFrom(options: ImportOptions): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, ...options.archiveLimits };
}

function isZip(file: ChatGptExportFile): boolean {
  if (file.data.length < 4 || file.data[0] !== 0x50 || file.data[1] !== 0x4b)
    return false;
  const signature = (file.data[2] ?? 0) | ((file.data[3] ?? 0) << 8);
  return signature === 0x0403 || signature === 0x0605 || signature === 0x0807;
}

function isFileArray(
  input: ChatGptExportFile | readonly ChatGptExportFile[],
): input is readonly ChatGptExportFile[] {
  return Array.isArray(input);
}

export function parseChatGptExport(
  input: ChatGptExportFile | readonly ChatGptExportFile[],
  options: ImportOptions = {},
): ImportResult {
  const inputFiles: ChatGptExportFile[] = (
    isFileArray(input) ? [...input] : [input]
  )
    .map((file) => ({ file, contentHash: sha256(file.data) }))
    .sort(
      (left, right) =>
        compareStableStrings(left.file.fileName, right.file.fileName) ||
        compareStableStrings(left.contentHash, right.contentHash),
    )
    .map(({ file }) => file);
  const importedAt = options.importedAt ?? new Date().toISOString();
  const limits = limitsFrom(options);
  const first = inputFiles[0];
  if (inputFiles.length === 0 || first === undefined) {
    const source = sourceFor([], "unsupported", importedAt);
    return {
      source: { ...source, provider: "unknown" },
      conversations: [],
      diagnostics: [
        diagnostic("UNSUPPORTED_INPUT", "No import files were supplied."),
      ],
    };
  }

  let jsonFiles = inputFiles;
  let importFormat =
    inputFiles.length > 1 ? "chatgpt-json-numbered-set" : "chatgpt-json";
  const diagnostics: ImportDiagnostic[] = [];
  if (inputFiles.length === 1 && isZip(first)) {
    importFormat = "chatgpt-zip";
    try {
      const archive = readConversationFilesFromZip(first.data, limits);
      jsonFiles = archive.files;
      if (archive.ignoredEntryCount > 0) {
        diagnostics.push({
          code: "UNSUPPORTED_ARCHIVE_ENTRY",
          severity: "warning",
          message: `${String(archive.ignoredEntryCount)} safe non-conversation ZIP entr${archive.ignoredEntryCount === 1 ? "y was" : "ies were"} ignored.`,
        });
      }
      if (jsonFiles.length === 0)
        diagnostics.push(
          diagnostic(
            "MISSING_CONVERSATIONS_JSON",
            "ZIP contains no supported conversation JSON export.",
          ),
        );
    } catch (error) {
      const archiveDiagnostic =
        error instanceof ArchiveError
          ? diagnostic(error.code, error.message)
          : diagnostic("INVALID_ARCHIVE", "ZIP processing failed safely.");
      return {
        source: sourceFor(inputFiles, importFormat, importedAt),
        conversations: [],
        diagnostics: [archiveDiagnostic],
      };
    }
  } else if (inputFiles.some((file) => isZip(file))) {
    return {
      source: sourceFor(inputFiles, "unsupported", importedAt),
      conversations: [],
      diagnostics: [
        diagnostic(
          "UNSUPPORTED_INPUT",
          "ZIP input cannot be combined with other files.",
        ),
      ],
    };
  }

  const parsed = parseJsonFiles(jsonFiles, limits);
  diagnostics.push(...parsed.diagnostics);
  const normalized = parsed.conversations.map(normalizeConversation);
  for (const item of normalized) diagnostics.push(...item.diagnostics);
  return {
    source: sourceFor(inputFiles, importFormat, importedAt),
    conversations: normalized.map(({ conversation }) => conversation),
    diagnostics,
  };
}
