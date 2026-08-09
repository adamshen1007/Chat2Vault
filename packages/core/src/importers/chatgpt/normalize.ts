import type {
  CanonicalContentBlock,
  CanonicalConversation,
  CanonicalMessage,
  CanonicalRole,
  ImportDiagnostic,
} from "../../domain/contracts.js";
import {
  compareStableStrings,
  fingerprint,
} from "../../fingerprint/stable-json.js";
import type {
  ProviderConversation,
  ProviderMessage,
  ProviderNode,
} from "./types.js";

interface GraphNode {
  nodeId: string;
  declaredNodeId?: string;
  parentNodeId?: string;
  childNodeIds: string[];
  message?: ProviderMessage;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value * 1_000);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string") {
    const milliseconds = Date.parse(value);
    if (!Number.isNaN(milliseconds))
      return new Date(milliseconds).toISOString();
  }
  return undefined;
}

function roleOf(author: unknown): CanonicalRole {
  if (author === null || typeof author !== "object") return "unknown";
  const role = (author as Record<string, unknown>).role;
  return role === "user" ||
    role === "assistant" ||
    role === "system" ||
    role === "tool"
    ? role
    : "unknown";
}

function contentOf(value: unknown): CanonicalContentBlock[] {
  if (value === null || typeof value !== "object")
    return [{ type: "unsupported", description: "Missing content" }];
  const content = value as Record<string, unknown>;
  const contentType = text(content.content_type);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const blocks: CanonicalContentBlock[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      blocks.push(
        contentType === "code"
          ? { type: "code", text: part }
          : { type: "text", text: part },
      );
      continue;
    }
    if (part !== null && typeof part === "object") {
      const item = part as Record<string, unknown>;
      const partText = text(item.text) ?? text(item.content);
      const partType = text(item.content_type) ?? text(item.type);
      if (partText !== undefined && partType === "code") {
        const language = text(item.language);
        blocks.push(
          language === undefined
            ? { type: "code", text: partText }
            : { type: "code", text: partText, language },
        );
      } else if (partText !== undefined) {
        blocks.push({ type: "text", text: partText });
      } else {
        blocks.push({
          type: "unsupported",
          description: `Unsupported content part${partType === undefined ? "" : `: ${partType}`}`,
        });
      }
    } else {
      blocks.push({
        type: "unsupported",
        description: "Unsupported content part",
      });
    }
  }
  return blocks.length > 0
    ? blocks
    : [
        {
          type: "unsupported",
          description: `Unsupported content${contentType === undefined ? "" : `: ${contentType}`}`,
        },
      ];
}

function graphOf(conversation: ProviderConversation): GraphNode[] {
  if (
    conversation.mapping === null ||
    typeof conversation.mapping !== "object" ||
    Array.isArray(conversation.mapping)
  )
    return [];
  return Object.entries(conversation.mapping as Record<string, unknown>)
    .map(([mappingId, raw]): GraphNode | undefined => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        return undefined;
      const node = raw as ProviderNode;
      const nodeId = mappingId;
      const declaredNodeId = text(node.id);
      const parentNodeId = text(node.parent);
      const childNodeIds = Array.isArray(node.children)
        ? node.children.filter(
            (child): child is string => typeof child === "string",
          )
        : [];
      const message =
        node.message !== null && typeof node.message === "object"
          ? node.message
          : undefined;
      return {
        nodeId,
        childNodeIds,
        ...(declaredNodeId === undefined ? {} : { declaredNodeId }),
        ...(parentNodeId === undefined ? {} : { parentNodeId }),
        ...(message === undefined ? {} : { message }),
      };
    })
    .filter((node): node is GraphNode => node !== undefined)
    .sort((left, right) => compareStableStrings(left.nodeId, right.nodeId));
}

function selectedPath(
  nodes: readonly GraphNode[],
  currentNodeId: string | undefined,
): {
  path: string[];
  alternatives: string[];
  ambiguous: boolean;
  invalidGraph: boolean;
} {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const declaredNodeIds = nodes
    .map(({ declaredNodeId }) => declaredNodeId)
    .filter((id): id is string => id !== undefined);
  const hasDuplicateDeclaredNodeId =
    new Set(declaredNodeIds).size !== declaredNodeIds.length;
  const parentNodeIds = new Set(
    nodes.flatMap((node) =>
      node.parentNodeId === undefined ? [] : [node.parentNodeId],
    ),
  );
  const leaves = nodes
    .filter((node) => !parentNodeIds.has(node.nodeId))
    .map((node) => node.nodeId);
  const makePath = (leafId: string): { path: string[]; cyclic: boolean } => {
    const reversed: string[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = leafId;
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      reversed.push(cursor);
      cursor = byId.get(cursor)?.parentNodeId;
    }
    return { path: reversed.reverse(), cyclic: cursor !== undefined };
  };
  if (currentNodeId !== undefined && byId.has(currentNodeId)) {
    const selected = makePath(currentNodeId);
    return {
      path: selected.path,
      alternatives: leaves
        .filter((leaf) => leaf !== currentNodeId)
        .sort(compareStableStrings),
      ambiguous: selected.cyclic,
      invalidGraph: selected.cyclic || hasDuplicateDeclaredNodeId,
    };
  }
  const candidates = leaves
    .map((leaf) => ({ leaf, ...makePath(leaf) }))
    .sort(
      (left, right) =>
        right.path.length - left.path.length ||
        compareStableStrings(left.leaf, right.leaf),
    );
  const fallbackNodeId = nodes[0]?.nodeId;
  const fallback =
    fallbackNodeId === undefined ? undefined : makePath(fallbackNodeId);
  const chosen =
    candidates[0] ??
    (fallbackNodeId === undefined || fallback === undefined
      ? undefined
      : { leaf: fallbackNodeId, ...fallback });
  const noLeafForNonEmptyGraph = leaves.length === 0 && nodes.length > 0;
  return {
    path: chosen?.path ?? [],
    alternatives: candidates.slice(1).map(({ leaf }) => leaf),
    ambiguous:
      currentNodeId !== undefined ||
      candidates.length > 1 ||
      noLeafForNonEmptyGraph,
    invalidGraph:
      noLeafForNonEmptyGraph ||
      (chosen?.cyclic ?? false) ||
      hasDuplicateDeclaredNodeId,
  };
}

