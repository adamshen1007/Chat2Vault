# M08 ChatGPT Current-Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve an explicitly reviewed ChatGPT page/text capture as an immutable, distinctly labeled Chat2Vault source note, with official Web Clipper staging and manual-paste fallback.

**Architecture:** A strict, provider-neutral core capture contract validates staged or pasted text, canonicalizes the ChatGPT URL, computes a method-aware fingerprint, and renders inert capture-source Markdown. The Obsidian layer reads one explicitly selected staging note or in-memory paste, binds an exact preview to current vault/settings state, then uses the existing create-only source safety primitives for an explicit save. Web Clipper remains a separate user-operated extension; M08 captures are not export-shaped conversations and cannot enter M04/M05/M06.

**Tech Stack:** Node.js 24 LTS; pnpm 11; strict TypeScript; Vitest; Prettier; ESLint; Obsidian desktop plugin; existing macOS x86_64 native containment observer.

## Global Constraints

- Authority: [approved design](../specs/2026-10-15-m08-chatgpt-current-capture-design.md), `AGENTS.md`, roadmap M08; no M09/M10 or other-site work.
- Platform: macOS desktop x86_64; retain M01-M07 behavior and no external provider request for capture.
- Size: normalized capture text 1–1,048,576 UTF-8 bytes; complete staging note at most 1,064,960 bytes; URL at most 2,048 UTF-8 bytes.
- Identity: SHA-256 of five length-framed UTF-8 fields—`m08-capture-v1`, method, URL presence, normalized URL, normalized text—in that order.
- Security: no automatic clipboard read, browser/session access, background scan, provider call, overwrite, rename, delete, or staging-note mutation.
- Provenance: all captures remain `visible-page-unverified`; do not invent export graph, message role, chronology, or completeness.
- Authority: the Product Owner subsequently authorized M08 implementation in the current task on 2026-10-15. This does not authorize any commit/push/PR/merge/release. Even when an execution skill suggests a commit, skip that step until separately authorized.
- Task 3 amendment: on 2026-10-16 the Product Owner chose Option A in the native-create safety review. Only an identified, operation-owned, uncommitted private temporary artifact may be cleaned up; published capture sources, staging, and existing notes remain immutable. A hostile concurrent relocation of an already-open vault/source hierarchy is outside the absolute no-transient-outside-vault guarantee, while stale queued authority, ordinary races, identity changes, collisions, no false success, and reconciliation of uncertain effects remain in scope. See the design's Task 3 amendment; this is not publication authority.
- Reconciliation amendment: on 2026-10-16 the Product Owner chose Option A for a durable, content-free plugin-settings record of an unresolved transaction. Prepare it before possible exclusive publication, enforce its unresolved block in the capture service across view/plugin reload, fail closed on persistence errors, and clear it only after explicit, independently verified acknowledgment. Never store capture text, source URL, title, or secrets in the record. This narrow settings write is the sole additional Chat2Vault write outside private temporary and explicit source target; no publication authority follows.

## File map and interfaces

| Unit                      | Responsibility                                                                                                                   | Intended files                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core capture contract     | Normalize URL/text, parse staging envelope, fingerprint, render capture source, parse capture registry identity                  | Create `packages/core/src/capture/{contracts,normalize,staging,source}.ts`; export from `packages/core/src/index.ts`; tests in `packages/core/test/capture-*.test.ts`          |
| Source-root compatibility | Keep M03 export registry and M08 capture registry disjoint while sharing safe path/containment policy                            | Modify `packages/core/src/source-writer/planner.ts` only if coexistence tests demonstrate a needed change; create `apps/obsidian-plugin/src/capture-vault-adapter.ts` and test |
| Native bounded read       | Extend the requested-byte ceiling for M08 staging while retaining descriptor-relative containment and sentinel behavior          | Modify `apps/obsidian-plugin/src/native-observer.ts`, `native/source_observer.cc`, and `test/native-observer.test.ts`                                                          |
| M08 controller            | Ephemeral draft/preview owner, stale-generation fences, explicit save, content-free diagnostics                                  | Create `apps/obsidian-plugin/src/capture-controller.ts` and test                                                                                                               |
| M08 UI                    | Active-note preview command, paste panel, exact preview, explicit save, honest scope warning                                     | Modify `apps/obsidian-plugin/src/main.ts`, `view.ts`; add focused tests                                                                                                        |
| Companion and evidence    | Importable official template, non-sensitive setup instructions, synthetic/browser qualification, boundary gate, milestone report | Create `assets/web-clipper/chatgpt-capture.json`, `docs/M08_CAPTURE_WORKFLOW.md`, M08 test scripts/reports only after they exist; update README/index                          |

