# Chat2Vault Open-Source Release Strategy

Version: 0.1

## 1. Recommendation

Use the **MIT License** unless a later dependency or business decision requires a different license.

Rationale:

- low friction for contributors and users;
- familiar in the Obsidian ecosystem;
- compatible with the goal of broad adoption.

Final licensing should still receive a dependency-license check before first public release.

## 2. Distribution

Primary:

- Obsidian Community Plugins.

Development/beta:

- GitHub Releases;
- optional manual installation or BRAT-style beta instructions later.

Do not require a separate installer for the normal path.

## 3. Repository public surface

Before public beta, repository should contain:

```text
README.md
LICENSE
CONTRIBUTING.md
SECURITY.md
PRIVACY.md
CHANGELOG.md
CODE_OF_CONDUCT.md
docs/
examples/
```

## 4. Public README requirements

README should answer within the first screen:

- What does this do?
- Why is it different from exporting chats?
- Where does my data go?
- Does it require an API key?
- Does it upload my vault?
- How do I install it?
- What AI providers are supported?
- What is still experimental?

## 5. Privacy promise

Recommended public promise:

> Chat2Vault parses and stores conversation data locally by default. It sends conversation content over the network only when you explicitly invoke a configured remote AI provider. Chat2Vault does not operate a hosted conversation service.

The implementation must match this wording before it is published.

## 6. Telemetry

Default recommendation: **no telemetry in v1**.

Reasons:

- conversation content is sensitive;
- trust is central to product positioning;
- open-source adoption benefits from simple privacy claims.

If anonymous telemetry is ever added:

- explicit opt-in;
- documented event schema;
- no note contents/titles/paths;
- easy disable/delete.

## 7. Contribution architecture

Good community contribution boundaries:

- provider import adapters;
- output templates;
- localization;
- synthetic fixtures;
- provider adapter tests;
- docs;
- accessibility.

Higher-risk changes requiring stronger review:

- archive extraction;
- filesystem writes;
- secret handling;
- network provider code;
- schema migration;
- deduplication/merge.

## 8. Fixture policy

Never use real user exports in the repository.

Create synthetic fixtures covering:

- minimal conversation;
- long conversation;
- Unicode/CJK;
- code blocks;
- links;
- tool messages;
- missing timestamps;
- branching;
- malformed graph;
- duplicated IDs;
- unknown fields;
- path traversal filenames inside ZIP;
- oversized archive metadata.

## 9. Security disclosure

`SECURITY.md` should provide:

- supported versions;
- private vulnerability-reporting route;
- examples of security-sensitive issues;
- response expectations.

## 10. Versioning

Use semantic versioning after public beta.

Before Community Plugin submission:

- maintain `manifest.json`;
- maintain compatibility mapping expected by Obsidian;
- GitHub release tag must match manifest version.

## 11. Branding

"Chat2Vault" is a working name.

Before public launch:

- trademark/name collision search;
- GitHub/package availability check;
- Obsidian community search;
- domain decision only if needed.

Do not delay engineering foundation for final branding.

## 12. Community release gate

Release only when:

- clean-room install verified;
- import tested on synthetic and user-provided private fixtures locally;
- no secrets in repo;
- dependency/license audit passes;
- plugin guidelines reviewed;
- README/privacy docs match observed behavior;
- destructive-write tests pass;
- an independent review produces GO.
