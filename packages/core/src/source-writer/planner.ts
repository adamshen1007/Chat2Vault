/* eslint-disable @typescript-eslint/no-misused-spread -- M03 stable comparison and title fitting require Unicode code-point iteration. */
import type {
  CanonicalConversation,
  SourceDescriptor,
} from "../domain/contracts.js";
import {
  isCanonicalM03Timestamp,
  isM03WellFormedString,
  pathCollisionKey,
  renderSourceNote,
  safeSourceTitle,
  sourceTopologyAvailable,
} from "./primitives.js";

const FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;
const KEY = /^[a-z0-9_]+$/u;
const REQUIRED = [
  "chat2vault_schema",
  "type",
  "source_provider",
  "source_content_fingerprint",
  "source_import_fingerprint",
  "source_message_count",
  "imported_at",
  "knowledge_status",
] as const;
const ALLOWED = new Set([
  ...REQUIRED,
  "source_conversation_id",
  "source_created_at",
  "source_updated_at",
]);

export interface SourceRegistryEntry {
  schemaVersion: 1;
  path: string;
  provider: "chatgpt";
  providerConversationId?: string;
  contentFingerprint: string;
  importFingerprint: string;
}

export type SourceWriterDiagnosticSeverity = "warning" | "error";
export type SourceWriterDiagnosticCode =
  | "DUPLICATE_SOURCE_REGISTRY_ENTRY"
  | "MALFORMED_SOURCE_REGISTRY_ENTRY"
  | "UNSUPPORTED_SOURCE_WRITER_PLATFORM"
  | "SOURCE_ROOT_SETTING_PENDING"
  | "SOURCE_PREVIEW_IN_PROGRESS"
  | "SOURCE_EXTERNAL_PATH_INVALID_UNICODE"
  | "SOURCE_ROOT_UNCONFIGURED"
  | "INVALID_SOURCE_ROOT"
  | "SOURCE_ROOT_CONFIG_DIR"
  | "SOURCE_ROOT_NAME_COLLISION"
  | "SOURCE_ROOT_PHYSICAL_ALIAS"
  | "SOURCE_ROOT_NOT_VAULT_VISIBLE"
  | "SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE"
  | "SOURCE_NATIVE_PROBE_INDETERMINATE"
  | "SOURCE_PATH_OBSTRUCTED"
  | "SOURCE_PATH_TOO_LONG"
  | "SOURCE_PATH_COLLISION"
  | "SOURCE_REGISTRY_ENUMERATION_FAILED"
  | "SOURCE_REGISTRY_READ_FAILED"
  | "SOURCE_REGISTRY_PHYSICAL_ALIAS"
  | "UNSUPPORTED_SOURCE_PROVIDER"
  | "SOURCE_TOPOLOGY_UNAVAILABLE"
  | "INVALID_SOURCE_RENDER_INPUT"
  | "STALE_SOURCE_WRITE_PLAN"
  | "SOURCE_WRITE_IN_PROGRESS"
  | "SOURCE_WRITE_TARGET_CHANGED"
  | "SOURCE_WRITE_FAILED"
  | "SOURCE_WRITE_VERIFICATION_FAILED";

export interface SourceWriterDiagnostic {
  code: SourceWriterDiagnosticCode;
  severity: SourceWriterDiagnosticSeverity;
  message: string;
}

const DIAGNOSTICS: Record<
  SourceWriterDiagnosticCode,
  readonly [SourceWriterDiagnosticSeverity, string]
