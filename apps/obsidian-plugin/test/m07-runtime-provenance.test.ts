import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface RuntimeProvenanceModule {
  removeInheritedM05ProviderExercise: (source: string) => string;
  validateM07RuntimeArtifacts: (value: unknown) => string[];
  validateM07RuntimeEvidence: (value: unknown) => string[];
  validateM07RuntimeSourceProvenance: (
    row: string,
    version: string,
    value: unknown,
  ) => string[];
  validateM07RetainedPacket: (
    packet: unknown,
    rowId: string,
    productionArtifacts: unknown,
    runtimeArtifact: unknown,
  ) => string[];
}

const moduleUrl = pathToFileURL(
  join(import.meta.dirname, "../scripts/m07-runtime-provenance.mjs"),
).href;

async function validator(): Promise<RuntimeProvenanceModule> {
  return (await import(moduleUrl)) as RuntimeProvenanceModule;
}

const hash = (digit: string): string => digit.repeat(64);
interface ArtifactIdentity {
  file: string;
  bytes: number;
  sha256: string;
}
interface RetainedPacketFixture {
  productionArtifacts: Record<string, ArtifactIdentity>;
  runtimeArtifact: ArtifactIdentity;
  row: {
    id: string;
    version: string;
    platform: string;
    arch: string;
    networkAttemptCount: number;
    sourceMetadata: { download: { sha256: string } };
    provider: { beforeCalls: number };
    scenarios: { outcome: string }[];
    mutationAttempts: { method: string }[];
  };
}

function validEvidence() {
  const scenarios = [
    "exact-duplicate-blocked",
    "combined-preview-approved",
    "create-only-combined-note",
    "inputs-unchanged",
    "provider-not-called",
  ].map((id) => ({
    id,
    outcome: "success",
    mutations: id === "create-only-combined-note" ? 1 : 0,
  }));
  return {
    scenarioRegistry: scenarios.map(({ id }) => id),
    scenarios,
    observations: scenarios,
    candidateHash:
      "f0e164891b4b587cdf06e9b556c2a0db9a0ec17eea0bba1a2480f545e7eded33",
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
      ...[
        "Sources/synthetic-existing.md",
        "Sources/synthetic-candidate.md",
        "Knowledge/Synthetic runtime knowledge--0ffe11ddbfec.md",
      ].flatMap((path) => [
        {
          surface: "vault",
          method: "create",
          path,
          phase: "fixture-setup",
          blocked: false,
        },
        {
          surface: "adapter",
          method: "write",
          path,
          phase: "fixture-setup",
          blocked: false,
        },
      ]),
      {
        surface: "vault",
        method: "create",
        path: "Knowledge/Synthetic runtime knowledge--c87f70b2535e.md",
        phase: "create-only-combined-note",
        blocked: false,
      },
      {
        surface: "adapter",
        method: "write",
        path: "Knowledge/Synthetic runtime knowledge--c87f70b2535e.md",
        phase: "create-only-combined-note",
        blocked: false,
      },
    ],
    inputs: [
      {
        path: "Sources/synthetic-existing.md",
        beforeHash:
          "b54a893dc3fa19c4054b274c5291bc082abab43ed533afc5b1311adbec4b1aa3",
        afterHash:
          "b54a893dc3fa19c4054b274c5291bc082abab43ed533afc5b1311adbec4b1aa3",
        unchanged: true,
      },
      {
        path: "Sources/synthetic-candidate.md",
        beforeHash:
          "31a908c7499ad1fcf91d64184f3625c10da95e54bc03b8d38f755131675612d5",
        afterHash:
          "31a908c7499ad1fcf91d64184f3625c10da95e54bc03b8d38f755131675612d5",
        unchanged: true,
      },
      {
        path: "Knowledge/Synthetic runtime knowledge--0ffe11ddbfec.md",
        beforeHash:
          "9835de2c9cb1c806396676efa071882e1977b90800b86b9b20313b03153b7728",
        afterHash:
          "9835de2c9cb1c806396676efa071882e1977b90800b86b9b20313b03153b7728",
        unchanged: true,
      },
    ],
    combined: {
      path: "Knowledge/Synthetic runtime knowledge--c87f70b2535e.md",
      status: "created",
      sha256:
        "4cdb914c4a25e81bf45685ca0ecb5b4b3eab229d69074ce39409c5f694abf465",
      schema: 2,
      combinedFrom: "Knowledge/Synthetic runtime knowledge--0ffe11ddbfec.md",
    },
    provider: { beforeCalls: 0, afterCalls: 0 },
    counts: { exactDuplicates: 1, combinedCreated: 1, providerCalls: 0 },
    privacy: { relativePathsOnly: true, retainedContent: false },
  };
}

