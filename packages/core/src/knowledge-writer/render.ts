/* eslint-disable @typescript-eslint/no-misused-spread -- filename limits are defined on Unicode code points. */
import {
  M04_BODY_MAX_UTF16,
  M04_BODY_MAX_UTF8,
  M04_MAX_SUGGESTED_TAGS,
  M04_SUGGESTION_MAX_UTF16,
  M04_SUGGESTION_MAX_UTF8,
  M04_SUMMARY_MAX_UTF16,
  M04_SUMMARY_MAX_UTF8,
  M04_TITLE_MAX_UTF16,
  M04_TITLE_MAX_UTF8,
  type KnowledgeType,
} from "../distillation/contracts.js";
import {
  compareStableStrings,
  fingerprint,
  sha256,
} from "../fingerprint/stable-json.js";
import {
  isM03WellFormedString,
  normalizeSourceRoot,
  toM03WellFormedString,
} from "../source-writer/primitives.js";
import type {
  KnowledgeNoteRenderResult,
  ResolvedKnowledgeSource,
  ReviewedKnowledgeCandidate,
} from "./contracts.js";
import { m06Diagnostic } from "./review.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
// eslint-disable-next-line no-control-regex -- portable filenames forbid these exact controls.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;
const WINDOWS_INVALID = /[<>:"/\\|?*]/gu;
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu;
const KNOWLEDGE_TYPES: readonly KnowledgeType[] = [
  "insight",
  "decision",
  "framework",
  "procedure",
  "prompt",
  "resource",
  "project-context",
  "assumption",
  "open-question",
  "action",
];
const HEADING_PUNCTUATION = new Set([...`!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`]);

interface CanonicalSourceRef {
  provider: ResolvedKnowledgeSource["provider"];
  providerConversationId?: string;
  conversationFingerprint: string;
  messageFingerprints: string[];
}

interface RenderData {
  type: KnowledgeType;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  sourceRefs: CanonicalSourceRef[];
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function normalizedText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?|\n/gu, "\n");
}

function validText(
  value: unknown,
  maxUtf16: number,
  maxUtf8: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    isM03WellFormedString(value) &&
    value.normalize("NFC") === value &&
    value.length <= maxUtf16 &&
    utf8Length(value) <= maxUtf8
  );
}

function dataProperty(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.enumerable
    ? descriptor.value
    : undefined;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => typeof key === "string" && allowed.has(key))
  );
}

function strictArrayValues(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
    )
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      return undefined;
    result.push(descriptor.value);
  }
  return result;
}

function canonicalMessages(value: unknown): string[] | undefined {
  const items = strictArrayValues(value);
  if (items === undefined || items.length === 0) return undefined;
  const messages: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string" || !SHA256.test(item) || seen.has(item))
      return undefined;
    seen.add(item);
    messages.push(item);
  }
  return messages.sort(compareStableStrings);
}

function canonicalSource(
  value: unknown,
  requirePath: boolean,
): (CanonicalSourceRef & { sourceNotePath?: string }) | undefined {
  if (!plainRecord(value)) return undefined;
  if (
    !hasOnlyKeys(
      value,
      ["provider", "conversationFingerprint", "messageFingerprints"],
      ["providerConversationId", ...(requirePath ? ["sourceNotePath"] : [])],
    ) ||
    (requirePath && !Reflect.ownKeys(value).includes("sourceNotePath"))
  )
    return undefined;
  const provider = dataProperty(value, "provider");
  const providerConversationId = dataProperty(value, "providerConversationId");
  const conversationFingerprint = dataProperty(
    value,
    "conversationFingerprint",
  );
  const messages = canonicalMessages(
    dataProperty(value, "messageFingerprints"),
  );
  const sourceNotePath = dataProperty(value, "sourceNotePath");
  if (
    (provider !== "chatgpt" && provider !== "unknown") ||
    (providerConversationId !== undefined &&
      (!validText(providerConversationId, 2048, 8192) ||
        providerConversationId.includes("\n"))) ||
    typeof conversationFingerprint !== "string" ||
    !SHA256.test(conversationFingerprint) ||
    messages === undefined ||
    (requirePath &&
      (typeof sourceNotePath !== "string" ||
        !sourceNotePath.endsWith(".md") ||
        normalizeSourceRoot(sourceNotePath).status !== "configured"))
  )
    return undefined;
  return {
    provider,
    ...(providerConversationId === undefined ? {} : { providerConversationId }),
    conversationFingerprint,
    messageFingerprints: messages,
    ...(requirePath ? { sourceNotePath: sourceNotePath as string } : {}),
  };
}

