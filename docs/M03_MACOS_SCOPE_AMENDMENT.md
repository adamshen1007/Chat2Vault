# Milestone 03.1 macOS-Only Scope Amendment

Version: 1.0.1  
Date: 2026-08-24  
Status: **Candidate — pending genuinely independent approval**

## 1. Decision and purpose

The Product Owner has decided that Milestone 03 source writing will be developed and qualified for the currently available macOS environment. Windows support will be added only through a later, separately specified and independently reviewed compatibility milestone.

This amendment narrows the M03 commit-readiness platform and runtime-evidence scope. It does not waive a failed required row, claim Windows compatibility, authorize publication, or begin a later milestone.

## 2. Authority, immutability, and precedence

The approved base specification remains the exact UTF-8 bytes of `docs/M03_SPEC.md` with SHA-256:

```text
ad8f548e1ca264c569c75030a7f3f0fb6430ceee3838b08e4071c6400b672791
```

Those bytes remain unchanged. Before this amendment becomes implementation authority, a genuinely independent whole-amendment review must approve one exact UTF-8 byte sequence and its SHA-256 with the exact verdict:

```text
GO — M03.1 SPEC AMENDMENT APPROVED
```

After that verdict, the approved amendment bytes are frozen. Any byte change invalidates amendment approval and requires a new hash and genuinely independent re-review.

For M03.1 only, the approved amendment supersedes the base specification solely for the clauses explicitly listed in §§4–7 below. The amendment has precedence for those clauses. Every unlisted base-specification requirement remains unchanged and mandatory.

Until the exact approval verdict is issued, implementation may not resume under the amended scope and the existing M03 candidate remains NO-GO.

## 3. Scope and non-goals

M03.1 source writing is supported only on:

- macOS desktop;
- x86_64 architecture;
- exact Obsidian 1.7.4 and the current public stable Obsidian version required by §5.

On Windows, Linux, mobile, a macOS process whose running architecture is not x86_64, or any other environment:

- M01/M02 import and preview behavior remains available where already supported;
- M03 source-writing Preview/Save actions fail closed as unsupported;
- use the exact diagnostic `UNSUPPORTED_SOURCE_WRITER_PLATFORM` and its existing specified message;
- perform zero source-folder or source-note mutation;
- do not claim qualification, compatibility, packaging, or release readiness.

Deferred work includes Windows native-observer build/package support, Windows junction/generic-reparse runtime qualification, Windows raw filesystem traces, Apple Silicon native-observer packaging, and universal native-observer/package distribution. This deferred work is not part of M03.1 and must not be implemented opportunistically while closing M03.1.

Eligibility is determined by the running Obsidian/Electron process architecture, not solely by the host bundle's available slices. A universal Obsidian/Electron host running as x86_64 is eligible and is not rejected merely because its bundle also contains an arm64 slice. A host process running as arm64 is ineligible. The M03.1 native observer itself remains an x86_64-only artifact; universal native-observer/package distribution is deferred.

The portable source-root contract remains unchanged. In particular, Windows-invalid filename characters and Windows reserved device names remain rejected on every OS so persisted configuration has one deterministic forward-compatible lexical meaning.

## 4. Superseded supported-platform contract

This section supersedes base-specification §23.1, the base-specification §3 bullet that includes a read-only Windows generic reparse-point observation in M03 scope, and any other statement that identifies Windows 11 or a Windows native observer as an M03.1 source-writer deliverable.

The M03.1 source writer is qualified only for macOS desktop x86_64. Production eligibility must be equivalent to:

```ts
process.platform === "darwin" && process.arch === "x64";
```

Production eligibility must not include `win32`, Linux, or `darwin` with `process.arch !== "x64"`. Every ineligible OS/architecture pair must fail closed with `UNSUPPORTED_SOURCE_WRITER_PLATFORM` before source-writing Preview or Save can become actionable. The macOS native observer remains read-only and retains the exact `getattrlist(2)`/`ATTR_VOL_MOUNTPOINT` contract from the base specification.

Platform-neutral Windows-path lexical rules, normalized native-probe/reparse result types, and synthetic fault-injection, containment-boundary, and post-create race tests remain mandatory where the base specification requires them because they protect deterministic data and fail-closed behavior. Existing dormant abstractions and tests may remain. Windows native-observer build/package/runtime qualification is not an M03.1 deliverable, and none of these retained contracts constitutes Windows product support or Windows runtime evidence.

## 5. Superseded runtime matrix and platform-specific execution

This section supersedes base-specification §§23.2–23.3 and every §§24–27 phrase that requires a four-row macOS/Windows matrix.

Run every retained M03.1 runtime scenario on both rows:

| OS            | Architecture | Obsidian                                                     |
| ------------- | ------------ | ------------------------------------------------------------ |
| macOS desktop | x86_64       | exact 1.7.4                                                  |
| macOS desktop | x86_64       | exact public stable from official metadata at execution time |

