import {
  compareStableStrings,
  fingerprint,
} from "../fingerprint/stable-json.js";
import {
  normalizeSourceRoot,
  pathCollisionKey,
} from "../source-writer/primitives.js";
import type {
  KnowledgePlanEntry,
  KnowledgePlannerInput,
  KnowledgeTargetObservation,
  KnowledgeWritePlan,
  M06DiagnosticCode,
  ResolvedKnowledgeSource,
  ReviewedKnowledgeCandidate,
} from "./contracts.js";
import { knowledgeRenderInternals, renderKnowledgeNote } from "./render.js";
import { m06Diagnostic } from "./review.js";

const DIAGNOSTIC_ORDER: readonly M06DiagnosticCode[] = [
  "KNOWLEDGE_REVIEW_INVALID",
  "KNOWLEDGE_TAG_INVALID",
  "KNOWLEDGE_NO_SELECTION",
  "KNOWLEDGE_ROOT_UNCONFIGURED",
  "KNOWLEDGE_ROOT_INVALID",
  "KNOWLEDGE_ROOT_OVERLAP",
  "KNOWLEDGE_SOURCE_UNRESOLVED",
  "KNOWLEDGE_SOURCE_AMBIGUOUS",
  "KNOWLEDGE_SOURCE_STALE",
  "KNOWLEDGE_PATH_UNSAFE",
  "KNOWLEDGE_BATCH_TARGET_DUPLICATE",
  "KNOWLEDGE_TARGET_CONFLICT",
  "KNOWLEDGE_PREVIEW_IN_PROGRESS",
  "KNOWLEDGE_WRITE_IN_PROGRESS",
  "KNOWLEDGE_PLAN_STALE",
  "KNOWLEDGE_CREATE_FAILED",
  "KNOWLEDGE_VERIFICATION_FAILED",
];

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

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length &&
    keys.every((key) => ownKeys.includes(key)) &&
    ownKeys.every((key) => typeof key === "string")
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

function normalizedRoot(value: unknown): string | null {
  const normalized = normalizeSourceRoot(value);
  return normalized.status === "configured" ? normalized.sourceRoot : null;
}

function pathSegments(value: string): string[] {
  return value.split("/").map(pathCollisionKey);
}

function isSameOrAncestor(left: string, right: string): boolean {
  const leftSegments = pathSegments(left);
  const rightSegments = pathSegments(right);
  return (
    leftSegments.length <= rightSegments.length &&
    leftSegments.every((segment, index) => segment === rightSegments[index])
  );
}

