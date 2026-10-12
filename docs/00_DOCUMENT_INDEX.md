# Chat2Vault Document Index

Version: 0.23
Status: M03-M06 complete and merged; M07 design pending
Working name: Chat2Vault

| Document                                                             | Purpose                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `01_PRODUCT_BRIEF.md`                                                | Product problem, users, value proposition, MVP scope, non-goals, acceptance thesis             |
| `02_COMPETITIVE_POSITIONING.md`                                      | Existing alternatives and the differentiation required for an open-source project              |
| `03_ARCHITECTURE.md`                                                 | Local-first architecture, trust boundaries, components, data flow, repository shape            |
| `04_KNOWLEDGE_SCHEMA.md`                                             | Source, candidate, note, provenance, identity, and deduplication contracts                     |
| `05_ROADMAP.md`                                                      | Milestones, gates, dependencies, exit criteria, release path                                   |
| `06_OPEN_SOURCE_RELEASE_STRATEGY.md`                                 | Licensing, distribution, contribution, privacy, compatibility, community release requirements  |
| `07_M01_SPEC.md`                                                     | Milestone 01 specification and verification gate                                               |
| `08_M01_IMPLEMENTATION_NOTES.md`                                     | Implemented parser behavior, branch rule, fingerprints, ZIP security, and limitations          |
| `M02_SPEC.md`                                                        | Reviewed Milestone 02 preview-plugin specification and acceptance contract                     |
| `09_M02_IMPLEMENTATION_NOTES.md`                                     | M02 implementation, privacy/security bounds, build, verification, and runtime smoke procedure  |
| `10_M02_RUNTIME_GATE_REPORT.md`                                      | Historical first runtime-gate execution, blockers, and superseded compatibility evidence       |
| `11_M02_RUNTIME_CLOSURE_REPORT.md`                                   | Final exact-minimum/current-stable closure evidence, AC ledger, and M02 decision               |
| `M03_SPEC.md`                                                        | Independently approved and byte-frozen Milestone 03 implementation authority                   |
| `M03_MACOS_SCOPE_AMENDMENT.md`                                       | Independently approved M03.1 macOS-only platform/runtime/acceptance amendment                  |
| `12_M03_IMPLEMENTATION_NOTES.md`                                     | M03 source registry/writer implementation, boundaries, artifacts, and verification             |
| `13_M03_RUNTIME_GATE_REPORT.md`                                      | Historical pre-commit M03 automated/runtime evidence ledger and readiness decision             |
| `14_M03_CLOSURE_REPORT.md`                                           | Final independent verdict, publication chronology, post-merge verification, and M03 closure    |
| `M04_SPEC.md`                                                        | Independently approved, byte-frozen M04 manual-distillation implementation authority           |
| `15_M04_IMPLEMENTATION_NOTES.md`                                     | M04 candidate implementation, automated evidence, AC ledger, and remaining runtime/review gate |
| `16_M04_RUNTIME_GATE_REPORT.md`                                      | M04 two-row macOS runtime qualification, attributed evidence, and runtime decision             |
| `17_M04_CLOSURE_REPORT.md`                                           | Final independent verdict, publication chronology, post-merge verification, and M04 closure    |
| `M05_SPEC.md`                                                        | Independently approved byte-frozen M05 OpenAI-compatible cloud adapter specification           |
| `M05_SPEC_REVIEW_LEDGER.md`                                          | M05 v1–v7 independent specification findings and exact remediation lineage                     |
| `M05_FILE_KEYCHAIN_AMENDMENT.md`                                     | Approved file-Keychain selection amendment for the M05 native credential boundary              |
| `18_M05_IMPLEMENTATION_NOTES.md`                                     | M05 implementation architecture, inventory, acceptance mapping, evidence, and readiness state  |
| `19_M05_RUNTIME_GATE_REPORT.md`                                      | Exact Obsidian 1.7.4/current-stable two-row M05 macOS runtime qualification                    |
| `20_M06_IMPLEMENTATION_NOTES.md`                                     | M06 architecture, user workflow, inventory, verification, limitations, and readiness state     |
| `21_M06_RUNTIME_GATE_REPORT.md`                                      | Exact Obsidian 1.7.4/current-stable two-row M06 macOS runtime qualification                    |
| `22_M06_CLOSURE_REPORT.md`                                           | Final independent verdict, PR #6 merge chronology, verification, and M06 closure               |
| `superpowers/specs/2026-09-15-m06-knowledge-review-writer-design.md` | Product Owner-approved M06 architecture, UX, write-safety, and verification design             |
| `superpowers/plans/2026-09-15-m06-knowledge-review-writer.md`        | Test-first task plan for implementing and qualifying the approved M06 design                   |
| `../prompts/CODEX_M01_EXECUTION_PROMPT.md`                           | Consolidated Codex implementation prompt for Milestone 01                                      |
| `../AGENTS.md`                                                       | Persistent repository governance for Codex/agents                                              |

## Authority order

For Milestone 01:

1. `AGENTS.md`
2. `docs/07_M01_SPEC.md`
3. `docs/03_ARCHITECTURE.md`
4. `docs/04_KNOWLEDGE_SCHEMA.md`
5. `docs/01_PRODUCT_BRIEF.md`
6. `docs/05_ROADMAP.md`

If documents conflict, follow the higher authority and report the conflict rather than silently choosing.

