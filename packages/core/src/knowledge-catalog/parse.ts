import type { KnowledgeType } from "../distillation/contracts.js";
import {
  compareStableStrings,
  fingerprint,
} from "../fingerprint/stable-json.js";
import { normalizeSourceRoot } from "../source-writer/primitives.js";
import type { CatalogParseResult, CatalogSourceNote } from "./contracts.js";

const MAX_BYTES = 128 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SUFFIX = /--([0-9a-f]{12})\.md$/u;
const SCHEMA_MARKER = new TextEncoder().encode("chat2vault_schema:");
const FRONTMATTER_OPEN = new TextEncoder().encode("---\n");
const FRONTMATTER_CLOSE = new TextEncoder().encode("\n---\n");
const TYPES = new Set<KnowledgeType>([
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
]);
const MALFORMED: CatalogParseResult = {
  status: "malformed",
  code: "M07_CATALOG_MALFORMED",
};

function matchesAt(
  bytes: Uint8Array,
  pattern: Uint8Array,
  index: number,
): boolean {
  if (index + pattern.length > bytes.length) return false;
  for (let offset = 0; offset < pattern.length; offset += 1) {
    if (bytes[index + offset] !== pattern[offset]) return false;
  }
  return true;
}

function hasLeadingSchemaMarker(bytes: Uint8Array): boolean {
  if (!matchesAt(bytes, FRONTMATTER_OPEN, 0)) return false;
  for (let index = FRONTMATTER_OPEN.length; index < bytes.length; index += 1) {
    if (matchesAt(bytes, FRONTMATTER_CLOSE, index)) return false;
    if (
      (index === FRONTMATTER_OPEN.length || bytes[index - 1] === 10) &&
      matchesAt(bytes, SCHEMA_MARKER, index)
    )
      return true;
  }
  return false;
}

function hasSchemaKey(frontmatter: string): boolean {
  return /(?:^|\n)chat2vault_schema:/u.test(frontmatter);
}

export function knowledgeContentFingerprint(
  type: KnowledgeType,
  payload: string,
  tags: readonly string[],
): string {
  return fingerprint({
    version: 1,
    type,
    payload,
    tags: [...new Set(tags)].sort(compareStableStrings),
  });
}

function quoted(value: string): string | undefined {
  if (!value.startsWith('"') || !value.endsWith('"')) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseFields(
  frontmatter: string,
): Map<string, string | string[]> | undefined {
  const fields = new Map<string, string | string[]>();
  const lines = frontmatter.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^([a-z0-9_]+):(?: (.*))?$/u.exec(line ?? "");
    if (match?.[1] === undefined || fields.has(match[1])) return undefined;
    const key = match[1];
    const raw = match[2];
    if (raw !== undefined) {
      if (raw.length === 0) return undefined;
      fields.set(key, raw);
    } else {
      const items: string[] = [];
      while (lines[index + 1]?.startsWith("  - ")) {
        index += 1;
        const item = lines[index];
        if (item === undefined) return undefined;
        items.push(item.slice(4));
      }
      if (items.length === 0) return undefined;
      fields.set(key, items);
    }
  }
  return fields;
}

function scalar(
  fields: Map<string, string | string[]>,
  key: string,
): string | undefined {
  const value = fields.get(key);
  return typeof value === "string" ? value : undefined;
}

function values(
  fields: Map<string, string | string[]>,
  key: string,
): string[] | undefined {
  const value = fields.get(key);
  if (value === undefined) return undefined;
  return typeof value === "string" ? [value] : value;
}

function linkPath(value: string): string | undefined {
  const match = /^\[\[([^\r\n]+)\]\]$/u.exec(value);
  if (match?.[1] === undefined) return undefined;
  const inner = match[1];
  if (/#[^/]*|\^|%%|\||\[\[|\]\]/u.test(inner)) return undefined;
  let unescaped = "";
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (character === "\\") {
      const next = inner[++index];
      if (next === undefined || !"\\[]|".includes(next)) return undefined;
      unescaped += next;
    } else {
      if (character === undefined || character === "[" || character === "]")
        return undefined;
      unescaped += character;
    }
  }
  const path = `${unescaped}.md`;
  const normalized = normalizeSourceRoot(path);
  return normalized.status === "configured" && normalized.sourceRoot === path
    ? path
    : undefined;
}