Core public interfaces to stabilize before adapter/UI work:

```ts
export type CaptureMethod = "obsidian-web-clipper" | "manual-paste";
export interface CaptureInput {
  method: CaptureMethod;
  text: string;
  sourceUrl?: string;
  title?: string;
}
export interface CaptureDraft {
  method: CaptureMethod;
  scope: "visible-page-unverified";
  text: string;
  sourceUrl?: string;
  title?: string;
  fingerprint: `sha256:${string}`;
}
export type CaptureValidation =
  { ok: true; draft: CaptureDraft } | { ok: false; code: string };
export function validateCapture(input: CaptureInput): CaptureValidation;
export function parseStagingCapture(bytes: Uint8Array): CaptureValidation;
export function renderCaptureSource(draft: CaptureDraft): string;
```

### Task 1: Core normalization and identity

**Files:** Create `packages/core/src/capture/contracts.ts`, `normalize.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/capture-normalize.test.ts`.

**Interfaces:** Produces `CaptureInput`, `CaptureDraft`, `CaptureValidation`, and `validateCapture` as above. Uses existing `sha256` from `packages/core/src/fingerprint/stable-json.ts` and well-formed-Unicode policy from `source-writer/primitives.ts`; no Obsidian import.

- [ ] Write Vitest vectors for valid `https://chatgpt.com/c/11111111-1111-4111-8111-111111111111?secret=x#tail`, absent manual URL, an invalid host/port/path, BOM/CRLF normalization, lone surrogate/NUL, zero/over-limit bytes, method-aware identity, and repeated exact input. Assert the normalized URL contains no query/fragment, the scope is always unverified, and repeated input has the same fingerprint.
- [ ] Run `pnpm --filter @chat2vault/core exec vitest run test/capture-normalize.test.ts`; expect red because the new module is absent.
- [ ] Implement the closed method union, URL parser, text normalization, byte limits, and five-field framing. The framing function must encode each field as ASCII decimal UTF-8 byte length, a colon, then the exact UTF-8 bytes, for example:

  ```ts
  const encoder = new TextEncoder();
  const fields = [
    "m08-capture-v1",
    method,
    url ? "url" : "absent",
    url ?? "",
    text,
  ];
  const framed = fields.map((field) => {
    const bytes = encoder.encode(field);
    return [encoder.encode(`${bytes.length}:`), bytes];
  });
  // Concatenate all framed byte arrays, then hash those bytes.
  ```

  Reject malformed input with closed, content-free codes; do not include text or URL in diagnostics. Exact return shape must match the public interface above.

- [ ] Run the focused test and `pnpm --filter @chat2vault/core typecheck`; expect exit 0. Review the vectors against design §3/§5, including method-aware identity.

### Task 2: Strict staging parse, capture-source render, and registry coexistence

**Files:** Create `packages/core/src/capture/staging.ts`, `source.ts`; test `packages/core/test/capture-staging.test.ts`, `capture-source.test.ts`; modify `packages/core/src/index.ts` and `packages/core/src/source-writer/planner.ts` only if the coexistence test fails.

**Interfaces:** `parseStagingCapture(bytes)` consumes bounded raw bytes and calls `validateCapture` with method `obsidian-web-clipper`; `renderCaptureSource(draft)` returns deterministic inert Markdown; `parseCaptureSource(bytes, path)` returns a validated fingerprint/path record or a closed error. No export canonical conversation is produced.

