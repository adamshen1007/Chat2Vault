import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface Validator {
  M08_CANDIDATE_MANIFEST_EXCLUSIONS: readonly string[];
  M08_PRODUCTION_ARTIFACT_PATHS: readonly string[];
  candidateBinding(value: CandidateManifest): unknown;
  sha256Canonical(value: unknown): string;
  validateM08CandidateManifest(value: unknown): string[];
  validateM08RuntimeArtifacts(value: unknown): string[];
  validateM08RuntimeEvidence(value: unknown): string[];
  validateM08RetainedPacket(
    packet: unknown,
    row: "minimum" | "stable",
    production: unknown,
    runtime: unknown,
    candidateManifest: unknown,
  ): string[];
}

interface CandidateManifest {
  schemaVersion: number;
  baseCommit: string;
  exclusions: string[];
  entryCount: number;
  entries: {
    path: string;
    mode: string;
    type: string;
    size: number;
    sha256: string;
  }[];
  manifestDigest: string;
}

const url = pathToFileURL(
  join(import.meta.dirname, "../scripts/m08-runtime-provenance.mjs"),
).href;
const load = async () => (await import(url)) as Validator;
const hash = (digit: string) => digit.repeat(64);
const artifact = (file: string, digit: string) => ({
  file,
  bytes: 100,
  sha256: hash(digit),
});

function evidence() {
  const ids = [
    "staging-created",
    "manual-created",
    "duplicate-no-op",
    "changed-content-versioned",
    "stale-preview-blocked",
    "prepared-crash-reload-blocked",
    "published-crash-reload-blocked",
    "clear-failure-reload-blocked",
    "protected-notes-unchanged",
    "provider-not-called",
  ];
  return {
    scenarioRegistry: ids,
    scenarios: ids.map((id) => ({ id, outcome: "success" })),
    created: [
      { path: "Sources/ChatGPT Capture - 111111111111.md", sha256: hash("1") },
      { path: "Sources/ChatGPT Capture - 222222222222.md", sha256: hash("2") },
      { path: "Sources/ChatGPT Capture - 333333333333.md", sha256: hash("3") },
      { path: "Sources/ChatGPT Capture - 444444444444.md", sha256: hash("4") },
      { path: "Sources/ChatGPT Capture - 555555555555.md", sha256: hash("5") },
    ],
    duplicate: { status: "existing-identical", mutationDelta: 0 },
    stale: { status: "stale", mutationDelta: 0 },
    protected: [
      {
        path: "Sources/existing.md",
        beforeHash: hash("4"),
        afterHash: hash("4"),
        unchanged: true,
      },
      {
        path: "Knowledge/existing.md",
        beforeHash: hash("5"),
        afterHash: hash("5"),
        unchanged: true,
      },
    ],
    stagingFixture: {
      writer: "runtime-harness",
      qualification: "synthetic-staging-contract",
    },
    provider: { beforeCalls: 0, afterCalls: 0 },
    reconciliation: {
      preparedBeforePublish: {
        targetPresent: false,
        reloadBlocked: true,
        blockedWriteDelta: 0,
        unresolvedAtLoad: true,
        providerCalls: 0,
        networkAttempts: 0,
        crashSignal: "SIGKILL",
      },
      publishedBeforeClear: {
        targetPresent: true,
        reloadBlocked: true,
        blockedWriteDelta: 0,
        unresolvedAtLoad: true,
        providerCalls: 0,
        networkAttempts: 0,
        crashSignal: "SIGKILL",
      },
      clearPersistenceFailure: {
        targetPresent: true,
        saveEffect: "published",
        reloadBlocked: true,
        blockedWriteDelta: 0,
        unresolvedAtLoad: true,
        providerCalls: 0,
        networkAttempts: 0,
        reloadMethod: "plugin-disable-enable",
      },
    },
    counts: {
      created: 5,
      providerCalls: 0,
      reconciliationPersistenceAttempts: 13,
      reconciliationWrites: 12,
      reconciliationFailures: 1,
    },
    privacy: { relativePathsOnly: true, retainedContent: false },
  };
}

function manifest(validator: Validator): CandidateManifest {
  const entries = [
    {
      path: "apps/obsidian-plugin/src/main.ts",
      mode: "100644",
      type: "blob",
      size: 3,
      sha256: hash("a"),
    },
  ];
  const authority = {
    schemaVersion: 1,
    baseCommit: "9".repeat(40),
    exclusions: [...validator.M08_CANDIDATE_MANIFEST_EXCLUSIONS],
    entries,
  };
  return {
    ...authority,
    entryCount: entries.length,
    manifestDigest: validator.sha256Canonical(authority),
  };
}