describe("M07 runtime evidence acceptance", () => {
  it("rejects stale retained packets for every artifact and row identity", async () => {
    const { validateM07RetainedPacket } = await validator();
    const minimum = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          "../../../docs/evidence/m07-runtime-minimum.json",
        ),
        "utf8",
      ),
    ) as RetainedPacketFixture;
    const stable = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          "../../../docs/evidence/m07-runtime-stable.json",
        ),
        "utf8",
      ),
    ) as RetainedPacketFixture;
    const check = (packet: RetainedPacketFixture, id = "minimum") =>
      validateM07RetainedPacket(
        packet,
        id,
        minimum.productionArtifacts,
        minimum.runtimeArtifact,
      );
    expect(check(minimum)).toEqual([]);
    expect(check(stable, "stable")).toEqual([]);
    for (const path of Object.keys(minimum.productionArtifacts)) {
      for (const key of ["file", "bytes", "sha256"] as const) {
        const altered = structuredClone(minimum);
        const artifact = altered.productionArtifacts[path];
        if (artifact === undefined) throw new Error("missing artifact");
        if (key === "bytes") artifact.bytes += 1;
        else artifact[key] = key === "file" ? "substituted" : "1".repeat(64);
        expect(check(altered)).not.toEqual([]);
      }
    }
    for (const key of ["file", "bytes", "sha256"] as const) {
      const altered = structuredClone(minimum);
      if (key === "bytes") altered.runtimeArtifact.bytes += 1;
      else
        altered.runtimeArtifact[key] =
          key === "file" ? "substituted" : "1".repeat(64);
      expect(check(altered)).not.toEqual([]);
    }
    for (const [key, value] of [
      ["id", "stable"],
      ["version", "1.7.2"],
      ["platform", "win32"],
      ["arch", "arm64"],
      ["networkAttemptCount", 1],
    ] as const) {
      const altered = structuredClone(minimum);
      if (key === "networkAttemptCount")
        altered.row.networkAttemptCount = value;
      else altered.row[key] = value;
      expect(check(altered)).not.toEqual([]);
    }
    expect(check(stable)).not.toEqual([]);
    const source = structuredClone(minimum);
    source.row.sourceMetadata.download.sha256 = "1".repeat(64);
    expect(check(source)).not.toEqual([]);
    const provider = structuredClone(minimum);
    provider.row.provider.beforeCalls = 1;
    expect(check(provider)).not.toEqual([]);
    const scenario = structuredClone(minimum);
    const firstScenario = scenario.row.scenarios[0];
    if (firstScenario === undefined) throw new Error("missing scenario");
    firstScenario.outcome = "failed";
    expect(check(scenario)).not.toEqual([]);
    const mutation = structuredClone(minimum);
    const finalMutation = mutation.row.mutationAttempts[10];
    if (finalMutation === undefined) throw new Error("missing mutation");
    finalMutation.method = "modify";
    expect(check(mutation)).not.toEqual([]);
  });
  it("accepts the complete closed evidence contract", async () => {
    const { validateM07RuntimeEvidence } = await validator();
    expect(validateM07RuntimeEvidence(validEvidence())).toEqual([]);
  });

  it("removes the inherited pre-scenario provider request", async () => {
    const { removeInheritedM05ProviderExercise } = await validator();
    const legacy =
      "before;const prepared=await view.distillationController.prepare();const providerOperation=view.runProvider();await Promise.resolve();const pendingCancel=view.contentEl.querySelector('.c2v-provider-cancel');const pendingCancelFocused=document.activeElement===pendingCancel;const pendingCancelRect=pendingCancel?.getBoundingClientRect();await providerOperation;const providerSnapshot=view.providerController.snapshot;const status=view.contentEl.querySelector('[role=\"status\"]');window.__c2vM05ViewStatus=status;after";
    const rewritten = removeInheritedM05ProviderExercise(legacy);
    expect(rewritten).not.toContain("view.runProvider()");
    expect(rewritten).toContain(
      "const providerSnapshot=view.providerController.snapshot",
    );
  });

  it("rejects a measured pre-scenario provider request", async () => {
    const { validateM07RuntimeEvidence } = await validator();
    const evidence = validEvidence();
    evidence.provider = { beforeCalls: 1, afterCalls: 1 };
    evidence.counts.providerCalls = 1;
    expect(validateM07RuntimeEvidence(evidence)).not.toEqual([]);
  });

  it("rejects a forged zero count that conflicts with measurements", async () => {
    const { validateM07RuntimeEvidence } = await validator();
    const evidence = validEvidence();
    evidence.provider = { beforeCalls: 1, afterCalls: 1 };
    expect(evidence.counts.providerCalls).toBe(0);
    expect(validateM07RuntimeEvidence(evidence)).not.toEqual([]);
  });

  it("rejects substituted scenario evidence", async () => {
    const { validateM07RuntimeEvidence } = await validator();
    const evidence = validEvidence();
    const substitution = evidence.scenarios[1];
    if (substitution === undefined) throw new Error("missing scenario fixture");
    evidence.scenarios[0] = { ...substitution };
    expect(validateM07RuntimeEvidence(evidence)).not.toEqual([]);
  });

  it("rejects mutation of an input followed by restoration", async () => {
    const { validateM07RuntimeEvidence } = await validator();
    const evidence = validEvidence();
    const input = evidence.inputs[0];
    if (input === undefined) throw new Error("missing input fixture");
    evidence.mutationAttempts.push({
      surface: "adapter",
      method: "write",
      path: input.path,
      phase: "create-only-combined-note",
      blocked: true,
    });
    expect(validateM07RuntimeEvidence(evidence)).not.toEqual([]);
  });

  it("rejects a substituted but internally consistent synthetic path", async () => {
    const { validateM07RuntimeEvidence } = await validator();
    const evidence = validEvidence();
    const original = evidence.inputs[0];
    const vaultAttempt = evidence.mutationAttempts[4];
    const adapterAttempt = evidence.mutationAttempts[5];
    if (original === undefined) throw new Error("missing input fixture");
    if (vaultAttempt === undefined || adapterAttempt === undefined)
      throw new Error("missing mutation fixtures");
    const substituted = "Sources/other-synthetic.md";
    original.path = substituted;
    vaultAttempt.path = substituted;
    adapterAttempt.path = substituted;
    expect(validateM07RuntimeEvidence(evidence)).not.toEqual([]);
  });

  it("rejects swapped protected-input identities", async () => {
    const { validateM07RuntimeEvidence } = await validator();
    const evidence = validEvidence();
    const first = evidence.inputs[0];
    const second = evidence.inputs[1];
    if (first === undefined || second === undefined)
      throw new Error("missing input fixtures");
    [first.beforeHash, second.beforeHash] = [
      second.beforeHash,
      first.beforeHash,
    ];
    [first.afterHash, second.afterHash] = [second.afterHash, first.afterHash];
    expect(validateM07RuntimeEvidence(evidence)).not.toEqual([]);
  });

  it("requires the exact candidate artifact inventory", async () => {
    const { validateM07RuntimeArtifacts } = await validator();
    const artifacts = {
      "main.js": { file: "main.js", bytes: 100, sha256: hash("6") },
      "manifest.json": {
        file: "manifest.json",
        bytes: 100,
        sha256: hash("9"),
      },
      "native/keychain.node": {
        file: "keychain.node",
        bytes: 100,
        sha256: hash("a"),
      },
      "worker.js": { file: "worker.js", bytes: 100, sha256: hash("7") },
      "native/source_observer.node": {
        file: "source_observer.node",
        bytes: 100,
        sha256: hash("8"),
      },
      "styles.css": { file: "styles.css", bytes: 100, sha256: hash("b") },
    };
    expect(validateM07RuntimeArtifacts(artifacts)).toEqual([]);
    delete (artifacts as Partial<typeof artifacts>)["worker.js"];
    expect(validateM07RuntimeArtifacts(artifacts)).not.toEqual([]);
  });

  it("requires the notarized official minimum asset", async () => {
    const { validateM07RuntimeSourceProvenance } = await validator();
    expect(
      validateM07RuntimeSourceProvenance("minimum", "1.7.4", {
        kind: "official-dmg",
        appVersion: "1.7.4",
        downloadUrl:
          "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.7.4/Obsidian-1.7.4.dmg",
        download: {
          file: "Obsidian-1.7.4.dmg",
          bytes: 177_000_000,
          sha256:
            "af77521f1df2ec1ce36d6609c17c325827934726b68cb31587357b356a510dbe",
        },
        codeSignature: {
          identifier: "md.obsidian",
          teamIdentifier: "6JSW4SJWN9",
          authorities: [
            "Developer ID Application: Dynalist Inc. (6JSW4SJWN9)",
            "Apple Root CA",
          ],
          designatedRequirementSha256: hash("c"),
          assessment: "accepted",
          assessmentSource: "Notarized Developer ID",
        },
      }),
    ).toEqual([]);
    expect(
      validateM07RuntimeSourceProvenance("minimum", "1.7.4", {
        kind: "installed-application",
      }),
    ).not.toEqual([]);
  });

  it("binds stable ASAR provenance while allowing an older desktop shell", async () => {
    const { validateM07RuntimeSourceProvenance } = await validator();
    const compressedHash = hash("d");
    expect(
      validateM07RuntimeSourceProvenance("stable", "1.14.4", {
        kind: "official-stable-asar",
        appVersion: "1.12.7",
        metadataUrl:
          "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json",
        metadata: {
          file: "desktop-releases.json",
          bytes: 1_256,
          sha256: hash("e"),
        },
        downloadUrl:
          "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.14.4/obsidian-1.14.4.asar.gz",
        releaseHash: Buffer.from(compressedHash, "hex").toString("base64"),
        download: {
          file: "obsidian-1.14.4.asar.gz",
          bytes: 8_000_000,
          sha256: compressedHash,
        },
        asar: {
          file: "obsidian-1.14.4.asar",
          bytes: 25_000_000,
          sha256: hash("f"),
        },
      }),
    ).toEqual([]);
  });
});