- [ ] Add tests for exact staging marker/fields, optional title, duplicate or unknown identity fields, malformed UTF-8/frontmatter, hostile Markdown/HTML/embeds, the 1,064,960-byte boundary, and URL stripping. Add a coexistence test in `source-planner.test.ts` proving a valid `ai-conversation-web-capture` under the source root is not misclassified as a malformed M03 export note. Add a negative test for a malformed M03-like note remaining fail-closed.
- [ ] Run the two new focused core tests and the coexistence test; expect red before implementation.
- [ ] Implement a strict raw-byte staging parser with fatal UTF-8 decode, a closed field set, no YAML aliases or duplicate keys, and `validateCapture` delegation. Render source-note frontmatter with `chat2vault_schema: 2`, `type: "ai-conversation-web-capture"`, provider/method/scope/fingerprint/optional normalized URL; render the body through the existing inert-text escaping policy. Implement `parseCaptureSource` to validate that exact envelope and fingerprint. Keep the M03 export parser's own type check; alter it only if the coexistence test establishes a real conflict.
- [ ] Run `pnpm --filter @chat2vault/core exec vitest run test/capture-staging.test.ts test/capture-source.test.ts test/source-planner.test.ts` and core typecheck; expect exit 0. Inspect rendered bytes for export-only fields or a completeness claim; neither is allowed.

### Task 3: Bounded active-note read and create-only capture source planning

**Files:** Create `apps/obsidian-plugin/src/capture-vault-adapter.ts`; test `apps/obsidian-plugin/test/capture-vault-adapter.test.ts`; modify `apps/obsidian-plugin/src/native-observer.ts`, `apps/obsidian-plugin/native/source_observer.cc`, and `apps/obsidian-plugin/test/native-observer.test.ts`; reuse `source-vault-adapter.ts` and `containment.ts` primitives without modifying the M03 writer unless a focused regression requires it.

**Interfaces:** Define `CaptureVaultAdapter` with `readActiveStaging(path): Promise<{ bytes: Uint8Array; digest: string } | { code: string }>`, `plan(draft): Promise<CaptureWritePlan>`, and `save(plan,current): Promise<CaptureSaveResult>`. `CaptureWritePlan` contains source-root identity, source input fingerprint, target path, exact Markdown, and `create | existing-identical | blocked` disposition. It never exposes update/delete operations.