> = {
  DUPLICATE_SOURCE_REGISTRY_ENTRY: [
    "warning",
    "Multiple source notes represent the same source fingerprint; no additional note will be written.",
  ],
  MALFORMED_SOURCE_REGISTRY_ENTRY: [
    "warning",
    "A Chat2Vault-like source note has invalid registry frontmatter and was ignored.",
  ],
  UNSUPPORTED_SOURCE_WRITER_PLATFORM: [
    "error",
    "Source-note writing is not qualified on this operating system in M03.",
  ],
  SOURCE_ROOT_SETTING_PENDING: [
    "error",
    "The source folder setting is still being saved; wait for it to settle before previewing or saving a source note.",
  ],
  SOURCE_PREVIEW_IN_PROGRESS: [
    "error",
    "A source-note Preview is already in progress; wait for it to settle before starting another Preview or Save.",
  ],
  SOURCE_EXTERNAL_PATH_INVALID_UNICODE: [
    "error",
    "An external vault or filesystem path contains invalid Unicode and cannot be used safely.",
  ],
  SOURCE_ROOT_UNCONFIGURED: [
    "error",
    "Configure a source folder before previewing or saving a source note.",
  ],
  INVALID_SOURCE_ROOT: [
    "error",
    "The configured source folder is not a valid Chat2Vault vault-relative path.",
  ],
  SOURCE_ROOT_CONFIG_DIR: [
    "error",
    "The configured source folder must not be the Obsidian configuration directory or a descendant of it.",
  ],
  SOURCE_ROOT_NAME_COLLISION: [
    "error",
    "The configured source folder collides with an existing path under Chat2Vault path-equivalence rules.",
  ],
  SOURCE_ROOT_PHYSICAL_ALIAS: [
    "error",
    "The configured source path uses or resolves through an unsupported filesystem alias.",
  ],
  SOURCE_ROOT_NOT_VAULT_VISIBLE: [
    "error",
    "The configured source folder is not safely visible through the Obsidian Vault API.",
  ],
  SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE: [
    "error",
    "Physical containment of the configured source folder could not be verified.",
  ],
  SOURCE_NATIVE_PROBE_INDETERMINATE: [
    "error",
    "A required native filesystem safety probe did not return an authoritative result.",
  ],
  SOURCE_PATH_OBSTRUCTED: [
    "error",
    "The planned source path is obstructed by an incompatible existing filesystem object.",
  ],
  SOURCE_PATH_TOO_LONG: [
    "error",
    "The planned source path exceeds the supported deterministic path limits.",
  ],
  SOURCE_PATH_COLLISION: [
    "error",
    "Every deterministic source filename candidate is already occupied.",
  ],
  SOURCE_REGISTRY_ENUMERATION_FAILED: [
    "error",
    "The source registry could not be enumerated safely from current vault contents.",
  ],
  SOURCE_REGISTRY_READ_FAILED: [
    "error",
    "A current source-registry candidate could not be read safely.",
  ],
  SOURCE_REGISTRY_PHYSICAL_ALIAS: [
    "error",
    "A source-registry candidate uses or resolves through an unsupported filesystem alias.",
  ],
  UNSUPPORTED_SOURCE_PROVIDER: [
    "error",
    "The selected conversation provider is not supported for M03 source writing.",
  ],
  SOURCE_TOPOLOGY_UNAVAILABLE: [
    "error",
    "The selected conversation topology cannot be represented safely by the M03 source-note contract.",
  ],
  INVALID_SOURCE_RENDER_INPUT: [
    "error",
    "The selected canonical source contains invalid values for deterministic source-note rendering.",
  ],
  STALE_SOURCE_WRITE_PLAN: [
    "error",
    "The source-note plan became stale before the write could complete.",
  ],
  SOURCE_WRITE_IN_PROGRESS: [
    "error",
    "A source-note write is already in progress.",
  ],
  SOURCE_WRITE_TARGET_CHANGED: [
    "error",
    "The source-note target changed before creation; review the refreshed plan before saving.",
  ],
  SOURCE_WRITE_FAILED: [
    "error",
    "The source note could not be created safely.",
  ],
  SOURCE_WRITE_VERIFICATION_FAILED: [
    "error",
    "The created source note could not be verified against the approved write plan.",
  ],
};

export function sourceWriterDiagnostic(
  code: SourceWriterDiagnosticCode,
): SourceWriterDiagnostic {
  const [severity, message] = DIAGNOSTICS[code];
  return { code, severity, message };
}

