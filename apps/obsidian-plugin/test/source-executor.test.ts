/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- Vitest mocks intentionally model detached adapter methods. */
import { describe, expect, test, vi } from "vitest";
import type { SourceWritePlan } from "@chat2vault/core";
import {
  executeSourceWrite,
  type SourceMutationAdapter,
} from "../src/source-executor.js";
import type {
  SourceOperationToken,
  SourceWriteSaveRequest,
} from "../src/source-controller.js";

const plan: Extract<SourceWritePlan, { disposition: "new" }> = {
  disposition: "new",
  targetPath: "Sources/Deep/note.md",
  noteContent: "note\n",
  noteContentFingerprint: `sha256:${"a".repeat(64)}`,
  foldersToCreate: ["Sources", "Sources/Deep"],
  diagnostics: [],
};
const request: SourceWriteSaveRequest = {
  plan,
  previewGeneration: 0,
  selectedConversationContentFingerprint: `sha256:${"b".repeat(64)}`,
  settledSourceRoot: "Sources/Deep",
};
const noFolderPlan: Extract<SourceWritePlan, { disposition: "new" }> = {
  ...plan,
  foldersToCreate: [],
};
const noFolderRequest: SourceWriteSaveRequest = {
  ...request,
  plan: noFolderPlan,
};
const token: SourceOperationToken = {
  operationGeneration: 0,
  selectedConversationContentFingerprint:
    request.selectedConversationContentFingerprint,
  normalizedSourceRoot: request.settledSourceRoot,
};

function adapter(): SourceMutationAdapter {
  let remaining = [...plan.foldersToCreate];
  return {
    plan: vi.fn(async () => ({ ...plan, foldersToCreate: [...remaining] })),
    checkpointFolder: vi.fn(async () => ({
      status: "missing-safe" as const,
      resolvedPath: remaining[0] ?? "",
    })),
    createFolder: vi.fn(async (path) => {
      remaining = remaining.filter((entry) => entry !== path);
    }),
    verifyFolder: vi.fn(async () => ({ status: "safe" as const })),
    checkpointFinalParent: vi.fn(async () => ({
      status: "safe" as const,
      resolvedTargetPath: plan.targetPath,
    })),
    createNote: vi.fn(async () => undefined),
    verifyCreatedNote: vi.fn(async () => ({ status: "verified" as const })),
  };
}