describe("M08 runtime provenance", () => {
  it("accepts only the exact production inventory and excludes test-native controls", async () => {
    const validator = await load();
    const inventory = Object.fromEntries(
      validator.M08_PRODUCTION_ARTIFACT_PATHS.map((path, index) => [
        path,
        artifact(path.split("/").at(-1) ?? path, String((index % 9) + 1)),
      ]),
    );
    expect(validator.validateM08RuntimeArtifacts(inventory)).toEqual([]);
    expect(
      validator.validateM08RuntimeArtifacts({
        ...inventory,
        "native/source_observer_test.node": artifact(
          "source_observer_test.node",
          "a",
        ),
      }),
    ).not.toEqual([]);
  });

  it("accepts the closed content-free runtime evidence and rejects substitutions", async () => {
    const validator = await load();
    const valid = evidence();
    expect(validator.validateM08RuntimeEvidence(valid)).toEqual([]);
    const changed = structuredClone(valid);
    changed.provider.afterCalls = 1;
    changed.counts.providerCalls = 1;
    expect(validator.validateM08RuntimeEvidence(changed)).not.toEqual([]);
    const content = { ...valid, capturedText: "must not persist" };
    expect(validator.validateM08RuntimeEvidence(content)).not.toEqual([]);
    const update = structuredClone(valid);
    update.duplicate.mutationDelta = 1;
    expect(validator.validateM08RuntimeEvidence(update)).not.toEqual([]);
  });

  it("binds a closed exact candidate manifest and rejects content or mode drift", async () => {
    const validator = await load();
    const valid = manifest(validator);
    expect(validator.validateM08CandidateManifest(valid)).toEqual([]);
    const content = structuredClone(valid);
    if (content.entries[0] === undefined) throw new Error("fixture missing");
    content.entries[0].sha256 = hash("b");
    expect(validator.validateM08CandidateManifest(content)).not.toEqual([]);
    const mode = structuredClone(valid);
    if (mode.entries[0] === undefined) throw new Error("fixture missing");
    mode.entries[0].mode = "100755";
    expect(validator.validateM08CandidateManifest(mode)).not.toEqual([]);
    const added = structuredClone(valid);
    added.entries.push({
      path: "README.md",
      mode: "100644",
      type: "blob",
      size: 1,
      sha256: hash("c"),
    });
    expect(validator.validateM08CandidateManifest(added)).not.toEqual([]);
  });

  it("accepts both exact retained rows and rejects stale or cross-row evidence", async () => {
    const validator = await load();
    const minimum = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          "../../../docs/evidence/m08-runtime-minimum.json",
        ),
        "utf8",
      ),
    ) as {
      productionArtifacts: unknown;
      runtimeArtifact: unknown;
      candidate?: unknown;
      row: {
        m08: ReturnType<typeof evidence>;
        persistenceViolationCount: number;
      };
    };
    const stable = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          "../../../docs/evidence/m08-runtime-stable.json",
        ),
        "utf8",
      ),
    ) as typeof minimum;
    const candidateManifest = manifest(validator);
    minimum.candidate = validator.candidateBinding(candidateManifest);
    stable.candidate = validator.candidateBinding(candidateManifest);
    minimum.row.m08 = evidence();
    stable.row.m08 = evidence();
    minimum.row.persistenceViolationCount = 13;
    stable.row.persistenceViolationCount = 13;
    expect(
      validator.validateM08RetainedPacket(
        minimum,
        "minimum",
        minimum.productionArtifacts,
        minimum.runtimeArtifact,
        candidateManifest,
      ),
    ).toEqual([]);
    expect(
      validator.validateM08RetainedPacket(
        stable,
        "stable",
        minimum.productionArtifacts,
        minimum.runtimeArtifact,
        candidateManifest,
      ),
    ).toEqual([]);
    expect(
      validator.validateM08RetainedPacket(
        stable,
        "minimum",
        minimum.productionArtifacts,
        minimum.runtimeArtifact,
        candidateManifest,
      ),
    ).not.toEqual([]);
    const stale = structuredClone(minimum);
    stale.row.m08.provider.afterCalls = 1;
    expect(
      validator.validateM08RetainedPacket(
        stale,
        "minimum",
        minimum.productionArtifacts,
        minimum.runtimeArtifact,
        candidateManifest,
      ),
    ).not.toEqual([]);
  });
});
