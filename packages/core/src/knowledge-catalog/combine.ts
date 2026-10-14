import { compareStableStrings, sha256 } from "../fingerprint/stable-json.js";
import type {
  KnowledgeReviewEdit,
  ResolvedKnowledgeSource,
  ReviewedKnowledgeCandidate,
} from "../knowledge-writer/contracts.js";
import {
  renderKnowledgeNote,
  safeKnowledgeFilename,
} from "../knowledge-writer/render.js";
import { editKnowledgeCandidate } from "../knowledge-writer/review.js";
import { normalizeSourceRoot } from "../source-writer/primitives.js";
import type { CatalogKnowledgeNote, CatalogSourceNote } from "./contracts.js";
import {
  knowledgeContentFingerprint,
  v2CandidateFingerprint,
} from "./parse.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_BYTES = 128 * 1024;
const UNSAFE_LINK = /#|\^|%%|\[\[|\]\]/u;

export interface CombinedKnowledgeInput {
  candidate: ReviewedKnowledgeCandidate;
  selectedNote: CatalogKnowledgeNote;
  draft: KnowledgeReviewEdit;
  /** Complete canonical union of candidate-resolved and selected-note source triples. */
  sourceNotes: readonly CatalogSourceNote[];
  /** Fingerprints from the complete, current catalog, including the selected note. */
  existingContentFingerprints: readonly string[];
  knowledgeRoot: string;
}

export interface CombinedKnowledgePlanEntry {
  readonly action: "create";
  readonly targetPath: string;
  readonly noteContent: string;
  readonly candidateFingerprint: string;
  readonly contentFingerprint: string;
  readonly noteContentFingerprint: string;
}

export type CombinedRenderResult =
  | {
      ok: true;
      targetPath: string;
      noteContent: string;
      candidateFingerprint: string;
      contentFingerprint: string;
      entry: CombinedKnowledgePlanEntry;
    }
  | {
      ok: false;
      code:
        | "M07_DRAFT_INVALID"
        | "M07_EXACT_DUPLICATE"
        | "M07_NOTE_TOO_LARGE"
        | "M07_PATH_UNSAFE";
    };

function safePath(path: unknown): path is string {
  if (
    typeof path !== "string" ||
    !path.endsWith(".md") ||
    UNSAFE_LINK.test(path)
  )
    return false;
  const normalized = normalizeSourceRoot(path);
  return normalized.status === "configured" && normalized.sourceRoot === path;
}

function link(path: string): string {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- M06 wikilinks escape Unicode code points exactly.
  return `[[${[...path.slice(0, -3)]
    .map((point) => ("\\[]|".includes(point) ? `\\${point}` : point))
    .join("")}]]`;
}

