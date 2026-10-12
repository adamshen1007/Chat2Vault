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
const createdHashes = [
  "0ec7be9d691bdf119cc77b87bd73b8c779c798371787e67b63b7f3d143b18588",
  "4edf0cc2eced96c6015511badf3e5bc4ce8eb14313f74af0190eb4a7fc7498e7",
] as const;
const conflictHash =
  "c0bc8a1b49d08ce156003b729b8ee9eb6502dc2ab31b2c313c94da3a36c6881c";
const sourceHash =
  "0d5e6873fd5a56b574cf7143f4ea2de7c5dfbd9b6188c4161ae3538fa9a7782c";

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
      beforeHash: sourceHash,
      afterHash: sourceHash,
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
      ...createdPaths.map((path, index) => ({
        path,
        status: "created",
        sha256: createdHashes[index] ?? "",
      })),
      ...createdPaths.map((path, index) => ({
        path,
        status: "identical-no-op",
        sha256: createdHashes[index] ?? "",
      })),
      { path: conflictPath, status: "conflict", sha256: conflictHash },
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

function swap(values: unknown[], left: number, right: number): void {
  [values[left], values[right]] = [
    required(values, right),
    required(values, left),
  ];
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

  it.each([
    [
      "wrong path",
      (value: ReturnType<typeof validEvidence>) => {
        const path = "Knowledge/wrong-but-relative.md";
        required(value.knowledge, 0).path = path;
        required(value.knowledge, 2).path = path;
        required(value.mutationAttempts, 6).path = path;
        required(value.mutationAttempts, 7).path = path;
      },
    ],
    [
      "duplicate path",
      (value: ReturnType<typeof validEvidence>) => {
        const first = required(value.knowledge, 0);
        const firstNoOp = required(value.knowledge, 2);
        required(value.knowledge, 1).path = first.path;
        required(value.knowledge, 1).sha256 = first.sha256;
        required(value.knowledge, 3).path = firstNoOp.path;
        required(value.knowledge, 3).sha256 = firstNoOp.sha256;
        required(value.mutationAttempts, 8).path = first.path;
        required(value.mutationAttempts, 9).path = first.path;
      },
    ],
    [
      "swapped path",
      (value: ReturnType<typeof validEvidence>) => {
        swap(value.knowledge, 0, 1);
        swap(value.knowledge, 2, 3);
        swap(value.mutationAttempts, 6, 8);
        swap(value.mutationAttempts, 7, 9);
      },
    ],
    [
      "wrong hash",
      (value: ReturnType<typeof validEvidence>) => {
        const hash = "d".repeat(64);
        required(value.knowledge, 0).sha256 = hash;
        required(value.knowledge, 2).sha256 = hash;
      },
    ],
    [
      "status path mismatch",
      (value: ReturnType<typeof validEvidence>) => {
        const created = required(value.knowledge, 0);
        const noOp = required(value.knowledge, 2);
        const conflict = required(value.knowledge, 4);
        const oldPath = created.path;
        const oldHash = created.sha256;
        created.path = conflict.path;
        created.sha256 = conflict.sha256;
        noOp.path = conflict.path;
        noOp.sha256 = conflict.sha256;
        conflict.path = oldPath;
        conflict.sha256 = oldHash;
        required(value.mutationAttempts, 6).path = created.path;
        required(value.mutationAttempts, 7).path = created.path;
        required(value.mutationAttempts, 10).path = conflict.path;
        required(value.mutationAttempts, 11).path = conflict.path;
      },
    ],
  ])("rejects %s knowledge inventory", async (_name, mutate) => {
    await expectRejected(mutate);
  });
});
