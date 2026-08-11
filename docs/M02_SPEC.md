# Chat2Vault Milestone 02 Specification
## Obsidian Plugin Shell and Import UX

**Document:** `M02_SPEC.md`  
**Version:** 0.5.1  
**Status:** MINIMUM-VERSION AMENDMENT DRAFT FOR INDEPENDENT WHOLE-SPEC REVIEW — IMPLEMENTATION NOT AUTHORIZED  
**Depends on:** M01 baseline commit tagged `chat2vault-m01-complete-v0.1`  
**Active milestone:** M02 only

---

## 1. Decision

**SPECIFICATION DRAFT ONLY.**

This document defines Milestone 02. Its presence does **not** authorize M02 implementation.

Implementation may begin only after:

1. the M01 baseline commit exists;
2. annotated tag `chat2vault-m01-complete-v0.1` resolves to that exact commit;
3. the M01 working tree is clean before this document is added;
4. this specification receives an independent review;
5. the independent review decision is explicitly:
   - `GO — M02 IMPLEMENTATION AUTHORIZED`.

Any other result is a NO-GO for implementation.

---

## 2. Context

Milestone 01 established the deterministic, provider-independent ingestion core for ChatGPT exports:

- canonical source, conversation, message, content, diagnostic, and import contracts;
- supported ChatGPT JSON and ZIP import shapes;
- graph-aware normalization;
- stable SHA-256 identity and deterministic serialization;
- hostile ZIP protections;
- safe diagnostics;
- synthetic fixture and contract/security coverage;
- no runtime network, Obsidian, vault-writing, LLM, or provider dependencies.

M02 adds the first Obsidian-facing product layer.

M02 must prove that a user can safely invoke Chat2Vault inside Obsidian, select a supported ChatGPT export, parse it through the M01 core, inspect conversations and diagnostics, and leave the vault's Markdown/content state unchanged.

M02 is an **import preview milestone**, not a persistence or knowledge-generation milestone.

---

## 3. Objective

Enable a desktop Obsidian user to:

1. install/load the development plugin;
2. invoke `Import ChatGPT export`;
3. explicitly choose a supported ChatGPT JSON/ZIP input;
4. see deterministic import status and diagnostics;
5. browse normalized conversations;
6. inspect a bounded conversation preview;
7. clear the session;
8. close/reopen the plugin without any source-note or knowledge-note creation.

The M02 success condition is:

> Chat2Vault can expose the trusted M01 parser through a safe, comprehensible Obsidian desktop UX without changing user knowledge content or introducing network behavior.

---

## 4. Product Boundary

### 4.1 In scope

M02 includes only:

- Obsidian plugin package/application shell;
- `manifest.json`;
- production/development plugin build;
- plugin lifecycle registration and cleanup;
- plugin settings persistence for non-sensitive M02 preferences;
- one import command;
- optional ribbon entry for the same import workflow;
- dedicated import workspace view or equivalent Obsidian-native surface;
- explicit file chooser and drag/drop ingestion;
- supported single ZIP, single JSON, and multi-JSON selection as permitted by the M01 core;
- M01 core integration;
- import state machine;
- session-local parsed import result;
- conversation list;
- bounded conversation detail/preview;
- safe diagnostics display;
- empty/loading/success/success-with-warnings/partial-success/error states;
- clear/reset session action;
- accessibility and keyboard basics;
- automated UI-adapter/component tests where practical;
- development-vault smoke-test procedure;
- M02 documentation.

### 4.2 Out of scope

M02 must not implement:

- source-note creation;
- Markdown note creation;
- knowledge candidates;
- LLM/API calls;
- API keys or secrets;
- OpenAI/Anthropic/Gemini/Ollama SDKs;
- browser scraping;
- ChatGPT session/cookie/token access;
- clipboard monitoring or clipboard writes;
- web clipping integration;
- other AI-provider importers;
- semantic search;
- embeddings/vector storage;
- deduplication of knowledge;
- automatic tags or links;
- backlinks;
- merge UX;
- vault-wide indexing;
- background imports;
- scheduled imports;
- telemetry;
- hosted services;
- authentication/accounts;
- payment;
- plugin release/community-directory submission;
- mobile support;
- M03+ implementation.

### 4.3 Allowed persistence

The phrase **"no vault writes"** in M02 means no user knowledge/content file may be created, edited, renamed, moved, appended to, or deleted by Chat2Vault.

The only M02 persistence Chat2Vault may initiate is the exact validated settings object defined in §13 through Obsidian's `Plugin.loadData()` / `Plugin.saveData()` mechanism.

M02 must not persist imported/source-derived data through any other mechanism.

Prohibited persistence sinks include:

- `localStorage`;
- `sessionStorage`;
- IndexedDB;
- Cache Storage / service workers;
- browser File System Access persistence;
- Node `fs` / `fs/promises` runtime writes;
- Electron filesystem APIs;
- Obsidian `Vault` / adapter / `FileManager` write operations;
- custom caches;
- hidden files;
- temporary files containing source content;
- serialized custom-view/workspace state containing imported data;
- console/file logs containing imported data;
- clipboard writes;
- any plugin-owned database.

The plugin must not persist:

- imported conversation content;
- conversation titles;
- message content;
- URLs/reference text;
- raw or hashed provider message/conversation/node identifiers;
- source bytes;
- source fingerprints;
- selected external file names or paths;
- raw diagnostics;
- external-file history.

`ItemView` state, if implemented, may serialize only a static schema/version marker. It must never serialize the active import session.

Parsed imports, selected file bytes, canonical results, filters, and current selection live in memory only and are cleared under the lifecycle rules in §6.3 and §8.3.

A previously open Chat2Vault leaf may be restored by Obsidian after restart, but it must restore in `idle` state with no imported content.

## 5. Current Obsidian Compatibility Decisions


### 5.1 Working plugin identity

Working display name:

```json
"name": "Chat2Vault"
```

Plugin ID:

```json
"id": "chat-to-vault"
```

Rationale: current Obsidian manifest rules require plugin IDs to contain only lowercase letters and hyphens. The numeral in the working brand cannot therefore be used in the plugin ID.

The plugin folder used for local development must match `chat-to-vault`.

### 5.2 Desktop-only for M02

M02 manifest:

```json
"isDesktopOnly": true
```

This is technically required for the current M01 implementation because M01 uses Node.js `node:zlib` for archive decompression. It also matches the validated desktop-first roadmap.

M02 does not claim mobile compatibility. Mobile support requires a later explicit architecture and verification decision.

### 5.3 Minimum Obsidian version

`minAppVersion` must be evidence-based and testable.

For each required M02 API/behavior, distinguish:

1. **API/behavior introduction version:** the earliest version in which it was introduced; this may be a Catalyst/early-access release;
2. **earliest public compatible version:** the earliest publicly released Obsidian desktop version that contains every required API/behavior; and
3. **declared plugin minimum:** the `minAppVersion` declared for this public open-source Community Plugin.

The declared plugin minimum must equal the earliest public compatible version unless a separately reviewed product reason explicitly requires a higher version.