function fatalDecode(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function jsonString(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('"') || !value.endsWith('"'))
    return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isM03WellFormedString(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseSourceRegistryEntry(
  rawBytes: Uint8Array,
  logicalPath: string,
): SourceRegistryEntry | undefined {
  if (rawBytes.length < 8 || rawBytes.length > Number.MAX_SAFE_INTEGER)
    return undefined;
  if (
    rawBytes[0] !== 0x2d ||
    rawBytes[1] !== 0x2d ||
    rawBytes[2] !== 0x2d ||
    rawBytes[3] !== 0x0a
  )
    return undefined;
  const limit = Math.min(rawBytes.length, 16_384);
  let start = 4;
  let lineCount = 1;
  const fields = new Map<string, string>();
  let closed = false;
  while (start < limit && lineCount < 32) {
    let end = start;
    while (end < limit && rawBytes[end] !== 0x0a) {
      if (rawBytes[end] === 0x0d) return undefined;
      end += 1;
    }
    if (end >= limit || rawBytes[end] !== 0x0a) return undefined;
    const lineBytes = rawBytes.slice(start, end);
    lineCount += 1;
    start = end + 1;
    if (
      lineBytes.length === 3 &&
      lineBytes[0] === 0x2d &&
      lineBytes[1] === 0x2d &&
      lineBytes[2] === 0x2d
    ) {
      closed = true;
      break;
    }
    if (lineBytes.length === 0) return undefined;
    const line = fatalDecode(lineBytes);
    if (line === undefined) return undefined;
    const delimiter = line.indexOf(": ");
    if (delimiter <= 0) return undefined;
    const key = line.slice(0, delimiter);
    const value = line.slice(delimiter + 2);
    if (!KEY.test(key) || !ALLOWED.has(key) || fields.has(key))
      return undefined;
    fields.set(key, value);
  }
  if (!closed || REQUIRED.some((key) => !fields.has(key))) return undefined;
  if (
    fields.get("chat2vault_schema") !== "1" ||
    fields.get("type") !== '"ai-conversation-source"' ||
    fields.get("source_provider") !== '"chatgpt"' ||
    fields.get("knowledge_status") !== '"source"'
  )
    return undefined;
  const contentFingerprint = jsonString(
    fields.get("source_content_fingerprint"),
  );
  const importFingerprint = jsonString(fields.get("source_import_fingerprint"));
  const providerConversationId = fields.has("source_conversation_id")
    ? jsonString(fields.get("source_conversation_id"))
    : undefined;
  const messageCount = fields.get("source_message_count") ?? "";
  const importedAt = jsonString(fields.get("imported_at"));
  const createdAt = fields.has("source_created_at")
    ? jsonString(fields.get("source_created_at"))
    : undefined;
  const updatedAt = fields.has("source_updated_at")
    ? jsonString(fields.get("source_updated_at"))
    : undefined;
  if (
    contentFingerprint === undefined ||
    !FINGERPRINT.test(contentFingerprint) ||
    importFingerprint === undefined ||
    !FINGERPRINT.test(importFingerprint) ||
    (fields.has("source_conversation_id") &&
      (providerConversationId === undefined ||
        providerConversationId.length === 0)) ||
    !/^(0|[1-9][0-9]*)$/u.test(messageCount) ||
    !Number.isSafeInteger(Number(messageCount)) ||
    !isCanonicalM03Timestamp(importedAt) ||
    (fields.has("source_created_at") && !isCanonicalM03Timestamp(createdAt)) ||
    (fields.has("source_updated_at") && !isCanonicalM03Timestamp(updatedAt))
  )
    return undefined;
  return {
    schemaVersion: 1,
    path: logicalPath.normalize("NFC"),
    provider: "chatgpt",
    ...(providerConversationId === undefined ? {} : { providerConversationId }),
    contentFingerprint,
    importFingerprint,
  };
}

export function isChat2VaultLikeMalformed(rawBytes: Uint8Array): boolean {
  const probe = rawBytes.slice(0, 16_384);
  let start =
    probe.length >= 3 &&
    probe[0] === 0xef &&
    probe[1] === 0xbb &&
    probe[2] === 0xbf
      ? 3
      : 0;
  const lines: Uint8Array[] = [];
  for (
    let index = start;
    index <= probe.length && lines.length < 32;
    index += 1
  ) {
    const lf = index < probe.length && probe[index] === 0x0a;
    if (!lf && index !== probe.length) continue;
    let end = index;
    if (end > start && probe[end - 1] === 0x0d) end -= 1;
    lines.push(probe.slice(start, end));
    start = index + 1;
  }
  const ascii = (value: string) => new TextEncoder().encode(value);
  const equal = (left: Uint8Array | undefined, right: Uint8Array) =>
    left?.length === right.length &&
    left.every((byte, index) => byte === right[index]);
  if (!equal(lines[0], ascii("---"))) return false;
  let type = false;
  let status = false;
  for (const line of lines.slice(1)) {
    if (equal(line, ascii("---"))) break;
    type ||= equal(line, ascii('type: "ai-conversation-source"'));
    status ||= equal(line, ascii('knowledge_status: "source"'));
  }
  return type && status;
}

export interface SourcePlannerInput {
  source: SourceDescriptor;
  conversation: CanonicalConversation;
  sourceRoot: string;
  platform: string;
  settingsPending?: boolean;
  rootStatus: "existing" | "partially-missing" | "fully-missing" | "blocked";
  rootError?: SourceWriterDiagnosticCode;
  foldersToCreate: string[];
  registryEntries: SourceRegistryEntry[];
  occupiedPaths: string[];
  malformedRegistryPaths: string[];
}

export type SourcePreRootGateInput = Pick<
  SourcePlannerInput,
  "source" | "conversation" | "platform" | "settingsPending"
>;

export function sourceWritePreRootGate(
  input: SourcePreRootGateInput,
): BlockedSourceWritePlan | undefined {
  if (input.settingsPending === true)
    return blocked("SOURCE_ROOT_SETTING_PENDING");
  if (input.platform !== "darwin" && input.platform !== "win32")
    return blocked("UNSUPPORTED_SOURCE_WRITER_PLATFORM");
  if (
    input.conversation.provider !== "chatgpt" ||
    input.source.provider !== "chatgpt"
  )
    return blocked("UNSUPPORTED_SOURCE_PROVIDER");
  return undefined;
}

export function sourceWritePreRegistryGate(
  input: SourcePlannerInput,
): BlockedSourceWritePlan | undefined {
  const early = sourceWritePreRootGate(input);
  if (early !== undefined) return early;
  if (input.rootStatus === "blocked")
    return blocked(input.rootError ?? "INVALID_SOURCE_ROOT");
  if (
    !FINGERPRINT.test(input.conversation.contentFingerprint) ||
    (input.conversation.providerConversationId !== undefined &&
      input.conversation.providerConversationId.length > 0 &&
      !isM03WellFormedString(input.conversation.providerConversationId))
  )
    return blocked("INVALID_SOURCE_RENDER_INPUT");
  return undefined;
}

export interface NewSourceWritePlan {
  disposition: "new";
  targetPath: string;
  noteContent: string;
  noteContentFingerprint: string;
  foldersToCreate: string[];
  diagnostics: SourceWriterDiagnostic[];
}
export interface NewVersionSourceWritePlan extends Omit<
  NewSourceWritePlan,
  "disposition"
> {
  disposition: "new-version";
  previousVersionPaths: string[];
}
export interface DuplicateSourceWritePlan {
  disposition: "duplicate";
  existingPath: string;
  duplicatePaths: string[];
  foldersToCreate: [];
  diagnostics: SourceWriterDiagnostic[];
}
export interface BlockedSourceWritePlan {
  disposition: "blocked";
  foldersToCreate: [];
  diagnostics: SourceWriterDiagnostic[];
}
export type SourceWritePlan =
  | NewSourceWritePlan
  | NewVersionSourceWritePlan
  | DuplicateSourceWritePlan
  | BlockedSourceWritePlan;

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function stringsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function diagnosticsEqual(
  left: readonly SourceWriterDiagnostic[],
  right: readonly SourceWriterDiagnostic[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        exactObjectKeys(value, ["code", "severity", "message"]) &&
        exactObjectKeys(other, ["code", "severity", "message"]) &&
        value.code === other.code &&
        value.severity === other.severity &&
        value.message === other.message
      );
    })
  );
}