function quoted(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

function sourceKey(note: CatalogSourceNote): string {
  return `${note.provider}\u0000${note.conversationFingerprint}\u0000${note.sourceNotePath}`;
}

function validatedSources(
  notes: readonly CatalogSourceNote[],
): CatalogSourceNote[] | undefined {
  if (!Array.isArray(notes) || notes.length === 0) return undefined;
  const result: CatalogSourceNote[] = [];
  const seenPaths = new Set<string>();
  for (const note of notes as readonly unknown[]) {
    if (
      note === null ||
      typeof note !== "object" ||
      !("provider" in note) ||
      !("conversationFingerprint" in note) ||
      !("sourceNotePath" in note) ||
      (note.provider !== "chatgpt" && note.provider !== "unknown") ||
      typeof note.conversationFingerprint !== "string" ||
      !SHA256.test(note.conversationFingerprint) ||
      !safePath(note.sourceNotePath) ||
      seenPaths.has(note.sourceNotePath)
    )
      return undefined;
    seenPaths.add(note.sourceNotePath);
    result.push({
      provider: note.provider,
      conversationFingerprint: note.conversationFingerprint,
      sourceNotePath: note.sourceNotePath,
    });
  }
  return result.sort((a, b) =>
    compareStableStrings(sourceKey(a), sourceKey(b)),
  );
}

/** Validates the editable fields with the established M06 text and tag limits. */
export function validateCombinedDraft(
  candidate: ReviewedKnowledgeCandidate,
  draft: unknown,
):
  | { ok: true; candidate: ReviewedKnowledgeCandidate }
  | { ok: false; code: "M07_DRAFT_INVALID" } {
  const edited = editKnowledgeCandidate(candidate, draft);
  return edited.ok
    ? { ok: true, candidate: edited.candidate }
    : { ok: false, code: "M07_DRAFT_INVALID" };
}

export function renderCombinedKnowledgeNote(
  input: CombinedKnowledgeInput,
): CombinedRenderResult {
  const root = normalizeSourceRoot(input.knowledgeRoot);
  const selected = input.selectedNote;
  if (
    root.status !== "configured" ||
    root.sourceRoot !== input.knowledgeRoot ||
    !safePath(selected.path) ||
    selected.path.split("/").length !== root.sourceRoot.split("/").length + 1 ||
    !selected.path.startsWith(`${root.sourceRoot}/`) ||
    !SHA256.test(selected.candidateFingerprint) ||
    !selected.path.endsWith(
      `--${selected.candidateFingerprint.slice(7, 19)}.md`,
    )
  )
    return { ok: false, code: "M07_PATH_UNSAFE" };

  const draft = validateCombinedDraft(input.candidate, input.draft);
  if (!draft.ok) return draft;
  const sources = validatedSources(input.sourceNotes);
  const existingSources = validatedSources(selected.sourceNotes);
  if (sources === undefined || existingSources === undefined)
    return { ok: false, code: "M07_PATH_UNSAFE" };
  if (
    selected.contentFingerprint !==
    knowledgeContentFingerprint(selected.type, selected.payload, selected.tags)
  )
    return { ok: false, code: "M07_DRAFT_INVALID" };
  if (
    existingSources.some(
      (note) =>
        !sources.some((source) => sourceKey(source) === sourceKey(note)),
    )
  )
    return { ok: false, code: "M07_DRAFT_INVALID" };

  // A candidate's message references prove its source identity, but v2 only
  // records resolved source-note triples; no v1 message fingerprint is invented.
  const candidateSources: ResolvedKnowledgeSource[] = [];
  for (const reference of input.candidate.sourceRefs) {
    const matches = sources.filter(
      (source) =>
        source.provider === reference.provider &&
        source.conversationFingerprint === reference.conversationFingerprint,
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match === undefined) return { ok: false, code: "M07_DRAFT_INVALID" };
    candidateSources.push({
      ...reference,
      sourceNotePath: match.sourceNotePath,
    });
  }
  const expectedUnion = new Set(
    [
      ...existingSources,
      ...candidateSources.map((source) => ({
        provider: source.provider,
        conversationFingerprint: source.conversationFingerprint,
        sourceNotePath: source.sourceNotePath,
      })),
    ].map(sourceKey),
  );
  if (expectedUnion.size !== sources.length)
    return { ok: false, code: "M07_DRAFT_INVALID" };

  const candidateRender = renderKnowledgeNote(
    draft.candidate,
    candidateSources,
  );
  if (!candidateRender.ok) return { ok: false, code: "M07_DRAFT_INVALID" };
  const bodyStart = candidateRender.noteContent.indexOf("\n---\n\n");
  const footerStart =
    candidateRender.noteContent.lastIndexOf("\n\n## Source\n\n");
  if (bodyStart < 0 || footerStart < 0)
    return { ok: false, code: "M07_DRAFT_INVALID" };
  const payload = candidateRender.noteContent.slice(bodyStart + 6, footerStart);
  const tags = [...new Set(["knowledge", ...draft.candidate.tags])].sort(
    compareStableStrings,
  );
  const knowledgeIndex = tags.indexOf("knowledge");
  if (knowledgeIndex > 0) tags.unshift(...tags.splice(knowledgeIndex, 1));
  const contentFingerprint = knowledgeContentFingerprint(
    draft.candidate.type,
    payload,
    tags,
  );
  if (
    !Array.isArray(input.existingContentFingerprints) ||
    input.existingContentFingerprints.some(
      (value) => typeof value !== "string" || !SHA256.test(value),
    ) ||
    !input.existingContentFingerprints.includes(selected.contentFingerprint)
  )
    return { ok: false, code: "M07_DRAFT_INVALID" };
  if (input.existingContentFingerprints.includes(contentFingerprint))
    return { ok: false, code: "M07_EXACT_DUPLICATE" };

  const candidateFingerprint = v2CandidateFingerprint(
    draft.candidate.type,
    payload,
    tags,
    sources,
    selected.path,
  );
  const links = sources.map((source) => link(source.sourceNotePath));
  const lines = [
    "---",
    "chat2vault_schema: 2",
    `type: ${draft.candidate.type}`,
    "status: accepted",
    "created_from: ai-conversation",
    `candidate_fingerprint: ${quoted(candidateFingerprint)}`,
    `knowledge_content_fingerprint: ${quoted(contentFingerprint)}`,
    `combined_from: ${quoted(link(selected.path))}`,
  ];
  if (sources.length === 1) {
    const source = sources[0];
    const sourceLink = links[0];
    if (source === undefined || sourceLink === undefined)
      return { ok: false, code: "M07_DRAFT_INVALID" };
    lines.push(
      `source_provider: ${source.provider}`,
      `source_fingerprint: ${quoted(source.conversationFingerprint)}`,
      `source_conversation: ${quoted(sourceLink)}`,
    );
  } else {
    lines.push(
      "source_provider:",
      ...sources.map((source) => `  - ${source.provider}`),
      "source_fingerprint:",
      ...sources.map(
        (source) => `  - ${quoted(source.conversationFingerprint)}`,
      ),
      "source_conversation:",
      ...links.map((value) => `  - ${quoted(value)}`),
    );
  }
  lines.push(
    "tags:",
    ...tags.map((tag) => `  - ${quoted(tag)}`),
    "---",
    "",
    payload,
    "",
    "## Source",
    "",
    ...(links.length === 1 && links[0] !== undefined
      ? [`Derived from ${links[0]}.`]
      : links.map((value) => `- Derived from ${value}.`)),
    "",
  );
  const noteContent = lines.join("\n");
  if (new TextEncoder().encode(noteContent).length > MAX_BYTES)
    return { ok: false, code: "M07_NOTE_TOO_LARGE" };
  const targetPath = `${root.sourceRoot}/${safeKnowledgeFilename(draft.candidate.title, candidateFingerprint)}`;
  const entry: CombinedKnowledgePlanEntry = Object.freeze({
    action: "create",
    targetPath,
    noteContent,
    candidateFingerprint,
    contentFingerprint,
    noteContentFingerprint: sha256(noteContent),
  });
  return {
    ok: true,
    targetPath,
    noteContent,
    candidateFingerprint,
    contentFingerprint,
    entry,
  };
}