- [ ] Add tests using the existing fake `SourceVaultIO`/native observer fixtures for a safe active `.md` note, staged note inside source/knowledge/config roots, bidirectional normalized/case-folded root overlap and physical aliasing, file change between read and save, duplicate fingerprint, different-content target, a concurrent target create after preflight, missing/pending source root, failed create, and failed readback. Add native-read tests for exactly 1,064,960 bytes, one sentinel byte, over-limit rejection, and unchanged symlink/path/alias refusal at the new ceiling. Assert zero create calls before explicit save and no write/delete/rename against the staging path.
- [ ] Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/capture-vault-adapter.test.ts`; expect red before implementation.
- [ ] Raise the **maximum requested bytes** in both `readNativeVaultFileBounded` and the native observer from 128 KiB to 1,064,960 bytes, without weakening descriptor-relative path validation, the exact requested bound, `maxBytes + 1` sentinel, or error handling. Keep M07 catalog reads at their existing 128 KiB request value. Implement bounded physical staging and registry reads; reject per-file and aggregate overflow rather than using unbounded vault reads. Reuse M03 root normalization, collision checks, native containment, and exact readback discipline. Revalidate every caller-provided draft field against canonical core validation and bind the approved preview to exact staging-byte digest, selected path, relevant settings/root/config physical identities, and proposed output bytes; fingerprint equality alone is insufficient. Before publication, re-enumerate export and capture registry identities and re-read the active staging bytes. The runtime adapter must expose only capture-specific read/plan/save capabilities, not ordinary vault create/update/delete/rename methods. Write and fsync exact bytes into a private, operation-owned, uncommitted temporary artifact, verify it, then publish exclusively with no-replace semantics; clean up only the identified private artifact. A collision never overwrites; an uncertain publish/cleanup outcome is non-success and requires reconciliation, never deletion of a possibly published source. An existing validated capture with the same method/URL/text fingerprint returns `existing-identical` without mutation; unsafe or changed state returns blocked/replan. Bind and recheck vault/source-parent/config physical identities at native execution checkpoints. Do not clone M03 export canonical-conversation rendering or bypass its safety checks.
- [ ] Add deterministic tests for queued root/parent replacement, mid-operation relocation, partial writes/fsync/readback failures, private-temporary cleanup, exclusive-publication collision, and uncertain effects. Do not claim absolute containment against a hostile actor concurrently relocating an already-open directory hierarchy; do require detectable relocation to return non-success and report residual artifacts for reconciliation.
- [ ] Close the post-integration ownership finding with a direct exclusive 0600 temporary file under a validated, descriptor-pinned source parent. Use the returned file descriptor for exact write/fsync/readback and inode identity; never infer ownership from a later lookup of a newly created directory. Check the temp name/identity before `RENAME_EXCL`, but do not use a name-based automatic unlink/rmdir when identity may be substituted. A failed pre-publication operation with possible residue is temporary uncertainty; a possibly published target is published uncertainty. Test a deterministic substitution that resumes through production execution and proves zero bytes enter the replacement, no replacement is removed, and the durable reconciliation gate remains active. Clean up only when operation ownership is actually established; safe retention is acceptable.
- [ ] Run the focused adapter suite, `test/native-observer.test.ts`, `test/source-vault-adapter.test.ts`, and plugin typecheck; expect exit 0. Review the adapter API for accidental mutation capability beyond create. Record that the native binary byte change requires fresh M08 host qualification and must not rewrite M07 historical packets.

### Task 4: Ephemeral controller and explicit UI

**Files:** Create `apps/obsidian-plugin/src/capture-controller.ts`; modify `apps/obsidian-plugin/src/main.ts`, `view.ts`; test `apps/obsidian-plugin/test/capture-controller.test.ts`, `main.test.ts`, `view.test.ts`.

**Interfaces:** `CaptureController.previewStaging(path)` and `.previewPaste(text,url?)` install a draft plus exact adapter plan; `.save()` succeeds only when its captured generation, active-file identity, source root, staging digest, and plan bytes remain current. `.invalidate(reason)` clears draft/plan on relevant edits, settings changes, view close, or unload, but cannot clear the service-owned durable reconciliation block. Existing `SourceWriteController` remains for export conversations only.

- [ ] Write controller tests for start/finish ownership, non-queuing preview/save, edit/switch/root invalidation before and after await points, stale readback settlement, no automatic clipboard read, and zero provider calls. Write UI tests asserting separate **Preview ChatGPT capture**, **Paste ChatGPT capture**, and **Save capture source** actions, visible `visible-page-unverified`/missing-URL warnings, inert text rendering, full proposed note preview, and Save disabled until current plan succeeds.
- [ ] Run `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/capture-controller.test.ts test/main.test.ts test/view.test.ts`; expect red before implementation.
- [ ] Wire one active-file command and one paste panel to the controller. Use `textContent`/existing `renderText` for all untrusted text; use an explicit textarea input rather than `navigator.clipboard.readText`. Keep capture draft/preview memory-only. Ensure no capture object is passed to `ManualDistillationController`, `ProviderController`, `KnowledgeController`, or `KnowledgeDedupController`.
- [ ] Add the approved content-free reconciliation ledger at the capture-service boundary. Durably prepare the transaction record before exclusive publication; block write attempts whenever a record is unresolved, even after view close/reopen or plugin unload/reload. Distinguish authenticated operation-owned temporary residue from an unverified candidate, never direct deletion of unverified material, and require explicit acknowledgment after independent outcome inspection. Test failures of ledger preparation/update/clear, crash windows, close/reopen, and reload for both temporary and published uncertainty. Do not persist draft text, URL, title, or credentials.
- [ ] Run focused controller/UI tests, plugin typecheck, `node apps/obsidian-plugin/scripts/check-m07-boundaries.mjs`, and `pnpm --filter @chat2vault/obsidian-plugin exec vitest run test/m07-boundaries.test.ts`; expect exit 0 with unchanged M07 functional boundaries. The M07 artifact-only check is a historical byte pin and is addressed by forward-versioned aggregate gating in Task 6; do not rewrite its packets. Inspect the UI manually in a disposable vault for honest labels and keyboard-accessible action order.

### Task 5: Official Web Clipper companion and user workflow

**Files:** Create `assets/web-clipper/chatgpt-capture.json`, `docs/M08_CAPTURE_WORKFLOW.md`; update `README.md` and `docs/00_DOCUMENT_INDEX.md`; add a synthetic template-contract test under `apps/obsidian-plugin/test/capture-template.test.ts`.

**Interfaces:** Template produces the Task 2 staging frontmatter/body contract, triggers only `https://chatgpt.com/c/` conversation URLs, uses **Create a new note**, and does not invoke Interpreter or prompt variables.