export function sourceWritePlanEqual(
  left: SourceWritePlan,
  right: unknown,
): right is SourceWritePlan {
  if (right === null || typeof right !== "object" || Array.isArray(right))
    return false;
  const candidate = right as Partial<SourceWritePlan> & Record<string, unknown>;
  if (
    left.disposition !== candidate.disposition ||
    !Array.isArray(candidate.foldersToCreate) ||
    !Array.isArray(candidate.diagnostics)
  )
    return false;
  const diagnostics = candidate.diagnostics;
  const folders = candidate.foldersToCreate as string[];
  if (
    !stringsEqual(left.foldersToCreate, folders) ||
    !diagnosticsEqual(left.diagnostics, diagnostics)
  )
    return false;
  if (left.disposition === "blocked")
    return exactObjectKeys(candidate, [
      "disposition",
      "foldersToCreate",
      "diagnostics",
    ]);
  if (left.disposition === "duplicate") {
    return (
      exactObjectKeys(candidate, [
        "disposition",
        "existingPath",
        "duplicatePaths",
        "foldersToCreate",
        "diagnostics",
      ]) &&
      candidate.existingPath === left.existingPath &&
      Array.isArray(candidate.duplicatePaths) &&
      stringsEqual(left.duplicatePaths, candidate.duplicatePaths as string[])
    );
  }
  const writableKeys = [
    "disposition",
    "targetPath",
    "noteContent",
    "noteContentFingerprint",
    "foldersToCreate",
    "diagnostics",
  ];
  if (left.disposition === "new") {
    return (
      exactObjectKeys(candidate, writableKeys) &&
      candidate.targetPath === left.targetPath &&
      candidate.noteContent === left.noteContent &&
      candidate.noteContentFingerprint === left.noteContentFingerprint
    );
  }
  return (
    exactObjectKeys(candidate, [...writableKeys, "previousVersionPaths"]) &&
    candidate.targetPath === left.targetPath &&
    candidate.noteContent === left.noteContent &&
    candidate.noteContentFingerprint === left.noteContentFingerprint &&
    Array.isArray(candidate.previousVersionPaths) &&
    stringsEqual(
      left.previousVersionPaths,
      candidate.previousVersionPaths as string[],
    )
  );
}

