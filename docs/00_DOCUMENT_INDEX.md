# Chat2Vault Document Index

Version: 0.6
Status: M03.1 macOS-only amendment approved and implementation/runtime aligned; final independent review pending
Working name: Chat2Vault

| Document                                   | Purpose                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `01_PRODUCT_BRIEF.md`                      | Product problem, users, value proposition, MVP scope, non-goals, acceptance thesis            |
| `02_COMPETITIVE_POSITIONING.md`            | Existing alternatives and the differentiation required for an open-source project             |
| `03_ARCHITECTURE.md`                       | Local-first architecture, trust boundaries, components, data flow, repository shape           |
| `04_KNOWLEDGE_SCHEMA.md`                   | Source, candidate, note, provenance, identity, and deduplication contracts                    |
| `05_ROADMAP.md`                            | Milestones, gates, dependencies, exit criteria, release path                                  |
| `06_OPEN_SOURCE_RELEASE_STRATEGY.md`       | Licensing, distribution, contribution, privacy, compatibility, community release requirements |
| `07_M01_SPEC.md`                           | Milestone 01 specification and verification gate                                              |
| `08_M01_IMPLEMENTATION_NOTES.md`           | Implemented parser behavior, branch rule, fingerprints, ZIP security, and limitations         |
| `M02_SPEC.md`                              | Reviewed Milestone 02 preview-plugin specification and acceptance contract                    |
| `09_M02_IMPLEMENTATION_NOTES.md`           | M02 implementation, privacy/security bounds, build, verification, and runtime smoke procedure |
| `10_M02_RUNTIME_GATE_REPORT.md`            | Historical first runtime-gate execution, blockers, and superseded compatibility evidence      |
| `11_M02_RUNTIME_CLOSURE_REPORT.md`         | Final exact-minimum/current-stable closure evidence, AC ledger, and M02 decision              |
| `M03_SPEC.md`                              | Independently approved and byte-frozen Milestone 03 implementation authority                  |
| `M03_MACOS_SCOPE_AMENDMENT.md`             | Independently approved M03.1 macOS-only platform/runtime/acceptance amendment                 |
| `12_M03_IMPLEMENTATION_NOTES.md`           | M03 source registry/writer implementation, boundaries, artifacts, and verification            |
| `13_M03_RUNTIME_GATE_REPORT.md`            | M03 automated/runtime evidence ledger, gaps, and current readiness decision                   |
| `../prompts/CODEX_M01_EXECUTION_PROMPT.md` | Consolidated Codex implementation prompt for Milestone 01                                     |
| `../AGENTS.md`                             | Persistent repository governance for Codex/agents                                             |

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