function canonicalLink(path: string): string {
  const withoutExtension = path.slice(0, -3);
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- match M06's code-point-wise wikilink escaping exactly.
  return `[[${[...withoutExtension]
    .map((point) => ("\\[]|".includes(point) ? `\\${point}` : point))
    .join("")}]]`;
}

function sourceNotes(
  fields: Map<string, string | string[]>,
): CatalogSourceNote[] | undefined {
  const providers = values(fields, "source_provider");
  const fingerprints = values(fields, "source_fingerprint");
  const links = values(fields, "source_conversation");
  if (
    providers === undefined ||
    fingerprints === undefined ||
    links === undefined ||
    providers.length === 0 ||
    providers.length !== fingerprints.length ||
    providers.length !== links.length
  )
    return undefined;
  const arrayShape = [
    "source_provider",
    "source_fingerprint",
    "source_conversation",
  ].map((key) => Array.isArray(fields.get(key)));
  if (
    arrayShape.some((shape) => shape !== arrayShape[0]) ||
    (providers.length === 1 && arrayShape[0])
  )
    return undefined;
  const notes: CatalogSourceNote[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const sourceFingerprint = quoted(fingerprints[index] ?? "");
    const link = quoted(links[index] ?? "");
    const path = link === undefined ? undefined : linkPath(link);
    if (
      (provider !== "chatgpt" && provider !== "unknown") ||
      sourceFingerprint === undefined ||
      !SHA256.test(sourceFingerprint) ||
      path === undefined ||
      link !== canonicalLink(path) ||
      seen.has(path)
    )
      return undefined;
    seen.add(path);
    notes.push({
      provider,
      conversationFingerprint: sourceFingerprint,
      sourceNotePath: path,
    });
  }
  return notes;
}

function footer(notes: readonly CatalogSourceNote[]): string {
  const links = notes.map((note) => canonicalLink(note.sourceNotePath));
  const lines =
    links.length === 1 && links[0] !== undefined
      ? [`Derived from ${links[0]}.`]
      : links.map((link) => `- Derived from ${link}.`);
  return `\n\n## Source\n\n${lines.join("\n")}\n`;
}

function validTags(
  fields: Map<string, string | string[]>,
): string[] | undefined {
  const raw = fields.get("tags");
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const tags = raw.map(quoted);
  if (
    tags.some(
      (tag) => tag === undefined || tag.length === 0 || tag.includes("\n"),
    )
  )
    return undefined;
  const result = tags as string[];
  if (
    result[0] !== "knowledge" ||
    new Set(result).size !== result.length ||
    result.slice(1).some((tag) => tag === "knowledge") ||
    result.slice(1).join("\u0000") !==
      [...result.slice(1)].sort(compareStableStrings).join("\u0000")
  )
    return undefined;
  return result;
}

export function v2CandidateFingerprint(
  type: KnowledgeType,
  payload: string,
  tags: readonly string[],
  sourceNotes: readonly CatalogSourceNote[],
  combinedFrom: string,
): string {
  return fingerprint({
    version: 2,
    type,
    payload,
    tags: [...new Set(tags)].sort(compareStableStrings),
    sourceNotes: [...sourceNotes].sort((a, b) =>
      compareStableStrings(
        `${a.provider}\u0000${a.conversationFingerprint}\u0000${a.sourceNotePath}`,
        `${b.provider}\u0000${b.conversationFingerprint}\u0000${b.sourceNotePath}`,
      ),
    ),
    combinedFrom,
  });
}