function blocked(
  code: SourceWriterDiagnosticCode,
  warnings: SourceWriterDiagnostic[] = [],
): BlockedSourceWritePlan {
  return {
    disposition: "blocked",
    foldersToCreate: [],
    diagnostics: [...warnings, sourceWriterDiagnostic(code)],
  };
}

export function compareSourcePaths(left: string, right: string): number {
  const a = [...left.normalize("NFC")];
  const b = [...right.normalize("NFC")];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const leftPoint = a[index]?.codePointAt(0);
    const rightPoint = b[index]?.codePointAt(0);
    if (leftPoint !== rightPoint) return (leftPoint ?? 0) - (rightPoint ?? 0);
  }
  return a.length - b.length;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function allocateTarget(
  sourceRoot: string,
  conversation: CanonicalConversation,
  occupiedPaths: readonly string[],
):
  | { ok: true; targetPath: string }
  | {
      ok: false;
      code:
        | "INVALID_SOURCE_RENDER_INPUT"
        | "SOURCE_PATH_TOO_LONG"
        | "SOURCE_PATH_COLLISION";
    } {
  const fingerprint = conversation.contentFingerprint;
  if (!FINGERPRINT.test(fingerprint))
    return { ok: false, code: "INVALID_SOURCE_RENDER_INPUT" };
  const date = isCanonicalM03Timestamp(conversation.createdAt)
    ? conversation.createdAt.slice(0, 10)
    : "Undated";
  let title = safeSourceTitle(conversation.title);
  const fullHex = fingerprint.slice("sha256:".length);
  const fitName = (candidateTitle: string) =>
    `${date} - Source - ${candidateTitle} - ${fullHex}.md`;
  while (fitName(title).length > 180 || utf8Length(fitName(title)) > 240) {
    const points = [...title];
    points.pop();
    title = points.join("").replace(/^[ .-]+|[ .-]+$/gu, "");
    if (title.length === 0) title = "Untitled conversation";
    if (
      title === "Untitled conversation" &&
      (fitName(title).length > 180 || utf8Length(fitName(title)) > 240)
    )
      return { ok: false, code: "SOURCE_PATH_TOO_LONG" };
  }
  const occupied = new Set(occupiedPaths.map(pathCollisionKey));
  for (const length of [12, 20, 32, 64]) {
    const targetPath =
      `${sourceRoot}/${date} - Source - ${title} - ${fullHex.slice(0, length)}.md`.normalize(
        "NFC",
      );
    if (targetPath.length > 1024 || utf8Length(targetPath) > 2048)
      return { ok: false, code: "SOURCE_PATH_TOO_LONG" };
    if (!occupied.has(pathCollisionKey(targetPath)))
      return { ok: true, targetPath };
  }
  return { ok: false, code: "SOURCE_PATH_COLLISION" };
}