Both rows must execute all platform-neutral requirements and every macOS-specific requirement from base §23.3, including raw-NFD addressing, POSIX symlink ancestry, `realpath` escape, hidden/dot roots, ordinary-file obstruction, actual contained-realpath non-symbolic mount ancestry, authoritative ordinary-directory `not-mount-point`, capability-unavailable and indeterminate fault cases, and exact diagnostics with zero forbidden mutation.

Windows-only junction, generic-reparse, `FILE_ATTRIBUTE_REPARSE_POINT`, Windows symbolic-link privilege, and Windows raw-trace execution requirements are deferred and are not M03.1 commit-readiness requirements. Synthetic Windows lexical, containment-boundary, reparse-result, and post-create race fixtures may remain in automated tests but cannot be represented as Windows runtime qualification.

Every “all four rows,” “each four-row runtime,” or equivalent phrase in base §§24–27 means both amended macOS rows for M03.1. Every required evidence artifact must bind to the final identical production artifact hashes and both the approved base-specification hash and approved amendment hash.

## 6. Retained exact application-zoom requirement

Base-specification §23.4 remains mandatory on both amended macOS rows without weakening.

Each row must use external host-level Electron `webContents` control and retain:

- verified zoom readback at `1.0`, then `2.0`, then restored `1.0` within the specified tolerance;
- a Chat2Vault view-content `clientWidth` in the inclusive range `358..362` CSS pixels while zoom is `2.0`;
- two `requestAnimationFrame` turns;
- exact view, control, status-region, and raw-preview rectangles;
- outer-overflow and Preview/Save non-overlap results;
- actual keyboard transitions reaching enabled Preview and Save controls;
- one screenshot at zoom `2.0`;
- the external harness call log and restoration evidence.

OS scaling, renderer-only CSS zoom, text zoom, pinch zoom, browser emulation, or helper-contract unit tests do not substitute for this runtime evidence.

## 7. Superseded acceptance criteria

The following text supersedes only AC-30, AC-31, and AC-32 in base §28.

**AC-30 — macOS runtime compatibility:** The complete two-row macOS x86_64 exact-minimum/current-stable matrix passes every retained M03.1 scenario, including actual contained-realpath non-symbolic mount-point prohibition, multi-segment missing-root Preview/Save transitions, post-create required-parent macOS mount/indeterminate/POSIX races, Preview/Save arbitration, exact raw-Markdown display boundaries, and the unmodified §23.4 200% host-level application-zoom procedure.

**AC-31 — macOS raw runtime evidence:** Both amended rows retain final production artifact hashes; approved base-specification and amendment hashes; all §15.3 post-create parent checkpoints; contained-realpath macOS mount-point races; authoritative `ATTR_VOL_MOUNTPOINT` capability/probe evidence; synthetic missing-descendant Preview versus authoritative Save checks; Preview/Save mutex and installed-plan/UI-winner arbitration; raw-Markdown display boundaries; exact §23.4 zoom metrics, call logs, keyboard transitions, screenshots, and restored zoom; mutation/registry/privacy/storage/clipboard/network evidence; and complete privacy-clean raw pathname traces.

**AC-32 — governance and publication:** The approved base-specification bytes and independently approved amendment bytes remain frozen. Any change to either invalidates the corresponding approval. No commit, push, tag, PR, merge, release, deployment, Community submission, or later-milestone work occurs before a genuinely independent implementation/evidence review issues the exact verdict `GO — M03 COMMIT READY` and the Product Owner separately authorizes the publication action.

All AC-01 through AC-32, with AC-30–AC-32 interpreted through this approved amendment, must pass simultaneously for M03.1 commit readiness.

## 8. Required implementation alignment

After independent amendment approval and before final runtime qualification:

1. make the production source-writer platform predicate return true only for `darwin` with running architecture `x64`;
2. make the active native build produce only the macOS x86_64 observer and fail closed elsewhere;
3. add focused tests for `darwin`/`x64` eligible and at minimum `darwin`/`arm64`, `win32`/`x64`, and `linux`/`x64` ineligible;
4. add a static gate preventing production eligibility from admitting Windows, Linux, or non-x64 macOS execution;
5. update README, document index, implementation notes, and runtime report consistently;
6. rerun the full repository verification and both amended macOS runtime rows;
7. obtain exact host-level zoom evidence on both rows;
8. submit the complete candidate for genuinely independent review.

Existing Windows-oriented source abstractions or synthetic tests may remain only when dormant behind the macOS-only production boundary and accurately described as unqualified. No new Windows feature work is authorized.

## 9. Approval and current decision

Current amendment decision: **NO-GO — candidate amendment is not yet approved.**

Required next verdict:

```text
GO — M03.1 SPEC AMENDMENT APPROVED
```

No M03.1 implementation change, commit, push, release, or later-milestone work is authorized by this candidate amendment alone.
