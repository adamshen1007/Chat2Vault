import type { KnowledgeType } from "../distillation/contracts.js";
import type { SourceProvider } from "../domain/contracts.js";
import type {
  ReviewedKnowledgeCandidate,
  ResolvedKnowledgeSource,
} from "../knowledge-writer/contracts.js";

export interface CatalogSourceNote {
  provider: SourceProvider;
  conversationFingerprint: string;
  sourceNotePath: string;
}

interface CatalogKnowledgeNoteBase {
  path: string;
  type: KnowledgeType;
  title: string;
  payload: string;
  tags: readonly string[];
  sourceNotes: readonly CatalogSourceNote[];
  candidateFingerprint: string;
  contentFingerprint: string;
}

export interface CatalogV1KnowledgeNote extends CatalogKnowledgeNoteBase {
  schemaVersion: 1;
  combinedFrom?: never;
}

export interface CatalogV2KnowledgeNote extends CatalogKnowledgeNoteBase {
  schemaVersion: 2;
  combinedFrom: string;
}

export type CatalogKnowledgeNote =
  CatalogV1KnowledgeNote | CatalogV2KnowledgeNote;

export type CatalogParseResult =
  | { status: "eligible"; note: CatalogKnowledgeNote }
  | { status: "ignored" }
  | { status: "malformed"; code: "M07_CATALOG_MALFORMED" };

export interface MatchInput {
  candidate: ReviewedKnowledgeCandidate;
  /** Exact rendered knowledge payload, excluding the source footer. */
  payload: string;
  /** Exact rendered tags, including renderer-added tags such as `knowledge`. */
  renderedTags: readonly string[];
  notes: readonly CatalogKnowledgeNote[];
  /** App-resolved source identities; joined to catalog refs by path, provider, and fingerprint. */
  resolvedSources: readonly ResolvedKnowledgeSource[];
}

export interface KnowledgeMatchResult {
  exact: readonly CatalogKnowledgeNote[];
  sameSource: readonly CatalogKnowledgeNote[];
  sameSourceDetails: readonly {
    path: string;
    kind: "changed-source-content" | "alternative-extraction";
  }[];
  related: readonly { path: string; score: number }[];
}