For Milestone 02, `AGENTS.md` and `M02_SPEC.md` are the active implementation authorities; M01 remains the immutable import-core baseline.

For Milestone 03, the authority order is:

1. `AGENTS.md`
2. byte-frozen `docs/M03_MACOS_SCOPE_AMENDMENT.md` (independently approved SHA-256 `6cd26a318e74e7299376020cbf37608a267bf903d068aacf6debdfdc5bc02dad`) for the explicitly superseded clauses
3. exact byte-frozen `docs/M03_SPEC.md` (SHA-256 `ad8f548e1ca264c569c75030a7f3f0fb6430ceee3838b08e4071c6400b672791`)
4. M02 baseline commit `e7350887f8da44d931a648a0f30a9aac87ffce6f`
5. `docs/03_ARCHITECTURE.md`
6. `docs/04_KNOWLEDGE_SCHEMA.md`
7. `docs/01_PRODUCT_BRIEF.md`
8. `docs/05_ROADMAP.md`
9. `docs/06_OPEN_SOURCE_RELEASE_STRATEGY.md`

`docs/M03_SPEC.md` must remain byte-identical. The amendment is not implementation authority until a genuinely independent review approves its exact bytes and SHA-256 with `GO — M03.1 SPEC AMENDMENT APPROVED`; after approval, its bytes must also remain exact.

For Milestone 04, the authority order is:

1. `AGENTS.md`
2. exact byte-frozen `docs/M04_SPEC.md` (SHA-256 `12a6fdd8346b80e1b015c099b78c2d26c3b736b6d09dfecc55254d648df5193c`)
3. M03 closure baseline commit `994bdeabd5a30c343c0d5a4bcbd872c69e794f2b`
4. `docs/03_ARCHITECTURE.md`
5. `docs/04_KNOWLEDGE_SCHEMA.md`
6. `docs/01_PRODUCT_BRIEF.md`
7. `docs/05_ROADMAP.md`
8. `docs/06_OPEN_SOURCE_RELEASE_STRATEGY.md`

The exact v0.6 specification received `GO — M04 IMPLEMENTATION AUTHORIZED`, and the Product Owner explicitly authorized implementation. `docs/M04_SPEC.md` must remain byte-identical. The two-row runtime evidence and v8 whole-candidate packet received exact `GO — M04 COMMIT READY` on 2026-08-28. The Product Owner then separately authorized publication; pull request #3 merged the candidate into `main` at `09ecdd0c250e44060e597fd2777d52ae03e5fac3`. Deployment, release, and M05 remain outside M04 closure.

For Milestone 05, the authority order is:

1. `AGENTS.md`
2. exact byte-frozen `docs/M05_FILE_KEYCHAIN_AMENDMENT.md` (SHA-256 `0f3f24e43343705ec411730453b2e92acab75c32cb283d5737fc441163b4ba78`) for the explicitly superseded Keychain clauses
3. exact byte-frozen `docs/M05_SPEC.md` v0.8 (SHA-256 `895504880bc369bfbe64d60f60f675064f538458a563b2476fb9cf2e9c4876fd`)
4. M04 closure baseline `2ac8f194adeca6de5cf2c227ca8213013455573e`
5. `docs/03_ARCHITECTURE.md`
6. `docs/04_KNOWLEDGE_SCHEMA.md`
7. `docs/01_PRODUCT_BRIEF.md`
8. `docs/05_ROADMAP.md`
9. `docs/06_OPEN_SOURCE_RELEASE_STRATEGY.md`

The exact M05 specification and file-Keychain amendment were independently approved, and the Product Owner separately supplied `M05 IMPLEMENTATION AUTHORIZED`. The exact implementation candidate passed its two-row runtime gate and independent review, received `GO — M05 COMMIT READY`, and was merged by pull request #5 at `be0f5803ac39120e00e9994a936a8858a1cf3187`. Release, deployment, provider spend, and Community submission remain separate decisions.

For Milestone 06 design, the authority order is:

1. `AGENTS.md`
2. Product Owner-approved `docs/superpowers/specs/2026-09-15-m06-knowledge-review-writer-design.md`
3. M05 closure merge `be0f5803ac39120e00e9994a936a8858a1cf3187`
4. `docs/03_ARCHITECTURE.md`
5. `docs/04_KNOWLEDGE_SCHEMA.md`
6. `docs/01_PRODUCT_BRIEF.md`
7. `docs/05_ROADMAP.md`
8. `docs/06_OPEN_SOURCE_RELEASE_STRATEGY.md`

The approved design was the complete M06 implementation authority. Its approval authorized implementation planning; the Product Owner then separately selected and executed the committed implementation plan. The milestone authority baseline was the M05 merge `be0f5803ac39120e00e9994a936a8858a1cf3187`; approved design commit `81964c7ed7367e59cefe1c946d74c4424dfb144d` and plan commit `f05b0016cde3ca984f024a1ccf1edd93e56d0323` were later M06 documentation baselines. The exact final candidate received a fresh independent `GO — M06 COMMIT READY` review and a separate Product Owner publication instruction. Pull request #6 squash-merged M06 into `main` at `aaf44aaf37c4fd3d458d663a42e3e7bb22459928`; its tree equals the reviewed candidate tree. See `22_M06_CLOSURE_REPORT.md` for the chronology. No tag, deployment, release, Community Plugin submission, provider spend, or M07 work was authorized by M06 closure.
