# M05 Specification Review Ledger

Version: 0.1-candidate

Status: M05 v0.6 remediation lineage; exact independent re-review pending

## Purpose

This ledger makes the complete M05 v1–v5 specification-review lineage independently reconstructible. It records each reviewed candidate, each material blocker returned by the independent reviewer, the remediation location in the current candidate, and the commit that introduced that remediation. It is evidence only: it does not approve the specification or authorize implementation, publication, provider use, release, or M06.

## Candidate lineage

| Review | Candidate commit                           | Specification SHA-256                                              | Result                                           | Remediation commit                         |
| ------ | ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| v1     | `dd48366abd749c718587246b934194ab13a9bc04` | `da950f5d4d704dfe5a2fbd077a677e1a207c6226875d1c5b96a74484b5f0f611` | `NO-GO — M05 SPECIFICATION REMEDIATION REQUIRED` | `1ef26a17c2605e3efba96f1a5f81a75c486e2801` |
| v2     | `1ef26a17c2605e3efba96f1a5f81a75c486e2801` | `fba695d9e68e5a0620397e644e2da963748f2e3f7674a18f9b663b66145c0c31` | `NO-GO — M05 SPECIFICATION REMEDIATION REQUIRED` | `471c45b6de8f3fc44a47642b5c8f3ef4bea91ed4` |
| v3     | `471c45b6de8f3fc44a47642b5c8f3ef4bea91ed4` | `c147055242175d57df31f0f06b697920c2da5ed6b4bf3d35015563b3406f03fc` | `NO-GO — M05 SPECIFICATION REMEDIATION REQUIRED` | `fe5b223058c727d2200882a129bd85140e2ebf96` |
| v4     | `fe5b223058c727d2200882a129bd85140e2ebf96` | `8a902f003a16a306244ae833c479205bbfd65c97419bedb84cd287ed8ed51126` | `NO-GO — M05 SPECIFICATION REMEDIATION REQUIRED` | `a04d3d7744c7f29111beb9a9a253ece6a205e943` |
| v5     | `a04d3d7744c7f29111beb9a9a253ece6a205e943` | `3cced511ad24979764f48fa64045c2d4b003f0d404fcaf49f3df94be5b678baf` | `NO-GO — M05 SPECIFICATION REMEDIATION REQUIRED` | current v0.6 candidate commit after freeze |

Every candidate descends from the M04 closure baseline `2ac8f194adeca6de5cf2c227ca8213013455573e`. The review packet must contain an independently verifiable Git bundle that exposes the candidate and baseline refs, plus canonical Git object/tree/blob evidence.

## v1 findings and current closure

| ID         | Material blocker                                                                                                  | Current v0.6 closure                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M05-V1-B01 | Native Keychain ABI and result shapes were not closed.                                                            | §§7–8 and §§20–22 define ABI version 1, exact tagged unions, own-key/descriptor checks, method-specific success cross-products, throw/malformed handling, and runtime evidence.         |
| M05-V1-B02 | Credential mutation did not invalidate generation/ownership before native effects.                                | §§8, 13, 17, and 20–22 advance credential generation and invalidate Provider ownership synchronously before each valid native mutation.                                                 |
| M05-V1-B03 | Keychain account identity was not durably bound to an installation.                                               | §§7–9 derive the account from a persisted, non-editable installation UUID and disclose copy/clear/orphan behavior.                                                                      |
| M05-V1-B04 | Public-network address denial policy was incomplete.                                                              | §10 freezes the complete denied IPv4 CIDR classifier, fails closed on IPv6/IP literals, and requires inclusive boundary tests.                                                          |
| M05-V1-B05 | DNS selection/pinning and TLS hostname behavior were ambiguous.                                                   | §§10 and 14 select A-only IPv4 deterministically, pin the first validated result, prohibit IP literals, and retain DNS-hostname SNI/certificate verification.                           |
| M05-V1-B06 | Native-module failure and substitution claims exceeded the supported boundary.                                    | §7 disables only M05 on Keychain module failure, preserves M01–M04, keeps source observation independent, and limits substitution claims to detectable ABI/shape plus artifact binding. |
| M05-V1-B07 | Provider/M04 arbitration, cancellation, invalidation, and settlement were incomplete.                             | §§13, 17, and 20–22 define the closed owner matrix, invalidations, stale fences, event precedence, exact release rules, and late-result suppression.                                    |
| M05-V1-B08 | Diagnostic codes, precedence, states, and results were not closed.                                                | §17 provides the closed diagnostic/status table and precedence contract; §§8–13 define authoritative transitions.                                                                       |
| M05-V1-B09 | Runtime evidence did not bind exact Obsidian rows, accessibility, production artifacts, and the test-entry delta. | §§20–22 require exact 1.7.4/current-stable rows, focus/live/zoom/geometry proof, production hashes, a delimited test bundle, shared-input/metafile proof, and no production bypass.     |

## v2 findings and current closure

