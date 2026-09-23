import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const scenarioIds = [
  "review-accept-edit-reject",
  "multi-select-dry-run",
  "stale-preview-disabled",
  "verified-create",
  "idempotent-retry-no-op",
  "conflict-refusal",
  "source-backlink",
  "source-note-unchanged",
  "provider-not-called",
] as const;

const createdPaths = [
  "Knowledge/Synthetic edited runtime title--c9ac8ed3a692.md",
  "Knowledge/Synthetic runtime title 1--a4e2e375959f.md",
] as const;
const conflictPath = "Knowledge/Synthetic runtime title 3--019816a233ca.md";

function scenario(id: (typeof scenarioIds)[number]) {
  return {
    id,
    outcome: "success",
    attempts: 0,
    mutations: id === "verified-create" ? 2 : 0,
  };
}

function validEvidence() {
  const scenarios = scenarioIds.map(scenario);
  return {
    scenarioRegistry: [...scenarioIds],
    scenarios,
    observations: scenarios,
    source: {
      path: "Sources/synthetic-source.md",
      beforeHash: "a".repeat(64),
      afterHash: "a".repeat(64),
      unchanged: true,
    },
    mutationAttempts: [
      {
        surface: "vault",
        method: "createFolder",
        path: "Sources",
        phase: "fixture-setup",
        blocked: false,
      },
      {
        surface: "adapter",
        method: "mkdir",
        path: "Sources",
        phase: "fixture-setup",
        blocked: false,
      },
      {
        surface: "vault",
        method: "createFolder",
        path: "Knowledge",
        phase: "fixture-setup",
        blocked: false,
      },
      {
        surface: "adapter",
        method: "mkdir",
        path: "Knowledge",
        phase: "fixture-setup",
        blocked: false,
      },
      {
        surface: "vault",
        method: "create",
        path: "Sources/synthetic-source.md",
        phase: "fixture-setup",
        blocked: false,
      },
      {
        surface: "adapter",
        method: "write",
        path: "Sources/synthetic-source.md",
        phase: "fixture-setup",
        blocked: false,
      },
      ...createdPaths.flatMap((path) => [
        {
          surface: "vault",
          method: "create",
          path,
          phase: "verified-create",
          blocked: false,
        },
        {
          surface: "adapter",
          method: "write",
          path,
          phase: "verified-create",
          blocked: false,
        },
      ]),
      {
        surface: "vault",
        method: "create",
        path: conflictPath,
        phase: "conflict-fixture",
        blocked: false,
      },
      {
        surface: "adapter",
        method: "write",
        path: conflictPath,
        phase: "conflict-fixture",
        blocked: false,
      },
    ],
    knowledge: [
      ...createdPaths.map((path) => ({
        path,
        status: "created",
        sha256: "b".repeat(64),
      })),
      ...createdPaths.map((path) => ({
        path,
        status: "identical-no-op",
        sha256: "b".repeat(64),
      })),
      { path: conflictPath, status: "conflict", sha256: "c".repeat(64) },
    ],
    counts: {
      candidates: 3,
      selected: 2,
      created: 2,
      noOp: 2,
      conflicts: 1,
      providerCalls: 0,
    },
    privacy: { relativePathsOnly: true, retainedContent: false },
  };
}

function required<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined)
    throw new Error(`missing fixture entry ${String(index)}`);
  return value;
}

type Validator = (value: unknown) => string[];

async function validator(): Promise<Validator | undefined> {
  const moduleUrl = pathToFileURL(
    join(import.meta.dirname, "../scripts/m06-runtime-provenance.mjs"),
  ).href;
  const loaded: unknown = await import(moduleUrl);
  return (loaded as { validateM06RuntimeEvidence?: Validator })
    .validateM06RuntimeEvidence;
}

async function expectRejected(
  mutate: (value: ReturnType<typeof validEvidence>) => void,
) {
  const check = await validator();
  if (check === undefined) {
    expect(check).toBeTypeOf("function");
    return;
  }
  const evidence = validEvidence();
  mutate(evidence);
  expect(check(evidence)).not.toEqual([]);
}

describe("M06 runtime evidence acceptance", () => {
  it("accepts the exact scenario and mutation sequence contract", async () => {
    const check = await validator();
    if (check === undefined) {
      expect(check).toBeTypeOf("function");
      return;
    }
    expect(check(validEvidence())).toEqual([]);
  });

  it.each([
    [
      "duplicate",
      (value: ReturnType<typeof validEvidence>) => {
        value.scenarios[8] = { ...required(value.scenarios, 0) };
      },
    ],
    [
      "substituted",
      (value: ReturnType<typeof validEvidence>) => {
        value.scenarios[4] = {
          ...required(value.scenarios, 4),
          id: "provider-not-called",
        };
      },
    ],
    [
      "reordered",
      (value: ReturnType<typeof validEvidence>) => {
        [value.scenarios[0], value.scenarios[1]] = [
          required(value.scenarios, 1),
          required(value.scenarios, 0),
        ];
      },
    ],
    [
      "wrong counter",
      (value: ReturnType<typeof validEvidence>) => {
        required(value.scenarios, 3).mutations = 1;
      },
    ],
  ])("rejects %s scenario evidence", async (_name, mutate) => {
    await expectRejected(mutate);
  });

  it.each([
    [
      "extra relative mutation",
      (value: ReturnType<typeof validEvidence>) => {
        value.mutationAttempts.push({
          surface: "adapter",
          method: "write",
          path: "Knowledge/extra.md",
          phase: "verified-create",
          blocked: false,
        });
      },
    ],
    [
      "write then restore",
      (value: ReturnType<typeof validEvidence>) => {
        value.mutationAttempts.push(
          {
            surface: "adapter",
            method: "write",
            path: "Sources/synthetic-source.md",
            phase: "verified-create",
            blocked: true,
          },
          {
            surface: "adapter",
            method: "writeBinary",
            path: "Sources/synthetic-source.md",
            phase: "verified-create",
            blocked: true,
          },
        );
      },
    ],
    [
      "wrong phase",
      (value: ReturnType<typeof validEvidence>) => {
        required(value.mutationAttempts, 6).phase = "idempotent-retry-no-op";
      },
    ],
    [
      "wrong method",
      (value: ReturnType<typeof validEvidence>) => {
        required(value.mutationAttempts, 7).method = "append";
      },
    ],
    [
      "reordered mutation",
      (value: ReturnType<typeof validEvidence>) => {
        [value.mutationAttempts[6], value.mutationAttempts[7]] = [
          required(value.mutationAttempts, 7),
          required(value.mutationAttempts, 6),
        ];
      },
    ],
  ])("rejects %s ledger evidence", async (_name, mutate) => {
    await expectRejected(mutate);
  });
});