- [ ] First export a minimal template from the installed official extension to obtain its current JSON schema. In a disposable vault, verify two clips create two distinct staging notes and do not overwrite each other. If this cannot be verified, record the failure, do not ship an unverified importable template, and keep the manual fallback as the only qualified route.
- [ ] Write a template-contract test asserting the exported JSON parses, trigger host/path is bounded, create-new behavior is selected, fields match the strict staging parser, and no prompt/Interpreter/append/overwrite behavior appears. Run the test and expect red before adding the template.
- [ ] Produce the importable JSON in the official schema, using `{{url}}`, `{{title}}`, and bounded captured content variables only after checking their actual emitted output. Write the workflow with exact install/import/clip/inspect/open/preview/save steps, the partial-capture and URL-query warning, manual-paste fallback, duplicate handling, and how to verify the saved note. Do not put real account content in the repository.
- [ ] Run the template test and Prettier check on the JSON/docs; expect exit 0. Record exact browser, extension, and Obsidian versions plus observed visible-versus-captured synthetic text and collision behavior.

### Task 6: Whole-candidate qualification and handoff

**Files:** Create `apps/obsidian-plugin/scripts/check-m08-boundaries.mjs`, `apps/obsidian-plugin/scripts/check-m08-runtime.mjs`, focused M08 negative/runtime tests, and `docs/26_M08_IMPLEMENTATION_REPORT.md` after actual execution. Modify `apps/obsidian-plugin/scripts/check-plugin.mjs`, the narrow M05 artifact-comparator input allowlist if required by new M08 runtime modules, and `package.json` gate wiring; update document index/README from observed results. Do not alter M01-M07 evidence packets.

**Interfaces:** Evidence binds the exact Git tree and production artifacts, the two Obsidian host rows, the Web Clipper staging write separately from Chat2Vault's source write, and zero Chat2Vault provider/network calls. No real conversation data appears in retained packets.

- [ ] Add static negative fixtures for provider routes, clipboard reads, browser/session access, automatic staging scan, and update/delete/rename from the M08 capture spine. Add runtime tests for a synthetic staged capture and manual paste, duplicate no-op, changed-content new version, stale preview, and unchanged existing source/knowledge notes.
- [ ] Update the aggregate so historical M07 **functional/boundary** tests still run, while an M08 artifact gate pins the new production/native bytes; old M07 retained packets remain immutable evidence for their old tree, not current-build qualification. Extend the M05 comparator allowlist only for exact new M08 modules if its contract requires it; preserve negative tests against arbitrary inputs. Run focused M08 tests, then full `pnpm verify` with Node 24/pnpm 11. Record exact command, counts, and any legacy host-focus intervention; do not relabel a failing gate as pass. Run minimum/current-stable macOS x86_64 Obsidian rows on exact new production artifact bytes and document browser/extension compatibility separately.
- [ ] Perform a whole-branch diff and untracked-file review against `origin/main`, secret/export scan, and independent read-only R2 review after the candidate is stable. If bytes change, rerun affected gates and review on the new exact candidate. Report known limitations, especially unverified capture completeness and separately controlled Web Clipper storage.
- [ ] Write the implementation report with GO/CONDITIONAL GO/NO-GO, acceptance mapping, exact commands and actual outcomes, runtime identity, limitations, manual actions, and separate commit/push/PR/merge/release status. Stop at the authorization boundary; a green gate is not publication authority.

## Plan self-review and execution boundary

Coverage: Tasks 1–2 cover normalization, strict staging, identity, inert rendering, and export-registry separation; Task 3 covers bounded read/create-only safety; Task 4 covers explicit UI and stale authority; Task 5 covers the official companion and manual instructions; Task 6 covers privacy, compatibility, runtime, and completion evidence. No other-site, distillation, M09, or M10 implementation is planned.

The Product Owner authorized M08 implementation in the current task on 2026-10-15. The existing local M07 closure documentation and this approved M08 design must be preserved; do not discard or silently fold them into an unrelated change. Any commit, push, PR, merge, deployment, or release needs its own explicit authority under repository rules.