The deferred-view behavior required by M02 was introduced in the 1.7.2 Desktop Catalyst release: [Obsidian 1.7.2 Desktop — September 19, 2024](https://obsidian.md/changelog/2024-09-19-desktop-v1.7.2/). The earliest public compatible version is 1.7.4, the public Obsidian 1.7 desktop release on October 16, 2024: [Obsidian 1.7.4 Desktop — October 16, 2024](https://obsidian.md/changelog/2024-10-16-desktop-v1.7.4/). Therefore, the M02 declared plugin minimum is:

```json
"minAppVersion": "1.7.4"
```

Before selecting it, implementation must:

1. inventory every Obsidian API used by M02, including plugin lifecycle, custom view/workspace, settings, commands, ribbon if present, and DOM helpers;
2. identify authoritative Obsidian API/documentation evidence for the earliest app version that supports every required API/behavior;
3. confirm that `1.7.4` remains the earliest public compatible version after applying the selection policy above, or raise `minAppVersion` if later required API/behavior evidence demands it;
4. record the API-to-version evidence table in the M02 implementation notes;
5. smoke-test the production build on:
   - exact Obsidian desktop `1.7.4`; and
   - the then-current stable Obsidian desktop version.

M02 acceptance must not require an exact Catalyst/early-access build. Obsidian desktop `1.7.2` remains historical API/behavior-introduction evidence only; it is not a supported/tested M02 runtime-gate target.

If exact Obsidian desktop `1.7.4` cannot run the complete M02 smoke flow, raise `minAppVersion` to the earliest later public compatible version and repeat verification.

Do not set the minimum to the latest version merely for convenience, and do not claim compatibility with an untested minimum.

### 5.4 External file access disclosure


M02 accesses files outside the vault only after explicit user selection or drag/drop.

The README must clearly disclose:

- Chat2Vault can read user-selected ChatGPT export files outside the vault;
- it does not scan external directories;
- it does not remember the external path in M02;
- M02 performs no network request.

### 5.5 No telemetry

M02 must contain no client-side telemetry, analytics, crash-reporting SDK, tracking pixels, or usage metrics.

---

## 6. Architecture

### 6.1 Layering

Target M02 dependency direction:

```text
apps/obsidian-plugin
        |
        v
packages/core
```

Never:

```text
packages/core
        |
        v
obsidian
```

`packages/core` remains framework-independent and must continue to have no Obsidian dependency.

### 6.2 Suggested plugin package

Target:

```text
apps/
└── obsidian-plugin/
    ├── src/
    │   ├── main.ts
    │   ├── settings.ts
    │   ├── import/
    │   │   ├── import-controller.ts
    │   │   ├── input-adapter.ts
    │   │   └── import-state.ts
    │   ├── views/
    │   │   └── import-view.ts
    │   ├── components/
    │   │   ├── input-panel.ts
    │   │   ├── conversation-list.ts
    │   │   ├── conversation-preview.ts
    │   │   └── diagnostics-panel.ts
    │   └── ui/
    │       └── text.ts
    ├── manifest.json
    ├── styles.css
    ├── package.json
    └── build configuration
```

Exact filenames can differ if the implementation remains modular and traceable.

Do not place the entire product in `main.ts`.

### 6.3 Plugin lifecycle

`onload()` may:

- load and validate the small settings object in §13;
- register the command;
- register the custom view;
- register the optional ribbon action;
- register the settings tab.

`onload()` must not:

- parse files;
- scan the vault;
- read external directories;
- read an external import file;
- initialize network clients;
- create knowledge/content files;
- restore imported session data;
- perform other expensive work.

Use Obsidian cleanup registration APIs (`registerEvent`, `registerDomEvent`, `registerInterval`, or equivalent current official lifecycle helpers) for resources that require automatic cleanup.

M02 supports **one logical import workspace session** at a time.

Command/view behavior must be deferred-view safe:

1. reuse an existing Chat2Vault import leaf when one exists;
2. otherwise create one using the current supported workspace API;
3. reveal/await the leaf before using its concrete view instance;
4. verify the resulting view instance/type before calling Chat2Vault-specific methods;
5. focus the import affordance only after the view is ready.

View close must:

- invalidate the active run token;
- drop selected file references/bytes;
- drop the `ImportResult`;
- drop conversation selection/filter state;
- remove view-owned DOM/listeners;
- leave no imported content in serialized view state.

Plugin unload must additionally:

- invalidate all active runs;
- clear the controller/session;
- detach Chat2Vault import leaves as appropriate;
- leave no Chat2Vault timer/listener/worker/resource active.

If Obsidian restores a previously open Chat2Vault leaf on startup, the view must initialize empty in `idle`; Chat2Vault itself must not programmatically open a new leaf at startup.

### 6.4 Import controller

The UI must not call low-level parser internals directly from multiple components.

A single import-controller/application boundary must:

1. receive explicit selected `File` object(s);
2. enforce the M02 UX input envelope in §7 before loading/parsing;
3. read only `File.name`, `File.size`, `File.type` where useful, and file bytes;
4. never read/store a non-standard absolute filesystem path exposed by Electron/browser extensions;
5. convert bytes to the public input contract expected by M01;
6. invoke the public M01 importer without changing its semantics;
7. translate the complete `ImportResult` into the exhaustive UI-state mapping in §8;
8. own a monotonically increasing run token/generation;
9. discard every late result whose run token is no longer current;
10. keep source bytes and parsed results only in memory;
11. clear all session references on reset/view close/plugin unload.

The controller must publish the `reading` state before reading large file bytes and the `parsing` state before invoking M01.

Because the M01 importer is synchronous, implementation must meet the renderer responsiveness gate in §15. The engineering mechanism is not prescribed, but a solution that violates the blocking threshold is a NO-GO. Moving parser execution off the renderer thread is permitted within M02 provided M01 semantics remain unchanged.

### 6.5 No M01 semantic rewrite


M02 must not duplicate or reinterpret M01 parsing logic.

Specifically, the UI must not independently:

- flatten graph branches;
- sort messages into a new canonical order;
- recalculate fingerprints;
- infer unsupported formats;
- suppress core warnings to create a "cleaner" result.

The M01 result is the import authority.

---

## 7. Import Inputs

### 7.1 Supported UX inputs and hard limits

Expose only formats already supported by M01:

- one `.zip`;
- one `.json`;
- multiple `.json` files as one import set where M01 supports split/numbered exports.

M02 applies an interactive safety envelope **before** M01 invocation.

Hard limits:

| Input form | M02 limit |
|---|---:|
| Single ZIP selected-file size | 64 MiB |
| Single JSON selected-file size | 64 MiB |
| Multi-JSON file count | 16 files |
| Multi-JSON per-file size | 64 MiB |
| Multi-JSON aggregate selected-file size | 128 MiB |

Definitions:

- `1 MiB = 1,048,576 bytes`.
- Limits are evaluated from selected `File.size` before byte loading when possible.
- A value equal to the limit is accepted; a value above it is rejected.
- M01 remains authoritative for archive-entry/decompression/JSON limits after M02's precheck.

These M02 limits intentionally do not enlarge M01's safety envelope. If M01 rejects an input that passes the M02 precheck, M02 displays the safe M01 diagnostic/result state.

Do not advertise any format the M01 parser does not support.

### 7.2 File picker

The import view must provide an explicit file-picker action.

Requirements:

- picker accepts `.zip,.json`;
- multiple selection is allowed because multi-JSON sets are supported;
- one ZIP must be selected alone;
- no filesystem scan;
- no automatic directory traversal;
- no persistent path history;
- picker cancellation leaves the current terminal-state result unchanged;
- accepted selection is validated by §7.1/§7.4 before current results are cleared.

### 7.3 Drag and drop — required

Drag/drop is a required M02 input path, not optional.

It must:

- accept the same file shapes and limits as the picker;
- prevent default browser/Electron navigation/replacement behavior for the drop surface;
- reject unsupported/mixed/over-limit inputs with the same safe validation messages;
- remain a secondary convenience path; keyboard users must be able to complete the full workflow with the picker;
- not inspect folders/directories recursively.

Drag/drop behavior must have automated adapter tests and a runtime smoke case.

### 7.4 Mixed and invalid selections

Deterministic policy:

- one ZIP alone: eligible;
- one JSON: eligible;
- 2–16 JSON files: eligible if aggregate/per-file limits pass;
- more than 16 JSON files: reject;
- any ZIP combined with any other file: reject;
- unsupported extension: reject before M01 invocation;
- directory/folder drop: reject;
- over-limit size/count: reject before loading bytes.

M02 precheck errors are application-layer validation messages. They must not be represented as fake M01 diagnostics.

### 7.5 Replacement, cancellation, stale runs, and repetition

Terminal states are:

- `idle`;
- `success`;
- `success-with-warnings`;
- `partial-success`;
- `error`.

Rules:

1. Opening the picker and cancelling causes no state/result change.
2. Selecting/dropping a new valid import while in a terminal state is an explicit replacement action.
3. Once the new selection passes prechecks and reading begins, the previous result is immediately cleared from UI and controller memory.
4. If the replacement later fails, the UI remains on the new `error` state; the previous result is not resurrected.
5. Import controls are disabled while an active run is `reading` or `parsing`, except `Clear`.
6. Dropping files while active returns a non-destructive `Import already in progress` UI message and does not start a second run.
7. `Clear` during `reading` or `parsing` increments/invalidates the run token and returns the view to `idle` immediately when the execution mechanism permits UI control. Any late completion must be discarded without changing state.
8. If underlying parsing cannot be physically cancelled, stale completion still must be discarded and all references released after it returns.
9. Re-selecting the same file(s) after a terminal state is allowed and starts a new run.
10. M02 never accumulates results across independent import runs.

## 8. Import State Machine

Implement an explicit state model:

```text
idle
reading
parsing
success
success-with-warnings
partial-success
error
```

The native OS/browser file-picker open state is not represented as persistent application state. Picker cancellation therefore requires no state transition.

### 8.1 Exhaustive `ImportResult` → UI-state mapping

M01 diagnostic severity in the current public contract is exactly:

```ts
"warning" | "error"
```

M02 must not invent informational diagnostics or settings for a severity M01 does not expose.

Let:

- `C = conversations.length > 0`;
- `E = diagnostics contains severity error`;
- `W = diagnostics contains severity warning`.

| C | E | W | Terminal state | Conversations displayed | Diagnostics displayed |
|---|---|---|---|---|---|
| no | no | no | `error` | no | fixed local `No supported conversations found` status |
| no | no | yes | `error` | no | all M01 warnings through §12 pagination |
| no | yes | no/yes | `error` | no | all M01 diagnostics through §12 pagination |
| yes | no | no | `success` | yes | none |
| yes | no | yes | `success-with-warnings` | yes | all M01 warnings through §12 pagination |
| yes | yes | no/yes | `partial-success` | **yes** | **all M01 diagnostics** through §12 pagination |

`partial-success` is authoritative for M01's valid multi-JSON behavior where one input can succeed while another fails. Valid conversations returned by M01 remain inspectable.

M02 displays exactly the canonical conversations M01 returns and exactly the safe diagnostic records M01 returns, subject only to the inert rendering/pagination/display bounds in §12.

### 8.2 Busy-state rules


- `reading` begins only after input prechecks pass.
- `parsing` begins immediately before M01 execution.
- Busy UI must not show fabricated percentages.
- A deterministic indeterminate status such as `Reading export…` / `Parsing conversations…` is sufficient.
- Import picker and drop-start behavior are disabled/rejected during an active run as specified in §7.5.
- The busy state must paint before heavy processing; §15 defines the measured threshold.

### 8.3 Reset and lifecycle invalidation

`Clear`, view close, and plugin unload invalidate the current run generation.

After invalidation:

- late file-read/parser completions cannot transition state;
- no previous result may reappear;
- source bytes/results are released when underlying work completes;
- view state is `idle` if the view remains open;
- no session content is serialized.

### 8.4 Application validation errors

Pre-M01 validation failures such as unsupported extension, mixed ZIP+JSON, too many JSON files, or size-limit violations enter `error` without invoking M01.

These messages:

- have fixed application-owned codes/text;
- contain at most a bounded selected display file name;
- never contain absolute external paths;
- never masquerade as M01 diagnostic codes.

## 9. Import Workspace UX


### 9.1 Surface

Recommended M02 default:

> A dedicated Chat2Vault import workspace view opened by the command palette.

Reasons:

- conversation lists can be large;
- preview is easier to inspect in a persistent workspace leaf than a narrow modal;
- the view can remain closed until explicitly invoked;
- no startup auto-open is required.

A modal is acceptable only if independent specification review determines it meets the same usability and scale requirements without compromising maintainability.

### 9.2 Command

Required registered command:

```text
Import ChatGPT export
```

Required command ID:

```text
import-chatgpt-export
```

Do **not** include the plugin name in the registered command name; Obsidian supplies the plugin context/prefix in its command UI.

Command behavior:

1. reuse the existing Chat2Vault import leaf when present, otherwise create one;
2. await/reveal the target leaf;
3. validate the concrete view instance;
4. focus the import affordance;
5. do not automatically start an import or read an external file.

### 9.3 Ribbon


Ribbon icon is optional.

If present:

- it invokes the same import workflow as the command;
- it adds no second behavior path;
- accessible label uses sentence case.

### 9.4 View layout

Minimum logical layout:

```text
+----------------------------------------------------+
| Chat2Vault                                         |
| Import ChatGPT export                              |
+----------------------------------------------------+
| Input / status                                     |
+----------------------+-----------------------------+
| Conversations        | Preview                     |
|                      |                             |
| [search/filter]      | title                       |
| conversation A       | timestamps                  |
| conversation B       | message count               |
| conversation C       | branch/import warnings      |
| ...                  | bounded messages            |
+----------------------+-----------------------------+
| Diagnostics                                        |
+----------------------------------------------------+
```

Responsive adaptation within the desktop app is required for narrow panes.

### 9.5 Empty state

Empty state must explain, concisely:

- accepted input types;
- import is local/offline in M02;
- no notes will be created;
- user chooses the file.

Do not use marketing-heavy copy.

---

## 10. Conversation List

### 10.1 Required fields

Each conversation row displays only:

- bounded display title or fixed fallback;
- message count;
- created/updated date when available;
- warning/error indicator if relevant to that conversation and safely derivable from the M01 result without exposing raw identifiers.

Conversation rows must not display:

- source/message/conversation fingerprints, shortened or otherwise;
- raw provider identifiers;
- graph-node identifiers;
- absolute paths;
- arbitrary metadata.

There is no fingerprint/debug-display mode in M02.

### 10.2 Ordering


Conversation ordering is mandatory, locale-independent, and a total order over the M01 result array.

When M02 receives `ImportResult.conversations`, it records the zero-based **original M01 result ordinal** for each conversation as UI-only session metadata. The ordinal is never written into the canonical object and is never persisted.

Sort by:

1. valid `updatedAt` descending;
2. valid `createdAt` descending;
3. bounded display title using deterministic Unicode code-point comparison, ascending;
4. `contentFingerprint` ascending;
5. original M01 result ordinal ascending as the final unique tie-breaker.

Rules:

- a valid timestamp sorts before a missing/invalid timestamp;
- two missing/invalid timestamps fall through to the next key;
- do not use locale-sensitive `localeCompare()` for the stable ordering contract;
- `contentFingerprint` is not assumed unique;
- the M01 result ordinal closes all remaining collisions deterministically;
- ordering changes only display order, never canonical message/graph semantics.

Automated tests must include at least two fully colliding rows whose timestamps, bounded title, and `contentFingerprint` are identical and prove the ordinal decides the final order.

### 10.3 Search/filter — required

Title filtering is required.

Scope:

- filter only the bounded conversation display title;
- never filter message bodies, identifiers, fingerprints, or arbitrary metadata.

Query contract:

1. limit query to 240 UTF-16 code units;
2. trim leading/trailing ECMAScript whitespace;
3. normalize query and display title with Unicode `NFKC`;
4. apply JavaScript `toLowerCase()` to both normalized strings;
5. match by substring inclusion;
6. empty normalized query matches every conversation.

Result semantics:

- filtering never mutates canonical conversations;
- matches retain the total order in §10.2;
- query text is session-only and never persisted;
- changing query resets list paging/windowing to the first page;
- preserve selection if the selected conversation still matches;
- otherwise clear selection/preview and move focus predictably to the results surface;
- `Clear` resets query to empty;
- a new accepted import resets query to empty;
- zero matches shows fixed `No matching conversations`, not an import error.

Automated tests cover empty query, case folding, NFKC equivalence, whitespace trimming, length bound, zero matches, selection preserve/clear, paging reset, and deterministic filtered ordering.

### 10.4 Large lists


The conversation list must be bounded in the DOM.

Requirements:

- render at most **200 conversation rows** at one time;
- use pagination/incremental windowing in deterministic chunks of 200;
- never render message bodies in list rows;
- filter operates only on the bounded display title;
- filtering a synthetic set of **10,000 canonical conversations** must satisfy the §15 responsiveness threshold;
- no result count is truncated semantically: all conversations remain reachable through paging/filtering.

Virtualization is allowed but not required if these behavioral limits are met.

## 11. Conversation Preview


### 11.1 Purpose

Preview confirms the parser result to the user.

It is not an editor and not a source-note renderer.

### 11.2 Display metadata whitelist

M02 may display only:

- bounded conversation display title;
- canonical provider label (`chatgpt` rendered as a product-neutral/user-facing label as appropriate);
- valid created/updated timestamps;
- canonical message count;
- canonical message role;
- canonical `text`, `code`, `reference`, and `unsupported` content blocks under the rendering bounds below;
- M01 diagnostic:
  - severity;
  - code;
  - safe message;
- branch/graph ambiguity through those safe M01 diagnostic fields and a fixed non-sensitive status label;
- selected source **file name only** in the input panel, bounded as below.

M02 must never display:

- `sourceIdentifier`;
- `conversationIdentifier`;
- `messageIdentifier`;
- any other current or future typed diagnostic identifier field;
- raw `providerConversationId`;
- raw `providerMessageId`;
- raw `parentMessageId`;
- raw graph-node IDs;
- arbitrary `metadata` object content;
- source/message/conversation fingerprints;
- shortened fingerprints;
- absolute external paths.

Typed diagnostic identifier values remain available **internally only** when needed for:

- in-memory correlation;
- `ForbiddenPersistenceMarkerSet` generation;
- security/privacy verification.

Internal availability creates no UI/debug-display exception and does not permit persistence.

### 11.3 Strict inert rendering contract


Every imported/provider-controlled string must enter the DOM only through:

- `textContent`;
- `innerText`; or
- an Obsidian/DOM helper whose documented behavior is equivalent to creating a text node.

For imported data, prohibit:

- `innerHTML`;
- `outerHTML`;
- `insertAdjacentHTML`;
- `DOMParser`;
- `Range.createContextualFragment`;
- template/HTML fragment parsing;
- `srcdoc`;
- `eval`;
- `Function`;
- imported-input use of `MarkdownRenderer`;
- assigning imported content to event-handler attributes/properties;
- assigning imported URLs to `href`, `src`, `srcset`, CSS URLs, iframe/media/image sources, or navigation APIs.

Canonical `reference.url` values are displayed as **plain inert text only** in M02. They are not clickable.

`code` blocks use `<pre><code>` (or equivalent) with text-node insertion only. M02 does not require syntax highlighting.

Before display, replace C0/C1 control characters that are not ordinary tab/newline/carriage-return with `U+FFFD` or an equivalent visible-safe replacement. Do not remove semantic source content from the canonical model; this transformation is display-only.

### 11.4 Display bounds

Bounds are measured in JavaScript UTF-16 code units for deterministic implementation.

| Field | Maximum rendered imported text |
|---|---:|
| Conversation/source file display title | 240 |
| Diagnostic safe message | 2,000 |
| Reference URL text | 2,048 |
| Unsupported-block description | 1,024 |
| Any one text/code/reference-label block | 16,384 |
| Total imported content text mounted in the active preview page | 131,072 |

When a field exceeds its bound:

- render the bounded prefix;
- append a fixed marker such as `… [preview truncated]`;
- do not place the hidden remainder in DOM attributes, tooltips, ARIA labels, hidden elements, or dataset properties.

M02 is a verification preview, not a full transcript reader.

### 11.5 Message pagination

Exact settings/behavior:

- default messages per page: **25**;
- user choices: **10, 25, 50** only;
- at most 50 message containers are mounted for the active conversation;
- `Previous` / `Next` page controls navigate deterministically;
- page number is session-only state;
- changing conversation resets to page 1;
- total rendered imported-text budget in §11.4 applies even when the selected page contains fewer than the configured message count.

If the page text budget is exhausted, subsequent content on that page is represented by a fixed `Preview text limit reached` marker. The user can navigate to another page, but M02 never renders beyond the per-page budget.

### 11.6 Branch ambiguity

If M01 records branch ambiguity or graph warnings, M02 displays the corresponding safe M01 diagnostics/status.

M02 does not add branch selection and does not independently inspect/render raw graph metadata.

## 12. Diagnostics UX

Diagnostics are untrusted-volume data even though each M01 diagnostic message is privacy-safe. M02 must bound the mounted diagnostics DOM exactly as it bounds conversation/message previews.

### 12.1 Authority and severity

Use only typed diagnostics returned by M01.

Current M01 severities:

- `warning`;
- `error`.

M02 must not create a third informational severity.

Application-layer input/precheck errors remain visually and structurally separate from M01 diagnostics.

### 12.2 Deterministic diagnostics pagination

Diagnostics remain in the exact order returned by M01.

Pagination is fixed:

- **25 diagnostics per page**;
- at most **25 diagnostic rows mounted** at one time;
- page 1 opens by default when diagnostics exist;
- `Previous` / `Next` controls navigate pages;
- changing import result resets diagnostics to page 1;
- every M01 diagnostic remains reachable through page navigation;
- do not duplicate the full diagnostics collection in per-row DOM attributes, hidden elements, ARIA strings, tooltips, or serialized view state.

The UI may display:

```text
Diagnostics 26–50 of 12,345
```

using numeric counts only.

### 12.3 Per-row and aggregate display bounds

The diagnostics UI renders exactly these fields:

| Diagnostic field | Maximum rendered text |
|---|---:|
| Severity | fixed enum |
| Code | 128 UTF-16 code units |
| Safe message | 2,000 UTF-16 code units |

Typed diagnostic identifier fields are not rendered.

This prohibition includes:

- `sourceIdentifier`;
- `conversationIdentifier`;
- `messageIdentifier`;
- any additional current or future identifier-valued field in the typed M01 diagnostic contract.

Those values may remain in memory only as permitted by §11.2 and must still participate in `ForbiddenPersistenceMarkerSet` verification under §14.10.

If a rendered field exceeds its bound:

- render the bounded prefix;
- append fixed `… [diagnostic truncated]`;
- do not place the hidden remainder elsewhere in the DOM.

Maximum aggregate imported/provider-derived diagnostic text mounted in the diagnostics panel is:

**65,536 UTF-16 code units per diagnostics page.**

If the aggregate budget would be exceeded:

- render rows in order;
- truncate the last visible rendered field as needed;
- preserve the diagnostic row/index;
- keep later diagnostics reachable on later pages;
- do not increase page size.

### 12.4 Strict inert rendering


All diagnostic strings use the same text-node-only rule as §11.3.

Do not render diagnostic content using Markdown/HTML parsers, active links, URL-bearing DOM attributes, or unsafe HTML sinks.

### 12.5 No diagnostic-derived persistence/logging/clipboard

M02 must not:

- persist diagnostics;
- serialize diagnostics into custom-view/workspace state;
- log diagnostics to console/file;
- write diagnostics to clipboard.

`Copy diagnostics` remains out of scope.

### 12.6 Diagnostic amplification performance case

The performance/test suite must include:

1. a synthetic `ImportResult` containing **50,000 safe diagnostics** to verify UI windowing independent of parser generation;
2. a valid generated import under the §7 M02 input envelope designed to produce the highest practical number of real M01 diagnostics, with the resulting diagnostic count recorded.

For the 50,000-diagnostic synthetic result:

- initial diagnostics page (≤25 rows) renders within **250 ms** after result handoff;
- page navigation completes/repaints within **100 ms p95** over 20 page changes;
- mounted diagnostic rows never exceed 25;
- mounted diagnostic imported text never exceeds 65,536 code units;
- every diagnostic index remains reachable.

These thresholds are part of AC-20 and AC-27.

## 13. Settings

M02 has one exact user setting.

```ts
interface Chat2VaultSettingsV1 {
  schemaVersion: 1;
  previewMessagesPerPage: 10 | 25 | 50;
}
```

Defaults:

```ts
{
  schemaVersion: 1,
  previewMessagesPerPage: 25
}
```

Validation rules:

- missing/invalid object → defaults;
- unknown keys → ignored and not re-persisted;
- invalid `schemaVersion` → migrate only if an approved migration exists; otherwise use M02 defaults;
- invalid `previewMessagesPerPage` → `25`.

Persist only this normalized object through `Plugin.saveData()`.

M02 settings must not contain:

- diagnostic-severity/display preferences not supported by the current M01 contract;
- paths;
- file names;
- conversation titles/content;
- IDs/fingerprints;
- source history;
- API/provider fields;
- output-folder fields;
- prompt/AI settings;
- developer-debug payloads.

The settings tab exposes exactly one control:

1. `Messages per preview page` — choices `10`, `25`, `50`.

No future-feature placeholders are permitted.

## 14. Security and Privacy Requirements

### SEC-01 — Explicit external input

External data is read only after direct HTML file-picker or drag/drop action.

Production M02 code must not scan external directories, reopen a file using an absolute path, watch common folders, read arbitrary Node filesystem paths, use browser File System Access pickers/handles, or use OPFS. Supported browser-side input is limited to ordinary user-selected/dropped `File` objects.

### SEC-02 — No network

M02 runtime must not initiate network communication.

Prohibited surfaces include:

- browser/worker `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, remote `Worker`/`SharedWorker`, remote navigation/assets;
- Obsidian `requestUrl` or equivalent network helpers;
- Node `node:http`/`http`, `node:https`/`https`, `node:http2`/`http2`, `node:net`/`net`, `node:tls`/`tls`, `node:dgram`/`dgram`, `node:dns`/`dns`, including `http2.connect()`;
- Electron `net`, `shell.openExternal`, `webContents` navigation/load methods, or equivalent network/navigation APIs;
- remote dynamic imports, workers, images, media, fonts, styles, or other assets.

Imported URLs remain inert text and never become active URL-bearing properties.

### SEC-03 — No telemetry

No analytics, crash-reporting, tracking, usage metrics, or client telemetry.

### SEC-04 — Imported content is hostile data

Enforce §11.3 and §12.4. Imported/source-derived strings cannot act as HTML/Markdown application markup, script, command, event handler, CSS, navigation target, filesystem path, configuration, or instruction to Chat2Vault.

### SEC-05 — Closed persistence model

Only the exact §13 settings object may persist through `Plugin.saveData()`.

Production M02 code must not write through:

- browser `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, service workers;
- File System Access API or OPFS, including `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`, `navigator.storage.getDirectory`, `FileSystemFileHandle.createWritable`, `FileSystemFileHandle.createSyncAccessHandle`, writable sync-access methods, create/remove-capable directory-handle methods;
- Node `fs`/`fs/promises` writes, Electron filesystem/shell write paths, child-process persistence helpers;
- custom caches/databases or temporary files;
- user-content/vault mutation APIs;
- serialized custom-view/workspace state containing source-derived values;
- console/file logs containing source-derived values;
- clipboard writes.

### SEC-06 — No vault/content mutation

M02 runtime must not use `app.vault` to read/write user note content, `Vault` content-write methods, vault-adapter mutation methods, `FileManager` mutation methods, editor mutation APIs, or direct Node filesystem access to vault content.

`app.vault.configDir` may be read only to derive the current configuration-directory name for verification/path contracts. It does not authorize direct configuration-file mutation.

### SEC-07 — Safe logging

Production plugin source must not emit imported/source-derived values through console/file logging. User-facing errors come only from fixed application text or M01 safe diagnostics.

### SEC-08 — Dependency minimization

Expected runtime dependencies are Obsidian-provided APIs, bundled `packages/core`, and only specifically justified local worker support needed for §15. No LLM/provider/network/telemetry/UI-framework SDK or native addon may introduce an unreviewed filesystem/network surface.

### SEC-09 — Static enforcement

Automated checks inspect source, dependency graph/lockfile, worker entrypoints, every production bundle, and dynamic import/require expressions.

At minimum detect/prohibit production use of:

- Node `fs`, `fs/promises`, `http`, `https`, `http2`, `net`, `tls`, `dgram`, `dns`, `child_process`;
- Electron network/shell/navigation APIs;
- Obsidian `requestUrl`;
- browser/worker network APIs in SEC-02;
- browser persistence/File System Access/OPFS APIs in SEC-05;
- `app.vault` content reads/writes except the narrowly permitted `configDir` read;
- `FileManager` and adapter mutation methods;
- dynamic remote loaders and remote worker URLs;
- `eval` / `Function`;
- unsafe DOM sinks;
- clipboard writes;
- telemetry and provider/LLM SDKs.

Any local worker is bundled locally, has a constant non-user-derived code location, and is included in all static/network/persistence checks. Test harness instrumentation may reference prohibited APIs only from isolated tooling proven absent from production bundles. Raw grep alone is insufficient; combine AST/lint, dependency, and final-bundle inspection.

### SEC-10 — ForbiddenPersistenceMarkerSet

Each privacy fixture generates a marker set from the **actual M01 parse**.

Include:

- selected source file name;
- conversation title;
- unique message and reference-URL sentinels;
- synthetic raw provider conversation/message/node identifiers;
- actual M01 source, conversation, and message fingerprints;
- every identifier-valued field defined by the current typed `ImportDiagnostic` contract and every actual value emitted by M01 for the fixture, including `conversationIdentifier`, `messageIdentifier`, and any other current diagnostic identifier field;
- SHA-256 of every exact marker string above;
- normalized filename/title forms actually rendered.

Do not assume a diagnostic identifier equals `SHA256(raw ID)`; use the exact structured/fingerprinted value returned by M01.

Search every marker in every persistence/log/storage location required by §14 and §19. No marker may persist outside transient in-memory test observation.

### SEC-11 — Configuration-directory derivation

Never hardcode `.obsidian`.

Verification records:

```ts
const configDir = app.vault.configDir;
```

The disposable vault root is supplied by the test harness. Paths derive as:

```text
<configRoot> = <vaultRoot>/<configDir>
<pluginRoot> = <configRoot>/plugins/chat-to-vault
```

Production code must not gain filesystem access merely to support verification.

### SEC-12 — Objective attribution model

Use two evidence layers.

**Layer A — direct API tripwire attribution.** Before enabling Chat2Vault, instrumentation wraps every prohibited reachable API. Each invocation records timestamp, surface, safe metadata, call stack where available, renderer/worker identity, and bundle/module identity. A **Direct Chat2Vault Violation** exists when stack/module/worker identity resolves to `<pluginRoot>/main.js`, a Chat2Vault production worker, or a Chat2Vault source-mapped production module. Any such event fails immediately.

**Layer B — residual process-event control.** Run three instrumented baseline control windows with the same disposable vault/profile/build, Chat2Vault disabled, other community plugins disabled, and no user navigation/import action. Build a documented allowlist only from consistent clearly Obsidian-owned path/destination patterns. Then run the Chat2Vault window identically.

Any process filesystem-write or egress event that is not explicitly allowed by this spec, is not in the documented baseline allowlist, and is not explained by a captured non-Chat2Vault stack/event fails the evidence gate conservatively. The tester need not prove causality; unexplained new activity means NO-GO.

### SEC-13 — Filesystem/FSA/OPFS tripwires and mandatory process trace

Runtime verification begins before plugin enable and ends after disable/unload.

Fail-on-call instrumentation covers main renderer and any Chat2Vault worker for available writable browser filesystem surfaces, including `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`, `navigator.storage.getDirectory`, `FileSystemFileHandle.prototype.createWritable`, `createSyncAccessHandle`, writable `FileSystemSyncAccessHandle` methods, and create/remove-capable `FileSystemDirectoryHandle` operations.

It also covers Node/Electron write surfaces including `fs.writeFile*`, `appendFile*`, write-capable `open*`, `createWriteStream`, `rename*`, `copyFile*`, `mkdir*`, `rm*`, `unlink*`, `truncate*`, `fsPromises` equivalents, and prohibited child-process launch surfaces.

OS/process-level filesystem-write tracing with process/PID and target-path evidence is **mandatory** for the three baseline windows and Chat2Vault test window. Record tracing tool/configuration, process IDs, observation times, and non-baseline writes.

The only permitted Chat2Vault M02 persistent mutation is `<pluginRoot>/data.json` containing exactly §13 settings. No other direct or unexplained residual write may pass.

### SEC-14 — Clipboard tripwire

Before plugin enable, fail on `navigator.clipboard.write`, `writeText`, `document.execCommand("copy"|"cut")`, and Electron clipboard writes where reachable. Any Direct Chat2Vault clipboard call fails.

### SEC-15 — Network tripwires and mandatory process egress trace

DevTools Network is supplementary only.

Before plugin enable, instrument:

- browser/worker fetch, XHR, WebSocket, EventSource, sendBeacon, remote Worker/SharedWorker, navigation/resource assignment;
- Obsidian `requestUrl`/equivalents;
- Node `http.request/get`, `https.request/get`, `http2.connect`, `net.connect/createConnection`, `tls.connect`, `dgram.createSocket`, DNS lookup/resolve family;
- Electron `net` request/fetch, `shell.openExternal`, and reachable navigation/load methods.

Every call records SEC-12 attribution evidence.

OS/process-level egress observation is **mandatory** for all baseline and Chat2Vault windows. Record tool/method, process IDs, destination/protocol where observable, baseline allowlist, and all non-baseline connections. Any Direct Chat2Vault network call or unexplained new non-baseline egress fails.

Electron/DevTools Node-network visibility may be used only as supplementary evidence and never substitutes for `node:http2`/socket/DNS tripwires or process tracing.

### SEC-16 — Browser/workspace/log evidence

Runtime verification proves:

- `data.json` is exact §13 schema;
- no marker appears in workspace/view state, Local Storage, Session Storage, IndexedDB, Cache Storage, inspectable OPFS, or production Chat2Vault logs;
- FSA/OPFS tripwires recorded zero Direct Chat2Vault write-capable calls;
- restored leaves reopen in `idle`.

### SEC-17 — Lifecycle cleanup

Reset, view close, disable/unload, failed import, and stale completion are privacy boundaries. Session results must not reappear after invalidation.

### SEC-18 — External-file disclosure

README discloses user-selected external ZIP/JSON access, no directory scanning/path history, no FSA/OPFS use, no network, memory-only session data, and no source/knowledge-note writes.

## 15. Performance Requirements



Performance is a release gate for M02 because the M01 parser is synchronous.

### 15.1 Reference measurement environment

M02 implementation notes must record:

- Mac hardware model/CPU;
- RAM;
- macOS version;
- Obsidian version;
- Electron/Chromium/Node versions;
- production plugin bundle mode.

Performance acceptance is measured on that declared development reference machine in a dedicated vault with other community plugins disabled unless the test specifically requires otherwise.

### 15.2 Startup budget

Across 20 plugin enable/reload measurements:

- median Chat2Vault `onload()` duration ≤ **50 ms**;
- p95 ≤ **100 ms**;
- no external import file read/parse is attributable to startup.

Record raw measurements.

If the budget fails, M02 is NO-GO until startup work is reduced or the specification is re-reviewed with a justified threshold change.

### 15.3 Busy-state paint

After a valid selected/drop input passes prechecks:

- `reading` status must become visibly painted within **100 ms** before heavy processing begins.

Do not simulate progress percentages.

### 15.4 Renderer blocking threshold

For every representative near-limit import in §15.6:

- no Chat2Vault-attributable renderer main-thread task may exceed **100 ms**;
- no Chat2Vault-attributable contiguous unresponsive interval may exceed **250 ms**.

Measure with Chromium/Electron performance tooling and preserve the trace or summarized evidence in the implementation report.

If the current synchronous integration fails this threshold, M02 implementation must remediate **before approval** by moving heavy work off the renderer thread or by another architecture that preserves M01 semantics. Reducing the specified M02 input limits requires a spec amendment and independent re-review; implementation may not silently lower them.

### 15.5 List, preview, and diagnostics responsiveness

Using a synthetic canonical result with **10,000 conversations**:

- initial list surface (≤200 mounted rows) renders within **250 ms** after result handoff;
- title filter update completes/repaints within **100 ms p95** over 20 representative searches;
- mounted conversation rows remain ≤200.

Preview rendering obeys §11 bounds.

Using a synthetic result with **50,000 M01-safe diagnostics**:

- initial diagnostics page renders within **250 ms**;
- diagnostics page navigation completes/repaints within **100 ms p95** over 20 page changes;
- mounted diagnostic rows remain ≤25;
- mounted diagnostic imported text remains ≤65,536 UTF-16 code units;
- every diagnostic remains reachable.

### 15.6 Representative performance fixtures

Do not commit huge binary fixtures.

Generate deterministic runtime/test artifacts in ignored temporary storage or memory for:

1. single JSON at ≥95% of the 64 MiB M02 limit;
2. single ZIP at ≥90% of the selected-file limit with valid M01-supported archive/JSON content;
3. 16-file multi-JSON set at ≥90% of the 128 MiB aggregate M02 limit;
4. 10,000-conversation canonical UI result;
5. conversation containing oversized title/content/reference strings to exercise render bounds;
6. synthetic `ImportResult` with 50,000 diagnostics;
7. valid M01-path diagnostic-amplification input under the M02 envelope designed to produce the highest practical diagnostic count.

For item 7:

- record fixture generator parameters;
- record source hash;
- record actual M01 diagnostic count;
- run it through the complete M02 UI path;
- it must satisfy the same main-thread/unresponsive thresholds in §15.4 and the diagnostic DOM bounds in §12/§15.5.

Record generator parameters/hashes so measurements are reproducible.

### 15.7 Memory/session release


After `Clear`, view close, and plugin unload:

- controller/session references to source `File` objects, loaded bytes, and `ImportResult` are removed;
- no import history is retained;
- repeated import/reset cycles must not show monotonically retained Chat2Vault session objects in a reasonable heap-snapshot comparison.

A strict byte-perfect garbage-collection assertion is not required, but obvious retained Chat2Vault session graphs are a NO-GO.

## 16. Accessibility and Obsidian UX

### UX-01 — Sentence case and native styling

Use sentence case.

Prefer Obsidian/native controls and CSS variables. Styles must be scoped to Chat2Vault and work in default light/dark themes.

### UX-02 — Keyboard-only completion

A user must be able to complete:

```text
open command palette
→ open Chat2Vault import view
→ activate file picker
→ select a conversation row
→ page preview
→ inspect/expand diagnostics
→ clear session
```

without requiring a mouse.

Conversation rows must use native interactive semantics (for example button/listbox-option patterns) rather than click-only generic `<div>` elements.

### UX-03 — Focus contract

Required focus destinations:

- command opens/focuses the import button/drop surface;
- successful/partial import moves focus to a results heading or first conversation control without surprising scroll loss;
- error moves focus to an error summary with a usable accessible label;
- selecting a conversation makes preview content discoverable while preserving predictable keyboard order;
- `Clear` returns focus to the import control.

Focus behavior must be verified in the runtime gate.

### UX-04 — Accessible status/errors

- busy/success status uses an appropriate polite live region (`role="status"` or equivalent);
- import error uses an assertive error/alert pattern appropriate to current Obsidian/HTML accessibility guidance;
- controls have accessible names;
- warning/error icons are not the sole carrier of meaning;
- truncation markers are textual.

### UX-05 — Drag/drop

Drag/drop is not the only import method.

The drop surface:

- has equivalent picker action;
- prevents default navigation;
- provides textual instructions;
- provides visible keyboard focus for the picker/control.

### UX-06 — Theme compatibility

Verify default:

- light theme;
- dark theme.

No fixed foreground/background color may make core text/control states unreadable.

### UX-07 — Objective narrow-pane contract

At a workspace-leaf content width of **360 CSS pixels**:

- no horizontal page-level overflow is introduced by Chat2Vault;
- import/clear/navigation controls remain reachable;
- conversation list and preview may stack vertically;
- no control overlaps another;
- diagnostic text wraps;
- long imported strings cannot force horizontal expansion;
- primary workflow remains keyboard operable.

Also verify a typical wider desktop leaf.

## 17. Build and Packaging Requirements


M02 development build must produce the artifacts Obsidian needs to load the plugin:

- `main.js`;
- `manifest.json`;
- `styles.css` if used.

Do not create a public GitHub release in M02.

The build must keep `obsidian` external as appropriate for the plugin environment and must not bundle Node/test-only dependencies unnecessarily.

Production build should be minified or otherwise release-appropriate even though public release is not yet authorized.

The production bundle is part of the security review surface in §14.9. M02 must not require undisclosed runtime artifacts or remote code.

---

## 18. Testing Strategy

### 18.1 Core regression

All M01 tests must continue to pass. M02 must not change canonical parser semantics without a separately justified corrective review.

### 18.2 Plugin unit/contract tests

Cover at least:

1. exact one-field settings defaults;
2. settings validation/unknown-key stripping;
3. settings persistence contains only §13 schema;
4. no informational-diagnostics setting/branch exists;
5. file precheck ZIP boundary;
6. single JSON boundary;
7. multi-JSON 16-file/128-MiB boundary;
8. 17-file rejection;
9. mixed ZIP+JSON rejection;
10. unsupported extension/folder-drop rejection;
11. picker cancellation preserves terminal result;
12. accepted replacement clears previous result;
13. replacement failure does not resurrect previous result;
14. active-run second import rejection;
15. reset invalidates run token;
16. stale completion cannot transition state;
17. exhaustive §8 result mapping;
18. deterministic ordering including fully colliding rows resolved by M01 result ordinal;
19. missing/invalid timestamps;
20. list mount/page bound;
21. 10/25/50 preview behavior;
22. per-field preview bounds;
23. total preview text budget;
24. inert HTML/script/SVG/Markdown/URL rendering;
25. control-character display transform;
26. raw provider IDs/graph metadata/fingerprints not displayed;
27. branch-warning display;
28. diagnostic code/message bounds;
29. negative DOM test proving `sourceIdentifier`, `conversationIdentifier`, `messageIdentifier`, and every typed diagnostic identifier field are absent from rendered DOM;
30. exactly 25 diagnostics mounted/page;
31. 65,536 diagnostic aggregate-text bound;
32. 50,000-diagnostic reachability/page behavior;
33. no clipboard write path;
34. reset/view-close/unload cleanup;
35. custom view state contains no imported content;
36. drag/drop navigation prevention and validation parity;
37. command/view single-session reuse;
38. deferred-view-safe instance validation where testable.

### 18.3 Static scope/security tests

Automated checks prove at least:

- `packages/core` does not import `obsidian`;
- no LLM/provider or telemetry SDK exists;
- every production bundle/worker is local and reviewed;
- `node:http2` / `http2` imports and `http2.connect` are absent from production M02;
- browser File System Access/OPFS write-capable APIs are absent, including `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`, and `navigator.storage.getDirectory`;
- prohibited browser/Obsidian/Node/Electron network APIs are absent;
- prohibited Node/Electron filesystem APIs and child-process code are absent;
- vault/content mutation APIs are absent;
- unsafe DOM sinks and clipboard writes are absent;
- no `eval` / executable dynamic-content path exists;
- no hardcoded `.obsidian` path exists in normative runtime/verification logic; configuration paths derive from `Vault.configDir`;
- dependency/lockfile review contains no unexplained runtime package;
- no real user exports/vault content are committed.

Isolated test harness code may reference prohibited APIs solely to install tripwires and must be proven absent from production bundles.

Use AST/lint/dependency/bundle checks rather than raw grep alone.

### 18.4 Performance tests


Automated or runtime-measured evidence must cover:

- startup measurement;
- 10,000-conversation list/filter behavior;
- preview rendering bounds;
- 50,000-diagnostic pagination/rendering bounds;
- valid M01-path diagnostic-amplification case;
- generated near-limit input fixtures;
- renderer blocking thresholds with captured evidence.

Hardware-sensitive performance gates may run outside CI but results must be recorded.

### 18.5 Build verification


Required commands:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` must include M01 regression, M02 unit/contract checks, formatting, lint, typecheck, and production build.

Runtime Obsidian/performance evidence is an additional gate and must not be falsely reported as covered by `pnpm verify`.

## 19. Manual / Runtime Verification Gate

Obsidian runtime behavior must be verified in a disposable development vault, never the user's production vault.

Record:

- development-vault path;
- Obsidian version;
- whether it is the declared minimum or current stable;
- plugin production bundle hash;
- reference-machine details from §15.1.

### 19.1 Pre-test snapshots, controls, and tripwires

Before enabling Chat2Vault:

1. obtain and record `configDir = app.vault.configDir`;
2. record disposable `vaultRoot` from the test harness;
3. derive `<configRoot>` and `<pluginRoot>` per SEC-11;
4. hash every vault file outside `<configRoot>`;
5. create recursive path/size/SHA-256 manifests of `<pluginRoot>` and `<configRoot>`;
6. snapshot relevant workspace-state files;
7. record Local Storage, Session Storage, IndexedDB, Cache Storage, and inspectable OPFS state;
8. clear/record DevTools Network and Console;
9. install filesystem/FSA/OPFS tripwires before plugin enable;
10. install clipboard tripwires;
11. install network tripwires including `node:http2`;
12. run three plugin-disabled attribution baseline control windows and record their allowlists;
13. start mandatory OS/process filesystem tracing for the Chat2Vault window;
14. start mandatory process egress tracing;
15. prepare unique filename/title/message/URL/provider-ID/node-ID fixture sentinels;
16. parse the fixture through the real M01 public API;
17. capture actual canonical fingerprints and every actual emitted diagnostic identifier field/value;
18. compute the complete `ForbiddenPersistenceMarkerSet` including derivatives.

All instrumentation is test-only and excluded from production bundles.

### 19.2 Core smoke flow



1. load/enable the built plugin;
2. verify Chat2Vault itself does not programmatically open/import at startup;
3. verify startup budget;
4. run registered command `Import ChatGPT export`;
5. verify the leaf is revealed/focused and view instance works;
6. import valid synthetic ZIP via picker;
7. inspect at least two conversations/pages;
8. verify warning and unsupported-content display;
9. verify branch-warning display;
10. `Clear`;
11. import valid single JSON;
12. import valid multi-JSON with mixed success/error and verify `partial-success`;
13. import malformed/unsupported/over-limit input and verify safe error;
14. exercise required drag/drop, including default-navigation prevention;
15. start an import then clear/invalidate it; verify late result does not reappear;
16. close the view and reopen it; verify `idle`/no source data;
17. disable/re-enable plugin; verify no source data restored.

### 19.3 Privacy/network/write evidence

After smoke flow and disable/unload:

#### Vault/content

- recompute hashes outside `<configRoot>`; path/hash manifest must match.

#### Plugin/configuration directories

- recompute `<pluginRoot>` and complete `<configRoot>` manifests;
- do not assume the config directory is named `.obsidian`;
- only `data.json` may be a Chat2Vault M02 persistent mutation and it must equal §13 schema;
- apply SEC-12 attribution/control rules to every changed path;
- no marker may appear in changed/relevant configuration files.

#### Browser File System Access / OPFS

- all main-renderer/worker FSA/OPFS write-capable tripwires report zero Direct Chat2Vault violations;
- compare inspectable OPFS/browser-storage state before/after;
- search marker set through inspectable entries;
- mandatory OS/process filesystem trace remains the backstop for profile/external writes not enumerable through web APIs.

#### External/temp/profile filesystem

- review mandatory write traces from all three baseline windows and the Chat2Vault window;
- no Direct Chat2Vault write outside allowed `data.json` may occur;
- no unexplained non-baseline write may pass;
- inspect relevant written paths for marker values where safe/applicable.

#### Actual diagnostic identifiers

Search the marker set for all actual M01-emitted diagnostic identifier values—including `conversationIdentifier`, `messageIdentifier`, every other typed identifier field present—and their SHA-256 derivatives.

Expected persistence matches: zero.

#### Browser/workspace/log storage

Search all markers in plugin data, workspace/view state, Local Storage, Session Storage, IndexedDB, Cache Storage, inspectable OPFS, and production Chat2Vault console/log output.

Expected: zero.

#### Clipboard

Clipboard tripwires report zero Direct Chat2Vault writes.

#### Network

- browser/Obsidian/Node `http`/`https`/**`http2`**/socket/TLS/UDP/DNS/Electron/worker tripwires report zero Direct Chat2Vault violations;
- mandatory process egress traces are compared against the three control windows;
- no unexplained non-baseline egress may pass;
- DevTools remains supplementary;
- no imported URL becomes navigation/resource input.

Static checks, direct tripwires, mandatory process traces, manifests, marker searches, and control windows are all required for AC-22/23/24.

### 19.4 Accessibility/theme/layout



Perform:

- keyboard-only end-to-end workflow from §16.2;
- focus checks after success, `partial-success`, error, conversation selection, and clear;
- live-status/error discoverability check;
- default light theme;
- default dark theme;
- 360 CSS-pixel leaf-width contract;
- wider desktop leaf check.

If accessibility automation is available, use it; otherwise document the human/manual observations exactly.

### 19.5 Version compatibility

Run the complete M02 smoke flow on:

1. exact Obsidian desktop `1.7.4` (`minAppVersion`);
2. current stable Obsidian desktop version at execution time.

If exact `1.7.4` cannot pass, raise `minAppVersion` to the earliest later public compatible version and re-run the complete flow on that exact minimum and current stable.

### 19.6 Performance

Run the §15 fixture/threshold suite with performance tooling and retain summarized measurements/traces.

Any failure of a hard performance threshold is M02 NO-GO.

## 20. Documentation Deliverables


M02 implementation must update/create:

- root `README.md`:
  - development status;
  - desktop-only status;
  - supported inputs;
  - external-file access disclosure;
  - no-network/no-telemetry statement for M02;
  - no-notes-created statement;
- M02 implementation notes;
- development-vault smoke-test instructions;
- architecture documentation only if implementation materially differs from approved architecture;
- document index if the repository uses one.

Do not document future AI features as if implemented.

---

## 21. Acceptance Criteria

### AC-01 — M01 baseline preserved
M02 base descends from exact tag `chat2vault-m01-complete-v0.1`; M01 regression remains green.

### AC-02 — Manifest identity and desktop scope valid
Manifest uses valid ID `chat-to-vault`, valid display name, `isDesktopOnly: true`, and matching plugin folder.

### AC-03 — Minimum version evidence valid
Every M02 Obsidian API/behavior is mapped to authoritative version evidence; §5.3's introduction/public-compatibility/declared-minimum policy is applied; exact Obsidian desktop `1.7.4` (`minAppVersion`) and current stable Obsidian desktop at execution time pass runtime smoke.

### AC-04 — Plugin loads within startup budget
20-run startup measurement satisfies §15.2 and causes no import/network/content write.

### AC-05 — Command contract correct
Registered command is exactly `Import ChatGPT export`; it reveals/focuses a validated import view without auto-import.

### AC-06 — ZIP picker import
Eligible valid synthetic ZIP reaches M01 and displays normalized results.

### AC-07 — JSON picker import
Eligible valid single JSON reaches M01 and displays normalized results.

### AC-08 — Multi-JSON envelope and mapping
Up to 16 JSON files / 128 MiB aggregate are mapped deterministically; overflow rejects pre-read.

### AC-09 — Mixed/unsupported input rejected
ZIP+other-file, unsupported extension, folder drop, and over-limit input safely reject.

### AC-10 — Drag/drop parity
Required drag/drop uses picker semantics and prevents default navigation.

### AC-11 — Core authority preserved
M02 does not duplicate/reinterpret M01 parsing, graph, fingerprint, or diagnostic semantics.

### AC-12 — Exhaustive result-state mapping
Every current M01 result shape maps deterministically; conversations + error diagnostics yields `partial-success`.

### AC-13 — Replacement/stale-run semantics deterministic
Cancel, replacement, active-run rejection, reset, failure, repeat, and late completion follow §§7–8.

### AC-14 — Conversation ordering is a total deterministic order
§10.2 ordering is locale-independent; fully colliding rows are resolved by original M01 result ordinal.

### AC-15 — Large list and required title filter bounded
At most 200 conversation rows mount; required §10.3 NFKC/lowercase title filtering, query bound, reset/selection/paging semantics, and 10,000-conversation filter performance meet §§10/15.

### AC-16 — Preview bounded
10/25/50 page size, ≤50 message containers, field bounds, and page text budget are enforced.

### AC-17 — Imported content inert
All imported strings follow text-node-only rendering and negative DOM/URL/control tests pass.

### AC-18 — Metadata and diagnostic-identifier display whitelist enforced with no debug exception
Raw provider IDs, graph metadata, source/message/conversation fingerprints, shortened fingerprints, absolute paths, and all typed diagnostic identifier fields are never rendered. This explicitly includes `sourceIdentifier`, `conversationIdentifier`, and `messageIdentifier`.

### AC-19 — Branch warnings visible safely
M01 branch ambiguity is surfaced only through safe diagnostics/status.

### AC-20 — Diagnostics bounded, private, identifier-hidden, and fully reachable
Diagnostics render only severity, code, and safe message. Typed diagnostic identifier fields remain internal-only and are absent from rendered DOM. Diagnostics are fixed at 25 rows/page, ≤65,536 mounted imported diagnostic text code units, rendered-field bounds are enforced, no diagnostic persistence/log/clipboard exists, 50,000 diagnostics remain fully reachable, and §15 diagnostic performance thresholds pass.

### AC-21 — Settings exact and non-dormant
`data.json` contains only `schemaVersion` and `previewMessagesPerPage`; no informational/future/source setting can persist.

### AC-22 — No imported/source-derived persistence across all sinks
The complete marker set includes actual M01 diagnostic identifiers and derivatives. Derived-config manifests, browser storage, FSA/OPFS tripwires/state, mandatory process filesystem tracing, workspace/log searches, and clipboard tripwires show no forbidden persistence outside exact settings.

### AC-23 — No vault/config/external filesystem writes beyond allowed settings
Using recorded `Vault.configDir`, vault/config/plugin manifests plus direct tripwires and mandatory process filesystem tracing show no Direct Chat2Vault or unexplained non-baseline write except exact `<pluginRoot>/data.json`.

### AC-24 — No network across all stacks with objective evidence
Static source/dependency/bundle review plus browser/Obsidian/Node `http`/`https`/`http2`/socket/TLS/UDP/DNS/Electron/worker tripwires and mandatory controlled process egress tracing find zero Direct Chat2Vault violations and zero unexplained non-baseline egress.

### AC-25 — No telemetry
No telemetry/analytics/crash-reporting dependency or code path exists.

### AC-26 — Lifecycle cleanup
Clear, view close, disable/unload, failed/stale run, and restored leaf leave no session data/resource.

### AC-27 — Renderer responsiveness includes diagnostic amplification
Near-limit imports, 10,000 conversations, 50,000 diagnostics, and real M01 diagnostic-amplification fixture satisfy §15 busy-paint/main-thread/render thresholds.

### AC-28 — Automated repository verification green
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm verify` pass with M01 regression.

### AC-29 — Runtime smoke gate green
Dedicated-vault runtime flow passes on exact Obsidian desktop `1.7.4` (`minAppVersion`) and current stable Obsidian desktop at execution time.

### AC-30 — Accessibility/theme/narrow-pane gate green
Keyboard/focus/live-status, light/dark, and 360 CSS-pixel contracts pass.

### AC-31 — External-access/privacy disclosure accurate
README accurately states selected external-file access, no scan/path history/network, memory-only session, desktop-only status, and no note creation.

### AC-32 — Scope boundary clean
No M03+ writer, LLM/provider, browser capture, mobile, release, hosted service, or knowledge-distillation implementation exists.

## 22. Specification Review Checklist

The independent whole-spec re-review must review every section and specifically verify:

1. §11.2 permits diagnostic severity, code, and safe message only;
2. `sourceIdentifier`, `conversationIdentifier`, `messageIdentifier`, and every typed diagnostic identifier are explicitly non-rendered;
3. §12.3 contains no identifier render row or identifier display allowance;
4. identifier values remain internal-only where needed for correlation and persistence-marker testing;
5. no fingerprint/identifier/debug display exception exists elsewhere;
6. §18.2 includes negative DOM tests for every typed diagnostic identifier field;
7. AC-18 and AC-20 state the same identifier-hidden policy;
8. actual M01 diagnostic identifier values remain in `ForbiddenPersistenceMarkerSet`;
9. hiding identifiers from UI does not weaken AC-22 persistence verification;
10. all prior FSA/OPFS, `node:http2`, mandatory filtering, attribution, `Vault.configDir`, diagnostics-volume, performance, lifecycle, and accessibility closures remain intact;
11. M02 remains preview-only with no M03 leakage;
12. §5.3 distinguishes API/behavior introduction, earliest public compatibility, and declared plugin minimum; it declares `minAppVersion` `1.7.4`, and §19.5, AC-03, and AC-29 require exact `1.7.4` plus current stable-at-execution verification;
13. AC-01 through AC-32 are independently implementation-ready.

Any unresolved security, correctness, privacy, performance, or material ambiguity is a NO-GO.

## 23. Implementation Gate





After independent specification review, only these outcomes are allowed:

### GO

```text
GO — M02 IMPLEMENTATION AUTHORIZED
```

Meaning:

- no implementation-blocking ambiguity remains;
- all material security/privacy/UI contracts are specified;
- implementation may begin on an M02 branch.

### CONDITIONAL / NO-GO

Any other decision means implementation remains unauthorized.

Reviewer must identify exact blocking clauses and remediation.

---

## 24. Commit / Push / Release Governance

Preparation of this specification does not authorize:

- an M02 implementation commit;
- M02 code changes;
- push;
- PR;
- merge;
- tag;
- release;
- Obsidian Community submission.

The M01 baseline commit/tag is separately authorized.

This M02 spec should remain a documentation-only working-tree change until reviewed and explicitly authorized under the repository's normal governance.

---

## 25. M03 Handoff Boundary

M03 may eventually add:

- source registry;
- safe configured source-note root;
- idempotent source persistence;
- Markdown source-note rendering;
- content-write preview/dry-run;
- collision policy.

M02 must not pre-implement those capabilities.

The only M02 state that may survive restart is validated plugin configuration, never imported conversation data.

---

## 26. Current Official Platform Reference Inputs

The v0.4 remediation was checked on 2026-08-09 against current primary/official sources covering:

### Obsidian
- manifest/desktop behavior;
- deferred views/lifecycle;
- developer self-review guidance;
- configuration-directory guidance requiring `Vault.configDir` rather than hardcoded `.obsidian`.
- [Obsidian 1.7.2 Desktop (Catalyst), September 19, 2024](https://obsidian.md/changelog/2024-09-19-desktop-v1.7.2/): deferred view loading was introduced during the Catalyst/early-access cycle.
- [Obsidian 1.7.4 Desktop (public Obsidian 1.7 release), October 16, 2024](https://obsidian.md/changelog/2024-10-16-desktop-v1.7.4/): the earliest public desktop release containing the required deferred-view behavior and the declared M02 `minAppVersion`.

### Browser filesystem
- File System Access writable handles/streams;
- OPFS via `navigator.storage.getDirectory()`;
- sync access handles in workers.

### Node/Electron networking
- Node's separate stable `node:http2` client implementation;
- Electron network-inspection behavior/limitations.

Implementation must re-check current primary documentation if platform behavior materially changes before M02 completion. Community submission remains outside M02.

## 27. Independent Review Remediation Traceability

### v0.1 → v0.2

Closed the original mixed-success, input/performance, inert-rendering, privacy-evidence, drag/drop, ordering/settings, command, deferred-view, and accessibility gaps.

### v0.2 → v0.3

Closed diagnostic-volume bounds, strengthened write/network evidence, total ordering, and removed the dormant informational-diagnostics setting.

### v0.3 → v0.4

Closed File System Access/OPFS coverage, `node:http2`, actual M01 diagnostic marker values, filter/fingerprint conflicts, objective attribution, and `Vault.configDir` derivation.

### v0.4 → v0.5

The v0.4 independent re-review returned:

```text
NO-GO — M02 SPECIFICATION REMEDIATION REQUIRED
```

Thirty of thirty-two acceptance criteria were implementation-ready. AC-18 and AC-20 conflicted because §11.2 prohibited identifier display while §12.3 allowed a safe/hashed diagnostic identifier.

v0.5 resolves the conflict with one conservative policy:

> **Typed diagnostic identifiers are internal-only and never rendered in M02.**

Changes:

- §11.2 explicitly prohibits rendering all typed diagnostic identifier fields;
- §12.3 renders only severity, code, and safe message;
- diagnostic identifiers remain usable internally only for correlation/security verification;
- §18.2 adds negative DOM tests for all typed diagnostic identifier fields;
- AC-18 and AC-20 now express the identical identifier-hidden rule.

This table is traceability only. A new independent reviewer must verify whole-spec readiness.

### v0.5 → v0.5.1

The M02 implementation/runtime interpretation associated with v0.5 used the Catalyst-only 1.7.2 introduction build as the implied baseline. v0.5.1 makes the specification itself explicit by separating the API/behavior introduction version from the earliest public compatible version and declared plugin minimum:

- the deferred-view behavior was introduced in 1.7.2 Desktop Catalyst;
- 1.7.4 is the earliest public compatible Obsidian desktop version;
- M02 declares `minAppVersion` `1.7.4`;
- §19.5, AC-03, and AC-29 require complete runtime smoke verification on exact `1.7.4` and current stable at execution time, not an exact Catalyst build.

This amendment changes compatibility policy only. It does not authorize implementation or close any existing runtime evidence gate.

## 28. Final Specification State





**M02_SPEC.md v0.5.1**

**State:** `MINIMUM-VERSION AMENDMENT DRAFT FOR INDEPENDENT WHOLE-SPEC REVIEW — IMPLEMENTATION NOT AUTHORIZED`

**Next allowed action:** compute/record this exact v0.5.1 artifact's SHA-256, then perform a genuinely independent whole-spec amendment review from that exact SHA.

**Only authorizing review outcome:** `GO — M02 IMPLEMENTATION AUTHORIZED`.

**Prohibited next action:** M02 implementation before that GO.
