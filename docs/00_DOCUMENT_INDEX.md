# Chat2Vault Document Index

Version: 0.1  
Status: Planning baseline  
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
