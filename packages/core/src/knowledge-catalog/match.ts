import type { SourceProvider } from "../domain/contracts.js";
import { compareStableStrings } from "../fingerprint/stable-json.js";
import type { ResolvedKnowledgeSource } from "../knowledge-writer/contracts.js";
import type {
  CatalogSourceNote,
  KnowledgeMatchResult,
  MatchInput,
} from "./contracts.js";
import { knowledgeContentFingerprint } from "./parse.js";

interface SourceIdentity {
  provider: SourceProvider;
  conversationFingerprint: string;
  providerConversationId?: string;
}

function sourceKey(
  source: CatalogSourceNote | ResolvedKnowledgeSource,
): string {
  return JSON.stringify([
    source.sourceNotePath,
    source.provider,
    source.conversationFingerprint,
  ]);
}

function resolvedIdentity(
  source: CatalogSourceNote,
  resolvedIds: ReadonlyMap<string, string | undefined>,
): SourceIdentity {
  const id = resolvedIds.get(sourceKey(source));
  return {
    provider: source.provider,
    conversationFingerprint: source.conversationFingerprint,
    ...(id === undefined ? {} : { providerConversationId: id }),
  };
}

function sameSourceKind(
  left: SourceIdentity,
  right: SourceIdentity,
): "changed-source-content" | "alternative-extraction" | undefined {
  if (left.provider !== right.provider) return undefined;
  if (
    left.providerConversationId !== undefined &&
    right.providerConversationId !== undefined
  ) {
    if (left.providerConversationId !== right.providerConversationId)
      return undefined;
    return left.conversationFingerprint === right.conversationFingerprint
      ? "alternative-extraction"
      : "changed-source-content";
  }
  return left.conversationFingerprint === right.conversationFingerprint
    ? "alternative-extraction"
    : undefined;
}

function tokens(value: string): Set<string> {
  const result = new Set<string>();
  for (const run of value
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFC")
    .matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = run[0];
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- M07 token length is defined in Unicode code points.
    const length = [...token].length;
    if (length >= 2 && length <= 64) result.add(token);
  }
  return result;
}

function weightedTokens(
  title: string,
  tags: readonly string[],
  payload: string,
): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (value: string, weight: number): void => {
    for (const token of tokens(value))
      weights.set(token, Math.max(weights.get(token) ?? 0, weight));
  };
  add(title, 3);
  for (const tag of tags) add(tag, 2);
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- M07 teaser bound is defined in Unicode code points.
  add([...payload.normalize("NFC")].slice(0, 2048).join(""), 1);
  return weights;
}

function weightedJaccard(
  left: Map<string, number>,
  right: Map<string, number>,
): number {
  const keys = new Set([...left.keys(), ...right.keys()]);
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    const leftWeight = left.get(key) ?? 0;
    const rightWeight = right.get(key) ?? 0;
    intersection += Math.min(leftWeight, rightWeight);
    union += Math.max(leftWeight, rightWeight);
  }
  return union === 0 ? 0 : intersection / union;
}

function comparePaths(left: string, right: string): number {
  return (
    compareStableStrings(left.normalize("NFC"), right.normalize("NFC")) ||
    compareStableStrings(left, right)
  );
}

export function matchKnowledgeCandidate(
  input: MatchInput,
): KnowledgeMatchResult {
  const exact: KnowledgeMatchResult["exact"][number][] = [];
  const sameSourceNotes: KnowledgeMatchResult["sameSource"][number][] = [];
  const sameSourceDetails: KnowledgeMatchResult["sameSourceDetails"][number][] =
    [];
  const related: { path: string; score: number }[] = [];
  const contentFingerprint = knowledgeContentFingerprint(
    input.candidate.type,
    input.payload,
    input.renderedTags,
  );
  const candidateTokens = weightedTokens(
    input.candidate.title,
    input.renderedTags,
    input.payload,
  );
  const candidateSources: readonly SourceIdentity[] =
    input.candidate.sourceRefs;
  const resolvedIds = new Map<string, string | undefined>();
  for (const source of input.resolvedSources) {
    const key = sourceKey(source);
    if (
      resolvedIds.has(key) &&
      resolvedIds.get(key) !== source.providerConversationId
    )
      resolvedIds.set(key, undefined);
    else if (!resolvedIds.has(key))
      resolvedIds.set(key, source.providerConversationId);
  }

  for (const note of input.notes) {
    if (note.contentFingerprint === contentFingerprint) {
      exact.push(note);
      continue;
    }
    const kinds = note.sourceNotes.flatMap((source) =>
      candidateSources.flatMap((candidate) => {
        const kind = sameSourceKind(
          candidate,
          resolvedIdentity(source, resolvedIds),
        );
        return kind === undefined ? [] : [kind];
      }),
    );
    if (kinds.length > 0) {
      sameSourceNotes.push(note);
      sameSourceDetails.push({
        path: note.path,
        kind: kinds.includes("changed-source-content")
          ? "changed-source-content"
          : "alternative-extraction",
      });
      continue;
    }
    const score = weightedJaccard(
      candidateTokens,
      weightedTokens(note.title, note.tags, note.payload),
    );
    if (score >= 0.25) related.push({ path: note.path, score });
  }

  exact.sort((left, right) => comparePaths(left.path, right.path));
  sameSourceNotes.sort((left, right) => comparePaths(left.path, right.path));
  sameSourceDetails.sort((left, right) => comparePaths(left.path, right.path));
  related.sort(
    (left, right) =>
      right.score - left.score || comparePaths(left.path, right.path),
  );
  return {
    exact,
    sameSource: sameSourceNotes,
    sameSourceDetails,
    related: related.slice(0, 5),
  };
}
