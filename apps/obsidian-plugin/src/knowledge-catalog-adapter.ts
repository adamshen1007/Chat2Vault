import {
  compareSourcePaths,
  fingerprint,
  parseKnowledgeCatalogNote,
  pathCollisionKey,
  sha256,
  type CatalogKnowledgeNote,
  type ResolvedKnowledgeSource,
} from "@chat2vault/core";
import type { KnowledgeCatalogObservation } from "./catalog-observer.js";

export type KnowledgeCatalogReadResult =
  | {
      status: "ready";
      notes: readonly CatalogKnowledgeNote[];
      resolvedSources: readonly ResolvedKnowledgeSource[];
      fingerprint: string;
    }
  | {
      status: "blocked";
      code:
        | "M07_CATALOG_UNAVAILABLE"
        | "M07_CATALOG_UNSAFE"
        | "M07_CATALOG_INCOMPLETE";
    };

const incomplete = {
  status: "blocked",
  code: "M07_CATALOG_INCOMPLETE",
} as const;

export class ObsidianKnowledgeCatalogAdapter {
  public constructor(
    private readonly readObservation: () => Promise<KnowledgeCatalogObservation>,
  ) {}

  public async readKnowledgeCatalog(): Promise<KnowledgeCatalogReadResult> {
    const observed = await this.readObservation();
    if (observed.status === "blocked") return observed;
    const notes: CatalogKnowledgeNote[] = [];
    const pairs: { path: string; digest: string }[] = [];
    const identities = new Set<string>();
    const resolved = new Map<string, ResolvedKnowledgeSource>();
    for (const file of observed.files) {
      const parsed = parseKnowledgeCatalogNote(file.path, file.bytes);
      if (parsed.status === "malformed") return incomplete;
      if (parsed.status === "ignored") continue;
      const note = parsed.note;
      const identity = note.candidateFingerprint;
      if (identities.has(identity)) return incomplete;
      identities.add(identity);
      for (const link of note.sourceNotes) {
        const identityMatches = observed.sources.filter(
          (entry) =>
            entry.provider === link.provider &&
            entry.contentFingerprint === link.conversationFingerprint,
        );
        const matches = observed.sources.filter(
          (entry) =>
            pathCollisionKey(entry.path) ===
              pathCollisionKey(link.sourceNotePath) &&
            entry.path === link.sourceNotePath &&
            entry.provider === link.provider &&
            entry.contentFingerprint === link.conversationFingerprint,
        );
        if (matches.length !== 1 || identityMatches.length !== 1)
          return incomplete;
        const match = matches[0];
        if (match === undefined) return incomplete;
        const key = JSON.stringify([
          link.sourceNotePath,
          link.provider,
          link.conversationFingerprint,
        ]);
        resolved.set(key, {
          provider: link.provider,
          ...(match.providerConversationId === undefined
            ? {}
            : { providerConversationId: match.providerConversationId }),
          conversationFingerprint: link.conversationFingerprint,
          sourceNotePath: link.sourceNotePath,
          // V1 has no persisted message references. The registry cannot supply them.
          messageFingerprints: [],
        });
      }
      notes.push(note);
      pairs.push({ path: file.path, digest: sha256(file.bytes) });
    }
    notes.sort((a, b) => compareSourcePaths(a.path, b.path));
    pairs.sort((a, b) => compareSourcePaths(a.path, b.path));
    const listing = observed.listing
      .map(({ path, kind }) => ({ path, kind }))
      .sort((a, b) => compareSourcePaths(a.path, b.path));
    const resolvedSources = [...resolved.values()].sort((a, b) =>
      compareSourcePaths(a.sourceNotePath, b.sourceNotePath),
    );
    const sourceAuthority = [...observed.sourceByteDigests].sort((a, b) =>
      compareSourcePaths(a.path, b.path),
    );
    return {
      status: "ready",
      notes: Object.freeze(
        notes.map((note) =>
          Object.freeze({
            ...note,
            tags: Object.freeze([...note.tags]),
            sourceNotes: Object.freeze(
              note.sourceNotes.map((source) => Object.freeze({ ...source })),
            ),
          }),
        ),
      ),
      resolvedSources: Object.freeze(
        resolvedSources.map((source) =>
          Object.freeze({
            ...source,
            messageFingerprints: Object.freeze([...source.messageFingerprints]),
          }),
        ),
      ),
      fingerprint: fingerprint({
        version: 2,
        listing,
        eligible: pairs,
        sourceAuthority,
      }),
    };
  }
}
