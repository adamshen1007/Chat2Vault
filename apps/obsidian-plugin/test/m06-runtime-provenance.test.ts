import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface ProvenanceModule {
  MINIMUM_OFFICIAL_DMG_URL: string;
  canonicalJson: (value: unknown) => string;
  validateM06RuntimeProvenance: (
    row: string,
    version: string,
    source: unknown,
  ) => string[];
}

const moduleUrl = pathToFileURL(
  join(import.meta.dirname, "../scripts/m06-runtime-provenance.mjs"),
).href;

async function provenance(): Promise<ProvenanceModule> {
  const loaded: unknown = await import(moduleUrl);
  return loaded as ProvenanceModule;
}

const hash = (digit: string): string => digit.repeat(64);

function minimumSource(downloadUrl: string) {
  return {
    kind: "official-dmg",
    appVersion: "1.7.4",
    downloadUrl,
    download: {
      file: "Obsidian-1.7.4.dmg",
      bytes: 177_000_000,
      sha256: hash("1"),
    },
    codeSignature: {
      identifier: "md.obsidian",
      teamIdentifier: "6JSW4SJWN9",
      authorities: [
        "Developer ID Application: Dynalist Inc. (6JSW4SJWN9)",
        "Developer ID Certification Authority",
        "Apple Root CA",
      ],
      designatedRequirementSha256: hash("2"),
      assessment: "accepted",
      assessmentSource: "Notarized Developer ID",
    },
  };
}

function stableSource(releaseHash: string) {
  return {
    kind: "official-stable-asar",
    appVersion: "1.12.7",
    metadataUrl:
      "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json",
    metadata: {
      file: "desktop-releases.json",
      bytes: 1_219,
      sha256: hash("4"),
    },
    downloadUrl:
      "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.13.7/obsidian-1.13.7.asar.gz",
    releaseHash,
    download: {
      file: "obsidian-1.13.7.asar.gz",
      bytes: 8_000_000,
      sha256: hash("3"),
    },
    asar: {
      file: "obsidian-1.13.7.asar",
      bytes: 25_000_000,
      sha256: hash("5"),
    },
  };
}

describe("M06 runtime source provenance", () => {
  it("rejects minimum evidence that relies on plist version alone", async () => {
    const { validateM06RuntimeProvenance } = await provenance();
    expect(
      validateM06RuntimeProvenance("minimum", "1.7.4", {
        kind: "official-release-application",
        appVersion: "1.7.4",
        appInfoPlist: { file: "Info.plist", bytes: 1, sha256: hash("1") },
      }),
    ).toContain("minimum official DMG provenance missing");
  });

  it("accepts an exact official minimum download bound to notarized signing identity", async () => {
    const { MINIMUM_OFFICIAL_DMG_URL, validateM06RuntimeProvenance } =
      await provenance();
    expect(
      validateM06RuntimeProvenance(
        "minimum",
        "1.7.4",
        minimumSource(MINIMUM_OFFICIAL_DMG_URL),
      ),
    ).toEqual([]);
  });

  it("rejects stable evidence without official metadata, compressed asset, and ASAR identities", async () => {
    const { validateM06RuntimeProvenance } = await provenance();
    expect(
      validateM06RuntimeProvenance("stable", "1.13.7", {
        kind: "installed-application-with-official-stable-asar",
        appVersion: "1.13.7",
        asar: { file: "obsidian-1.13.7.asar", bytes: 1, sha256: hash("3") },
      }),
    ).toContain("stable official release provenance missing");
  });

  it("binds the stable metadata release hash to the downloaded compressed bytes", async () => {
    const { validateM06RuntimeProvenance } = await provenance();
    const matchingReleaseHash = Buffer.from(hash("3"), "hex").toString(
      "base64",
    );
    expect(
      validateM06RuntimeProvenance(
        "stable",
        "1.13.7",
        stableSource(matchingReleaseHash),
      ),
    ).toEqual([]);
    expect(
      validateM06RuntimeProvenance(
        "stable",
        "1.13.7",
        stableSource(Buffer.from(hash("6"), "hex").toString("base64")),
      ),
    ).toContain("stable official release provenance missing");
  });

  it("canonicalizes sanitized packet preimages with deterministic key ordering", async () => {
    const { canonicalJson } = await provenance();
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: [2, 1] })).toBe(
      '{"a":[2,1],"nested":{"a":1,"b":2},"z":1}',
    );
  });
});