| ID         | Material blocker                                                                                     | Current v0.6 closure                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M05-V2-B01 | Invalid Set input could reach mutex/native effects.                                                  | §§8 and 17 return `KEYCHAIN_INPUT_INVALID` before mutex/native access with zero generation/state effects; §§20–21 require zero-access proof.                                                         |
| M05-V2-B02 | Credential status/read/mutation/refresh outcomes and indeterminate behavior were incomplete.         | §§7–8, 17, and 20–21 close shapes, mutex, generation, prior-state restoration, authoritative read transitions, and diagnostics.                                                                      |
| M05-V2-B03 | Provider settings Save was not atomic and its queue/generation/rollback semantics were incomplete.   | §§5, 9, 12–13, 17, and 20–22 now preserve the binary non-queuing mutex, define one explicit five-field Save, separate accepted/persisted generations, and close rollback/invalidation.               |
| M05-V2-B04 | Exact transmitted headers, fresh-socket behavior, and pre-transmission peer pinning were incomplete. | §§14 and 20–22 freeze the seven headers, explicit Host, `setHost: false`, `agent: false`, no proxy/global agent/reuse/CONNECT, one lookup, and `secureConnect` peer equality before sensitive bytes. |
| M05-V2-B05 | Provider-specific refusal/tool-call/function-call extras could alter envelope authority.             | §§16 and 20–22 ignore every provider-specific extra after global security validation; exactly one valid string `content` is decisive.                                                                |
| M05-V2-B06 | JSON container-depth accounting was ambiguous.                                                       | §§16 and 20–22 define root depth 1, child-container increments, scalar behavior, accepted depths 31/32, rejected entry into 33, and mixed fixtures.                                                  |

## v3 findings and current closure

| ID         | Material blocker                                                                                | Current v0.6 closure                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M05-V3-B01 | The no-data rule also prohibited necessary deterministic synthetic test evidence.               | §§6 and 19–24 distinguish forbidden real/user/provider data from narrowly permitted, inventoried deterministic synthetic fixtures and evidence.                                                            |
| M05-V3-B02 | Redacted screenshots could not directly prove the tested UI.                                    | §§6 and 21–22 reserve only `https://m05.invalid/v1/chat/completions`, `m05.invalid`, `synthetic-m05-model`, and deterministic synthetic display fixtures for the unredacted runtime screenshot.            |
| M05-V3-B03 | Stale settlement and ownership release were not exact.                                          | §§13 and 20–22 make stale completion return-only while allowing exactly one internal release only for its still-installed matching token; tests prove an old token cannot clear a newer owner.             |
| M05-V3-B04 | Installation-identity persistence, failure, retry, restart, and focus behavior were incomplete. | §§7–9, 12, 17, and 20–22 define the closed pending-identity transaction, same-UUID retry, ambiguous-write reload, no pre-authority Keychain/network access, safe restart, focus, and M01–M04 availability. |

## v4 findings and current closure

| ID         | Material blocker                                                                                       | Current v0.6 closure                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M05-V4-B01 | A FIFO settings queue conflicted with frozen M03’s binary non-queuing mutex.                           | §§5, 9, 17, and 20–22 preserve the exact non-queuing mutex and define a closed arbitration matrix for identity, Retry, Provider, preview, and source-root actions.                                                           |
| M05-V4-B02 | V3 load/recovery could discard unrelated valid authority and did not preserve M03 diagnostics exactly. | §9 applies the frozen M03 v1/v2 table first, recovers v3 fields independently, composes exact ordered diagnostics, and requires complete malformed/corrupt/combined fixtures.                                                |
| M05-V4-B03 | The runtime gate could replace production HTTPS transport with a simulator.                            | §§20–22 require both rows to execute the byte/source-identical production controller/`https.request` transport; only the bounded resolver/policy/socket-destination seam and process-start synthetic CA are test-controlled. |

## v5 findings and v0.6 remediation

| ID         | Material blocker                                                                                                 | v0.6 remediation                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M05-V5-B01 | Safe integer schema `>= 4` started identity persistence and could destructively rewrite unknown future settings. | §9 now creates a distinct load-only `unsupportedFutureSettings` state: original bytes remain untouched; Provider is `unavailable`/`unsupported-settings`; CSPRNG, `saveData`, Keychain, DNS, socket, and provider access are forbidden; only frozen-M03 explicit preview/source Save may write v2; M05 remains disabled until later reload. AC-04 and the implementation plan require restart and byte-identity tests. |
| M05-V5-B02 | `GO — M05 IMPLEMENTATION AUTHORIZED` conflated independent specification approval with Product Owner authority.  | §1 and the document index now reserve `GO — M05 SPECIFICATION APPROVED` for independent review and require a separate Product Owner `M05 IMPLEMENTATION AUTHORIZED` action before implementation.                                                                                                                                                                                                                      |
| M05-V5-B03 | The packet omitted candidate Git objects, frozen M03 bytes, and complete prior-finding lineage.                  | This ledger supplies the v1–v5 lineage. The v0.6 packet must also contain `docs/M03_SPEC.md`, the exact v1–v5 review requests/verdict evidence, and a Git bundle plus canonical object/tree/blob evidence binding the candidate to the M04 baseline.                                                                                                                                                                   |

## Re-review gate

The next independent reviewer must verify this ledger against the supplied review evidence and Git bundle, then re-review the complete exact v0.6 specification. Only this exact leading verdict approves the specification:

```text
GO — M05 SPECIFICATION APPROVED
```

Any other verdict leaves M05 at NO-GO. Even that verdict does not authorize implementation; the separate Product Owner token required by `docs/M05_SPEC.md` §1 remains mandatory.