function isBelow(root: string, path: string): boolean {
  const rootSegments = pathSegments(root);
  const pathSegmentsValue = pathSegments(path);
  return (
    pathSegmentsValue.length > rootSegments.length &&
    rootSegments.every((segment, index) => segment === pathSegmentsValue[index])
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameIdentity(
  left: ReturnType<typeof knowledgeRenderInternals.canonicalSource> & object,
  right: ReturnType<typeof knowledgeRenderInternals.canonicalSource> & object,
): boolean {
  return (
    left.provider === right.provider &&
    left.providerConversationId === right.providerConversationId
  );
}

type CanonicalResolved = NonNullable<
  ReturnType<typeof knowledgeRenderInternals.canonicalSource>
> & { sourceNotePath: string };

function resolveCandidateSources(
  candidate: ReviewedKnowledgeCandidate,
  resolved: readonly CanonicalResolved[],
):
  | { ok: true; sources: ResolvedKnowledgeSource[] }
  | { ok: false; code: M06DiagnosticCode } {
  const data = knowledgeRenderInternals.renderData(candidate);
  if (data === undefined)
    return { ok: false, code: "KNOWLEDGE_REVIEW_INVALID" };
  const sources: ResolvedKnowledgeSource[] = [];
  for (const reference of data.sourceRefs) {
    const exactMatches = resolved.filter(
      (source) =>
        knowledgeRenderInternals.compareSources(source, reference) === 0,
    );
    if (exactMatches.length > 1)
      return { ok: false, code: "KNOWLEDGE_SOURCE_AMBIGUOUS" };
    const match = exactMatches[0];
    if (match === undefined) {
      const stale = resolved.some((source) => sameIdentity(source, reference));
      return {
        ok: false,
        code: stale ? "KNOWLEDGE_SOURCE_STALE" : "KNOWLEDGE_SOURCE_UNRESOLVED",
      };
    }
    sources.push({
      provider: match.provider,
      ...(match.providerConversationId === undefined
        ? {}
        : { providerConversationId: match.providerConversationId }),
      conversationFingerprint: match.conversationFingerprint,
      messageFingerprints: [...match.messageFingerprints],
      sourceNotePath: match.sourceNotePath,
    });
  }
  return { ok: true, sources };
}

function readObservation(
  value: unknown,
): KnowledgeTargetObservation | undefined {
  if (!plainRecord(value)) return undefined;
  const status = dataProperty(value, "status");
  if (
    (status === "absent" || status === "obstructed" || status === "unsafe") &&
    hasOnlyKeys(value, ["status"])
  )
    return { status };
  if (status !== "regular-file" || !hasOnlyKeys(value, ["status", "bytes"]))
    return undefined;
  const bytes = dataProperty(value, "bytes");
  if (!(bytes instanceof Uint8Array)) return undefined;
  return { status, bytes: new Uint8Array(bytes) };
}

function observationMap(value: unknown): {
  observations: Map<string, KnowledgeTargetObservation>;
  unsafe: boolean;
} {
  const items = strictArrayValues(value);
  const observations = new Map<string, KnowledgeTargetObservation>();
  if (items === undefined) return { observations, unsafe: true };
  let unsafe = false;
  const collisionKeys = new Set<string>();
  for (const item of items) {
    if (!plainRecord(item)) {
      unsafe = true;
      continue;
    }
    const targetPath = dataProperty(item, "targetPath");
    const observation = readObservation(dataProperty(item, "observation"));
    if (typeof targetPath !== "string" || observation === undefined) {
      unsafe = true;
      continue;
    }
    const key = pathCollisionKey(targetPath);
    if (collisionKeys.has(key)) unsafe = true;
    collisionKeys.add(key);
    observations.set(targetPath, observation);
  }
  return { observations, unsafe };
}

function entryOrder(
  left: KnowledgePlanEntry,
  right: KnowledgePlanEntry,
): number {
  return (
    compareStableStrings(
      pathCollisionKey(left.targetPath),
      pathCollisionKey(right.targetPath),
    ) || compareStableStrings(left.targetPath, right.targetPath)
  );
}

function finalize(
  sourceRoot: string | null,
  knowledgeRoot: string | null,
  entries: KnowledgePlanEntry[],
  codes: ReadonlySet<M06DiagnosticCode>,
): KnowledgeWritePlan {
  entries.sort(entryOrder);
  const diagnostics = DIAGNOSTIC_ORDER.filter((code) => codes.has(code)).map(
    m06Diagnostic,
  );
  if (
    diagnostics.length === 0 &&
    sourceRoot !== null &&
    knowledgeRoot !== null
  ) {
    const status = "ready";
    const planFingerprint = fingerprint({
      status,
      sourceRoot,
      knowledgeRoot,
      entries,
      diagnostics,
    });
    return {
      status,
      sourceRoot,
      knowledgeRoot,
      entries,
      planFingerprint,
      diagnostics: [],
    };
  }
  const status = "blocked";
  const planFingerprint = fingerprint({
    status,
    sourceRoot,
    knowledgeRoot,
    entries,
    diagnostics,
  });
  return {
    status,
    sourceRoot,
    knowledgeRoot,
    entries,
    planFingerprint,
    diagnostics,
  };
}

export function planKnowledgeWrite(
  input: KnowledgePlannerInput,
): KnowledgeWritePlan {
  const codes = new Set<M06DiagnosticCode>();
  if (!plainRecord(input))
    return finalize(null, null, [], new Set(["KNOWLEDGE_REVIEW_INVALID"]));
  const rawSourceRoot = dataProperty(input, "sourceRoot");
  const rawKnowledgeRoot = dataProperty(input, "knowledgeRoot");
  const sourceRoot = normalizedRoot(rawSourceRoot);
  const knowledgeRoot = normalizedRoot(rawKnowledgeRoot);
  const normalizedKnowledge = normalizeSourceRoot(rawKnowledgeRoot);
  if (normalizedKnowledge.status === "unconfigured")
    codes.add("KNOWLEDGE_ROOT_UNCONFIGURED");
  else if (normalizedKnowledge.status === "invalid")
    codes.add("KNOWLEDGE_ROOT_INVALID");
  if (
    sourceRoot === null &&
    normalizeSourceRoot(rawSourceRoot).status !== "unconfigured"
  )
    codes.add("KNOWLEDGE_ROOT_INVALID");
  if (
    sourceRoot !== null &&
    knowledgeRoot !== null &&
    (isSameOrAncestor(sourceRoot, knowledgeRoot) ||
      isSameOrAncestor(knowledgeRoot, sourceRoot))
  )
    codes.add("KNOWLEDGE_ROOT_OVERLAP");

  const candidateItems = strictArrayValues(dataProperty(input, "candidates"));
  const resolvedItems = strictArrayValues(
    dataProperty(input, "resolvedSources"),
  );
  const resolved = (resolvedItems ?? []).map((source) =>
    knowledgeRenderInternals.canonicalSource(source, true),
  );
  if (
    resolvedItems === undefined ||
    resolved.some((source) => source === undefined)
  )
    codes.add("KNOWLEDGE_SOURCE_UNRESOLVED");
  const trusted = resolved.filter(
    (source): source is CanonicalResolved => source !== undefined,
  );
  const observed = observationMap(dataProperty(input, "targetObservations"));
  if (observed.unsafe) codes.add("KNOWLEDGE_PATH_UNSAFE");

  const selected: ReviewedKnowledgeCandidate[] = [];
  const ids = new Set<string>();
  if (candidateItems === undefined) codes.add("KNOWLEDGE_REVIEW_INVALID");
  for (const item of candidateItems ?? []) {
    if (!plainRecord(item)) {
      codes.add("KNOWLEDGE_REVIEW_INVALID");
      continue;
    }
    const decision = dataProperty(item, "decision");
    const isSelected = dataProperty(item, "selected");
    if (
      isSelected !== true ||
      (decision !== "accepted" && decision !== "edited")
    )
      continue;
    const id = dataProperty(item, "id");
    if (typeof id !== "string" || ids.has(id)) {
      codes.add("KNOWLEDGE_REVIEW_INVALID");
      continue;
    }
    ids.add(id);
    selected.push(item as unknown as ReviewedKnowledgeCandidate);
  }
  if (selected.length === 0) codes.add("KNOWLEDGE_NO_SELECTION");

  const entries: KnowledgePlanEntry[] = [];
  const targetKeys = new Set<string>();
  for (const candidate of selected) {
    const candidateId = dataProperty(candidate, "id") as string;
    const sourceResult = resolveCandidateSources(candidate, trusted);
    if (!sourceResult.ok) {
      codes.add(sourceResult.code);
      continue;
    }
    if (
      sourceRoot === null ||
      sourceResult.sources.some(
        ({ sourceNotePath }) => !isBelow(sourceRoot, sourceNotePath),
      )
    ) {
      codes.add("KNOWLEDGE_PATH_UNSAFE");
      continue;
    }
    const rendered = renderKnowledgeNote(candidate, sourceResult.sources);
    if (!rendered.ok) {
      for (const diagnostic of rendered.diagnostics) codes.add(diagnostic.code);
      continue;
    }
    if (knowledgeRoot === null) continue;
    const targetPath = `${knowledgeRoot}/${rendered.filename}`;
    if (!isBelow(knowledgeRoot, targetPath)) {
      codes.add("KNOWLEDGE_PATH_UNSAFE");
      continue;
    }
    const targetKey = pathCollisionKey(targetPath);
    if (targetKeys.has(targetKey))
      codes.add("KNOWLEDGE_BATCH_TARGET_DUPLICATE");
    targetKeys.add(targetKey);
    const observation = observed.observations.get(targetPath);
    let action: KnowledgePlanEntry["action"] = "conflict";
    if (observation?.status === "absent") action = "create";
    else if (observation?.status === "regular-file") {
      const expected = new TextEncoder().encode(rendered.noteContent);
      action = bytesEqual(observation.bytes, expected)
        ? "identical-no-op"
        : "conflict";
      if (action === "conflict") codes.add("KNOWLEDGE_TARGET_CONFLICT");
    } else if (observation?.status === "obstructed")
      codes.add("KNOWLEDGE_TARGET_CONFLICT");
    else codes.add("KNOWLEDGE_PATH_UNSAFE");
    entries.push({
      candidateId,
      candidateFingerprint: rendered.candidateFingerprint,
      targetPath,
      noteContent: rendered.noteContent,
      noteContentFingerprint: rendered.noteContentFingerprint,
      action,
    });
  }
  return finalize(sourceRoot, knowledgeRoot, entries, codes);
}

interface ComparablePlan {
  status: string;
  sourceRoot: string | null;
  knowledgeRoot: string | null;
  entries: unknown[];
  planFingerprint: string;
  diagnostics: unknown[];
}

function comparablePlan(value: unknown): ComparablePlan | undefined {
  if (
    !plainRecord(value) ||
    !hasOnlyKeys(value, [
      "status",
      "sourceRoot",
      "knowledgeRoot",
      "entries",
      "planFingerprint",
      "diagnostics",
    ])
  )
    return undefined;
  const status = dataProperty(value, "status");
  const sourceRoot = dataProperty(value, "sourceRoot");
  const knowledgeRoot = dataProperty(value, "knowledgeRoot");
  const entries = strictArrayValues(dataProperty(value, "entries"));
  const planFingerprint = dataProperty(value, "planFingerprint");
  const diagnostics = strictArrayValues(dataProperty(value, "diagnostics"));
  if (
    (status !== "ready" && status !== "blocked") ||
    !(sourceRoot === null || typeof sourceRoot === "string") ||
    !(knowledgeRoot === null || typeof knowledgeRoot === "string") ||
    entries === undefined ||
    typeof planFingerprint !== "string" ||
    diagnostics === undefined
  )
    return undefined;
  const safeEntries: unknown[] = [];
  for (const entry of entries) {
    if (
      !plainRecord(entry) ||
      !hasOnlyKeys(entry, [
        "candidateId",
        "candidateFingerprint",
        "targetPath",
        "noteContent",
        "noteContentFingerprint",
        "action",
      ])
    )
      return undefined;
    const detached: Record<string, unknown> = {};
    for (const key of [
      "candidateId",
      "candidateFingerprint",
      "targetPath",
      "noteContent",
      "noteContentFingerprint",
      "action",
    ]) {
      const field = dataProperty(entry, key);
      if (typeof field !== "string") return undefined;
      detached[key] = field;
    }
    safeEntries.push(detached);
  }
  const safeDiagnostics: unknown[] = [];
  for (const diagnostic of diagnostics) {
    if (
      !plainRecord(diagnostic) ||
      !hasOnlyKeys(diagnostic, ["code", "severity", "message"])
    )
      return undefined;
    const code = dataProperty(diagnostic, "code");
    const severity = dataProperty(diagnostic, "severity");
    const message = dataProperty(diagnostic, "message");
    if (
      typeof code !== "string" ||
      severity !== "error" ||
      typeof message !== "string"
    )
      return undefined;
    safeDiagnostics.push({ code, severity, message });
  }
  return {
    status,
    sourceRoot,
    knowledgeRoot,
    entries: safeEntries,
    planFingerprint,
    diagnostics: safeDiagnostics,
  };
}

export function knowledgeWritePlanEqual(
  left: unknown,
  right: unknown,
): boolean {
  const safeLeft = comparablePlan(left);
  const safeRight = comparablePlan(right);
  return (
    safeLeft !== undefined &&
    safeRight !== undefined &&
    fingerprint(safeLeft) === fingerprint(safeRight)
  );
}
