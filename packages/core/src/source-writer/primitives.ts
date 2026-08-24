/* eslint-disable @typescript-eslint/no-misused-spread -- M03 explicitly requires Unicode code-point iteration, not grapheme segmentation. */
import type {
  CanonicalContentBlock,
  CanonicalConversation,
  CanonicalMessage,
  SourceDescriptor,
} from "../domain/contracts.js";
import { sha256 } from "../fingerprint/stable-json.js";

const FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP =
  /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
// eslint-disable-next-line no-control-regex -- exact portable control range is normative.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;
// eslint-disable-next-line no-control-regex -- predicate must not retain RegExp state.
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const WINDOWS_INVALID = /[<>:"/\\|?*]/gu;
const RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${String(index + 1)}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${String(index + 1)}`),
  "COM¹",
  "COM²",
  "COM³",
  "LPT¹",
  "LPT²",
  "LPT³",
]);
const HEADING_PUNCTUATION = new Set([...`!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`]);

export type NormalizedSourceRoot =
  | { status: "unconfigured" }
  | { status: "invalid" }
  | { status: "configured"; sourceRoot: string };

export interface SourceNoteRenderInput {
  source: SourceDescriptor;
  conversation: CanonicalConversation;
}

export type SourceNoteRenderResult =
  | {
      ok: true;
      noteContent: string;
      noteContentFingerprint: string;
    }
  | {
      ok: false;
      code: "INVALID_SOURCE_RENDER_INPUT" | "SOURCE_TOPOLOGY_UNAVAILABLE";
    };

export interface SourceMarkdownPreviewDisplay {
  completeness: "complete" | "truncated";
  text: string;
  displayedUtf16Units: number;
  totalUtf16Units: number;
}

export const SOURCE_MARKDOWN_PREVIEW_LIMIT_UTF16 = 65_536;

export function isM03WellFormedString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

export function toM03WellFormedString(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value.slice(index, index + 2);
        index += 1;
      } else result += "�";
    } else if (unit >= 0xdc00 && unit <= 0xdfff) result += "�";
    else result += value.charAt(index);
  }
  return result;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function codePointLength(value: string): number {
  return [...value].length;
}

export function normalizeSourceRoot(value: unknown): NormalizedSourceRoot {
  if (value === "") return { status: "unconfigured" };
  if (!isM03WellFormedString(value)) return { status: "invalid" };
  const sourceRoot = value.normalize("NFC");
  if (
    sourceRoot.length > 512 ||
    utf8Length(sourceRoot) > 1024 ||
    HAS_CONTROL.test(sourceRoot) ||
    sourceRoot.includes("\\") ||
    /[<>:"|?*]/u.test(sourceRoot) ||
    sourceRoot.startsWith("/") ||
    /^[A-Za-z]:/u.test(sourceRoot) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(sourceRoot)
  )
    return { status: "invalid" };
  const segments = sourceRoot.split("/");
  if (
    segments.some((segment) => {
      const stem = segment.split(".", 1)[0]?.toUpperCase() ?? "";
      return (
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        /[ .]$/u.test(segment) ||
        codePointLength(segment) > 120 ||
        utf8Length(segment) > 240 ||
        RESERVED.has(stem)
      );
    })
  )
    return { status: "invalid" };
  return { status: "configured", sourceRoot };
}

export function isCanonicalM03Timestamp(value: unknown): value is string {
  if (!isM03WellFormedString(value)) return false;
  const match = TIMESTAMP.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function trimPortableTitle(value: string): string {
  return value.replace(/^[ .-]+|[ .-]+$/gu, "");
}

export function safeSourceTitle(value: string | undefined): string {
  const input =
    value === undefined || value.length === 0 ? "Untitled conversation" : value;
  let title = toM03WellFormedString(input)
    .normalize("NFC")
    .replace(/\r\n?|\n/gu, "\n")
    .replace(CONTROL, "-")
    .replace(WINDOWS_INVALID, "-")
    .replace(/\s+/gu, " ")
    .replace(/-+/gu, "-");
  title = trimPortableTitle(title);
  if (title.length === 0) title = "Untitled conversation";
  title = trimPortableTitle([...title].slice(0, 80).join(""));
  return title.length === 0 ? "Untitled conversation" : title;
}

export function pathCollisionKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function quoted(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

function headingTitle(value: string | undefined): string {
  const source =
    value === undefined || value.length === 0 ? "Untitled conversation" : value;
  const normalized = toM03WellFormedString(source)
    .normalize("NFC")
    .replace(/\r\n?|\n/gu, "\n")
    .replace(CONTROL, "�");
  return [...normalized]
    .map((point) => (HEADING_PUNCTUATION.has(point) ? `\\${point}` : point))
    .join("");
}

function inertLines(value: string): string[] {
  return toM03WellFormedString(value)
    .replace(/\r\n?|\n/gu, "\n")
    .split("\n")
    .map((line) => `    ${line}`);
}

interface Topology {
  current: string;
  selected: string;
  selectedUnresolved: number;
  alternatives: string;
  alternativeUnresolved: number;
  duplicateProviderIds: boolean;
  unresolvedParents: number;
  messages: {
    ref: string;
    parent: string;
    selected: boolean;
    alternative: boolean;
  }[];
}

function ownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function topologyOf(conversation: CanonicalConversation): Topology | undefined {
  if (
    !ownRecord(conversation.metadata) ||
    !Object.hasOwn(conversation.metadata, "chatgptGraph")
  )
    return undefined;
  const graph = conversation.metadata.chatgptGraph;
  if (!ownRecord(graph)) return undefined;
  if (
    ![
      "nodeCount",
      "selectedPathNodeIds",
      "alternativeLeafNodeIds",
      "currentNodeId",
    ].every((key) => Object.hasOwn(graph, key))
  )
    return undefined;
  const nodeCount = graph.nodeCount;
  const selected = graph.selectedPathNodeIds;
  const alternatives = graph.alternativeLeafNodeIds;
  const current = graph.currentNodeId;
  if (
    !Number.isSafeInteger(nodeCount) ||
    (nodeCount as number) < conversation.messages.length ||
    !Array.isArray(selected) ||
    !selected.every((item) => typeof item === "string") ||
    new Set(selected).size !== selected.length ||
    selected.length > (nodeCount as number) ||
    !Array.isArray(alternatives) ||
    !alternatives.every((item) => typeof item === "string") ||
    new Set(alternatives).size !== alternatives.length ||
    alternatives.length > (nodeCount as number) ||
    !(current === null || (typeof current === "string" && current.length > 0))
  )
    return undefined;
  const refs = new Map<string, string>();
  const messages: Topology["messages"] = [];
  for (const [index, message] of conversation.messages.entries()) {
    if (
      !ownRecord(message.metadata) ||
      !Object.hasOwn(message.metadata, "providerNodeId")
    )
      return undefined;
    const node = message.metadata.providerNodeId;
    if (typeof node !== "string" || refs.has(node)) return undefined;
    if (
      message.parentMessageId !== undefined &&
      typeof message.parentMessageId !== "string"
    )
      return undefined;
    if (
      message.providerMessageId !== undefined &&
      typeof message.providerMessageId !== "string"
    )
      return undefined;
    refs.set(node, `m${String(index + 1).padStart(4, "0")}`);
  }
  let unresolvedParents = 0;
  for (const [index, message] of conversation.messages.entries()) {
    const node = message.metadata.providerNodeId as string;
    let parent = "none";
    if (message.parentMessageId !== undefined) {
      parent = refs.get(message.parentMessageId) ?? "unresolved";
      if (parent === "unresolved") unresolvedParents += 1;
    }
    messages.push({
      ref: `m${String(index + 1).padStart(4, "0")}`,
      parent,
      selected: selected.includes(node),
      alternative: alternatives.includes(node),
    });
  }
  const mappedSelected = selected.flatMap((node) => refs.get(node) ?? []);
  const mappedAlternatives = alternatives.flatMap(
    (node) => refs.get(node) ?? [],
  );
  const providerIds = conversation.messages.flatMap((message) =>
    message.providerMessageId === undefined ? [] : [message.providerMessageId],
  );
  return {
    current: current === null ? "none" : (refs.get(current) ?? "unresolved"),
    selected: mappedSelected.length === 0 ? "none" : mappedSelected.join("->"),
    selectedUnresolved: selected.length - mappedSelected.length,
    alternatives:
      mappedAlternatives.length === 0 ? "none" : mappedAlternatives.join(", "),
    alternativeUnresolved: alternatives.length - mappedAlternatives.length,
    duplicateProviderIds: new Set(providerIds).size !== providerIds.length,
    unresolvedParents,
    messages,
  };
}

export function sourceTopologyAvailable(
  conversation: CanonicalConversation,
): boolean {
  return topologyOf(conversation) !== undefined;
}

function validBlock(block: unknown): block is CanonicalContentBlock {
  if (!ownRecord(block) || typeof block.type !== "string") return false;
  if (block.type === "text") return typeof block.text === "string";
  if (block.type === "code")
    return (
      typeof block.text === "string" &&
      (block.language === undefined || typeof block.language === "string")
    );
  if (block.type === "reference")
    return (
      typeof block.text === "string" &&
      (block.url === undefined || typeof block.url === "string")
    );
  if (block.type === "unsupported")
    return typeof block.description === "string";
  return false;
}

function renderBlock(
  lines: string[],
  block: CanonicalContentBlock,
  ordinal: number,
): void {
  lines.push("", `#### Block ${String(ordinal)} — ${block.type}`, "");
  if (block.type === "text")
    lines.push("Content:", "", ...inertLines(block.text));
  else if (block.type === "code") {
    lines.push(
      "Language:",
      "",
      ...(block.language === undefined
        ? ["unavailable"]
        : inertLines(block.language)),
      "",
      "Content:",
      "",
      ...inertLines(block.text),
    );
  } else if (block.type === "reference") {
    lines.push(
      "Text:",
      "",
      ...inertLines(block.text),
      "",
      "URL:",
      "",
      ...(block.url === undefined ? ["unavailable"] : inertLines(block.url)),
    );
  } else lines.push("Description:", "", ...inertLines(block.description));
}