describe("M03 create-only source executor", () => {
  test("replans before mutation and returns stale-plan without writes on mismatch", async () => {
    const io = adapter();
    vi.mocked(io.plan).mockResolvedValueOnce({
      ...plan,
      targetPath: "Sources/Deep/other.md",
    });
    await expect(
      executeSourceWrite(request, token, () => true, io),
    ).resolves.toMatchObject({
      status: "replanned",
      reason: "stale-plan",
      acceptedFolderPaths: [],
    });
    expect(io.createFolder).not.toHaveBeenCalled();
    expect(io.createNote).not.toHaveBeenCalled();
  });

  test("creates folders parent-first, fences every mutation, and verifies the exact note", async () => {
    const io = adapter();
    const current = vi.fn(() => true);
    await expect(
      executeSourceWrite(request, token, current, io),
    ).resolves.toEqual({
      status: "saved",
      createdPath: plan.targetPath,
      noteContentFingerprint: plan.noteContentFingerprint,
      disposition: "new",
      acceptedFolderPaths: ["Sources", "Sources/Deep"],
      diagnostics: [],
    });
    expect(io.createFolder).toHaveBeenNthCalledWith(1, "Sources", "Sources");
    expect(io.createFolder).toHaveBeenNthCalledWith(
      2,
      "Sources/Deep",
      "Sources/Deep",
    );
    expect(io.createNote).toHaveBeenCalledWith(
      plan.targetPath,
      plan.noteContent,
    );
    expect(current.mock.calls.length).toBeGreaterThanOrEqual(8);
  });

  test("never rolls back a fulfilled note when read-only verification fails", async () => {
    const io = adapter();
    vi.mocked(io.verifyCreatedNote).mockResolvedValueOnce({
      status: "verification-failed",
    });
    await expect(
      executeSourceWrite(request, token, () => true, io),
    ).resolves.toMatchObject({
      status: "verification-failed",
      createdPath: plan.targetPath,
      acceptedFolderPaths: ["Sources", "Sources/Deep"],
      diagnostics: [{ code: "SOURCE_WRITE_VERIFICATION_FAILED" }],
    });
    expect(io.createNote).toHaveBeenCalledTimes(1);
  });

  test("stale last-point fence prevents the next mutation", async () => {
    const io = adapter();
    let samples = 0;
    const current = () => {
      samples += 1;
      return samples < 4;
    };
    await expect(
      executeSourceWrite(request, token, current, io),
    ).resolves.toMatchObject({ status: "stale" });
    expect(io.createFolder).not.toHaveBeenCalled();
    expect(io.createNote).not.toHaveBeenCalled();
  });

  test("replans a final Vault-operation failure instead of inventing native indeterminacy", async () => {
    const io = adapter();
    vi.mocked(io.checkpointFinalParent).mockResolvedValueOnce({
      status: "blocked",
    });
    await expect(
      executeSourceWrite(request, token, () => true, io),
    ).resolves.toMatchObject({
      status: "mutation-failed",
      diagnostics: [{ code: "SOURCE_WRITE_FAILED" }],
    });
    expect(io.plan).toHaveBeenCalledTimes(3);
    expect(io.createNote).not.toHaveBeenCalled();
  });

  test.each([
    "folder-checkpoint",
    "folder-create-settlement",
    "folder-verification",
    "final-replan",
    "final-parent-checkpoint",
  ] as const)("fences mutation when invalidated during %s", async (stage) => {
    const io = adapter();
    let current = true;
    if (stage === "folder-checkpoint")
      vi.mocked(io.checkpointFolder).mockImplementationOnce(async () => {
        current = false;
        return { status: "missing-safe", resolvedPath: "Sources" };
      });
    if (stage === "folder-create-settlement")
      vi.mocked(io.createFolder).mockImplementationOnce(async () => {
        current = false;
      });
    if (stage === "folder-verification")
      vi.mocked(io.verifyFolder).mockImplementationOnce(async () => {
        current = false;
        return { status: "safe" };
      });
    if (stage === "final-replan") {
      const implementation = vi.mocked(io.plan).getMockImplementation();
      if (implementation === undefined) throw new Error("missing planner mock");
      let calls = 0;
      vi.mocked(io.plan).mockImplementation(async () => {
        const value = await implementation();
        if (++calls === 2) current = false;
        return value;
      });
    }
    if (stage === "final-parent-checkpoint")
      vi.mocked(io.checkpointFinalParent).mockImplementationOnce(async () => {
        current = false;
        return { status: "safe", resolvedTargetPath: plan.targetPath };
      });
    const result = await executeSourceWrite(request, token, () => current, io);
    expect(result).toMatchObject({ status: "stale" });
    expect(io.createNote).not.toHaveBeenCalled();
    if (stage === "folder-create-settlement")
      expect(result.acceptedFolderPaths).toEqual(["Sources"]);
  });

  test.each([
    { verification: "verified" as const, expected: "post-create-stale" },
    {
      verification: "verification-failed" as const,
      expected: "post-create-stale",
    },
    { verification: "not-completed" as const, expected: "post-create-stale" },
  ])(
    "settles a fulfilled note as $expected when $verification completes after invalidation",
    async ({ verification, expected }) => {
      const io = adapter();
      let current = true;
      vi.mocked(io.createNote).mockImplementationOnce(async () => {
        current = false;
      });
      vi.mocked(io.verifyCreatedNote).mockResolvedValueOnce({
        status: verification,
      });
      const result = await executeSourceWrite(
        request,
        token,
        () => current,
        io,
      );
      expect(result).toMatchObject({
        status: expected,
        createdPath: plan.targetPath,
        acceptedFolderPaths: ["Sources", "Sources/Deep"],
        verification: { status: verification },
      });
      expect(io.createNote).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    {
      checkpoint: { status: "blocked" as const, indeterminate: true },
      refreshed: plan,
      expected: "safety-check-failed",
    },
    {
      checkpoint: { status: "blocked" as const },
      refreshed: { ...plan, targetPath: "Sources/Deep/changed.md" },
      expected: "replanned",
    },
    {
      checkpoint: { status: "blocked" as const },
      refreshed: plan,
      expected: "mutation-failed",
    },
  ])(
    "settles final checkpoint failure as $expected",
    async ({ checkpoint, refreshed, expected }) => {
      const io = adapter();
      vi.mocked(io.checkpointFinalParent).mockResolvedValueOnce(checkpoint);
      vi.mocked(io.plan)
        .mockResolvedValueOnce(plan)
        .mockResolvedValueOnce({
          ...plan,
          foldersToCreate: [],
        });
      if (checkpoint.indeterminate !== true)
        vi.mocked(io.plan).mockResolvedValueOnce({
          ...refreshed,
          foldersToCreate: [],
        });
      const result = await executeSourceWrite(request, token, () => true, io);
      expect(result).toMatchObject({ status: expected });
      expect(io.createNote).not.toHaveBeenCalled();
    },
  );

  test("replans when an exact directory appears before the folder mutation", async () => {
    const io = adapter();
    vi.mocked(io.checkpointFolder).mockResolvedValueOnce({
      status: "exact-directory-present",
    });
    vi.mocked(io.plan)
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce({ ...plan, foldersToCreate: ["Sources/Deep"] });
    await expect(
      executeSourceWrite(request, token, () => true, io),
    ).resolves.toMatchObject({
      status: "replanned",
      reason: "target-changed",
      acceptedFolderPaths: [],
    });
    expect(io.createFolder).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "stale settlement",
      refresh: plan,
      stale: true,
      expected: "stale",
    },
    {
      name: "unchanged state",
      refresh: plan,
      stale: false,
      expected: "mutation-failed",
    },
    {
      name: "external directory",
      refresh: { ...plan, foldersToCreate: ["Sources/Deep"] },
      stale: false,
      expected: "replanned",
    },
    {
      name: "collision or alias",
      refresh: {
        disposition: "blocked" as const,
        foldersToCreate: [] as [],
        diagnostics: [
          {
            code: "SOURCE_ROOT_PHYSICAL_ALIAS" as const,
            severity: "error" as const,
            message: "synthetic alias",
          },
        ],
      },
      stale: false,
      expected: "replanned",
    },
    {
      name: "registry classification changed",
      refresh: {
        ...plan,
        disposition: "new-version" as const,
        previousVersionPaths: ["Sources/previous.md"],
      },
      stale: false,
      expected: "replanned",
    },
    {
      name: "native indeterminacy",
      refresh: {
        disposition: "blocked" as const,
        foldersToCreate: [] as [],
        diagnostics: [
          {
            code: "SOURCE_NATIVE_PROBE_INDETERMINATE" as const,
            severity: "error" as const,
            message: "synthetic native failure",
          },
        ],
      },
      stale: false,
      expected: "safety-check-failed",
    },
  ])(
    "classifies rejected folder create from fresh state only: $name",
    async ({ refresh, stale: becomesStale, expected }) => {
      const io = adapter();
      let current = true;
      vi.mocked(io.createFolder).mockImplementationOnce(async () => {
        if (becomesStale) current = false;
        throw Object.assign(new Error("ignored text"), {
          code: "IGNORED_OS_CODE",
        });
      });
      vi.mocked(io.plan)
        .mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(refresh);
      const result = await executeSourceWrite(
        request,
        token,
        () => current,
        io,
      );
      expect(result).toMatchObject({
        status: expected,
        acceptedFolderPaths: [],
      });
      expect(io.createNote).not.toHaveBeenCalled();
    },
  );

  test.each([
    {
      verification: { status: "blocked" as const, indeterminate: true },
      refresh: plan,
      expected: "safety-check-failed",
    },
    {
      verification: { status: "blocked" as const },
      refresh: { ...plan, targetPath: "Sources/Deep/changed.md" },
      expected: "replanned",
    },
    {
      verification: { status: "blocked" as const },
      refresh: { ...plan, foldersToCreate: ["Sources/Deep"] },
      expected: "mutation-failed",
    },
  ])(
    "classifies fulfilled-folder post-check failure as $expected while retaining the accepted folder",
    async ({ verification, refresh, expected }) => {
      const io = adapter();
      vi.mocked(io.verifyFolder).mockResolvedValueOnce(verification);
      vi.mocked(io.plan)
        .mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(refresh);
      const result = await executeSourceWrite(request, token, () => true, io);
      expect(result).toMatchObject({
        status: expected,
        acceptedFolderPaths: ["Sources"],
      });
      expect(io.createNote).not.toHaveBeenCalled();
    },
  );

  test.each([
    {
      name: "stale",
      stale: true,
      refresh: noFolderPlan,
      expected: "stale",
    },
    {
      name: "unchanged permission or I/O failure",
      stale: false,
      refresh: noFolderPlan,
      expected: "mutation-failed",
    },
    {
      name: "target appeared",
      stale: false,
      refresh: { ...noFolderPlan, targetPath: "Sources/other.md" },
      expected: "replanned",
    },
    {
      name: "duplicate appeared",
      stale: false,
      refresh: {
        disposition: "duplicate" as const,
        existingPath: "Sources/existing.md",
        duplicatePaths: ["Sources/existing.md"],
        foldersToCreate: [] as [],
        diagnostics: [],
      },
      expected: "replanned",
    },
    {
      name: "root alias appeared",
      stale: false,
      refresh: {
        disposition: "blocked" as const,
        foldersToCreate: [] as [],
        diagnostics: [
          {
            code: "SOURCE_ROOT_PHYSICAL_ALIAS" as const,
            severity: "error" as const,
            message: "synthetic root alias",
          },
        ],
      },
      expected: "replanned",
    },
    {
      name: "registry classification changed",
      stale: false,
      refresh: {
        ...noFolderPlan,
        disposition: "new-version" as const,
        previousVersionPaths: ["Sources/previous.md"],
      },
      expected: "replanned",
    },
    {
      name: "native indeterminacy",
      stale: false,
      refresh: {
        disposition: "blocked" as const,
        foldersToCreate: [] as [],
        diagnostics: [
          {
            code: "SOURCE_NATIVE_PROBE_INDETERMINATE" as const,
            severity: "error" as const,
            message: "synthetic native failure",
          },
        ],
      },
      expected: "safety-check-failed",
    },
  ])(
    "classifies rejected note create without exception inspection: $name",
    async ({ stale: becomesStale, refresh, expected }) => {
      const io = adapter();
      let current = true;
      vi.mocked(io.plan).mockResolvedValue(noFolderPlan);
      vi.mocked(io.createNote).mockImplementationOnce(async () => {
        if (becomesStale) current = false;
        throw Object.assign(new Error("target exists or permission denied"), {
          code: "EANYTHING",
        });
      });
      vi.mocked(io.plan)
        .mockResolvedValueOnce(noFolderPlan)
        .mockResolvedValueOnce(noFolderPlan)
        .mockResolvedValueOnce(refresh);
      const result = await executeSourceWrite(
        noFolderRequest,
        token,
        () => current,
        io,
      );
      expect(result).toMatchObject({
        status: expected,
        acceptedFolderPaths: [],
      });
      expect(result).not.toHaveProperty("createdPath");
      expect(io.verifyCreatedNote).not.toHaveBeenCalled();
    },
  );

  test.each(
    ["darwin", "win32"].flatMap((platform) =>
      ["pre-folder", "post-folder"].flatMap((stage) =>
        ["alias", "indeterminate", "capability-unavailable"].map((outcome) => ({
          platform,
          stage,
          outcome,
        })),
      ),
    ) as {
      platform: "darwin" | "win32";
      stage: "pre-folder" | "post-folder";
      outcome: "alias" | "indeterminate" | "capability-unavailable";
    }[],
  )(
    "settles $platform $outcome at $stage with exact folder outcome",
    async ({ platform, stage, outcome }) => {
      const io = adapter();
      const blockedPlan: SourceWritePlan = {
        disposition: "blocked",
        foldersToCreate: [],
        diagnostics: [
          {
            code:
              outcome === "alias"
                ? "SOURCE_ROOT_PHYSICAL_ALIAS"
                : "SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE",
            severity: "error",
            message: `synthetic ${platform} ${outcome}`,
          },
        ],
      };
      if (stage === "pre-folder")
        vi.mocked(io.checkpointFolder).mockResolvedValueOnce({
          status: "blocked",
          ...(outcome === "indeterminate" ? { indeterminate: true } : {}),
        });
      else
        vi.mocked(io.verifyFolder).mockResolvedValueOnce({
          status: "blocked",
          ...(outcome === "indeterminate" ? { indeterminate: true } : {}),
        });
      vi.mocked(io.plan).mockResolvedValueOnce(plan);
      if (outcome !== "indeterminate")
        vi.mocked(io.plan).mockResolvedValueOnce(blockedPlan);
      const result = await executeSourceWrite(request, token, () => true, io);
      expect(result).toMatchObject({
        status:
          outcome === "indeterminate" ? "safety-check-failed" : "replanned",
        acceptedFolderPaths: stage === "post-folder" ? ["Sources"] : [],
      });
      if (outcome !== "indeterminate")
        expect(result).toMatchObject({ plan: blockedPlan });
      expect(io.createNote).not.toHaveBeenCalled();
    },
  );

  test.each(
    ["darwin", "win32"].flatMap((platform) =>
      ["alias", "indeterminate", "capability-unavailable"].map((outcome) => ({
        platform,
        outcome,
      })),
    ) as {
      platform: "darwin" | "win32";
      outcome: "alias" | "indeterminate" | "capability-unavailable";
    }[],
  )(
    "settles final pre-note $platform $outcome without note creation",
    async ({ platform, outcome }) => {
      const io = adapter();
      const blockedPlan: SourceWritePlan = {
        disposition: "blocked",
        foldersToCreate: [],
        diagnostics: [
          {
            code:
              outcome === "alias"
                ? "SOURCE_ROOT_PHYSICAL_ALIAS"
                : "SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE",
            severity: "error",
            message: `synthetic final ${platform} ${outcome}`,
          },
        ],
      };
      vi.mocked(io.plan).mockReset();
      vi.mocked(io.plan).mockResolvedValue(noFolderPlan);
      vi.mocked(io.checkpointFinalParent).mockResolvedValueOnce({
        status: "blocked",
        ...(outcome === "indeterminate" ? { indeterminate: true } : {}),
      });
      if (outcome !== "indeterminate")
        vi.mocked(io.plan)
          .mockResolvedValueOnce(noFolderPlan)
          .mockResolvedValueOnce(noFolderPlan)
          .mockResolvedValueOnce(blockedPlan);
      const result = await executeSourceWrite(
        noFolderRequest,
        token,
        () => true,
        io,
      );
      expect(result).toMatchObject({
        status:
          outcome === "indeterminate" ? "safety-check-failed" : "replanned",
        acceptedFolderPaths: [],
      });
      if (outcome !== "indeterminate")
        expect(result).toMatchObject({ plan: blockedPlan });
      expect(io.createNote).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("createdPath");
    },
  );
});
