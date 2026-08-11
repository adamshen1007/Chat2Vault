import {
  fingerprint,
  type CanonicalConversation,
  type ImportDiagnostic,
} from "@chat2vault/core";

export type PreviewState =
  | "idle"
  | "reading"
  | "parsing"
  | "success"
  | "success-with-warnings"
  | "partial-success"
  | "error";

const MARKER = "… [preview truncated]";
const UNSAFE_CONTROL_PATTERN = new RegExp(
  // Compiled once for the exact C0/C1 display-sanitization contract.
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]",
  "gu",
);

export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sanitizeDisplayText(value: string): string {
  return value.replace(UNSAFE_CONTROL_PATTERN, "�");
}

export function boundText(
  value: string,
  maximum: number,
  marker = MARKER,
): string {
  if (maximum <= 0) return "";
  const safe = sanitizeDisplayText(value);
  if (safe.length <= maximum) return safe;
  return `${safe.slice(0, Math.max(0, maximum - marker.length))}${marker}`;
}

function validTimestamp(value: string | undefined): string {
  return value !== undefined && Number.isFinite(Date.parse(value)) ? value : "";
}

export function displayTimestamp(
  value: string | undefined,
): string | undefined {
  const valid = validTimestamp(value);
  return valid.length === 0 ? undefined : valid;
}

export function normalizeForSearch(value: string): string {
  return value.slice(0, 240).trim().normalize("NFKC").toLowerCase();
}

export function orderConversations(
  conversations: readonly CanonicalConversation[],
): CanonicalConversation[] {
  return conversations
    .map((conversation, ordinal) => ({ conversation, ordinal }))
    .sort((left, right) => {
      const a = left.conversation;
      const b = right.conversation;
      return (
        compareCodePoints(
          validTimestamp(b.updatedAt),
          validTimestamp(a.updatedAt),
        ) ||
        compareCodePoints(
          validTimestamp(b.createdAt),
          validTimestamp(a.createdAt),
        ) ||
        compareCodePoints(
          boundText(a.title ?? "Untitled conversation", 240),
          boundText(b.title ?? "Untitled conversation", 240),
        ) ||
        compareCodePoints(a.contentFingerprint, b.contentFingerprint) ||
        left.ordinal - right.ordinal
      );
    })
    .map(({ conversation }) => conversation);
}

export class ConversationOrderCache {
  private source: readonly CanonicalConversation[] | undefined;
  private ordered: CanonicalConversation[] = [];

  public order(
    conversations: readonly CanonicalConversation[],
  ): readonly CanonicalConversation[] {
    if (this.source !== conversations) {
      this.source = conversations;
      this.ordered = orderConversations(conversations);
    }
    return this.ordered;
  }
}

export function filterConversations(
  conversations: readonly CanonicalConversation[],
  query: string,
): CanonicalConversation[] {
  const needle = normalizeForSearch(query);
  if (needle.length === 0) return [...conversations];
  return conversations.filter((conversation) =>
    normalizeForSearch(
      boundText(conversation.title ?? "Untitled conversation", 240),
    ).includes(needle),
  );
}

export function pageItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number,
) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pages);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pages,
  };
}

export function classifyResult(
  count: number,
  diagnostics: readonly ImportDiagnostic[],
): PreviewState {
  const hasError = diagnostics.some((item) => item.severity === "error");
  if (count === 0) return "error";
  if (hasError) return "partial-success";
  if (diagnostics.length > 0) return "success-with-warnings";
  return "success";
}

export interface DiagnosticDisplay {
  severity: "warning" | "error";
  code: string;
  message: string;
}

export function diagnosticDisplay(
  diagnostic: ImportDiagnostic,
): DiagnosticDisplay {
  return {
    severity: diagnostic.severity,
    code: boundText(diagnostic.code, 128, "… [diagnostic truncated]"),
    message: boundText(diagnostic.message, 2000, "… [diagnostic truncated]"),
  };
}

export function conversationDiagnosticSeverity(
  conversation: CanonicalConversation,
  diagnostics: readonly ImportDiagnostic[],
): "warning" | "error" | undefined {
  if (conversation.providerConversationId === undefined) return undefined;
  const identifier = fingerprint({
    providerIdentifier: conversation.providerConversationId,
  });
  let severity: "warning" | "error" | undefined;
  for (const diagnostic of diagnostics) {
    if (diagnostic.conversationIdentifier !== identifier) continue;
    if (diagnostic.severity === "error") return "error";
    severity = "warning";
  }
  return severity;
}
