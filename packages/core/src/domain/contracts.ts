export type SourceProvider = "chatgpt" | "unknown";

export interface SourceDescriptor {
  provider: SourceProvider;
  importFormat: string;
  sourceFileName: string;
  sourceFileFingerprint: string;
  importedAt: string;
}

export type CanonicalRole =
  "user" | "assistant" | "system" | "tool" | "unknown";

export type CanonicalContentBlock =
  | { type: "text"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "reference"; text: string; url?: string }
  | { type: "unsupported"; description: string };

export interface CanonicalMessage {
  providerMessageId?: string;
  parentMessageId?: string;
  role: CanonicalRole;
  createdAt?: string;
  content: CanonicalContentBlock[];
  metadata: Record<string, unknown>;
  fingerprint: string;
}

export interface CanonicalConversation {
  schemaVersion: 1;
  provider: SourceProvider;
  providerConversationId?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messages: CanonicalMessage[];
  metadata: Record<string, unknown>;
  contentFingerprint: string;
}

export type DiagnosticSeverity = "warning" | "error";

export type ImportDiagnosticCode =
  | "AMBIGUOUS_BRANCH"
  | "ARCHIVE_ENTRY_LIMIT_EXCEEDED"
  | "ARCHIVE_SIZE_LIMIT_EXCEEDED"
  | "DUPLICATE_MESSAGE_ID"
  | "INVALID_ARCHIVE"
  | "INVALID_ARCHIVE_PATH"
  | "INVALID_MESSAGE_GRAPH"
  | "JSON_SIZE_LIMIT_EXCEEDED"
  | "MALFORMED_JSON"
  | "MISSING_CONVERSATIONS_JSON"
  | "ORPHAN_PARENT"
  | "UNSUPPORTED_ARCHIVE_ENTRY"
  | "UNSUPPORTED_INPUT"
  | "UNSUPPORTED_JSON_SHAPE";

export interface ImportDiagnostic {
  code: ImportDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  sourceIdentifier?: string;
  conversationIdentifier?: string;
  messageIdentifier?: string;
}

export interface ImportResult {
  source: SourceDescriptor;
  conversations: CanonicalConversation[];
  diagnostics: ImportDiagnostic[];
}

export interface ChatGptExportFile {
  fileName: string;
  data: Uint8Array;
}

export interface ArchiveLimits {
  maxEntries: number;
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
  maxJsonBytes: number;
}

export interface ImportOptions {
  importedAt?: string;
  archiveLimits?: Partial<ArchiveLimits>;
}
