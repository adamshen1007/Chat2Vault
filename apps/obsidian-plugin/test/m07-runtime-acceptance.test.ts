// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style -- synthetic DOM fixture controls are asserted below. */
import { describe, expect, it, vi } from "vitest";
import { KnowledgeDedupPanel } from "../src/dedup-panel.js";

describe("M07 synthetic runtime acceptance contract", () => {
  it("never invokes create for a malformed selected existing note", async () => {
    const root = document.createElement("section");
    const createCombined = vi
      .fn()
      .mockResolvedValue({ status: "saved", ledger: [], diagnostics: [] });
    const panel = new KnowledgeDedupPanel(root, {
      previewCombined: vi.fn().mockResolvedValue({
        status: "ready",
        action: "create",
        entry: {
          targetPath: "Knowledge/combined.md",
          noteContent: "# Combined\n",
        },
        selectedPath: "Knowledge/existing.md",
        sourcePaths: ["Sources/synthetic.md"],
      }),
      createCombined,
      readKnowledgeNote: vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("# Existing\n")),
      openKnowledgeNote: vi.fn(),
    });
    panel.render({
      candidates: [
        {
          id: "synthetic",
          title: "Synthetic",
          summary: "Summary",
          body: "Body",
          tags: [],
          decision: "accepted",
        },
      ],
      matches: [
        {
          candidateId: "synthetic",
          result: {
            exact: [],
            sameSource: [],
            sameSourceDetails: [],
            related: [{ path: "Knowledge/existing.md", score: 0.7 }],
          },
        },
      ],
      diagnostics: [],
    });
    (
      root.querySelector(
        '[aria-label="Select existing note Knowledge/existing.md"]',
      ) as HTMLButtonElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      root.querySelector('[aria-label="Create combined note"]'),
    ).toBeNull();
    expect(createCombined).not.toHaveBeenCalled();
    panel.invalidate();
    expect(
      root.querySelector('[aria-label="Create combined note"]'),
    ).toBeNull();
    expect(createCombined).not.toHaveBeenCalled();
  });
});
