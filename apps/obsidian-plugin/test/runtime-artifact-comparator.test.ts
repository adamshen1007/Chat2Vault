import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

interface BuildRecord {
  pluginRoot: string;
  buildOptions: Record<string, unknown>;
  metafile: {
    inputs: Record<string, { bytes: number }>;
    outputs: Record<
      string,
      { inputs: Record<string, { bytesInOutput: number }> }
    >;
  };
}

interface ComparatorModule {
  compareM05RuntimeArtifacts(
    production: BuildRecord,
    runtime: BuildRecord,
  ): {
    ok: boolean;
    failures: readonly string[];
    providerTransport: {
      sha256?: string;
      bytesInOutput?: number;
    };
  };
  compareTrackedReleaseArtifacts(
    built: Record<string, { bytes: number; sha256: string }>,
    tracked: Record<string, { bytes: number; sha256: string }>,
  ): { ok: boolean; failures: readonly string[] };
}

const pluginRoot = join(import.meta.dirname, "..");
const comparatorUrl = pathToFileURL(
  join(pluginRoot, "scripts/compare-m05-runtime-artifact.mjs"),
).href;
const temporaryRoots: string[] = [];

async function comparator(): Promise<ComparatorModule> {
  const loaded: unknown = await import(comparatorUrl);
  return loaded as ComparatorModule;
}

async function record(
  files: Record<string, string>,
  contributions: Record<string, number>,
): Promise<BuildRecord> {
  const root = await mkdtemp(join(tmpdir(), "c2v-m06-comparator-"));
  temporaryRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return {
    pluginRoot: root,
    buildOptions: { bundle: true, minify: true },
    metafile: {
      inputs: Object.fromEntries(
        Object.entries(files).map(([path, content]) => [
          path,
          { bytes: Buffer.byteLength(content) },
        ]),
      ),
      outputs: {
        "out.js": {
          inputs: Object.fromEntries(
            Object.entries(contributions).map(([path, bytesInOutput]) => [
              path,
              { bytesInOutput },
            ]),
          ),
        },
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("M05/M06 runtime artifact comparator", () => {
  it("rejects a stale tracked main release artifact", async () => {
    const result = (await comparator()).compareTrackedReleaseArtifacts(
      {
        "main.js": { bytes: 12, sha256: "a".repeat(64) },
        "worker.js": { bytes: 8, sha256: "b".repeat(64) },
      },
      {
        "main.js": { bytes: 12, sha256: "c".repeat(64) },
        "worker.js": { bytes: 8, sha256: "b".repeat(64) },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      "tracked main.js does not match the final production build",
    ]);
  });

  it("rejects same-byte-count shared input substitution by SHA-256", async () => {
    const production = await record(
      {
        "src/main.ts": "export const main = 1;",
        "src/provider-transport.ts": "export const transport = 1;",
      },
      { "src/main.ts": 8, "src/provider-transport.ts": 11 },
    );
    const runtime = await record(
      {
        "src/main.ts": "export const main = 1;",
        "src/provider-transport.ts": "export const transport = 2;",
        "src/runtime-test-entry.ts": "export {};",
        "src/runtime-test-network-seam.ts": "export {};",
        "src/runtime-test-keychain.ts": "export {};",
        "src/runtime-test-m06.ts": "export {};",
      },
      { "src/main.ts": 8, "src/provider-transport.ts": 11 },
    );
    const result = (await comparator()).compareM05RuntimeArtifacts(
      production,
      runtime,
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "shared input identity mismatch src/provider-transport.ts",
    );
    expect(result.providerTransport).not.toEqual({});
  });

  it("rejects a provider transport output-contribution mismatch", async () => {
    const shared = {
      "src/main.ts": "export const main = 1;",
      "src/provider-transport.ts": "export const transport = 1;",
    };
    const production = await record(shared, {
      "src/main.ts": 8,
      "src/provider-transport.ts": 11,
    });
    const runtime = await record(
      {
        ...shared,
        "src/runtime-test-entry.ts": "export {};",
        "src/runtime-test-network-seam.ts": "export {};",
        "src/runtime-test-keychain.ts": "export {};",
        "src/runtime-test-m06.ts": "export {};",
      },
      { "src/main.ts": 8, "src/provider-transport.ts": 10 },
    );
    const result = (await comparator()).compareM05RuntimeArtifacts(
      production,
      runtime,
    );
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((failure) =>
        failure.startsWith("production transport output contribution mismatch"),
      ),
    ).toBe(true);
  });

  it("accepts only the exact five approved runtime seams", async () => {
    const shared = {
      "src/main.ts": "export const main = 1;",
      "src/provider-transport.ts": "export const transport = 1;",
    };
    const production = await record(shared, {
      "src/main.ts": 8,
      "src/provider-transport.ts": 11,
    });
    const runtime = await record(
      {
        ...shared,
        "src/runtime-test-entry.ts": "export {};",
        "src/runtime-test-network-seam.ts": "export {};",
        "src/runtime-test-keychain.ts": "export {};",
        "src/runtime-test-m06.ts": "export {};",
        "src/runtime-test-mutation-ledger.ts": "export {};",
      },
      { "src/main.ts": 8, "src/provider-transport.ts": 11 },
    );
    const result = (await comparator()).compareM05RuntimeArtifacts(
      production,
      runtime,
    );
    expect(result.ok).toBe(true);
    expect(result.providerTransport.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.providerTransport.bytesInOutput).toBe(11);
  });
});
