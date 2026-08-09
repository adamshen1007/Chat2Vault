# Chat2Vault Knowledge and Provenance Schema

Version: 0.1  
Status: Domain baseline

## 1. Goals

The schema must support:

- provider-independent conversation imports;
- source preservation;
- knowledge extraction;
- review state;
- provenance;
- idempotence;
- deduplication;
- plain Markdown output.

## 2. Canonical source model

### SourceDescriptor

```ts
type SourceProvider = "chatgpt" | "unknown";

interface SourceDescriptor {
  provider: SourceProvider;
  importFormat: string;
  sourceFileName: string;
  sourceFileFingerprint: string;
  importedAt: string;
}
```

### CanonicalConversation

```ts
interface CanonicalConversation {
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
```

### CanonicalMessage

```ts
type CanonicalRole = "user" | "assistant" | "system" | "tool" | "unknown";

interface CanonicalMessage {
  providerMessageId?: string;
  parentMessageId?: string;
  role: CanonicalRole;
  createdAt?: string;
  content: CanonicalContentBlock[];
  metadata: Record<string, unknown>;
  fingerprint: string;
}
```

### CanonicalContentBlock

```ts
type CanonicalContentBlock =
  | { type: "text"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "reference"; text: string; url?: string }
  | { type: "unsupported"; description: string };
```

Unknown provider fields should normally be ignored or preserved in metadata, not cause a parser crash.

## 3. Branching conversations

ChatGPT exports can represent a message graph rather than a simple list.

M01 must preserve enough identity/parent information to avoid silently inventing chronology.

The importer should produce:

- a deterministic selected/default path when a clearly exported current path can be inferred; or
- a canonical graph/path representation sufficient for later selection.

If the format is ambiguous, report ambiguity rather than pretending it is linear.

## 4. Source note

Example frontmatter:

```yaml
---
chat2vault_schema: 1
type: ai-conversation-source
source_provider: chatgpt
source_conversation_id: "..."
source_content_fingerprint: "sha256:..."
imported_at: 2026-08-09T00:00:00Z
knowledge_status: source
---
```

The source note body may contain:

- conversation metadata;
- normalized transcript;
- import warnings;
- links to accepted derived notes.

## 5. Knowledge candidate

```ts
type KnowledgeType =
  | "insight"
  | "decision"
  | "framework"
  | "procedure"
  | "prompt"
  | "resource"
  | "project-context"
  | "assumption"
  | "open-question"
  | "action";

type CandidateStatus =
  "proposed" | "accepted" | "edited" | "merged" | "rejected";

interface KnowledgeCandidate {
  id: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  body: string;
  status: CandidateStatus;
  confidence?: "high" | "medium" | "low";
  sourceRefs: SourceRef[];
  suggestedLinks: string[];
  suggestedTags: string[];
}
```

## 6. Provenance reference

```ts
interface SourceRef {
  provider: SourceProvider;
  providerConversationId?: string;
  conversationFingerprint: string;
  messageFingerprints: string[];
}
```

Later implementations may add source ranges, quoted anchors, or message IDs.

## 7. Accepted knowledge note

Example:

```yaml
---
chat2vault_schema: 1
type: framework
status: accepted
created_from: ai-conversation
source_provider: chatgpt
source_conversation: "[[2026-08-09 - Source - Example Conversation]]"
source_fingerprint: "sha256:..."
tags:
  - knowledge
---
```

Body:

```markdown
# Conversation Distillation Framework

## Summary

...

## Knowledge

...

## Source

Derived from [[2026-08-09 - Source - Example Conversation]].
```

## 8. Identity and deduplication

### Source duplicate

A source is a known duplicate when stable source identity and/or content fingerprint match an existing import record.

### Knowledge duplicate

Knowledge similarity is not the same as source identity.

Later deduplication should distinguish:

- exact candidate fingerprint;
- same source re-extraction;
- likely semantic duplicate;
- intentional related note.

Automatic semantic merging is out of scope until a reviewable merge flow exists.

## 9. Filename policy

Never trust provider title or LLM title as a path.

Process:

1. derive display title;
2. sanitize filename;
3. enforce maximum length;
4. remove path separators/control characters;
5. resolve collision deterministically;
6. write under configured root.

## 10. Schema versioning

Every persisted Chat2Vault artifact must include a schema version.

Breaking schema changes require migration logic or an explicit compatibility policy.

## 11. Privacy metadata

Do not add raw model prompts, API keys, browser cookies, auth tokens, or full hidden provider metadata to frontmatter.

## 12. M01 boundary

M01 implements only:

- source descriptor;
- canonical conversation/message/content types;
- ChatGPT importer;
- deterministic fingerprints;
- parser diagnostics.

Knowledge-candidate generation begins later.