export function parseKnowledgeCatalogNote(
  path: string,
  bytes: Uint8Array,
): CatalogParseResult {
  const suffix = SUFFIX.exec(path)?.[1];
  if (bytes.length > MAX_BYTES) {
    if (suffix !== undefined) return MALFORMED;
    // Scan only leading frontmatter without decoding or copying the note.
    // A schema-like phrase in unrelated Markdown body is not ownership.
    return hasLeadingSchemaMarker(bytes) ? MALFORMED : { status: "ignored" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return suffix !== undefined || hasLeadingSchemaMarker(bytes)
      ? MALFORMED
      : { status: "ignored" };
  }
  if (!text.startsWith("---\n"))
    return suffix === undefined ? { status: "ignored" } : MALFORMED;
  const frontmatterEnd = text.indexOf("\n---\n", 4);
  if (frontmatterEnd < 0)
    return hasSchemaKey(text.slice(4)) || suffix !== undefined
      ? MALFORMED
      : { status: "ignored" };
  const frontmatter = text.slice(4, frontmatterEnd);
  if (!hasSchemaKey(frontmatter))
    return suffix === undefined ? { status: "ignored" } : MALFORMED;
  const end = text.indexOf("\n---\n\n", 4);
  if (end !== frontmatterEnd) return MALFORMED;
  const fields = parseFields(frontmatter);
  const schema =
    fields === undefined ? undefined : scalar(fields, "chat2vault_schema");
  if (schema !== "1" && schema !== "2") return MALFORMED;
  const allowed = new Set([
    "chat2vault_schema",
    "type",
    "status",
    "created_from",
    "candidate_fingerprint",
    "source_provider",
    "source_fingerprint",
    "source_conversation",
    "tags",
    ...(schema === "2"
      ? ["knowledge_content_fingerprint", "combined_from"]
      : []),
  ]);
  if (
    fields?.size !== allowed.size ||
    [...fields.keys()].some((key) => !allowed.has(key))
  )
    return MALFORMED;
  const type = scalar(fields, "type");
  const candidateFingerprint = quoted(
    scalar(fields, "candidate_fingerprint") ?? "",
  );
  const tags = validTags(fields);
  const notes = sourceNotes(fields);
  if (
    type === undefined ||
    !TYPES.has(type as KnowledgeType) ||
    scalar(fields, "status") !== "accepted" ||
    scalar(fields, "created_from") !== "ai-conversation" ||
    candidateFingerprint === undefined ||
    !SHA256.test(candidateFingerprint) ||
    suffix !== candidateFingerprint.slice(7, 19) ||
    tags === undefined ||
    notes === undefined
  )
    return MALFORMED;
  const body = text.slice(end + 6);
  const expectedFooter = footer(notes);
  if (!body.endsWith(expectedFooter)) return MALFORMED;
  const payload = body.slice(0, -expectedFooter.length);
  const title = /^# ([^\n]+)\n\n## Summary\n\n/u.exec(payload)?.[1];
  if (title === undefined || !payload.includes("\n\n## Knowledge\n\n"))
    return MALFORMED;
  const base = {
    path,
    type: type as KnowledgeType,
    title,
    payload,
    tags,
    sourceNotes: notes,
    candidateFingerprint,
    contentFingerprint: knowledgeContentFingerprint(
      type as KnowledgeType,
      payload,
      tags,
    ),
  };
  if (schema === "2") {
    const recordedContent = quoted(
      scalar(fields, "knowledge_content_fingerprint") ?? "",
    );
    const combinedLink = quoted(scalar(fields, "combined_from") ?? "");
    const combinedFrom =
      combinedLink === undefined ? undefined : linkPath(combinedLink);
    if (
      recordedContent !== base.contentFingerprint ||
      combinedFrom === undefined ||
      combinedLink !== canonicalLink(combinedFrom)
    )
      return MALFORMED;
    if (
      v2CandidateFingerprint(
        base.type,
        base.payload,
        base.tags,
        base.sourceNotes,
        combinedFrom,
      ) !== candidateFingerprint
    )
      return MALFORMED;
    return {
      status: "eligible",
      note: { ...base, schemaVersion: 2, combinedFrom },
    };
  }
  return { status: "eligible", note: { ...base, schemaVersion: 1 } };
}