function safeDiagnosticIdentifier(value: string): string;
function safeDiagnosticIdentifier(value: undefined): undefined;
function safeDiagnosticIdentifier(
  value: string | undefined,
): string | undefined;
function safeDiagnosticIdentifier(
  value: string | undefined,
): string | undefined {
  return value === undefined
    ? undefined
    : fingerprint({ providerIdentifier: value });
}

function normalizeMessage(node: GraphNode): CanonicalMessage | undefined {
  if (node.message === undefined) return undefined;
  const providerMessageId = text(node.message.id) ?? node.nodeId;
  const parentMessageId = node.parentNodeId;
  const role = roleOf(node.message.author);
  const createdAt = timestamp(node.message.create_time);
  const content = contentOf(node.message.content);
  const metadata: Record<string, unknown> = { providerNodeId: node.nodeId };
  if (
    node.declaredNodeId !== undefined &&
    node.declaredNodeId !== node.nodeId
  ) {
    metadata.providerDeclaredNodeId = node.declaredNodeId;
  }
  const identity = {
    providerMessageId,
    parentMessageId,
    role,
    createdAt,
    content,
    metadata,
  };
  return {
    providerMessageId,
    ...(parentMessageId === undefined ? {} : { parentMessageId }),
    role,
    ...(createdAt === undefined ? {} : { createdAt }),
    content,
    metadata,
    fingerprint: fingerprint(identity),
  };
}

export function normalizeConversation(raw: ProviderConversation): {
  conversation: CanonicalConversation;
  diagnostics: ImportDiagnostic[];
} {
  const providerConversationId = text(raw.id) ?? text(raw.conversation_id);
  const title = text(raw.title);
  const createdAt = timestamp(raw.create_time);
  const updatedAt = timestamp(raw.update_time);
  const nodes = graphOf(raw);
  const currentNodeId = text(raw.current_node);
  const selection = selectedPath(nodes, currentNodeId);
  const diagnostics: ImportDiagnostic[] = [];
  const conversationIdentifier = safeDiagnosticIdentifier(
    providerConversationId,
  );
  if (selection.invalidGraph) {
    diagnostics.push({
      code: "INVALID_MESSAGE_GRAPH",
      severity: "warning",
      message:
        "The exported message graph has a cycle, duplicate declared node identity, or no terminal node; all nodes were preserved with deterministic structural identity.",
      ...(conversationIdentifier === undefined
        ? {}
        : { conversationIdentifier }),
    });
  }
  if (selection.ambiguous) {
    diagnostics.push({
      code: "AMBIGUOUS_BRANCH",
      severity: "warning",
      message:
        "No definitive current branch was exported; selected the longest path with a lexical leaf-ID tie-breaker and preserved every graph node.",
      ...(conversationIdentifier === undefined
        ? {}
        : { conversationIdentifier }),
    });
  }
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  for (const node of nodes) {
    if (node.parentNodeId !== undefined && !nodeIds.has(node.parentNodeId)) {
      diagnostics.push({
        code: "ORPHAN_PARENT",
        severity: "warning",
        message:
          "A message references a parent node that is absent from the export; the message was preserved.",
        ...(conversationIdentifier === undefined
          ? {}
          : { conversationIdentifier }),
        messageIdentifier: safeDiagnosticIdentifier(node.nodeId),
      });
    }
  }
  const messages = nodes
    .map(normalizeMessage)
    .filter((message): message is CanonicalMessage => message !== undefined);
  const seenMessages = new Set<string>();
  for (const message of messages) {
    const id = message.providerMessageId;
    if (id !== undefined && seenMessages.has(id)) {
      diagnostics.push({
        code: "DUPLICATE_MESSAGE_ID",
        severity: "warning",
        message:
          "A provider message ID occurs more than once; all graph nodes were preserved.",
        ...(conversationIdentifier === undefined
          ? {}
          : { conversationIdentifier }),
        messageIdentifier: safeDiagnosticIdentifier(id),
      });
    }
    if (id !== undefined) seenMessages.add(id);
  }
  const metadata: Record<string, unknown> = {
    chatgptGraph: {
      nodeCount: nodes.length,
      selectedPathNodeIds: selection.path,
      alternativeLeafNodeIds: selection.alternatives,
      currentNodeId: currentNodeId ?? null,
    },
  };
  const contentIdentity = {
    provider: "chatgpt",
    messages,
    graph: metadata.chatgptGraph,
  };
  return {
    conversation: {
      schemaVersion: 1,
      provider: "chatgpt",
      ...(providerConversationId === undefined
        ? {}
        : { providerConversationId }),
      ...(title === undefined ? {} : { title }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      messages,
      metadata,
      contentFingerprint: fingerprint(contentIdentity),
    },
    diagnostics,
  };
}