export function planSourceWrite(input: SourcePlannerInput): SourceWritePlan {
  const preRegistry = sourceWritePreRegistryGate(input);
  if (preRegistry !== undefined) return preRegistry;
  const warnings = input.malformedRegistryPaths
    .sort(compareSourcePaths)
    .map(() => sourceWriterDiagnostic("MALFORMED_SOURCE_REGISTRY_ENTRY"));
  if (!sourceTopologyAvailable(input.conversation))
    return blocked("SOURCE_TOPOLOGY_UNAVAILABLE", warnings);
  const duplicates = input.registryEntries
    .filter(
      (entry) =>
        entry.contentFingerprint === input.conversation.contentFingerprint,
    )
    .map((entry) => entry.path)
    .sort(compareSourcePaths);
  if (duplicates.length > 0) {
    const diagnostics = [...warnings];
    if (duplicates.length > 1)
      diagnostics.push(
        sourceWriterDiagnostic("DUPLICATE_SOURCE_REGISTRY_ENTRY"),
      );
    return {
      disposition: "duplicate",
      existingPath: duplicates[0] ?? "",
      duplicatePaths: duplicates,
      foldersToCreate: [],
      diagnostics,
    };
  }
  const providerId = input.conversation.providerConversationId;
  const previousVersionPaths =
    providerId === undefined || providerId.length === 0
      ? []
      : input.registryEntries
          .filter(
            (entry) =>
              entry.providerConversationId === providerId &&
              entry.contentFingerprint !==
                input.conversation.contentFingerprint,
          )
          .map((entry) => entry.path)
          .sort(compareSourcePaths);
  const allocation = allocateTarget(
    input.sourceRoot,
    input.conversation,
    input.occupiedPaths,
  );
  if (!allocation.ok) return blocked(allocation.code, warnings);
  const target = allocation.targetPath;
  const rendered = renderSourceNote({
    source: input.source,
    conversation: input.conversation,
  });
  if (!rendered.ok) return blocked(rendered.code, warnings);
  const selfTrusted = parseSourceRegistryEntry(
    new TextEncoder().encode(rendered.noteContent),
    target,
  );
  const expectedProviderConversationId =
    input.conversation.providerConversationId === ""
      ? undefined
      : input.conversation.providerConversationId;
  if (
    selfTrusted?.provider !== input.conversation.provider ||
    selfTrusted.providerConversationId !== expectedProviderConversationId ||
    selfTrusted.contentFingerprint !== input.conversation.contentFingerprint ||
    selfTrusted.importFingerprint !== input.source.sourceFileFingerprint
  )
    return blocked("INVALID_SOURCE_RENDER_INPUT", warnings);
  const common = {
    targetPath: target,
    noteContent: rendered.noteContent,
    noteContentFingerprint: rendered.noteContentFingerprint,
    foldersToCreate: input.foldersToCreate.map((path) => path.normalize("NFC")),
    diagnostics: warnings,
  };
  return previousVersionPaths.length > 0
    ? { disposition: "new-version", ...common, previousVersionPaths }
    : { disposition: "new", ...common };
}
