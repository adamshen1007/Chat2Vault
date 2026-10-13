import { describe, expect, it, vi } from "vitest";
import { installM07MutationLedger } from "../src/runtime-test-m07-ledger.js";

describe("M07 runtime mutation ledger", () => {
  it("allows fixture creation, then blocks every protected input mutation", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const vault = { adapter: { write }, create };
    const protectedPaths = [
      "Sources/existing.md",
      "Sources/candidate.md",
      "Knowledge/existing.md",
    ];
    const protectedSource = protectedPaths[0];
    if (protectedSource === undefined)
      throw new Error("missing protected source fixture");
    const ledger = installM07MutationLedger(vault, protectedPaths);
    ledger.setPhase("fixture-setup");
    await vault.create(protectedSource, "fixture");
    ledger.setPhase("create-only-combined-note");
    await expect(
      vault.adapter.write(protectedSource, "changed"),
    ).rejects.toThrow("M07 protected input mutation prohibited");
    await vault.create("Knowledge/combined.md", "combined");
    expect(ledger.entries()).toEqual([
      {
        surface: "vault",
        method: "create",
        path: protectedPaths[0],
        phase: "fixture-setup",
        blocked: false,
      },
      {
        surface: "adapter",
        method: "write",
        path: protectedPaths[0],
        phase: "create-only-combined-note",
        blocked: true,
      },
      {
        surface: "vault",
        method: "create",
        path: "Knowledge/combined.md",
        phase: "create-only-combined-note",
        blocked: false,
      },
    ]);
    ledger.restore();
    await vault.adapter.write(protectedSource, "after restore");
    expect(write).toHaveBeenCalledTimes(1);
  });
});