function compareSources(
  left: CanonicalSourceRef,
  right: CanonicalSourceRef,
): number {
  for (const pair of [
    [left.provider, right.provider],
    [left.providerConversationId ?? "", right.providerConversationId ?? ""],
    [left.conversationFingerprint, right.conversationFingerprint],
    [
      left.messageFingerprints.join("\u0000"),
      right.messageFingerprints.join("\u0000"),
    ],
  ] as const) {
    const compared = compareStableStrings(pair[0], pair[1]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function readTags(value: unknown): string[] | undefined {
  const items = strictArrayValues(value);
  if (items === undefined || items.length > M04_MAX_SUGGESTED_TAGS)
    return undefined;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (
      !validText(item, M04_SUGGESTION_MAX_UTF16, M04_SUGGESTION_MAX_UTF8) ||
      item.includes("\n") ||
      seen.has(item)
    )
      return undefined;
    seen.add(item);
    tags.push(item);
  }
  return tags.sort(compareStableStrings);
}

function renderData(candidate: unknown): RenderData | undefined {
  if (!plainRecord(candidate)) return undefined;
  if (
    !hasOnlyKeys(candidate, [
      "id",
      "originalCandidateFingerprint",
      "type",
      "confidence",
      "sourceRefs",
      "title",
      "summary",
      "body",
      "tags",
      "decision",
      "selected",
    ])
  )
    return undefined;
  const type = dataProperty(candidate, "type");
  const id = dataProperty(candidate, "id");
  const originalCandidateFingerprint = dataProperty(
    candidate,
    "originalCandidateFingerprint",
  );
  const confidence = dataProperty(candidate, "confidence");
  const decision = dataProperty(candidate, "decision");
  const selected = dataProperty(candidate, "selected");
  const title = dataProperty(candidate, "title");
  const summary = dataProperty(candidate, "summary");
  const body = dataProperty(candidate, "body");
  const tags = readTags(dataProperty(candidate, "tags"));
  const rawSources = strictArrayValues(dataProperty(candidate, "sourceRefs"));
  if (
    typeof id !== "string" ||
    !SHA256.test(id) ||
    typeof originalCandidateFingerprint !== "string" ||
    !SHA256.test(originalCandidateFingerprint) ||
    (confidence !== "high" &&
      confidence !== "medium" &&
      confidence !== "low") ||
    (decision !== "accepted" && decision !== "edited") ||
    typeof selected !== "boolean" ||
    typeof type !== "string" ||
    !KNOWLEDGE_TYPES.includes(type as KnowledgeType) ||
    !validText(title, M04_TITLE_MAX_UTF16, M04_TITLE_MAX_UTF8) ||
    !validText(summary, M04_SUMMARY_MAX_UTF16, M04_SUMMARY_MAX_UTF8) ||
    !validText(body, M04_BODY_MAX_UTF16, M04_BODY_MAX_UTF8) ||
    tags === undefined ||
    rawSources === undefined ||
    rawSources.length === 0
  )
    return undefined;
  const sourceRefs = rawSources.map((source) => canonicalSource(source, false));
  if (sourceRefs.some((source) => source === undefined)) return undefined;
  const canonical = sourceRefs as CanonicalSourceRef[];
  canonical.sort(compareSources);
  if (
    canonical.some((source, index) => {
      const previous = canonical[index - 1];
      return previous !== undefined && compareSources(previous, source) === 0;
    })
  )
    return undefined;
  return {
    type: type as KnowledgeType,
    title: normalizedText(title),
    summary: normalizedText(summary),
    body: normalizedText(body),
    tags,
    sourceRefs: canonical,
  };
}

function sameSource(
  left: CanonicalSourceRef,
  right: CanonicalSourceRef,
): boolean {
  return compareSources(left, right) === 0;
}

function yamlQuoted(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

function escapeHeading(value: string): string {
  return [...toM03WellFormedString(value).replace(/\n/gu, " ")]
    .map((point) => (HEADING_PUNCTUATION.has(point) ? `\\${point}` : point))
    .join("");
}

function wikilink(path: string): string {
  const withoutExtension = path.slice(0, -3);
  const escaped = [...withoutExtension]
    .map((point) =>
      point === "\\" || point === "[" || point === "]" || point === "|"
        ? `\\${point}`
        : point,
    )
    .join("");
  return `[[${escaped}]]`;
}

function sourceLink(path: string): string {
  if (!path.includes("#")) return wikilink(path);
  const withoutExtension = path.slice(0, -3);
  const label = [...withoutExtension]
    .map((point) =>
      point === "\\" || point === "[" || point === "]" ? `\\${point}` : point,
    )
    .join("");
  const destination = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `[${label}](${destination})`;
}

export function safeKnowledgeFilename(
  title: string,
  candidateFingerprint: string,
): string {
  const suffixHex = SHA256.test(candidateFingerprint)
    ? candidateFingerprint.slice(7, 19)
    : "000000000000";
  let safe = toM03WellFormedString(title)
    .normalize("NFC")
    .replace(/\r\n?|\n/gu, " ")
    .replace(CONTROL, "-")
    .replace(WINDOWS_INVALID, "-")
    .replace(/\s+/gu, " ")
    .replace(/-+/gu, "-")
    .replace(/^[ .-]+|[ .-]+$/gu, "");
  if (safe.length === 0 || RESERVED.test(safe)) safe = "Untitled knowledge";
  const suffix = `--${suffixHex}.md`;
  const maximumTitleBytes = 240 - utf8Length(suffix);
  let bounded = "";
  for (const point of safe) {
    if (utf8Length(bounded + point) > maximumTitleBytes) break;
    bounded += point;
  }
  bounded = bounded.replace(/[ .-]+$/gu, "");
  if (bounded.length === 0 || RESERVED.test(bounded))
    bounded = "Untitled knowledge";
  return `${bounded}${suffix}`;
}

export function renderKnowledgeNote(
  candidate: ReviewedKnowledgeCandidate,
  resolvedSources: readonly ResolvedKnowledgeSource[],
): KnowledgeNoteRenderResult {
  const data = renderData(candidate);
  const rawResolved = strictArrayValues(resolvedSources);
  if (data === undefined || rawResolved === undefined)
    return {
      ok: false,
      diagnostics: [m06Diagnostic("KNOWLEDGE_REVIEW_INVALID")],
    };
  const resolved = rawResolved.map((source) => canonicalSource(source, true));
  if (resolved.some((source) => source === undefined))
    return {
      ok: false,
      diagnostics: [m06Diagnostic("KNOWLEDGE_SOURCE_UNRESOLVED")],
    };
  const ordered = resolved as (CanonicalSourceRef & {
    sourceNotePath: string;
  })[];
  ordered.sort(compareSources);
  if (
    ordered.length !== data.sourceRefs.length ||
    ordered.some((source, index) => {
      const reference = data.sourceRefs[index];
      return reference === undefined || !sameSource(source, reference);
    })
  )
    return {
      ok: false,
      diagnostics: [m06Diagnostic("KNOWLEDGE_SOURCE_STALE")],
    };

  const candidateFingerprint = fingerprint({
    schemaVersion: 1,
    type: data.type,
    title: data.title,
    summary: data.summary,
    body: data.body,
    tags: data.tags,
    sourceRefs: data.sourceRefs,
  });
  const links = ordered.map(({ sourceNotePath }) => sourceLink(sourceNotePath));
  const providers = ordered.map(({ provider }) => provider);
  const sourceFingerprints = ordered.map(
    ({ conversationFingerprint }) => conversationFingerprint,
  );
  const lines = [
    "---",
    "chat2vault_schema: 1",
    `type: ${data.type}`,
    "status: accepted",
    "created_from: ai-conversation",
    `candidate_fingerprint: ${yamlQuoted(candidateFingerprint)}`,
  ];
  if (ordered.length === 1) {
    const provider = providers[0];
    const sourceFingerprint = sourceFingerprints[0];
    const sourceLink = links[0];
    if (
      provider === undefined ||
      sourceFingerprint === undefined ||
      sourceLink === undefined
    )
      return {
        ok: false,
        diagnostics: [m06Diagnostic("KNOWLEDGE_SOURCE_UNRESOLVED")],
      };
    lines.push(
      `source_provider: ${provider}`,
      `source_fingerprint: ${yamlQuoted(sourceFingerprint)}`,
      `source_conversation: ${yamlQuoted(sourceLink)}`,
    );
  } else {
    lines.push(
      "source_provider:",
      ...providers.map((value) => `  - ${value}`),
      "source_fingerprint:",
      ...sourceFingerprints.map((value) => `  - ${yamlQuoted(value)}`),
      "source_conversation:",
      ...links.map((value) => `  - ${yamlQuoted(value)}`),
    );
  }
  const tags = [...new Set(["knowledge", ...data.tags])].sort(
    compareStableStrings,
  );
  const knowledgeIndex = tags.indexOf("knowledge");
  if (knowledgeIndex > 0) {
    tags.splice(knowledgeIndex, 1);
    tags.unshift("knowledge");
  }
  lines.push(
    "tags:",
    ...tags.map((tag) => `  - ${yamlQuoted(tag)}`),
    "---",
    "",
    `# ${escapeHeading(data.title)}`,
    "",
    "## Summary",
    "",
    data.summary,
    "",
    "## Knowledge",
    "",
    data.body,
    "",
    "## Source",
    "",
    ...(links.length === 1 && links[0] !== undefined
      ? [`Derived from ${links[0]}.`]
      : links.map((link) => `- Derived from ${link}.`)),
    "",
  );
  const noteContent = lines.join("\n");
  return {
    ok: true,
    candidateFingerprint,
    filename: safeKnowledgeFilename(data.title, candidateFingerprint),
    noteContent,
    noteContentFingerprint: sha256(noteContent),
  };
}

export const knowledgeRenderInternals = {
  canonicalSource,
  compareSources,
  renderData,
};