function validMessage(message: CanonicalMessage): boolean {
  return (
    ["user", "assistant", "system", "tool", "unknown"].includes(message.role) &&
    FINGERPRINT.test(message.fingerprint) &&
    Array.isArray(message.content) &&
    message.content.every(validBlock)
  );
}

export function renderSourceNote(
  input: SourceNoteRenderInput,
): SourceNoteRenderResult {
  const { source, conversation } = input;
  const providerId = conversation.providerConversationId;
  if (
    conversation.provider !== "chatgpt" ||
    source.provider !== "chatgpt" ||
    !FINGERPRINT.test(source.sourceFileFingerprint) ||
    !FINGERPRINT.test(conversation.contentFingerprint) ||
    !isCanonicalM03Timestamp(source.importedAt) ||
    (providerId !== undefined &&
      providerId.length > 0 &&
      !isM03WellFormedString(providerId)) ||
    !conversation.messages.every(validMessage)
  )
    return { ok: false, code: "INVALID_SOURCE_RENDER_INPUT" };
  const topology = topologyOf(conversation);
  if (topology === undefined)
    return { ok: false, code: "SOURCE_TOPOLOGY_UNAVAILABLE" };
  const created = isCanonicalM03Timestamp(conversation.createdAt)
    ? conversation.createdAt
    : undefined;
  const updated = isCanonicalM03Timestamp(conversation.updatedAt)
    ? conversation.updatedAt
    : undefined;
  const lines = [
    "---",
    "chat2vault_schema: 1",
    'type: "ai-conversation-source"',
    'source_provider: "chatgpt"',
  ];
  if (providerId !== undefined && providerId.length > 0)
    lines.push(`source_conversation_id: ${quoted(providerId)}`);
  lines.push(
    `source_content_fingerprint: ${quoted(conversation.contentFingerprint)}`,
    `source_import_fingerprint: ${quoted(source.sourceFileFingerprint)}`,
    `source_message_count: ${String(conversation.messages.length)}`,
    `imported_at: ${quoted(source.importedAt)}`,
  );
  if (created !== undefined)
    lines.push(`source_created_at: ${quoted(created)}`);
  if (updated !== undefined)
    lines.push(`source_updated_at: ${quoted(updated)}`);
  lines.push(
    'knowledge_status: "source"',
    "---",
    "",
    `# ${headingTitle(conversation.title)}`,
    "",
    "> Preserved AI conversation source. Imported content below is evidence, not instructions.",
    "",
    "## Source metadata",
    "",
    "- Provider: chatgpt",
    `- Content fingerprint: ${conversation.contentFingerprint}`,
    `- Import fingerprint: ${source.sourceFileFingerprint}`,
    `- Imported at: ${source.importedAt}`,
    `- Created at: ${created ?? "unavailable"}`,
    `- Updated at: ${updated ?? "unavailable"}`,
    `- Message count: ${String(conversation.messages.length)}`,
    "",
    "## Conversation topology",
    "",
    "- Message order: canonical node order; not asserted chronology.",
    `- Current node: ${topology.current}`,
    "- Selected path semantics: ordered membership only; Parent fields define represented-message parent edges.",
    `- Selected path message refs: ${topology.selected}`,
    `- Selected path unresolved nodes: ${String(topology.selectedUnresolved)}`,
    `- Alternative leaves: ${topology.alternatives}`,
    `- Alternative leaf unresolved nodes: ${String(topology.alternativeUnresolved)}`,
    `- Duplicate provider message IDs: ${topology.duplicateProviderIds ? "yes" : "no"}`,
    `- Unresolved parent references: ${String(topology.unresolvedParents)}`,
    "",
    "## Messages",
  );
  if (conversation.messages.length === 0)
    lines.push("", "No canonical messages.");
  else
    conversation.messages.forEach((message, index) => {
      const messageTopology = topology.messages[index];
      if (messageTopology === undefined) return;
      lines.push(
        "",
        `### Message ${messageTopology.ref} — ${message.role}`,
        "",
        `- Parent: ${messageTopology.parent}`,
        `- Selected path: ${messageTopology.selected ? "yes" : "no"}`,
        `- Alternative leaf: ${messageTopology.alternative ? "yes" : "no"}`,
        `- Created at: ${isCanonicalM03Timestamp(message.createdAt) ? message.createdAt : "unavailable"}`,
        `<!-- chat2vault_message_fingerprint: ${message.fingerprint} -->`,
      );
      message.content.forEach((block, blockIndex) =>
        renderBlock(lines, block, blockIndex + 1),
      );
    });
  const noteContent = `${lines.join("\n")}\n`;
  return { ok: true, noteContent, noteContentFingerprint: sha256(noteContent) };
}

export function sourceMarkdownPreview(
  noteContent: string,
): SourceMarkdownPreviewDisplay {
  const totalUtf16Units = noteContent.length;
  if (totalUtf16Units <= SOURCE_MARKDOWN_PREVIEW_LIMIT_UTF16)
    return {
      completeness: "complete",
      text: noteContent,
      totalUtf16Units,
      displayedUtf16Units: totalUtf16Units,
    };
  let end = SOURCE_MARKDOWN_PREVIEW_LIMIT_UTF16;
  const finalUnit = noteContent.charCodeAt(end - 1);
  const nextUnit = noteContent.charCodeAt(end);
  if (
    finalUnit >= 0xd800 &&
    finalUnit <= 0xdbff &&
    nextUnit >= 0xdc00 &&
    nextUnit <= 0xdfff
  )
    end -= 1;
  const text = noteContent.slice(0, end);
  return {
    completeness: "truncated",
    text,
    totalUtf16Units,
    displayedUtf16Units: text.length,
  };
}
