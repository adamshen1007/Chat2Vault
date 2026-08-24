# Chat2Vault M03 Specification

## Source Registry and Source-Note Writer

Version: 0.11.0  
Status: REMEDIATED SPECIFICATION DRAFT — INDEPENDENT WHOLE-SPEC RE-REVIEW REQUIRED  
Baseline: M02 commit `e7350887f8da44d931a648a0f30a9aac87ffce6f`

## 1. Objective

M03 introduces Chat2Vault's first intentional vault-write capability.

> Preserve one selected canonical AI conversation as an immutable, branch-aware, source-backed Markdown note below an explicitly configured vault source root, with a derived source registry, safe deterministic paths, dry-run planning, collision protection, and idempotent repeated imports.

M03 does not distill knowledge, write knowledge notes, call an AI/network provider, or implement M04 behavior.

## 2. Authority and specification immutability

Authority order:

1. `AGENTS.md`
2. exact independently approved `docs/M03_SPEC.md`
3. M02 baseline commit `e7350887f8da44d931a648a0f30a9aac87ffce6f`
4. `docs/03_ARCHITECTURE.md`
5. `docs/04_KNOWLEDGE_SCHEMA.md`
6. `docs/01_PRODUCT_BRIEF.md`
7. `docs/05_ROADMAP.md`
8. `docs/06_OPEN_SOURCE_RELEASE_STRATEGY.md`

A conflict with a higher authority is a specification NO-GO.

### 2.1 Approval freeze

Before implementation, a genuinely independent whole-spec review must approve one exact UTF-8 byte sequence of `docs/M03_SPEC.md`.

After that approval:

- the approved specification bytes are immutable implementation authority;
- implementation must record and verify the approved SHA-256 before mutation;
- `docs/M03_SPEC.md` must not be formatted, edited, regenerated, normalized, or otherwise changed during implementation;
- any byte change invalidates the prior specification approval immediately;
- after any byte change, implementation must stop;
- the changed specification requires a new SHA-256, a new review package, and a fresh genuinely independent whole-spec review before implementation may resume.

No formatter, implementation report, documentation cleanup, or remediation task may silently change the approved specification.

## 3. In scope

M03 includes exactly:

- a required user-configured source root;
- a total settings v2 load/migration/save contract;
- vault-relative lexical path validation;
- Vault visibility and checkpointed physical-containment verification;
- a read-only Windows generic reparse-point observation that detects `FILE_ATTRIBUTE_REPARSE_POINT` presence, or a precisely equivalent native observation, without following or mutating the object;
- deterministic safe source-note filename planning;
- a Markdown-derived source registry;
- exact duplicate detection;
- changed-content source-version detection;
- deterministic collision handling;
- deterministic branch-aware source-note Markdown rendering;
- a closed dry-run planning contract;
- a closed Save execution-result contract;
- explicit one-conversation source-note Save;
- a create-only writer;
- one-instance write serialization and stale-operation fencing;
- post-write byte/hash/registry verification;
- runtime privacy, filesystem, network, compatibility, and accessibility evidence.

## 4. Non-goals

M03 must not implement:

- knowledge extraction or `KnowledgeCandidate`;
- manual/no-provider distillation;
- AI provider adapters, API keys, secrets, or network calls;
- knowledge-note writing;
- candidate accept/edit/reject;
- source-to-knowledge backlinks;
- semantic deduplication or merge;
- multi-conversation or batch source writing;
- historical migration;
- Web Clipper integration or browser automation;
- mobile support;
- hosted services;
- telemetry;
- release automation;
- Community Plugin submission;
- M04 or later behavior.

M03 saves one currently selected conversation at a time.

## 5. Product rules

### 5.1 Immutable source evidence

M03 never edits, replaces, renames, deletes, trashes, or silently updates an existing source note.

### 5.1.1 Provenance-scoped non-disclosure and source-content preservation

The Product Owner has explicitly approved the following M03 provenance rule.

The writer must never intentionally serialize a value **from** any of these forbidden metadata/topology provenance fields:

- raw provider message IDs;
- raw provider node IDs;
- raw graph node IDs;
- diagnostic identifiers;
- arbitrary provider metadata not explicitly allowed by this specification.

This is a provenance rule, not a global substring-absence rule.

Consequently:

- a coincidentally equal character sequence occurring in preserved imported source content is permitted and must remain preserved under the deterministic rendering rules;
- `source_conversation_id` remains explicitly permitted provenance and may be serialized even when its value is equal to a raw provider message ID, provider node ID, graph node ID, diagnostic identifier, or arbitrary provider-metadata value;
- a conversation title or canonical content string is not redacted, omitted, or otherwise changed solely because its character sequence equals a forbidden metadata/topology identifier;
- tests and runtime evidence must prove which input field supplied an emitted value, rather than using global substring absence as evidence of non-disclosure;
- raw forbidden metadata/topology fields may be consumed transiently only where this specification explicitly authorizes comparison/topology derivation, but those fields are not themselves output fields.

The renderer therefore preserves source content while preventing intentional serialization from forbidden metadata/topology provenance.

### 5.2 Exact duplicate = zero Chat2Vault vault-content mutation

Same provider + same conversation content fingerprint means `duplicate`.

A duplicate action must cause zero Chat2Vault-issued vault-content mutation:

- no source-note create;
- no source-note modify;
- no source-folder create;
- no source-note rename/delete/trash;
- no unrelated vault-content write.

Settings persistence is a separate contract and is not triggered by duplicate planning or duplicate Save rejection.

### 5.3 Changed conversation content = new immutable version

Same provider + present/equal provider conversation ID + different content fingerprint means `new-version`.

Existing source notes remain unchanged.

Two absent provider conversation IDs never constitute a version relationship.

### 5.4 No default write location

`sourceRoot` starts empty.

No source folder or source note is created until the user configures a valid root and explicitly invokes Save.

### 5.5 No proprietary registry store

The durable source registry is derived from Chat2Vault Markdown source notes below the configured source root.

An in-memory cache is permitted.

JSON, database, hidden, sidecar, or other proprietary durable registry files are prohibited.

### 5.6 Total well-formed Unicode and external-path ingress policy

M03 must never pass an ill-formed JavaScript UTF-16 string directly to Unicode normalization, UTF-8 byte-length calculation, UTF-8 note serialization, or filesystem path construction.

Define:

```ts
function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
```

`toM03WellFormedString(input)` is the following code-unit algorithm:

1. scan UTF-16 code units from left to right;
2. a high surrogate followed immediately by a low surrogate is copied as that pair;
3. an unpaired high surrogate is replaced by one U+FFFD;
4. an unpaired low surrogate is replaced by one U+FFFD;
5. every other code unit is copied unchanged.

`isM03WellFormedString(input)` is true only when `toM03WellFormedString(input) === input`.

The policy by field is exact:

- `sourceRoot` must already be well-formed; any lone surrogate makes §7.1 return `INVALID_SOURCE_ROOT` before NFC normalization or byte-length counting;
- a present/non-empty `providerConversationId` must already be well-formed; otherwise planning returns `INVALID_SOURCE_RENDER_INPUT` before registry/version classification;
- every JSON string decoded from trusted-registry frontmatter must be well-formed; an ill-formed decoded value makes that note untrusted;
- conversation titles are transformed with `toM03WellFormedString` before filename and H1 processing;
- imported text, code text, code language, reference text, reference URL, and unsupported descriptions are transformed with `toM03WellFormedString` before line-ending normalization and inert rendering;
- optional timestamps containing a lone surrogate fail the total timestamp predicate in §11.3 and are therefore treated as absent;
- required `source.importedAt` containing a lone surrogate fails §11.3 and blocks rendering.

`UTF8(value)` in this specification means standard UTF-8 encoding of a string that is already well-formed under this section.

No replacement of lone surrogates is delegated to `TextEncoder`, Node, Obsidian, the operating system, or the filesystem.

The UTF-8 bytes for one replacement character U+FFFD are exactly:

```text
0xEF 0xBF 0xBD
```

Raw provider/node identifiers used only transiently for topology comparison may remain JavaScript code-unit strings because they are neither persisted nor used as filesystem paths. They must never bypass the above policy if later emitted into durable bytes.

### 5.6.1 External path-like string ingress

An `external path-like string` is any path/configuration string first obtained from outside pure M03 core policy, including:

- `app.vault.configDir`;
- the desktop adapter's vault base path;
- a Vault API enumerated child path or filename;
- a Vault API lookup/read/read-back/created-object path;
- an adapter-returned resolved Vault-relative path;
- a native `realpath` result;
- the macOS `ATTR_VOL_MOUNTPOINT` path returned by the §7.8.1 mount-point observer after fatal UTF-8 decoding;
- any other Obsidian/Vault/native adapter path string used to derive a logical path, collision key, native path, containment decision, registry address, or created/read-back address.

Every external path-like value must pass this ingress function immediately upon receipt:

```ts
function isValidM03ExternalPathString(value: unknown): value is string {
  return typeof value === "string" && isM03WellFormedString(value);
}
```

The ingress rule is fail-closed and performs no replacement or normalization.

Before the value passes this function, M03 must not:

- call Unicode normalization;
- call `pathCollisionKey`;
- lowercase/case-fold it;
- split/join it as a path;
- calculate UTF-8 length;
- concatenate it into another path;
- convert it to a native filesystem path;
- compare it as a logical/resolved path;
- pass it to `lstat`, `realpath`, Vault lookup/read/create, or any later M03 path operation.

If an external path-like value fails ingress:

- during Preview/planning, root/config evaluation, enumeration, registry candidate addressing, occupancy, or a pre-mutation Save checkpoint, planning fails closed with `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
- no lower-precedence root, registry, collision, alias, or visibility diagnostic is evaluated from that invalid value;
- if a fresh Save replan encounters the failure before mutation, the refreshed plan is `blocked` with `SOURCE_EXTERNAL_PATH_INVALID_UNICODE` and Save settlement follows §§16–17;
- if the failure is first observed after a folder create fulfilled but before another mutation, no later mutation is invoked;
- if the failure is first observed only after final note create fulfilled during created-object enumeration, read-back, native-path resolution, or verification, the Save result is `verification-failed` or `post-create-stale`/`verification-failed` as applicable, using `SOURCE_WRITE_VERIFICATION_FAILED`.

The invalid external path string itself is never normalized, persisted, displayed, or used to construct another path.

### 5.6.2 Ingress ordering guarantee

External-path ingress is logically before every path-specific rule in §§7, 8, 10, 15, 17, and 25.

In particular, it precedes:

- config-directory collision comparison;
- root child collision-aware walking;
- registry candidate path normalization/filtering;
- occupancy normalization;
- physical-containment path construction;
- post-create child/read-back logical-path reconstruction.

No section may infer that an Obsidian/Vault/native adapter returned a well-formed JavaScript string merely because its TypeScript surface is `string`.

## 6. Settings v2: total load, migration, normalization, and save contract

M02 persisted:

```ts
interface Chat2VaultSettingsV1 {
  schemaVersion: 1;
  previewMessagesPerPage: 10 | 25 | 50;
}
```

M03 persists exactly:

```ts
interface Chat2VaultSettingsV2 {
  schemaVersion: 2;
  previewMessagesPerPage: 10 | 25 | 50;
  sourceRoot: string;
}
```

Default in-memory M03 settings are exactly:

```ts
{
  schemaVersion: 2,
  previewMessagesPerPage: 25,
  sourceRoot: ""
}
```

### 6.1 JSON-object definition

A `JSON object` in this section means a non-null JavaScript object value that:

- is not an array;
- contains only own enumerable string-keyed properties;
- contains only JSON-compatible property values;
- is interpreted without prototype-chain properties.

The persisted value returned by Obsidian `loadData()` is classified using only own enumerable properties.

### 6.2 Exact valid persisted shapes

A valid v1 object:

- is a JSON object;
- has exactly the own keys `schemaVersion` and `previewMessagesPerPage`;
- has `schemaVersion` with number type and exact value `1`;
- has `previewMessagesPerPage` equal to number `10`, `25`, or `50`.

A valid v2 object:

- is a JSON object;
- has exactly the own keys `schemaVersion`, `previewMessagesPerPage`, and `sourceRoot`;
- has `schemaVersion` with number type and exact value `2`;
- has `previewMessagesPerPage` equal to number `10`, `25`, or `50`;
- has `sourceRoot` of string type.

### 6.3 Schema-version classification

Classify `schemaVersion` exactly:

- number `1` → v1 candidate;
- number `2` → v2 candidate;
- any safe integer number `>= 3` → unknown/future schema;
- missing property, string `"1"`/`"2"`/`"3"`, number `0`, negative number, non-integer number, `NaN`, `Infinity`, boolean, object, array, or null → invalid settings.

Only a safe integer `>= 3` is classified as `UNSUPPORTED_SETTINGS_SCHEMA`.

All other non-v1/non-v2 schema values are `INVALID_PERSISTED_SETTINGS`.

### 6.4 Total load state table

| Persisted value                                                                                           | In-memory result                              | Load diagnostic                 | Load-time `saveData` |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------- | -------------------- |
| missing / `undefined` / `null`                                                                            | exact M03 default                             | none                            | never                |
| valid v1                                                                                                  | schema 2, same preview size, `sourceRoot: ""` | none                            | never                |
| valid v2 with `sourceRoot === ""`                                                                         | exact normalized v2                           | none                            | never                |
| valid v2 with lexically valid non-empty root                                                              | same preview size + NFC-normalized root       | none                            | never                |
| exact-shape v2 whose only invalid field is a non-empty lexically invalid `sourceRoot`                     | same preview size + `sourceRoot: ""`          | `INVALID_PERSISTED_SOURCE_ROOT` | never                |
| schema 1 object that is not exact valid v1                                                                | exact M03 default                             | `INVALID_PERSISTED_SETTINGS`    | never                |
| schema 2 object with invalid preview type/value or extra/missing keys other than the root-only case above | exact M03 default                             | `INVALID_PERSISTED_SETTINGS`    | never                |
| safe integer schema `>= 3`                                                                                | exact M03 default                             | `UNSUPPORTED_SETTINGS_SCHEMA`   | never                |
| every other value/type/schema case                                                                        | exact M03 default                             | `INVALID_PERSISTED_SETTINGS`    | never                |

Lexical root validity in this table uses §7.1.

Environmental/physical root checks from §§7.2–7.7 do not mutate the loaded setting. A lexically valid persisted root that fails environmental/physical validation remains visible in settings but is write-ineligible until corrected.

No load or migration path calls `saveData`.

### 6.5 Settings-load diagnostics

```ts
type SettingsLoadDiagnosticCode =
  | "INVALID_PERSISTED_SOURCE_ROOT"
  | "INVALID_PERSISTED_SETTINGS"
  | "UNSUPPORTED_SETTINGS_SCHEMA";
```

Exact mapping:

| Code                            | Severity | Exact message                                                                               |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `INVALID_PERSISTED_SOURCE_ROOT` | warning  | `The saved source folder is invalid and was disabled in memory.`                            |
| `INVALID_PERSISTED_SETTINGS`    | warning  | `The saved Chat2Vault settings are invalid; safe defaults were loaded in memory.`           |
| `UNSUPPORTED_SETTINGS_SCHEMA`   | warning  | `The saved Chat2Vault settings schema is unsupported; safe defaults were loaded in memory.` |

Messages contain no persisted source value.

### 6.6 Authoritative settings-edit precedence, mutex, equality, and closed result

All settings persistence is serialized through one binary non-queuing mutex:

```ts
interface SettingsSaveSuccess {
  status: "saved";
}

interface SettingsSaveUnchanged {
  status: "unchanged";
}

interface SettingsSaveInProgress {
  status: "in-progress";
  message: "A Chat2Vault setting is already being saved.";
}

interface SettingsSaveInvalid {
  status: "invalid";
  message: "The preview setting is invalid." | "The source folder is invalid.";
}

interface SettingsSaveFailed {
  status: "failed";
  message:
    | "The preview setting could not be saved."
    | "The source folder setting could not be saved.";
}

type SettingsSaveResult =
  | SettingsSaveSuccess
  | SettingsSaveUnchanged
  | SettingsSaveInProgress
  | SettingsSaveInvalid
  | SettingsSaveFailed;
```

The plugin owns one `settingsSaveMutex`.

For every preview-page or source-root edit, including programmatic/event reentry, apply this exact precedence:

1. call an atomic non-blocking `tryAcquire(settingsSaveMutex)` before validating, normalizing, or comparing the proposed value with current in-memory settings;
2. if acquisition fails, return exactly:

```ts
{
  status: "in-progress",
  message: "A Chat2Vault setting is already being saved.",
}
```

and perform no validation result publication, no in-memory settings mutation, no `sourceWriteGeneration` mutation, and no `saveData` call; 3. if acquisition succeeds, execute all remaining edit logic while holding the mutex; 4. release the mutex exactly once in `finally`, including invalid, unchanged, saved, and failed outcomes.

Therefore mutex-held rejection has higher precedence than same-value/no-op detection. A same-value reentry can never report `unchanged` against an optimistic in-memory value from an older still-pending transaction.

Settings controls should be disabled while the mutex is held, but correctness must not depend on that UI state.

### 6.7 Structural settings equality and edit validation

For two valid in-memory v2 settings objects `left` and `right`:

```text
settingsEqual(left, right) =
  left.schemaVersion === right.schemaVersion
  AND left.previewMessagesPerPage === right.previewMessagesPerPage
  AND left.sourceRoot === right.sourceRoot
```

No serialization, key-order, prototype, locale, or object-identity comparison is used.

After the mutex has been acquired:

1. read the current complete in-memory v2 settings object as `previousSettings`;
2. validate and normalize the proposed edit:
   - preview page size is valid only for number `10`, `25`, or `50`;
   - source root is normalized/validated under §7.1;
3. invalid preview value returns:

```ts
{
  status: "invalid",
  message: "The preview setting is invalid.",
}
```

with no settings/generation mutation and no `saveData`; 4. invalid source-root value returns:

```ts
{
  status: "invalid",
  message: "The source folder is invalid.",
}
```

with no settings/generation mutation and no `saveData`; 5. construct `nextSettings` by replacing only the explicitly edited field in `previousSettings`; 6. if `settingsEqual(previousSettings, nextSettings)` is true, return `{ status: "unchanged" }` with no settings/generation mutation and no `saveData`; 7. otherwise execute §6.8 or §6.9.

Because the mutex is already held before step 1, `previousSettings` cannot be an optimistically mutable state concurrently observed by another accepted settings transaction.

### 6.8 Transactional preview-page-size save

For a non-equal valid preview-page-size edit while holding `settingsSaveMutex`:

1. retain `previousSettings`;
2. set current in-memory settings to `nextSettings`;
3. do not change `sourceWriteGeneration`, because page size does not affect source-write identity or path;
4. call `saveData(nextSettings)`;
5. on fulfilled persistence:
   - retain `nextSettings`;
   - return `{ status: "saved" }`;
6. on rejected persistence:
   - restore the complete `previousSettings` object in memory;
   - do not change `sourceWriteGeneration`;
   - keep any valid source dry-run plan unchanged;
   - display and return:

```ts
{
  status: "failed",
  message: "The preview setting could not be saved.",
}
```

- perform no vault-content mutation.

### 6.9 Transactional source-root save

The plugin owns this source-root persistence state:

```ts
type SourceRootPersistenceState =
  | {
      status: "settled";
    }
  | {
      status: "pending";
      previousRoot: string;
      proposedRoot: string;
    };
```

Initial state is `{ status: "settled" }`.

For a non-equal valid source-root edit while holding `settingsSaveMutex`:

1. retain complete `previousSettings`;
2. construct complete normalized `nextSettings`;
3. increment `sourceWriteGeneration`;
4. clear current source Preview/Save UI state;
5. invalidate the in-memory registry cache;
6. set `sourceRootPersistenceState` to:

```ts
{
  status: "pending",
  previousRoot: previousSettings.sourceRoot,
  proposedRoot: nextSettings.sourceRoot,
}
```

7. **do not install `nextSettings.sourceRoot` into current in-memory settings while persistence is pending**; the settled current source root remains `previousSettings.sourceRoot`;
8. call `saveData(nextSettings)`;
9. on fulfilled persistence:
   - atomically replace current in-memory settings with `nextSettings`;
   - set `sourceRootPersistenceState = { status: "settled" }`;
   - do not increment generation again;
   - keep all pre-transaction plans invalidated;
   - keep the registry cache invalidated;
   - return `{ status: "saved" }`;
10. on rejected persistence:

- current in-memory settings remain `previousSettings`;
- set `sourceRootPersistenceState = { status: "settled" }`;
- do not decrement or increment the already-advanced generation;
- keep every pre-transaction plan invalidated;
- keep the registry cache invalidated;
- display and return:

```ts
{
  status: "failed",
  message: "The source folder setting could not be saved.",
}
```

- perform no source-folder/source-note mutation.

A pending root candidate is therefore never an authoritative source-writer root.

The authoritative root used by Preview, Save tokens, planner adapters, registry discovery, and writer I/O is always the current **settled** in-memory `settings.sourceRoot`.

### 6.9.1 Settings reentry consequences

While either §6.8 or §6.9 awaits `saveData`:

- page → page settings reentry returns `in-progress`;
- page → root settings reentry returns `in-progress`;
- root → page settings reentry returns `in-progress`;
- root → root settings reentry returns `in-progress`;
- this rule applies even when the reentered value equals any current or staged value;
- this rule is unchanged whether the first persistence later fulfills or rejects.

At most one `saveData` promise may be in flight for Chat2Vault settings.

For settings results:

- `in-progress`, `invalid`, and `failed` display their exact `message`;
- `saved` and `unchanged` do not display an error message;
- no rejected reentry is queued or replayed automatically.

### 6.9.2 Cross-transaction root-persistence gate

Source-root persistence uses the settings mutex; source Preview and Save use the mutually excluding source mutex rules in §§14.1 and 17.2. Root persistence remains higher-precedence than both source actions.

While `sourceRootPersistenceState.status === "pending"`:

- source Preview is forbidden from invoking the §9.3 planner;
- source Preview returns the closed `settings-pending` preview result in §14;
- source Save is forbidden from beginning or continuing a new source mutation;
- a Save invoked while root persistence is already pending returns the closed `settings-pending` Save result in §16;
- no plan based on `proposedRoot` may be published or saved;
- the only authoritative source root remains `previousRoot`, but new Preview/Save operations do not use it until the root transaction settles.

If a root transaction begins while a Preview is already running:

- generation was incremented at root-transaction start;
- the Preview completion fence in §14 detects stale generation or pending root state;
- the computed plan is discarded and never becomes current UI state.

If a root transaction begins while a source Save already holds `sourceWriteMutex`:

- generation was incremented at root-transaction start;
- the active Save follows §§17.4–17.11;
- every required mutation fence also requires settled root persistence;
- no later source mutation may be invoked after the transaction start unless it was already invoked before staleness could be observed under the §17 linearization rules.

After root-persistence fulfillment:

- current settled root becomes `proposedRoot`;
- no previous plan is restored;
- the user must run Preview again before Save.

After root-persistence rejection:

- current settled root remains `previousRoot`;
- no previous plan is restored;
- the already-advanced generation remains advanced;
- the user must run Preview again before Save.

No automatic Preview or Save is queued or replayed after either settlement.

### 6.9.3 Explicit edit after unsupported future-schema load

An unsupported future schema remains fail-closed on load exactly as §§6.3–6.5 specify:

- load does not rewrite the persisted bytes;
- the in-memory state is the safe M03 v2 default;
- `UNSUPPORTED_SETTINGS_SCHEMA` is emitted;
- no automatic migration to v2 occurs.

If the user later performs an explicit valid M03 settings edit, that action is a new v2 settings transaction under §§6.6–6.9.

A fulfilled explicit transaction may therefore replace the previously persisted unsupported future-schema bytes with the exact normalized v2 settings object.

This is intentional user-triggered v2 persistence, not load-time migration and not evidence that the unknown schema was understood.

A rejected explicit transaction follows the ordinary rollback/evidence contract.

M03 makes no forward-compatibility promise that unknown future-schema bytes survive a later explicit user settings save.

This clause does not weaken fail-closed loading and does not authorize background, automatic, or load-time rewriting.

### 6.10 Settings privacy

No source content, provider IDs, source/conversation/message fingerprints, registry entries, source filenames, target filenames, dry-run plans, rendered Markdown, or Save execution result may be stored in plugin settings.

Only `schemaVersion`, `previewMessagesPerPage`, and `sourceRoot` are persisted.

## 7. Source-root, logical/resolved path, Vault-visibility, and physical-containment policy

M03 supports visible source roots whose existing ancestry is physically contained in the vault at every required checkpoint.

Symlink/junction/mount-point/generic-reparse traversal and hidden source-root namespaces are not supported.

On Windows, a present filesystem object is never trusted for source-root ancestry, registry identity, or post-write verification merely because `lstat` reports a non-symbolic-link object and `realpath` remains inside the vault. Every such trust decision must also pass the §7.8.1 generic Windows reparse-point observation. An authoritative reparse-point observation is a specified blocked physical-alias state even when the resolved pathname remains inside the vault.

On macOS, a present non-symbolic filesystem object below the vault containment boundary is never trusted for source-root ancestry, registry identity, or post-write verification merely because `lstat` reports an ordinary object and `realpath` remains inside the vault. Every such trust decision must also pass the §7.8.1 authoritative macOS mount-point observation. An authoritative mount-point observation is a specified blocked physical-alias state even when the resolved pathname remains inside the vault. The vault base itself is the containment boundary and is not rejected merely because the vault is located at the mount point of its containing volume; the mount-point prohibition applies to required source-root ancestry components below the vault base and to trusted registry/created-note objects.

### 7.1 Lexical root normalization and validation

Input is a JavaScript string.

Apply exactly in order:

1. If input is `""`, return `unconfigured`.
2. If `isM03WellFormedString(input)` from §5.6 is false, reject.
3. Normalize the complete string to Unicode NFC.
4. Reject if the NFC string exceeds 512 UTF-16 code units.
5. Reject if UTF-8 encoding exceeds 1024 bytes.
6. Reject any code point in U+0000–U+001F or U+007F–U+009F.
7. Reject any backslash U+005C.
8. Reject any occurrence of the Windows-invalid filename characters `<`, `>`, `:`, `"`, `|`, `?`, or `*`.
9. Reject if the string starts with `/`.
10. Reject if it matches `^[A-Za-z]:`.
11. Reject if it matches `^[A-Za-z][A-Za-z0-9+.-]*:`.
12. Split on `/`.
13. Reject any empty segment.
14. Reject any segment exactly `.` or `..`.
15. Reject any segment beginning with `.`.
16. Reject any segment ending with ASCII space U+0020 or `.`.
17. Reject any segment exceeding 120 Unicode code points.
18. Reject any segment whose UTF-8 encoding exceeds 240 bytes.
19. For each segment, take the substring before the first `.` and compare it with ECMAScript locale-independent `toUpperCase()` against:

```text
CON
PRN
AUX
NUL
COM1 COM2 COM3 COM4 COM5 COM6 COM7 COM8 COM9
LPT1 LPT2 LPT3 LPT4 LPT5 LPT6 LPT7 LPT8 LPT9
COM¹ COM² COM³
LPT¹ LPT² LPT³
```

If any comparison matches, reject.

Accepted lexical root is the NFC string joined with `/`.

Every dot-prefixed segment is rejected so M03 uses Vault-visible namespaces only.

The Windows-invalid-character rejection is applied on every supported OS so one configured source root has one cross-platform lexical contract.

### 7.2 Config-directory exclusion

Before any config-directory normalization/collision work:

1. read `app.vault.configDir`;
2. require it to pass §5.6.1 external path ingress;
3. if it fails, block with `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
4. otherwise NFC-normalize it as the logical config-directory path.

After lexical validation, reject if the normalized logical root:

- has the same `pathCollisionKey` as the normalized logical config-directory path; or
- has a `pathCollisionKey` beginning with `pathCollisionKey(normalizedConfigDir) + "/"`.

`pathCollisionKey` is defined in §10.1 and receives only ingress-valid canonical logical paths.

### 7.3 Canonical logical paths and resolved I/O paths

M03 distinguishes user-visible logical paths from exact Vault/native I/O paths.

```ts
interface VaultPathAddress {
  logicalPath: string;
  resolvedPath: string;
}
```

Definitions:

- `logicalPath` is the NFC-normalized, `/`-separated canonical path exposed to core logic, plans, diagnostics metadata, registry identity, UI, and tests.
- `resolvedPath` is the exact Vault-relative path spelling returned by Obsidian enumeration for an existing object, preserving the original Unicode code-point sequence and case. It must first pass §5.6.1 external path ingress and is never NFC-normalized before I/O.
- for vault root, both fields are `""`;
- native filesystem operations convert `resolvedPath` to a native path without Unicode normalization or case folding;
- every Vault/native enumerate, lookup, read, `lstat`, `realpath`, create-folder, create-file, read-back, and verification operation uses `resolvedPath`, not `logicalPath`;
- every collision comparison uses `logicalPath` and `pathCollisionKey`;
- `sourceRoot`, `SourceWritePlan.targetPath`, `SourceWritePlan.existingPath`, `duplicatePaths`, `previousVersionPaths`, `foldersToCreate`, `SourceRegistryEntry.path`, and every `createdPath` in `SourceWriteExecutionResult` expose logical paths only;
- resolved paths are adapter/session state only and are never persisted in Chat2Vault settings, source-note frontmatter, or registry identity.

For an existing raw path such as an NFD spelling whose NFC normalization exactly equals the desired logical NFC path:

- the object may satisfy that logical path after all collision/type/physical checks;
- its exact raw Vault path becomes `resolvedPath`;
- every subsequent I/O under that existing object uses that raw `resolvedPath`.

M03 therefore never assumes that a Windows or POSIX filesystem resolves an NFC spelling to an existing normalization-equivalent raw spelling.

For a planned missing child:

```text
logical child path =
  logical parent path + "/" + desired NFC segment

resolved child path =
  resolved parent path + "/" + desired NFC segment
```

with the leading separator omitted when parent is vault root.

After a fulfilled folder create, the adapter must re-enumerate the actual parent, require every returned path used for the created-child decision to pass §5.6.1, capture the exact ingress-valid raw Vault path returned for the created child, require `NFC(rawPath) === logicalPath`, and replace the provisional `resolvedPath` with that exact enumerated raw path before later I/O.

For a planned source note:

- logical target path is `<logical source root>/<NFC generated filename>`;
- resolved target path is `<resolved source root>/<same NFC generated filename>`;
- the create call uses resolved target path;
- successful read-back must resolve an ingress-valid created raw Vault path under §5.6.1 and require its NFC logical path to equal the planned logical target path;
- `createdPath` returned to UI is the logical target path.

### 7.4 Collision-aware segment walk and root-state model

For a lexically valid, non-configDir root, evaluate desired NFC segments from vault root toward source root.

The current parent is always a `VaultPathAddress`.

For each desired child:

1. fresh-enumerate direct Vault-visible children using `parent.resolvedPath`;
2. for each child path returned by enumeration, require §5.6.1 external path ingress before retaining or transforming it;
3. any ingress failure blocks immediately with `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
4. for each ingress-valid child, retain its exact raw Vault-relative path as candidate `resolvedPath`;
5. compute candidate `logicalPath = NFC(candidate resolvedPath)`;
6. compute `pathCollisionKey` for desired logical child path and every candidate logical child path;
7. collect all collision-key matches;
8. classify exactly:
   - no Vault-visible collision match:
     - inspect the exact intended child `resolvedPath` with the §7.8.1 native `lstat` probe;
     - `absent` is authoritative only for this not-yet-required child and means this is the first missing segment; after this authoritative first-missing result, stop the physical/Vault segment walk immediately and construct every remaining desired descendant synthetically under §7.5 rather than attempting to enumerate or probe a non-existent parent;
     - `indeterminate` blocks with `SOURCE_NATIVE_PROBE_INDETERMINATE`; it is never treated as missing;
     - for every `present` result, complete the platform alias observation under §7.8.1 before using `objectKind`: Windows requires the generic reparse-point observation; macOS requires an authoritative object `realpath` followed by the `ATTR_VOL_MOUNTPOINT` observation;
     - alias observation `alias` blocks with `SOURCE_ROOT_PHYSICAL_ALIAS`; this includes an authoritative Windows generic `reparse-point` or authoritative macOS `mount-point` even when `objectKind` is `directory` and the resolved pathname remains inside the vault;
     - alias observation `indeterminate` blocks with `SOURCE_NATIVE_PROBE_INDETERMINATE`;
     - alias observation `not-alias` + `present: regular-file` or `present: other` blocks with `SOURCE_PATH_OBSTRUCTED`;
     - alias observation `not-alias` + `present: directory` that is not represented by Vault enumeration blocks with `SOURCE_ROOT_NOT_VAULT_VISIBLE`;
   - exactly one collision match whose candidate `logicalPath` exactly equals the desired logical path and whose Vault object is a directory:
     - construct provisional `VaultPathAddress { logicalPath: desiredLogicalPath, resolvedPath: exactRawEnumeratedPath }`;
     - require the complete §7.8.3 physical-containment sequence for that existing component before accepting it;
     - a detected symbolic link, Windows generic reparse point, macOS mount point, junction, mount point, equivalent alias, or resolved escape blocks with `SOURCE_ROOT_PHYSICAL_ALIAS`;
     - only an authoritative non-alias passing component is accepted and traversal continues;
   - one or more collision-key matches exist but no match has the exact desired logical path → `SOURCE_ROOT_NAME_COLLISION`;
   - more than one exact-logical-path match → `SOURCE_ROOT_NAME_COLLISION`;
   - one exact logical match is a regular file/unsupported non-alias object → `SOURCE_PATH_OBSTRUCTED`;
   - one exact logical match whose authoritative physical observation is an alias, including a Windows generic reparse point or macOS mount point, → `SOURCE_ROOT_PHYSICAL_ALIAS`.

Consequences:

- existing raw NFD and desired NFC can be one logical path only when `NFC(rawPath) === desiredLogicalPath`; the raw spelling remains the resolved I/O path;
- existing `sources` and desired `Sources` collide but are not the same logical path and therefore block with `SOURCE_ROOT_NAME_COLLISION`;
- M03 never creates a second segment whose collision key is already represented by a different logical path.

After the walk classify:

```ts
type SourceRootState =
  | {
      kind: "existing";
      root: VaultPathAddress;
    }
  | {
      kind: "partially-missing";
      rootPath: string;
      nearestExistingParent: VaultPathAddress;
      missingFolders: VaultPathAddress[];
    }
  | {
      kind: "fully-missing";
      rootPath: string;
      nearestExistingParent: {
        logicalPath: "";
        resolvedPath: "";
      };
      missingFolders: VaultPathAddress[];
    }
  | {
      kind: "blocked";
      diagnostic: SourceWriterDiagnostic;
    };
```

Definitions:

- `existing`: all source-root segments have accepted exact-logical normal-directory matches;
- `partially-missing`: at least one leading segment exists and a later desired segment is absent;
- `fully-missing`: the first desired root segment is absent;
- `blocked`: first error selected by §7.8.

For missing states, construct each `missingFolders` address parent-first using the logical/resolved rules in §7.3.

Example where raw existing parent is NFD but logical NFC path is `Sources`:

```text
nearestExistingParent.logicalPath = "Sources"
nearestExistingParent.resolvedPath = "<exact raw enumerated spelling>"
missingFolders[0].logicalPath = "Sources/AI"
missingFolders[0].resolvedPath = "<exact raw enumerated spelling>/AI"
```

`SourceWritePlan.foldersToCreate` is exactly `missingFolders.map(folder => folder.logicalPath)`.

### 7.5 Existing ancestry and deterministic Preview model for missing descendants

For `existing`:

- registry discovery uses `root.resolvedPath`;
- root-derived `foldersToCreate` is empty;
- target occupancy uses the authoritative existing-parent rules in §10.8.

For `partially-missing` or `fully-missing`:

- validate every existing ancestry address physically and through Vault visibility;
- the first missing segment is authoritative only because §7.4 already obtained both:
  - no collision-key match from fresh enumeration of its actual existing parent; and
  - authoritative native `lstat: absent` for that exact intended child;
- registry is empty because the configured source-root directory does not exist at this Preview snapshot;
- `foldersToCreate` is exactly the parent-first logical paths in `missingFolders`;
- missing-root state alone emits no warning or error;
- planning proceeds without mutation.

Preview uses this closed internal occupancy state for every planned missing path:

```ts
interface PreviewAuthoritativeFirstMissingState {
  kind: "authoritative-first-missing";
  parent: VaultPathAddress;
  child: VaultPathAddress;
}

interface PreviewSyntheticMissingParentState {
  kind: "synthetic-parent-missing";
  parent: VaultPathAddress;
  child: VaultPathAddress;
}

type PreviewMissingPathState =
  PreviewAuthoritativeFirstMissingState | PreviewSyntheticMissingParentState;
```

The first missing folder uses `authoritative-first-missing`.

For every second or later planned missing folder whose immediate parent is itself a planned missing folder:

1. do **not** attempt Vault enumeration, Vault lookup, native `lstat`, `realpath`, Windows reparse observation, or physical traversal of that non-existent parent during Preview;
2. derive the child logical/resolved address only by the deterministic §7.3 planned-child rule;
3. record `synthetic-parent-missing` for Preview planning;
4. treat the child's occupancy as provisionally unoccupied **only for this Preview snapshot and only because its parent was authoritatively absent earlier in the same root-state evaluation**;
5. do not convert this synthetic state into `NativeLstatProbe: absent`, do not report it as a completed safety probe, and do not reuse it as Save-time mutation authorization.

The synthetic rule is not optimistic interpretation of an indeterminate native result. A first missing segment can enter this model only after authoritative absence was established. Any `indeterminate` probe before that point remains fail-closed under §7.8.

If the source root itself is planned missing, target-note Preview occupancy under that planned-missing parent follows the corresponding synthetic rule in §10.8.

Save never consumes `synthetic-parent-missing` as a mutation checkpoint. Folder creation remains parent-first. After each accepted `createFolder` fulfillment, Save must:

1. re-enumerate the now-existing actual parent under §7.6;
2. capture and verify the exact resolved address of the created folder;
3. use that authoritative resolved folder as the actual parent for the next planned descendant;
4. run the complete collision/native/alias/Vault-visibility checks immediately before the next folder or final note mutation.

An external object created after Preview is therefore handled by Save-time authoritative enumeration/replanning, not by pretending that a Preview synthetic descendant check was durable authorization.

Dry-run never creates missing folders.

### 7.6 Collision-aware folder-create checkpoint

This subsection is Save-time authoritative behavior only. It is never invoked during Preview for a `synthetic-parent-missing` descendant until that descendant's actual immediate parent exists and has an authoritative resolved address.

Immediately before a planned `createFolder`:

1. re-evaluate the current source operation token under §17 when called during Save;
2. locate the folder's current parent using the operation's latest resolved parent address;
3. fresh-enumerate the actual parent using `parent.resolvedPath`;
4. rerun the full §7.4 collision-key classification for the desired logical child;
5. inspect the exact intended resolved child through the §7.8.1 native probe algebra if no Vault-visible match exists;
6. any `indeterminate` probe blocks immediately with `SOURCE_NATIVE_PROBE_INDETERMINATE` and permits zero later mutation from this checkpoint;
7. repeat §7.8 physical containment and Vault-visibility checks on the current existing parent.

The checkpoint yields exactly one of:

```ts
type FolderCreateCheckpoint =
  | {
      kind: "missing-safe";
      address: VaultPathAddress;
    }
  | {
      kind: "exact-directory-present";
      address: VaultPathAddress;
    }
  | {
      kind: "blocked";
      diagnostic: SourceWriterDiagnostic;
    };
```

`exact-directory-present` means the environment changed since the displayed plan because that logical folder no longer requires this Save to create it. §17 maps that state to a refreshed plan before further mutation.

`blocked` uses the §7.8 diagnostic precedence.

After a fulfilled folder create:

1. re-enumerate the exact actual parent;
2. require exactly one exact-logical normal-directory match for the created logical path;
3. capture its exact raw enumerated path as the new `resolvedPath`;
4. verify physical containment and Vault visibility using that resolved path;
5. use that captured resolved address for every descendant I/O.

### 7.7 Vault visibility

Every existing ancestry address must resolve through Obsidian Vault API as a folder using its exact `resolvedPath`.

For a missing component, its current nearest existing resolved parent must be Vault-visible.

If an existing required directory is native-visible but cannot be resolved through Vault API at its resolved path, block with `SOURCE_ROOT_NOT_VAULT_VISIBLE`.

### 7.8 Native probe algebra, total component containment, and root-failure precedence

The dedicated desktop verifier may use only read-only:

- `lstat`;
- `realpath`;
- on Windows only, the `observeWindowsReparsePoint` abstraction defined in §7.8.1;
- on macOS only, the `observeMacOSMountPoint` abstraction defined in §7.8.1.

`observeWindowsReparsePoint` is authorized only to observe whether the existing path has Windows `FILE_ATTRIBUTE_REPARSE_POINT` (`0x00000400`) set, or to obtain a precisely equivalent native read-only observation whose truth condition is exactly generic Windows reparse-point presence. The observation must not mutate the object, follow the reparse target as a substitute for the attribute observation, launch a shell/child process, or provide general filesystem-write authority.

`observeMacOSMountPoint` is authorized only as a narrow in-process read-only Darwin volume-attribute observation. Its required native primitive is `getattrlist(2)` on the exact ingress-valid native object path with:

```text
attrlist.bitmapcount = ATTR_BIT_MAP_COUNT
attrlist.reserved = 0
attrlist.commonattr = ATTR_CMN_RETURNED_ATTRS
attrlist.volattr = ATTR_VOL_INFO | ATTR_VOL_MOUNTPOINT
attrlist.dirattr = 0
attrlist.fileattr = 0
attrlist.forkattr = 0
options = FSOPT_NOFOLLOW_ANY | FSOPT_REPORT_FULLSIZE
```

The returned attribute set must authoritatively include `ATTR_VOL_MOUNTPOINT`. The mount-point attribute is the volume mount-point path returned by the Darwin volume-attribute interface. The observation may additionally use the already-authorized read-only `realpath` primitive to canonicalize that returned mount-point path for equality comparison with the current object's already-resolved real path.

The macOS observation must not call `mount`, `unmount`, `setattrlist`, any write syscall, shell, child process, or general-purpose native mutation helper. A bundled/native bridge, if required, must expose only this exact read-only observation contract plus no filesystem mutation authority.

Node filesystem writes remain prohibited.

#### 7.8.1 Closed native-probe outcome algebra

Every safety-critical native `lstat`, `realpath`, platform alias observation, or direct native occupancy probe required by §§7, 8, 10, 15, or 17 must be normalized into this algebra before any M03 decision consumes it.

```ts
type NativeObjectKind =
  "directory" | "regular-file" | "symbolic-link" | "other";

type NativeLstatProbe =
  | {
      kind: "present";
      objectKind: NativeObjectKind;
    }
  | {
      kind: "absent";
    }
  | {
      kind: "indeterminate";
    };

type NativeRealpathProbe =
  | {
      kind: "resolved";
      realPath: string;
    }
  | {
      kind: "absent";
    }
  | {
      kind: "indeterminate";
    };

type WindowsReparsePointProbe =
  | {
      kind: "reparse-point";
    }
  | {
      kind: "not-reparse-point";
    }
  | {
      kind: "indeterminate";
    };

type MacOSMountPointProbe =
  | {
      kind: "mount-point";
    }
  | {
      kind: "not-mount-point";
    }
  | {
      kind: "indeterminate";
    };

type PlatformAliasCapabilityState =
  | {
      kind: "available";
      capability: "windows-reparse-point" | "macos-mount-point";
    }
  | {
      kind: "unavailable";
      capability: "windows-reparse-point" | "macos-mount-point";
    };

type NativeAliasObservation =
  | {
      kind: "alias";
      aliasKind:
        "symbolic-link" | "windows-reparse-point" | "macos-mount-point";
    }
  | {
      kind: "not-alias";
    }
  | {
      kind: "indeterminate";
    };
```

The native adapter classifies probe settlement without inspecting human-readable exception messages.

Before the first concrete platform-alias probe in each planner/Save replan, normalize the required platform observation capability into `PlatformAliasCapabilityState`. An `unavailable` state always maps to `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE` before any concrete alias probe and permits no fallback to `lstat`/`realpath` alone. After an `available` state has been established, a later per-path failure is a concrete probe `indeterminate`, not capability-unavailable.

For an `lstat` existence/occupancy probe:

- fulfilled `lstat` → `present` with the exact object kind above;
- a documented native not-found result equivalent to Node `ENOENT` → `absent`;
- capability absence, permission denial, I/O failure, malformed native result, unexpected rejection, or every rejection not authoritatively classified as not-found → `indeterminate`;
- `ENOTDIR` is not authoritative absence and is `indeterminate`.

For a `realpath` probe:

- fulfilled `realpath` with an ingress-valid external path string → `resolved`;
- an authoritative not-found result equivalent to Node `ENOENT` → `absent`;
- capability absence, permission denial, I/O failure, malformed result, unexpected rejection, or every non-not-found rejection → `indeterminate`;
- a returned ill-formed path string is handled first by §5.6.1 and is not converted into `indeterminate`.

For the Windows generic reparse-point observation:

- the capability is mandatory for the supported Windows 11 M03 source writer;
- before the first concrete Windows reparse observation in a planner/Save replan, inability to supply an observation equivalent to authoritative `FILE_ATTRIBUTE_REPARSE_POINT` presence blocks that planner with `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`; no fallback to `lstat`/`realpath` alone is permitted;
- after the capability has been established for the operation, a successful read showing the `FILE_ATTRIBUTE_REPARSE_POINT` bit set → `reparse-point`;
- a successful read showing that bit clear → `not-reparse-point`;
- permission denial, I/O failure, capability loss, malformed/ambiguous native result, unexpected rejection, or any result that cannot authoritatively distinguish bit-set from bit-clear → `indeterminate`;
- `reparse-point` is an authoritative specified-blocked alias state, not an `indeterminate` state and not `NativeObjectKind: "other"`;
- `realpath` containment never overrides a `reparse-point` result.

For the macOS mount-point observation:

- the capability is mandatory for the supported macOS M03 source writer;
- capability establishment occurs once per planner/Save replan before the first concrete macOS mount-point observation by invoking the exact §7.8 read-only `getattrlist(2)` contract against the ingress-valid native vault real path and requiring a structurally valid result whose returned-attribute set authoritatively includes `ATTR_VOL_MOUNTPOINT`;
- this capability-establishment call does not classify the vault base itself as a prohibited mount point; the vault base is the containment boundary;
- inability to invoke the exact observation, missing `ATTR_VOL_MOUNTPOINT`, unsupported attribute semantics, malformed attribute buffer/reference, inability to fatal-decode the returned mount-point bytes as UTF-8, or inability to provide the narrow read-only bridge before the first concrete object observation → capability unavailable and blocks the planner with `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`;
- after capability establishment, `observeMacOSMountPoint(nativePath, objectRealPath)` invokes the same exact `getattrlist(2)` request on the concrete existing object;
- the returned `ATTR_VOL_MOUNTPOINT` `attrreference` must be present, in-bounds, NUL-terminated, and fatal UTF-8 decodable; replacement decoding is forbidden;
- the decoded mount-point path must pass §5.6.1 external-path ingress before any path comparison or `realpath`;
- call the authorized native `realpath` probe on that returned mount-point path;
- mount-point-path `realpath: resolved` must pass §5.6.1;
- if the mount-point real path equals the already-resolved current-object real path byte-for-byte under the same native `realpath` implementation, return `mount-point`;
- if both real paths resolve authoritatively and are unequal, return `not-mount-point`;
- permission denial, I/O failure, capability loss, malformed/ambiguous returned attributes, invalid UTF-8, unexpected rejection, mount-point-path `realpath: absent`, mount-point-path `realpath: indeterminate`, or any result that cannot authoritatively decide equality → `indeterminate`;
- `mount-point` is an authoritative specified-blocked alias state, not an `indeterminate` state and not `NativeObjectKind: "other"`;
- ordinary `lstat` type and contained `realpath` never override `mount-point`.

Derive `NativeAliasObservation` for an existing `lstat: present` object exactly:

1. if `objectKind === "symbolic-link"`, return `{ kind: "alias", aliasKind: "symbolic-link" }`;
2. on Windows, for every other `objectKind`, invoke `observeWindowsReparsePoint` on the exact ingress-valid native path:
   - `reparse-point` → `{ kind: "alias", aliasKind: "windows-reparse-point" }`;
   - `not-reparse-point` → `{ kind: "not-alias" }`;
   - `indeterminate` → `{ kind: "indeterminate" }`;
3. on macOS, for every other `objectKind`, the object must first have an authoritative ingress-valid `realpath: resolved`; then invoke `observeMacOSMountPoint(nativePath, objectRealPath)`:
   - `mount-point` → `{ kind: "alias", aliasKind: "macos-mount-point" }`;
   - `not-mount-point` → `{ kind: "not-alias" }`;
   - `indeterminate` → `{ kind: "indeterminate" }`.

A Windows or macOS object below the vault containment boundary must not be trusted, traversed, read as registry identity, or used as a post-write verified object until its platform alias observation is authoritative.

`absent` is a safe absence only when the calling rule explicitly asks whether a not-yet-required child or final target currently exists.

For an object that the current root/registry/checkpoint state requires to exist:

- `lstat: absent` or `realpath: absent` means the current safety snapshot changed during evaluation;
- the current planner invocation fails closed with `SOURCE_NATIVE_PROBE_INDETERMINATE`;
- Save checkpoint settlement follows §§16–17;
- it is never silently converted to a missing child or safe target.

`indeterminate` is never equivalent to `absent`.

After any required native `lstat`, `realpath`, Windows reparse-point probe, or macOS mount-point probe returns `indeterminate`:

- the current planner/checkpoint cannot pass;
- no later source-folder/source-note mutation may be invoked from that checkpoint;
- the exact planner diagnostic is `SOURCE_NATIVE_PROBE_INDETERMINATE`;
- Save uses the exact §16 `safety-check-failed` result where §§17.5–17.8 require direct checkpoint settlement;
- no implementation may continue optimistically or infer absence, non-reparse, or non-mount-point status.

An authoritative Windows `reparse-point` or macOS `mount-point` is not a probe failure. It is a known blocked physical-alias state and maps to `SOURCE_ROOT_PHYSICAL_ALIAS` for source-root ancestry/checkpoints, `SOURCE_REGISTRY_PHYSICAL_ALIAS` for registry candidates, and the post-create verification mappings in §§15.3–15.4 and 17.9.

#### 7.8.2 Total native path-component containment boundary

Define:

```ts
function nativeContainmentPrefix(
  vaultRealPath: string,
  nativeSeparator: string,
): string {
  return vaultRealPath.endsWith(nativeSeparator)
    ? vaultRealPath
    : vaultRealPath + nativeSeparator;
}

function isNativePathContainedByVault(
  vaultRealPath: string,
  candidateRealPath: string,
  nativeSeparator: string,
): boolean {
  return (
    candidateRealPath === vaultRealPath ||
    candidateRealPath.startsWith(
      nativeContainmentPrefix(vaultRealPath, nativeSeparator),
    )
  );
}
```

Preconditions:

- `nativeSeparator` is exactly the current platform native path separator;
- both real-path strings were produced by the same native `realpath` implementation in the same operation;
- both strings passed §5.6.1 external-path ingress;
- no Unicode normalization or logical-path reconstruction is applied to either native real path before this containment test.

The boundary prefix appends one separator only when `vaultRealPath` does not already end with it.

Therefore it supports without double-separator false rejection:

- ordinary POSIX vault paths such as `/Users/a/Vault`;
- POSIX filesystem-root vault path `/`;
- ordinary Windows vault paths such as `C:\Vault`;
- separator-terminated Windows drive roots such as `C:\`;
- separator-terminated Windows share/root forms returned by the qualified native `realpath` implementation.

Component-boundary safety is retained because a non-root vault path such as `/vault` produces prefix `/vault/`, which does not match `/vault2`.

Separator-terminated vault real roots remain inside the supported macOS/Windows M03 source-writer domain and are not silently excluded.

#### 7.8.3 Required physical-containment probe sequence

At every required containment checkpoint:

1. obtain the native vault base path and require §5.6.1 ingress before native path work;
2. require all platform verifier capabilities before concrete probing:
   - Windows requires the §7.8.1 generic reparse-point observation;
   - macOS requires the §7.8.1 `getattrlist(2)`/`ATTR_VOL_MOUNTPOINT` observation;
   - capability absence here → `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`;
3. call native `realpath` for the vault base through §7.8.1;
4. `indeterminate`, or `absent` for this required-existing vault object → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
5. a `resolved` vault real path must pass §5.6.1;
6. for each existing component's exact ingress-valid `resolvedPath`, convert it to a native path without Unicode normalization;
7. call `lstat` through §7.8.1;
8. `indeterminate`, or `absent` for the required-existing component → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
9. if `objectKind === "symbolic-link"` → `SOURCE_ROOT_PHYSICAL_ALIAS`;
10. on Windows, derive the Windows portion of `NativeAliasObservation` before consuming non-symlink object type or trusting `realpath`:
    - `indeterminate` → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
    - `alias` → `SOURCE_ROOT_PHYSICAL_ALIAS`, regardless of eventual contained `realpath`;
    - `not-alias` → continue;
11. call `realpath` for the component through §7.8.1;
12. `indeterminate`, or `absent` for the required-existing component → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
13. require the returned resolved path string to pass §5.6.1;
14. on macOS, derive the macOS portion of `NativeAliasObservation` using that exact resolved object real path:
    - `indeterminate` → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
    - `alias` with `aliasKind: "macos-mount-point"` → `SOURCE_ROOT_PHYSICAL_ALIAS`, regardless of contained `realpath`;
    - `not-alias` → continue;
15. wrong `regular-file`/`other` type where a directory is required → `SOURCE_PATH_OBSTRUCTED`;
16. require `isNativePathContainedByVault(vaultRealPath, result, nativeSeparator)` to be true;
17. a resolved escape or any other supported-observation alias state → `SOURCE_ROOT_PHYSICAL_ALIAS`;
18. continue only after every required component produced authoritative passing non-alias results.

The vault base `realpath` establishes the containment boundary and capability-check location. The vault base itself is not classified as a prohibited nested mount point merely because it is the mount point of the volume containing the vault.

A platform/adapter that cannot supply its required native verifier at all is blocked before concrete probing with `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`. On Windows, the generic reparse-point observation is part of that required verifier capability. On macOS, the exact `getattrlist(2)`/`ATTR_VOL_MOUNTPOINT` observation is part of that required verifier capability.

Once a concrete object probe starts, every non-authoritative settlement from `lstat`, `realpath`, Windows reparse observation, or macOS mount-point observation uses `SOURCE_NATIVE_PROBE_INDETERMINATE`.

#### 7.8.4 Root-failure precedence

Root evaluation returns at most one root error, applying exactly:

| Priority | Condition                                                                                                                                                                                                                               | Diagnostic                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1        | root empty                                                                                                                                                                                                                              | `SOURCE_ROOT_UNCONFIGURED`                      |
| 2        | §7.1 lexical invalid                                                                                                                                                                                                                    | `INVALID_SOURCE_ROOT`                           |
| 3        | any externally supplied config/root-enumeration/native path string required for root evaluation fails §5.6.1                                                                                                                            | `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`          |
| 4        | §7.2 configDir equal/descendant                                                                                                                                                                                                         | `SOURCE_ROOT_CONFIG_DIR`                        |
| 5        | collision-key-equivalent different logical child or multiple exact logical matches                                                                                                                                                      | `SOURCE_ROOT_NAME_COLLISION`                    |
| 6        | concrete required `lstat`, `realpath`, Windows reparse-point probe, or macOS mount-point probe is indeterminate, or a required-existing object becomes authoritatively absent during its required probe sequence                        | `SOURCE_NATIVE_PROBE_INDETERMINATE`             |
| 7        | authoritative symlink, authoritative Windows generic reparse point, authoritative macOS mount point, junction/mount-point/equivalent alias, or resolved escape                                                                          | `SOURCE_ROOT_PHYSICAL_ALIAS`                    |
| 8        | required directory position occupied by regular file/unsupported authoritative non-alias object                                                                                                                                         | `SOURCE_PATH_OBSTRUCTED`                        |
| 9        | required physical-verifier capability unavailable before a concrete path probe can be performed, including unavailable Windows generic reparse observation capability or unavailable macOS `ATTR_VOL_MOUNTPOINT` observation capability | `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE` |
| 10       | required existing ancestry not Vault-visible                                                                                                                                                                                            | `SOURCE_ROOT_NOT_VAULT_VISIBLE`                 |

External invalid-Unicode ingress always precedes native probe classification for a returned path string.

`SOURCE_NATIVE_PROBE_INDETERMINATE` always prevents later mutation and is never downgraded to absence.

An authoritative Windows generic `reparse-point` or authoritative macOS `mount-point` always wins over `objectKind` obstruction classification and uses `SOURCE_ROOT_PHYSICAL_ALIAS`.

Alias failures always use `SOURCE_ROOT_PHYSICAL_ALIAS`.

Global planning order is defined only in §9.3.

## 8. Source registry: durable trust contract

### 8.1 Discovery for each root state

Registry discovery behavior:

- `existing` root → inspect only direct-child Markdown files using the root's exact `resolvedPath`;
- `partially-missing` root → return empty registry after nearest existing parent validation;
- `fully-missing` root → return empty registry after vault-root validation;
- `blocked` root → do not attempt registry discovery.

M03 writes source notes directly inside `sourceRoot`; it does not use nested source-note subdirectories. Registry discovery is intentionally non-recursive.

For an `existing` root:

1. fresh-enumerate direct Vault-visible children using `root.resolvedPath`;
2. if direct-child enumeration fails or cannot produce a stable complete list for this invocation, planning blocks with `SOURCE_REGISTRY_ENUMERATION_FAILED`;
3. for every direct child path returned by enumeration:
   - require §5.6.1 external path ingress before any filename test, NFC normalization, collision-key derivation, or native-path construction;
   - an ingress failure blocks immediately with `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
   - retain the ingress-valid exact raw Vault-relative path as `resolvedPath`;
   - derive `logicalPath = NFC(resolvedPath)`;
4. consider only direct-child files whose ingress-valid raw filename ends exactly in lowercase ASCII `.md`;
5. do not traverse any child directory, including child alias directories;
6. sort candidate logical paths under §10.2;
7. if two enumerated candidate objects normalize to the same logical path, registry access fails closed with `SOURCE_REGISTRY_ENUMERATION_FAILED`;
8. before reading each candidate:
   - use exact candidate `resolvedPath`;
   - call native `lstat` through §7.8.1 without normalization;
   - `lstat: indeterminate` or required-candidate `absent` → block with `SOURCE_NATIVE_PROBE_INDETERMINATE`;
   - `lstat: present` with `objectKind === "symbolic-link"` → block with `SOURCE_REGISTRY_PHYSICAL_ALIAS`;
   - on Windows, every other `lstat: present` candidate must receive the §7.8.1 generic reparse observation before type trust:
     - `reparse-point` → block with `SOURCE_REGISTRY_PHYSICAL_ALIAS`, even with contained eventual `realpath`;
     - `indeterminate` → block with `SOURCE_NATIVE_PROBE_INDETERMINATE`;
     - `not-reparse-point` → continue;
   - call native `realpath` through §7.8.1;
   - `realpath: indeterminate` or required-candidate `absent` → block with `SOURCE_NATIVE_PROBE_INDETERMINATE`;
   - `realpath: resolved` must pass §5.6.1;
   - on macOS, every non-symbolic candidate must receive the §7.8.1 `observeMacOSMountPoint` observation using that candidate real path before type trust:
     - `mount-point` → block with `SOURCE_REGISTRY_PHYSICAL_ALIAS`, even with contained `realpath`;
     - `indeterminate` → block with `SOURCE_NATIVE_PROBE_INDETERMINATE`;
     - `not-mount-point` → continue;
   - the authoritative non-alias object must be a regular file; otherwise block with `SOURCE_REGISTRY_READ_FAILED`;
   - the candidate real path must satisfy §7.8.2 containment under the vault real path;
9. fresh-read the candidate as exact raw bytes through an Obsidian-supported binary-read adapter operation using exact `resolvedPath`;
   - a text-decoding read is insufficient for registry trust;
   - if exact raw bytes cannot be obtained, block with `SOURCE_REGISTRY_READ_FAILED`;
10. after the read, re-enumerate the direct-child candidate and rerun the complete step 8 physical observation sequence on the same resolved/logical path; this includes an authoritative Windows `not-reparse-point` or macOS `not-mount-point` result as applicable;
11. disappearance, unreadability, type change, path change, authoritative alias/mount-point transition, or physical unverifiability during mandatory fresh read blocks with `SOURCE_REGISTRY_READ_FAILED`; a concrete indeterminate native/platform-alias probe retains the higher-precedence `SOURCE_NATIVE_PROBE_INDETERMINATE`;
12. parse trusted frontmatter under §§8.2–8.3;
13. if untrusted, evaluate the exact malformed-warning predicate in §8.4.

A nested directory's contents are never registry identity input, so descendant aliases cannot introduce registry bytes.

Metadata-cache frontmatter may be a non-authoritative UI hint only and never determines registry identity.

### 8.2 Exact registry frontmatter byte grammar

Byte constants:

```text
LF byte = 0x0A
ASCII backslash byte = 0x5C
ASCII letter n byte = 0x6E
```

`ASCII backslash followed by lowercase n` means exactly bytes `0x5C 0x6E`; it never means LF.

A trusted registry note must:

- begin at byte offset 0 with exactly `0x2D 0x2D 0x2D 0x0A`;
- contain no UTF-8 BOM;
- use `0x0A` as the only frontmatter line terminator;
- contain a closing delimiter line with exactly bytes `0x2D 0x2D 0x2D` followed by `0x0A` in the complete note;
- close within first 32 frontmatter lines;
- close within first 16,384 UTF-8 bytes including delimiters and LF bytes;
- contain no blank frontmatter line;
- contain unique keys only;
- contain allowed keys only.

Every frontmatter field-line byte sequence between the opening and closing delimiters must be decoded using the WHATWG UTF-8 decoder in **fatal** mode.

Equivalent required semantics are:

```ts
new TextDecoder("utf-8", { fatal: true }).decode(fieldLineBytes);
```

If any field-line byte sequence contains invalid UTF-8, trusted parsing fails immediately for that candidate.

Replacement decoding is forbidden and the registry byte decoder must never introduce U+FFFD.

After successful fatal decoding, each field line must be exactly:

```text
<key>: <value>
```

followed in the file by one `0x0A`.

`<key>` matches `[a-z0-9_]+`.

Duplicate keys, unknown keys, multiline YAML, aliases, tags, comments, arrays, objects, bare strings where JSON string is required, BOM, CRLF, non-top-of-file frontmatter, or any fatal UTF-8 decode failure make the note untrusted.

The registry parser is a strict byte parser for this generated subset, not a permissive YAML identity parser.

Its byte-to-string conversion is always the fatal UTF-8 rule above and is identical for ordinary registry discovery, writer-self-trust, and post-write rediscovery.

### 8.3 Complete trusted field schema

| Frontmatter key              | Required | Exact type/value                                | Registry mapping         |
| ---------------------------- | -------- | ----------------------------------------------- | ------------------------ |
| `chat2vault_schema`          | yes      | bare decimal integer `1`                        | `schemaVersion = 1`      |
| `type`                       | yes      | JSON string exactly `"ai-conversation-source"`  | discriminator            |
| `source_provider`            | yes      | JSON string `"chatgpt"`                         | `provider`               |
| `source_conversation_id`     | no       | non-empty JSON string                           | `providerConversationId` |
| `source_content_fingerprint` | yes      | JSON string matching `^sha256:[0-9a-f]{64}$`    | `contentFingerprint`     |
| `source_import_fingerprint`  | yes      | JSON string matching `^sha256:[0-9a-f]{64}$`    | `importFingerprint`      |
| `source_message_count`       | yes      | bare decimal `0` or `[1-9][0-9]*`, safe integer | validation only          |
| `imported_at`                | yes      | canonical ISO timestamp JSON string             | validation only          |
| `source_created_at`          | no       | canonical ISO timestamp JSON string             | validation only          |
| `source_updated_at`          | no       | canonical ISO timestamp JSON string             | validation only          |
| `knowledge_status`           | yes      | JSON string exactly `"source"`                  | discriminator            |

Every JSON string value decoded from a registry field must satisfy `isM03WellFormedString` from §5.6. A decoded lone-surrogate value makes the candidate untrusted.

A canonical ISO timestamp is exactly the total non-throwing predicate defined in §11.3. Extended-year forms, malformed dates, impossible calendar dates, leap seconds, and every other non-matching string are noncanonical.

`source_import_fingerprint` is mandatory for every trusted M03 registry entry.

### 8.4 Exact malformed Chat2Vault-like warning predicate

A registry candidate that fails the trusted parser receives `MALFORMED_SOURCE_REGISTRY_ENTRY` if and only if `isChat2VaultLikeMalformed(rawBytes)` below is true.

This predicate is used only for warning membership. It never makes a candidate trusted.

Apply exactly:

1. inspect at most the first 16,384 bytes of the candidate;
2. for this warning probe only, if the file begins with UTF-8 BOM bytes `0xEF 0xBB 0xBF`, skip exactly those three bytes before probing line 1; the BOM still makes trusted parsing fail;
3. split the probe into at most 32 logical lines using either:
   - LF byte `0x0A`; or
   - CRLF bytes `0x0D 0x0A`;
4. lone `0x0D` is not a line terminator for the warning probe;
5. after optional BOM removal, logical line 1 must have exactly bytes `0x2D 0x2D 0x2D`; otherwise return false;
6. starting at logical line 2, inspect lines through the earlier of:
   - the first later line exactly `---`;
   - logical line 32;
   - end of the 16,384-byte probe;
7. set `hasTypeDiscriminator = true` if at least one inspected line is byte-for-byte ASCII:

```text
type: "ai-conversation-source"
```

8. set `hasKnowledgeStatusDiscriminator = true` if at least one inspected line is byte-for-byte ASCII:

```text
knowledge_status: "source"
```

9. return true only when both booleans are true.

Consequences are exact:

- correct discriminator lines with BOM → malformed warning;
- correct discriminator lines with CRLF frontmatter → malformed warning;
- missing closing delimiter with both exact discriminator lines in probe → malformed warning;
- duplicate discriminator lines still satisfy warning predicate, while trusted parser rejects duplicate keys;
- malformed discriminator key/value syntax does not satisfy that discriminator;
- missing/broken opening delimiter on first logical line → no malformed warning;
- ordinary Markdown body containing either/both discriminator text without opening line `---` → no malformed warning;
- frontmatter-like content with only one exact discriminator → no malformed warning.

Warning membership depends only on this raw-byte predicate, not permissive YAML parsing, UTF-8 replacement decoding, or substring search.

Fatal UTF-8 failure in the trusted parser does not itself suppress or force a warning.

After trusted parsing fails for invalid UTF-8, §8.4 is evaluated against the original raw bytes:

- exact raw ASCII opening/discriminator conditions satisfied → emit `MALFORMED_SOURCE_REGISTRY_ENTRY`;
- otherwise → no malformed warning;
- invalid UTF-8 outside the exact discriminator lines does not alter discriminator matching;
- invalid bytes inside a discriminator line prevent that line from being an exact ASCII discriminator match.

Trusted status and malformed-warning membership are therefore deterministic for the same exact bytes.

### 8.5 Registry entry and logical/resolved address

```ts
interface SourceRegistryEntry {
  schemaVersion: 1;
  path: string;
  provider: "chatgpt";
  providerConversationId?: string;
  contentFingerprint: string;
  importFingerprint: string;
}
```

`SourceRegistryEntry.path` is always candidate `logicalPath`, never raw `resolvedPath`.

The adapter retains resolved path transiently alongside the trusted entry for current-operation I/O.

`providerConversationId` is present only when frontmatter field exists and decoded JSON string is non-empty.

An untrusted note is ignored for identity decisions.

A malformed Chat2Vault-like candidate emits one warning under §8.4.

An unrelated candidate emits no registry warning.

### 8.6 Freshness and instability

Dry-run and Save invoke only authoritative §9.3 state machine.

At registry-access stage:

- current direct-child enumeration is authoritative for that invocation;
- exact raw/resolved path and canonical logical path are captured together;
- every candidate current bytes are fresh-read through resolved path;
- no decision relies solely on prior in-memory/metadata cache;
- any enumerated/candidate/native path-like string failing §5.6.1 → `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
- enumeration instability/failure not caused by invalid path-string ingress → `SOURCE_REGISTRY_ENUMERATION_FAILED`;
- candidate read/disappearance/type/address instability after authoritative native probes → `SOURCE_REGISTRY_READ_FAILED`;
- direct-child candidate `lstat`, `realpath`, or Windows generic reparse-point observation `indeterminate`, or authoritative disappearance of a required candidate during its required probe sequence → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
- authoritative direct-child symbolic-link/Windows-generic-reparse alias or realpath escape → `SOURCE_REGISTRY_PHYSICAL_ALIAS`, even when a generic Windows reparse point resolves to a pathname still inside the vault.

Immediately before final note creation, Save invokes §9.3 again under §17.

### 8.7 Writer-self-trust invariant

Before any `new` or `new-version` plan may be returned:

1. render complete frontmatter under §11;
2. require every §8.2 byte/line/grammar limit;
3. parse exact rendered frontmatter bytes through the same strict registry parser, including the identical fatal UTF-8 decoder from §8.2;
4. require parsed identity to equal intended provider/conversation/content/import identity;
5. only then may writable plan be returned.

Failure blocks with `INVALID_SOURCE_RENDER_INPUT`.

Worst-case JSON escaping is measured on exact rendered UTF-8 frontmatter bytes.

### 8.8 Duplicate registry entries

If more than one trusted entry has same provider + content fingerprint:

- disposition `duplicate`;
- zero vault-content mutation;
- select lexicographically smallest logical path under §10.2 as `existingPath`;
- return all matching logical paths in same sorted order as `duplicatePaths`;
- emit exactly one `DUPLICATE_SOURCE_REGISTRY_ENTRY` after malformed warnings;
- never delete or merge duplicates.

## 9. Writer diagnostics and classification

### 9.1 Closed diagnostic object and code contract

```ts
type SourceWriterDiagnosticSeverity = "warning" | "error";

type SourceWriterDiagnosticCode =
  | "DUPLICATE_SOURCE_REGISTRY_ENTRY"
  | "MALFORMED_SOURCE_REGISTRY_ENTRY"
  | "UNSUPPORTED_SOURCE_WRITER_PLATFORM"
  | "SOURCE_ROOT_SETTING_PENDING"
  | "SOURCE_PREVIEW_IN_PROGRESS"
  | "SOURCE_EXTERNAL_PATH_INVALID_UNICODE"
  | "SOURCE_ROOT_UNCONFIGURED"
  | "INVALID_SOURCE_ROOT"
  | "SOURCE_ROOT_CONFIG_DIR"
  | "SOURCE_ROOT_NAME_COLLISION"
  | "SOURCE_ROOT_PHYSICAL_ALIAS"
  | "SOURCE_ROOT_NOT_VAULT_VISIBLE"
  | "SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE"
  | "SOURCE_NATIVE_PROBE_INDETERMINATE"
  | "SOURCE_PATH_OBSTRUCTED"
  | "SOURCE_PATH_TOO_LONG"
  | "SOURCE_PATH_COLLISION"
  | "SOURCE_REGISTRY_ENUMERATION_FAILED"
  | "SOURCE_REGISTRY_READ_FAILED"
  | "SOURCE_REGISTRY_PHYSICAL_ALIAS"
  | "UNSUPPORTED_SOURCE_PROVIDER"
  | "SOURCE_TOPOLOGY_UNAVAILABLE"
  | "INVALID_SOURCE_RENDER_INPUT"
  | "STALE_SOURCE_WRITE_PLAN"
  | "SOURCE_WRITE_IN_PROGRESS"
  | "SOURCE_WRITE_TARGET_CHANGED"
  | "SOURCE_WRITE_FAILED"
  | "SOURCE_WRITE_VERIFICATION_FAILED";

interface SourceWriterDiagnostic {
  code: SourceWriterDiagnosticCode;
  severity: SourceWriterDiagnosticSeverity;
  message: string;
}

type SourceWriteExecutionDiagnosticCode =
  | "SOURCE_ROOT_SETTING_PENDING"
  | "SOURCE_PREVIEW_IN_PROGRESS"
  | "STALE_SOURCE_WRITE_PLAN"
  | "SOURCE_WRITE_IN_PROGRESS"
  | "SOURCE_NATIVE_PROBE_INDETERMINATE"
  | "SOURCE_WRITE_TARGET_CHANGED"
  | "SOURCE_WRITE_FAILED"
  | "SOURCE_WRITE_VERIFICATION_FAILED";

interface SourceWriteExecutionDiagnostic extends SourceWriterDiagnostic {
  code: SourceWriteExecutionDiagnosticCode;
  severity: "error";
}
```

A diagnostic object has exactly the three own enumerable keys `code`, `severity`, and `message`. Additional fields are forbidden.

For every valid diagnostic object, `severity` and `message` are determined solely by `code` through this table:

| Code                                            | Severity | Exact message                                                                                                      |
| ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `DUPLICATE_SOURCE_REGISTRY_ENTRY`               | warning  | `Multiple source notes represent the same source fingerprint; no additional note will be written.`                 |
| `MALFORMED_SOURCE_REGISTRY_ENTRY`               | warning  | `A Chat2Vault-like source note has invalid registry frontmatter and was ignored.`                                  |
| `UNSUPPORTED_SOURCE_WRITER_PLATFORM`            | error    | `Source-note writing is not qualified on this operating system in M03.`                                            |
| `SOURCE_ROOT_SETTING_PENDING`                   | error    | `The source folder setting is still being saved; wait for it to settle before previewing or saving a source note.` |
| `SOURCE_PREVIEW_IN_PROGRESS`                    | error    | `A source-note Preview is already in progress; wait for it to settle before starting another Preview or Save.`     |
| `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`          | error    | `An external vault or filesystem path contains invalid Unicode and cannot be used safely.`                         |
| `SOURCE_ROOT_UNCONFIGURED`                      | error    | `Configure a source folder before previewing or saving a source note.`                                             |
| `INVALID_SOURCE_ROOT`                           | error    | `The configured source folder is not a valid Chat2Vault vault-relative path.`                                      |
| `SOURCE_ROOT_CONFIG_DIR`                        | error    | `The configured source folder must not be the Obsidian configuration directory or a descendant of it.`             |
| `SOURCE_ROOT_NAME_COLLISION`                    | error    | `The configured source folder collides with an existing path under Chat2Vault path-equivalence rules.`             |
| `SOURCE_ROOT_PHYSICAL_ALIAS`                    | error    | `The configured source path uses or resolves through an unsupported filesystem alias.`                             |
| `SOURCE_ROOT_NOT_VAULT_VISIBLE`                 | error    | `The configured source folder is not safely visible through the Obsidian Vault API.`                               |
| `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE` | error    | `Physical containment of the configured source folder could not be verified.`                                      |
| `SOURCE_NATIVE_PROBE_INDETERMINATE`             | error    | `A required native filesystem safety probe did not return an authoritative result.`                                |
| `SOURCE_PATH_OBSTRUCTED`                        | error    | `The planned source path is obstructed by an incompatible existing filesystem object.`                             |
| `SOURCE_PATH_TOO_LONG`                          | error    | `The planned source path exceeds the supported deterministic path limits.`                                         |
| `SOURCE_PATH_COLLISION`                         | error    | `Every deterministic source filename candidate is already occupied.`                                               |
| `SOURCE_REGISTRY_ENUMERATION_FAILED`            | error    | `The source registry could not be enumerated safely from current vault contents.`                                  |
| `SOURCE_REGISTRY_READ_FAILED`                   | error    | `A current source-registry candidate could not be read safely.`                                                    |
| `SOURCE_REGISTRY_PHYSICAL_ALIAS`                | error    | `A source-registry candidate uses or resolves through an unsupported filesystem alias.`                            |
| `UNSUPPORTED_SOURCE_PROVIDER`                   | error    | `The selected conversation provider is not supported for M03 source writing.`                                      |
| `SOURCE_TOPOLOGY_UNAVAILABLE`                   | error    | `The selected conversation topology cannot be represented safely by the M03 source-note contract.`                 |
| `INVALID_SOURCE_RENDER_INPUT`                   | error    | `The selected canonical source contains invalid values for deterministic source-note rendering.`                   |
| `STALE_SOURCE_WRITE_PLAN`                       | error    | `The source-note plan became stale before the write could complete.`                                               |
| `SOURCE_WRITE_IN_PROGRESS`                      | error    | `A source-note write is already in progress.`                                                                      |
| `SOURCE_WRITE_TARGET_CHANGED`                   | error    | `The source-note target changed before creation; review the refreshed plan before saving.`                         |
| `SOURCE_WRITE_FAILED`                           | error    | `The source note could not be created safely.`                                                                     |
| `SOURCE_WRITE_VERIFICATION_FAILED`              | error    | `The created source note could not be verified against the approved write plan.`                                   |

Messages contain no imported source text, provider IDs, or hostile raw paths.

### 9.2 Discriminated dry-run plan union

```ts
interface NewSourceWritePlan {
  disposition: "new";
  targetPath: string;
  noteContent: string;
  noteContentFingerprint: string;
  foldersToCreate: string[];
  diagnostics: SourceWriterDiagnostic[];
}

interface NewVersionSourceWritePlan {
  disposition: "new-version";
  targetPath: string;
  noteContent: string;
  noteContentFingerprint: string;
  foldersToCreate: string[];
  previousVersionPaths: string[];
  diagnostics: SourceWriterDiagnostic[];
}

interface DuplicateSourceWritePlan {
  disposition: "duplicate";
  existingPath: string;
  duplicatePaths: string[];
  foldersToCreate: [];
  diagnostics: SourceWriterDiagnostic[];
}

interface BlockedSourceWritePlan {
  disposition: "blocked";
  foldersToCreate: [];
  diagnostics: SourceWriterDiagnostic[];
}

type SourceWritePlan =
  | NewSourceWritePlan
  | NewVersionSourceWritePlan
  | DuplicateSourceWritePlan
  | BlockedSourceWritePlan;
```

Invariants:

- only `new` and `new-version` carry `targetPath`, `noteContent`, and `noteContentFingerprint`;
- only `new-version` carries non-empty `previousVersionPaths`;
- writable and duplicate plan diagnostics contain warnings only;
- `duplicate` has at least one `duplicatePaths` entry and no writable note/path content;
- `blocked` has exactly one error plus any preceding deterministic warnings and no writable note/path content;
- `foldersToCreate` is parent-first, unique, NFC-normalized, and empty for `duplicate`/`blocked`;
- UI Save eligibility is true only for a current `new` or `new-version` plan;
- for a writable plan, `noteContent` is the exact well-formed JavaScript string defined in §13.6 and `serializedNoteBytes` is the derived value `UTF8(noteContent)`; `serializedNoteBytes` is not an additional plan field.

### 9.3 Authoritative planning state machine and diagnostic order

This section is the only normative global evaluation order for dry-run and Save-time replan.

Sections 7, 8, 10, 11, 13, and 14 define operations used by this state machine and must not restate or reorder this sequence.

Execute exactly:

1. **Source-root persistence gate.**
   - if `sourceRootPersistenceState.status === "pending"` under §6.9, return `blocked` with only `SOURCE_ROOT_SETTING_PENDING`;
   - no platform/provider/root/registry/topology/path/render operation occurs while root persistence is pending.
2. **Platform gate.**
   - unsupported under §23 → return `blocked` with only `UNSUPPORTED_SOURCE_WRITER_PLATFORM`.
3. **Provider gate.**
   - provider other than `chatgpt` → return `blocked` with only `UNSUPPORTED_SOURCE_PROVIDER`.
4. **Root/config/external-path evaluation.**
   - evaluate §§5.6.1–5.6.2 and 7.1–7.8;
   - any required config/Vault/native external path-like string that fails ingress → return `blocked` with only `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
   - otherwise root blocked → return `blocked` with only the one root error selected by §7.8;
   - any concrete native `lstat`, `realpath`, Windows generic reparse-point, or macOS mount-point safety probe that is `indeterminate`, or any object required by the current safety snapshot that becomes authoritatively absent during its probe sequence, returns `blocked` with only `SOURCE_NATIVE_PROBE_INDETERMINATE`;
   - an authoritative Windows generic `reparse-point` or macOS `mount-point` in source-root ancestry returns `blocked` with only `SOURCE_ROOT_PHYSICAL_ALIAS`, even if `realpath` remains contained;
   - missing required Windows reparse-observation capability or macOS mount-point-observation capability before concrete probing returns `blocked` with only `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`;
   - `indeterminate` is never interpreted as path absence, non-reparse status, or non-mount-point status.
5. **Pre-allocation canonical content-fingerprint and identity-string gate.**
   - require `conversation.contentFingerprint` to be a string matching exactly `^sha256:[0-9a-f]{64}$`;
   - if a non-empty `providerConversationId` is present, require `isM03WellFormedString(providerConversationId)` from §5.6;
   - either failure → return `blocked` with only `INVALID_SOURCE_RENDER_INPUT`;
   - no registry enumeration, duplicate/version classification, or path allocation occurs after either failure.
6. **Registry enumeration/access.**
   - apply §§5.6.1, 8.1, and 8.6 for current root state;
   - any returned registry candidate/address/native path string failing ingress → return `blocked` with only `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
   - enumeration instability/failure not caused by ingress → return `blocked` with only `SOURCE_REGISTRY_ENUMERATION_FAILED`;
   - direct-child registry candidate `lstat`, `realpath`, Windows generic reparse-point observation, or macOS mount-point observation `indeterminate`, or authoritative disappearance of a required candidate during its required native probe sequence → return `blocked` with only `SOURCE_NATIVE_PROBE_INDETERMINATE`;
   - direct-child registry candidate authoritative symbolic-link/Windows-generic-reparse/macOS-mount-point alias or outside containment after authoritative probes → return `blocked` with only `SOURCE_REGISTRY_PHYSICAL_ALIAS`;
   - candidate unreadable/disappeared/type/address instability during mandatory byte read after authoritative native probes → return `blocked` with only `SOURCE_REGISTRY_READ_FAILED`.
7. **Registry parse and malformed-warning membership.**
   - trusted candidates become registry entries;
   - for every untrusted candidate, apply exactly §8.4 raw-byte predicate;
   - emit one `MALFORMED_SOURCE_REGISTRY_ENTRY` only when that predicate returns true;
   - sort malformed warnings by candidate logical path under §10.2;
   - these are the first possible planning warnings.
8. **Topology derivation.**
   - apply exact runtime schema and derivation in §13;
   - failure → return `blocked` with step-7 warnings followed by exactly one `SOURCE_TOPOLOGY_UNAVAILABLE`.
9. **Exact duplicate classification.**
   - find trusted entries with same provider + exact valid content fingerprint;
   - one exact entry → return `duplicate` with step-7 warnings;
   - more than one exact entry → append exactly one `DUPLICATE_SOURCE_REGISTRY_ENTRY` after all step-7 warnings, then return `duplicate`;
   - exact duplicate wins over every version relationship.
10. **Version classification.**
    - only if selected provider conversation ID is present/non-empty and well-formed under §11.2, find entries with same provider + same present conversation ID + different content fingerprint;
    - matches → provisional `new-version`, with logical `previousVersionPaths` sorted under §10.2;
    - absent/empty selected ID → provisional `new`;
    - absent IDs never match each other.
11. **Path allocation.**
    - because step 5 has already validated content fingerprint format, §10.6 suffix derivation is defined;
    - apply §10 against current logical/resolved occupancy snapshot;
    - path error → return `blocked` with step-7 warnings followed by exactly one path error.
12. **Full render validation and writer-self-trust.**
    - apply §§8.7 and 11–13;
    - this validates source/import/message fingerprints, required imported timestamp, topology/render types, exact well-formed output bytes, and writer-self-trust not already required by step 5;
    - error → return `blocked` with step-7 warnings followed by exactly one `INVALID_SOURCE_RENDER_INPUT` or `SOURCE_TOPOLOGY_UNAVAILABLE`.
13. **Writable plan.**
    - return provisional `new` or `new-version` with step-7 warnings only.

There are no other M03 planning warnings.

Global plan diagnostic order is total:

1. zero or more path-ordered `MALFORMED_SOURCE_REGISTRY_ENTRY` warnings;
2. optional `DUPLICATE_SOURCE_REGISTRY_ENTRY`, only for duplicate plan with multiple exact entries;
3. at most one final error for blocked plan.

Source-root-pending/platform/provider/root/content-fingerprint/identity-string/registry-access failures occur before malformed-warning membership and therefore return no registry warnings.

## 10. Stable path comparison and deterministic filename allocation

### 10.1 Collision key

```text
pathCollisionKey(path) = NFC(path).toLowerCase()
```

using ECMAScript locale-independent `toLowerCase()`.

Equal keys are treated as collisions even on a case-sensitive filesystem.

### 10.2 Stable path comparator

Compare NFC-normalized strings by Unicode code point from left to right.

If shared code points are equal, shorter string sorts first.

### 10.3 UTC date

Use the total timestamp predicate `isCanonicalM03Timestamp` from §11.3.

If `conversation.createdAt` is canonical:

```text
date = conversation.createdAt.slice(0, 10)
```

If it is missing or noncanonical:

```text
date = "Undated"
```

The accepted timestamp grammar is UTC-only and four-digit-year-only, so the first ten ASCII characters are exactly `YYYY-MM-DD`.

Do not call `Date`, `Date.parse`, or `toISOString()` for filename-date classification.

A noncanonical `createdAt` does not block rendering; it is treated as absent everywhere in M03.

The same optional-timestamp rule applies to `updatedAt` and message `createdAt`.

### 10.4 Safe-title transformation

Input is canonical title if present/non-empty; otherwise `Untitled conversation`.

Apply exactly:

1. transform input with `toM03WellFormedString` from §5.6;
2. NFC normalize the transformed string;
3. CRLF and lone CR → LF.
4. Replace each U+0000–U+001F, U+007F–U+009F, or ASCII `< > : " / \ | ? *` code point with ASCII `-`.
5. Replace each maximal ECMAScript whitespace run (`\s+`) with one ASCII space.
6. Replace each maximal ASCII `-` run with one ASCII `-`.
7. Remove leading/trailing ASCII space, `.`, and `-`.
8. If empty, use `Untitled conversation`.
9. Keep first 80 Unicode code points.
10. Repeat step 7.
11. If empty, use `Untitled conversation`.

No separate slash-stripping rule exists.

### 10.5 Filename component fit

Before collision attempts, fit safe title against:

```text
<date> - Source - <safe-title> - <64-hex-fingerprint>.md
```

While complete filename exceeds either:

- 180 UTF-16 code units; or
- 240 UTF-8 bytes,

remove the last Unicode code point from safe title and reapply trim step 7 from §10.4.

If empty, use and similarly fit `Untitled conversation`.

If even fallback cannot fit, block with `SOURCE_PATH_TOO_LONG`.

### 10.6 Fingerprint suffix

`contentFingerprint` must match:

```text
^sha256:[0-9a-f]{64}$
```

Candidate suffix lengths are exactly:

```text
12
20
32
64
```

Candidate filename:

```text
<date> - Source - <fitted-title> - <hex-prefix>.md
```

### 10.7 Target path limits

Target path:

```text
<normalized-sourceRoot>/<candidate-filename>
```

must be NFC and satisfy:

- ≤1024 UTF-16 code units;
- ≤2048 UTF-8 bytes.

Otherwise block with `SOURCE_PATH_TOO_LONG`.

### 10.8 Occupancy for logical/resolved paths and planned-missing parents

Occupancy is computed on canonical logical paths but discovered and verified through exact resolved I/O paths whenever the relevant parent actually exists.

For an existing root or any target whose immediate parent exists at Preview time:

1. enumerate Vault-visible direct children of the resolved parent as required by the current operation;
2. for every enumerated object retain exact raw `resolvedPath` after §5.6.1 ingress;
3. derive `logicalPath = NFC(resolvedPath)`;
4. index logical paths by `pathCollisionKey`;
5. use direct Vault lookup and §7.8.1 native probes where this section or §7 requires them.

For a partially/fully missing root, Preview distinguishes two cases.

**First missing folder:** its parent exists. The authoritative no-collision + native-absence result was already established by §7.4 and is reused only within the same Preview root-state snapshot.

**Descendant whose immediate parent is planned missing:** apply §7.5 `synthetic-parent-missing` exactly:

- do not enumerate or probe the non-existent immediate parent or child during Preview;
- compute only deterministic logical/resolved addresses;
- treat the child as provisionally unoccupied for Preview plan construction;
- do not describe that state as authoritative native absence.

If the final source-root parent of the planned note is still planned missing during Preview:

- no Vault/native target occupancy probe is performed because the immediate parent does not yet exist;
- every deterministic filename candidate is therefore evaluated against synthetic empty occupancy for that planned parent;
- the first otherwise-valid suffix candidate from §10.9 is selected in the Preview plan;
- this selection is provisional Preview state, not mutation authorization.

If the source-root parent exists during Preview, target occupancy is authoritative and a candidate is occupied when any of these holds:

- an enumerated file has the same logical collision key;
- an enumerated directory has the same logical collision key;
- direct Vault lookup using the exact resolved candidate path reports any object;
- §7.8.1 native `lstat` using the exact resolved candidate path returns `present`.

For final-target occupancy under an existing parent, `lstat: absent` is authoritative unoccupied only because that specific probe asks whether the not-yet-created target exists.

`lstat: indeterminate` blocks planning with `SOURCE_NATIVE_PROBE_INDETERMINATE` and is never treated as unoccupied.

An existing directory at a candidate `.md` path is occupied.

Unrelated or malformed Markdown still counts as occupancy.

No Vault/native lookup may substitute the logical NFC spelling for a different resolved raw spelling of an already-existing parent.

During Save, synthetic Preview occupancy is discarded. As missing folders become actual authoritative folders, §7.6 and §§17.5–17.7 perform fresh real enumeration/native/alias/occupancy checks. The final note target is authoritatively re-evaluated only after its actual parent exists. Any change from the displayed synthetic Preview plan follows the closed `replanned`/checkpoint rules rather than being treated as an overwrite opportunity.

### 10.9 Allocation

Exact duplicate classification occurs before allocation.

For writable dispositions:

1. try suffix 12;
2. if occupied, try 20;
3. if occupied, try 32;
4. if occupied, try 64;
5. if suffix 64 is occupied, block with `SOURCE_PATH_COLLISION`.

If a required intermediate path is occupied by a non-alias file/unsupported object, block with `SOURCE_PATH_OBSTRUCTED`.

Alias ancestry is classified under §7.8 as `SOURCE_ROOT_PHYSICAL_ALIAS`.

For the selected candidate:

- every required native occupancy probe must have returned an authoritative `present` or permitted `absent` result under §7.8.1;
- any `indeterminate` target/parent probe blocks with `SOURCE_NATIVE_PROBE_INDETERMINATE` before a writable plan can be returned;

- `SourceWritePlan.targetPath` is the logical NFC path;
- adapter session state retains the exact resolved target path from §7.3 for later create/read/verification;
- `pathCollisionKey` is computed only from the logical path.

Never overwrite.

## 11. Normative source-note field derivation and frontmatter bytes

### 11.1 Render input

```ts
interface SourceNoteRenderInput {
  source: SourceDescriptor;
  conversation: CanonicalConversation;
}
```

M03 writes only `conversation.provider === "chatgpt"`.

### 11.2 Presence rule for provider conversation ID

`providerConversationId` is considered present only when:

- its JavaScript type is string;
- `providerConversationId.length > 0`; and
- `isM03WellFormedString(providerConversationId)` from §5.6 is true.

An empty string is treated as absent everywhere in M03.

A non-empty ill-formed provider conversation ID is not coerced or replaced. Planning must block with `INVALID_SOURCE_RENDER_INPUT` at the pre-classification identity gate in §9.3 before registry/version classification.

`source_conversation_id` is explicitly permitted provenance under §5.1.1, even when its character sequence equals a raw provider message ID, provider node ID, graph node ID, diagnostic identifier, or arbitrary provider-metadata value.

### 11.3 Total canonical timestamp policy

M03 defines one total, non-throwing timestamp predicate.

The exact lexical grammar is:

```text
^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$
```

Accepted years are exactly `0000` through `9999`.

After lexical match, parse the decimal year, month, and day and validate the day against the proleptic Gregorian calendar:

```text
isLeapYear(year) =
  (year mod 4 === 0)
  AND ((year mod 100 !== 0) OR (year mod 400 === 0))

daysInMonth =
  Jan 31
  Feb 28 + (isLeapYear ? 1 : 0)
  Mar 31
  Apr 30
  May 31
  Jun 30
  Jul 31
  Aug 31
  Sep 30
  Oct 31
  Nov 30
  Dec 31
```

`isCanonicalM03Timestamp(value)` returns false, without throwing, unless:

1. `typeof value === "string"`;
2. `isM03WellFormedString(value)` is true;
3. the exact lexical grammar matches;
4. parsed day is no greater than the exact `daysInMonth`.

No JavaScript `Date`, `Date.parse`, `toISOString()`, locale parser, or timezone conversion participates in this predicate.

Consequences:

- invalid date text returns false;
- impossible dates such as `2026-02-30T00:00:00.000Z` return false;
- leap second `:60` returns false;
- extended-year values such as `+010000-01-01T00:00:00.000Z` return false;
- four-digit year `0000` is permitted if the calendar fields are otherwise valid;
- the predicate is total over every JavaScript value and never throws.

`source.importedAt` is required and must satisfy this predicate. Failure blocks rendering with `INVALID_SOURCE_RENDER_INPUT`.

`conversation.createdAt`, `conversation.updatedAt`, and message `createdAt` are optional:

- missing → absent;
- canonical → preserve exactly;
- present but noncanonical → treat as absent;
- optional timestamp noncanonicality alone never blocks source writing.

Therefore:

- filename date uses §10.3 `Undated` for missing/noncanonical `conversation.createdAt`;
- `source_created_at` and `source_updated_at` frontmatter are omitted when missing/noncanonical;
- body metadata displays `unavailable` for missing/noncanonical values.

### 11.4 Field-derivation table

| Persisted field              | Exact source                                              |
| ---------------------------- | --------------------------------------------------------- |
| `chat2vault_schema`          | constant integer `1`                                      |
| `type`                       | constant `"ai-conversation-source"`                       |
| `source_provider`            | `conversation.provider`                                   |
| `source_conversation_id`     | present `conversation.providerConversationId` under §11.2 |
| `source_content_fingerprint` | `conversation.contentFingerprint`                         |
| `source_import_fingerprint`  | `source.sourceFileFingerprint`                            |
| `source_message_count`       | `conversation.messages.length`                            |
| `imported_at`                | `source.importedAt`                                       |
| `source_created_at`          | canonical `conversation.createdAt`, if any                |
| `source_updated_at`          | canonical `conversation.updatedAt`, if any                |
| `knowledge_status`           | constant `"source"`                                       |

`source_import_fingerprint` is exactly M01 `ImportResult.source.sourceFileFingerprint`.

### 11.5 Render validation

Before writable plan:

- provider must equal `chatgpt`;
- a non-empty provider conversation ID must satisfy the well-formed presence rule in §11.2;
- source/content/message fingerprints must match `^sha256:[0-9a-f]{64}$`;
- message count must be safe non-negative integer;
- each message role must be `user`, `assistant`, `system`, `tool`, or `unknown`;
- each content block must match the closed M01 union;
- `source.importedAt` must be canonical;
- optional timestamps follow §11.3 and never block solely for noncanonicality;
- topology derivation must pass §13;
- exact generated frontmatter must pass writer-self-trust §8.7.

Non-topology failure → `INVALID_SOURCE_RENDER_INPUT`.

Topology failure → `SOURCE_TOPOLOGY_UNAVAILABLE`.

### 11.6 JSON/YAML string quoting at byte level

Start with ECMAScript `JSON.stringify(value)`.

Then scan the resulting Unicode string by code point. Replace:

- literal U+2028 with exactly six ASCII bytes `0x5C 0x75 0x32 0x30 0x32 0x38`;
- literal U+2029 with exactly six ASCII bytes `0x5C 0x75 0x32 0x30 0x32 0x39`.

Those byte sequences spell ASCII backslash + `u2028` and ASCII backslash + `u2029` respectively.

No literal U+2028 or U+2029 UTF-8 byte sequence may remain in a generated frontmatter string literal after this transformation.

Use the resulting JSON string literal verbatim as the YAML-compatible value.

### 11.7 Exact frontmatter order

Begin with LF-terminated lines:

```text
---
chat2vault_schema: 1
type: "ai-conversation-source"
source_provider: "chatgpt"
```

If provider conversation ID is present, append:

```text
source_conversation_id: <JSON-quoted-value>
```

Then:

```text
source_content_fingerprint: <JSON-quoted-value>
source_import_fingerprint: <JSON-quoted-value>
source_message_count: <bare-decimal>
imported_at: <JSON-quoted-value>
```

If canonical `createdAt` exists:

```text
source_created_at: <JSON-quoted-value>
```

If canonical `updatedAt` exists:

```text
source_updated_at: <JSON-quoted-value>
```

Then:

```text
knowledge_status: "source"
---
```

No extra key or blank frontmatter line is emitted.

### 11.8 Exact generated-frontmatter self-check

Before a writable plan is returned:

- render the exact frontmatter including all escaping;
- require closing delimiter within first 32 lines and first 16,384 UTF-8 bytes;
- parse exact bytes through the §8 strict registry parser;
- require parsed registry identity to equal intended identity.

This is mandatory even for extremely long/worst-case escaped provider conversation IDs.

If it fails, return `blocked` + `INVALID_SOURCE_RENDER_INPUT` before any mutation.

## 12. Markdown encoding primitives

### 12.1 Line endings, UTF-8, and golden byte constants

The byte grammar uses these constants:

```text
LF = one byte 0x0A
ASCII backslash = one byte 0x5C
ASCII letter n = one byte 0x6E
```

The two-byte ASCII sequence backslash + `n` is therefore `0x5C 0x6E` and is never interchangeable with the LF byte `0x0A`.

Complete note:

- uses LF byte `0x0A` as its only line terminator;
- contains no UTF-8 BOM;
- is encoded as UTF-8;
- ends with exactly one final byte `0x0A`.

Golden-byte tests must assert the exact opening frontmatter bytes `2D 2D 2D 0A`, closing delimiter bytes followed by LF, line joining, final LF, and U+2028/U+2029 ASCII escaping from §11.6.

### 12.2 Heading-title encoder

Display title is canonical title when present/non-empty, else `Untitled conversation`.

Encode exactly:

1. transform with `toM03WellFormedString` from §5.6;
2. NFC-normalize the transformed string;
3. CRLF/lone CR → LF;
4. replace every U+0000–U+001F and U+007F–U+009F, including LF, with U+FFFD;
5. prefix every ASCII punctuation code point in:

```text
! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ ` { | } ~
```

with one ASCII backslash `\`. 6. Leave others unchanged.

Use only in generated H1.

### 12.3 Inert imported-string encoder

For imported/provider-controlled string:

1. transform with `toM03WellFormedString` from §5.6;
2. CRLF/lone CR → LF;
3. split on LF preserving empty segments;
4. emit each segment as four ASCII spaces + segment.

An ill-formed lone surrogate therefore becomes one U+FFFD before UTF-8 serialization.

Empty string emits one line of exactly four spaces.

Use for imported text, code text, code language, reference text, reference URL, and unsupported descriptions.

No imported value is emitted as active Markdown syntax.

## 13. Branch-safe topology derivation and exact body grammar

### 13.1 Exact M01 `chatgptGraph` runtime schema

`conversation.metadata` is untrusted runtime data despite its TypeScript type.

M03 topology derivation begins by validating the exact baseline shape.

`conversation.metadata` must be a non-null, non-array object with an own property `chatgptGraph`.

`chatgptGraph` must be a non-null, non-array object with these four required own properties:

```ts
interface RequiredChatGptGraphRuntimeShape {
  nodeCount: number;
  selectedPathNodeIds: string[];
  alternativeLeafNodeIds: string[];
  currentNodeId: string | null;
}
```

Additional own properties on `chatgptGraph` are ignored by M03 and are never persisted.

Validation is exact:

#### `nodeCount`

- JavaScript number type;
- `Number.isSafeInteger(nodeCount) === true`;
- `nodeCount >= 0`;
- `nodeCount >= conversation.messages.length`.

`nodeCount` is used only as a structural sanity bound; it is not rendered directly as conversation chronology.

#### `selectedPathNodeIds`

- must be an array;
- every element must have JavaScript string type;
- empty strings are permitted because baseline graph node keys are strings without a non-empty guarantee;
- no two elements may be exactly equal under JavaScript string equality;
- `selectedPathNodeIds.length <= nodeCount`;
- preserve array order exactly.

#### `alternativeLeafNodeIds`

- must be an array;
- every element must have JavaScript string type;
- empty strings are permitted;
- no two elements may be exactly equal under JavaScript string equality;
- `alternativeLeafNodeIds.length <= nodeCount`;
- preserve array order exactly.

An identifier may occur once in each of the two different arrays; cross-array overlap is represented independently and is not itself a schema failure.

#### `currentNodeId`

- must be either `null` or a JavaScript string;
- when a string, it must be non-empty;
- it need not map to a canonical message; an unmapped valid string renders as `unresolved`.

#### Canonical-message topology fields

For every canonical message:

- `message.metadata` must be a non-null, non-array object;
- it must have own property `providerNodeId` of JavaScript string type;
- `providerNodeId` strings must be unique across canonical messages under exact JavaScript string equality;
- if `message.parentMessageId` is present, it must have string type;
- if `message.providerMessageId` is present, it must have string type.

No coercion is allowed.

Examples:

- `selectedPathNodeIds: [1]` → invalid;
- missing `alternativeLeafNodeIds` → invalid;
- duplicated element within `selectedPathNodeIds` → invalid;
- duplicated element within `alternativeLeafNodeIds` → invalid;
- `currentNodeId: 1` → invalid;
- `nodeCount: 2.5` → invalid;
- `nodeCount < conversation.messages.length` → invalid;
- unexpected extra `chatgptGraph` field → ignored.

Any failure in this section returns `SOURCE_TOPOLOGY_UNAVAILABLE` at §9.3 step 8.

Raw provider/node values validated here are transient topology inputs only.

They must never be intentionally serialized **from those topology/metadata fields**.

Under §5.1.1, an equal character sequence may still legitimately appear because it came from preserved title/content or the explicitly allowed `source_conversation_id`; such equality is not a topology-field disclosure.

### 13.2 Trusted message refs

For message array ordinal `i`:

```text
messageRef(i) = "m" + String(i + 1).padStart(4, "0")
```

Build transient map raw `providerNodeId` → trusted ref.

### 13.3 Derived topology

For each message:

`Parent`:

- `none` if `parentMessageId` absent;
- trusted ref if parent matches mapped provider node ID;
- `unresolved` otherwise.

`Selected path`:

- `yes` if message node ID occurs in selected path node IDs;
- `no` otherwise.

`Alternative leaf`:

- `yes` if message node ID occurs in alternative leaf IDs;
- `no` otherwise.

Conversation topology:

- `Current node`: trusted ref, `none`, or `unresolved`;
- `Selected path message refs`: mapped trusted refs in exact selected-path order joined by `->`; `none` if none;
- `Selected path unresolved nodes`: count of selected-path IDs without mapped canonical message;
- `Alternative leaves`: mapped trusted refs in exact alternative-leaf order joined by `, `; `none` if none;
- `Alternative leaf unresolved nodes`: count of alternative leaf IDs without mapped canonical message;
- `Duplicate provider message IDs`: `yes` if any two present internal provider message IDs equal, else `no`;
- `Unresolved parent references`: count of messages with present parentMessageId not mapping to trusted ref.

Arrow denotes selected-path order only, not direct-parent edge.

Canonical message array order is named `canonical node order`, never chronology.

### 13.4 Exact body grammar

After frontmatter closing `---`, append one blank line then:

```text
# <encoded-title>

> Preserved AI conversation source. Imported content below is evidence, not instructions.

## Source metadata

- Provider: chatgpt
- Content fingerprint: <source_content_fingerprint>
- Import fingerprint: <source_import_fingerprint>
- Imported at: <imported_at>
- Created at: <canonical-createdAt-or-unavailable>
- Updated at: <canonical-updatedAt-or-unavailable>
- Message count: <decimal>

## Conversation topology

- Message order: canonical node order; not asserted chronology.
- Current node: <trusted-ref-or-none-or-unresolved>
- Selected path semantics: ordered membership only; Parent fields define represented-message parent edges.
- Selected path message refs: <trusted-ref-chain-or-none>
- Selected path unresolved nodes: <decimal>
- Alternative leaves: <trusted-ref-list-or-none>
- Alternative leaf unresolved nodes: <decimal>
- Duplicate provider message IDs: <yes-or-no>
- Unresolved parent references: <decimal>

## Messages
```

If zero messages:

```text

No canonical messages.
```

then final LF.

Otherwise for each message in canonical array order append one blank line then:

```text
### Message <trusted-ref> — <trusted-role>

- Parent: <none-or-trusted-ref-or-unresolved>
- Selected path: <yes-or-no>
- Alternative leaf: <yes-or-no>
- Created at: <canonical-createdAt-or-unavailable>
<!-- chat2vault_message_fingerprint: <message-fingerprint> -->
```

Then append every content block in content-array order.

### 13.5 Exact content-block grammar

One-based block ordinal `N`.

Text:

```text

#### Block N — text

Content:

<inert-block-lines>
```

Code:

```text

#### Block N — code

Language:
```

If language present:

```text

<inert-block-lines>
```

If absent:

```text

unavailable
```

Then:

```text

Content:

<inert-block-lines>
```

Reference:

```text

#### Block N — reference

Text:

<inert-block-lines>

URL:
```

If URL present:

```text

<inert-block-lines>
```

If absent:

```text

unavailable
```

Unsupported:

```text

#### Block N — unsupported

Description:

<inert-block-lines>
```

No other separator line is emitted.

### 13.6 Final newline and note fingerprint

The renderer maintains an ordered array of line strings that contain no line-terminator characters except imported content already split by §12.3.

Define the writable-plan `noteContent` string as the exact well-formed JavaScript string formed from the ordered line array by inserting one U+000A code point between adjacent lines and one final U+000A code point after the last line.

Define:

```text
serializedNoteBytes = UTF8(noteContent)
```

To serialize those bytes equivalently:

1. UTF-8 encode each line independently;
2. between every adjacent pair of lines emit exactly one LF byte `0x0A`;
3. after the final line emit exactly one LF byte `0x0A`;
4. emit no BOM and no additional byte.

Equivalent pseudocode, where `LF_BYTE` is numeric byte `0x0A` rather than an escaped two-character string, is:

```text
UTF8(line[0]) || LF_BYTE || UTF8(line[1]) || LF_BYTE || ... || UTF8(lastLine) || LF_BYTE
```

`noteContentFingerprint` is exactly:

```text
"sha256:" + lowercaseHex(SHA256(serializedNoteBytes))
```

where `serializedNoteBytes` are the exact bytes above.

## 14. Preview/dry-run contract, bounded Markdown display, and one-instance arbitration

Dry-run planning itself is the pure/stateful adapter invocation of §9.3.

M03 chooses **non-queuing Preview serialization**, not latest-completion-wins concurrency. At most one user-facing Preview invocation may execute its planner at a time, and Preview and source Save never execute concurrently within one loaded Chat2Vault plugin instance.

### 14.1 Closed Preview result and arbitration

```ts
interface SourcePreviewPlannedResult {
  status: "planned";
  plan: SourceWritePlan;
}

interface SourcePreviewSettingsPendingResult {
  status: "settings-pending";
  diagnostics: [SourceWriterDiagnostic];
}

interface SourcePreviewInProgressResult {
  status: "preview-in-progress";
  diagnostics: [SourceWriterDiagnostic];
}

interface SourcePreviewWriteInProgressResult {
  status: "write-in-progress";
  diagnostics: [SourceWriterDiagnostic];
}

interface SourcePreviewStaleResult {
  status: "stale";
  diagnostics: [SourceWriterDiagnostic];
}

type SourcePreviewResult =
  | SourcePreviewPlannedResult
  | SourcePreviewSettingsPendingResult
  | SourcePreviewInProgressResult
  | SourcePreviewWriteInProgressResult
  | SourcePreviewStaleResult;
```

Exact invariants:

- `settings-pending` carries exactly `SOURCE_ROOT_SETTING_PENDING`;
- `preview-in-progress` carries exactly `SOURCE_PREVIEW_IN_PROGRESS`;
- `write-in-progress` carries exactly `SOURCE_WRITE_IN_PROGRESS`;
- `stale` carries exactly `STALE_SOURCE_WRITE_PLAN`;
- `planned` carries exactly one valid §9.2 plan and no outer diagnostic array.

Preview entry executes synchronously before any yield:

1. if `sourceRootPersistenceState.status === "pending"`, return `settings-pending` without acquiring `sourcePreviewMutex` and without invoking §9.3;
2. if `sourceWriteMutex` is held, return `write-in-progress` without acquiring `sourcePreviewMutex`;
3. atomically `tryAcquire(sourcePreviewMutex)`;
4. acquisition failure → return `preview-in-progress`; do not queue or replay;
5. after acquisition, synchronously recheck root persistence and `sourceWriteMutex` before the first yield:
   - pending root → release Preview mutex and return `settings-pending`;
   - held source-write mutex → release Preview mutex and return `write-in-progress`;
6. clear the currently installed Preview plan before planner work begins so Save is not enabled from an older plan while a replacement Preview is running;
7. capture the settled Preview token:
   - current `sourceWriteGeneration`;
   - selected conversation content fingerprint;
   - current settled normalized `settings.sourceRoot`;
8. invoke §9.3 exactly once against fresh current state;
9. after every yield-capable adapter stage, the controller may abandon early if the §17.4 token is stale;
10. immediately before publishing/installing the computed plan, evaluate the exact §17.4 stale predicate;
11. stale token or newly pending root → discard the computed plan, install nothing, and return `stale`;
12. otherwise install the plan as the sole current Preview state and return `planned`;
13. release `sourcePreviewMutex` exactly once in `finally`.

A second Preview that arrives while another Preview owns the mutex is rejected as `preview-in-progress`; it never supersedes the running Preview and is never queued.

A Save attempt while Preview owns the mutex is rejected at Save entry under §17.2 as `preview-in-progress` and never invokes a source mutation.

A Preview attempt while Save owns the source-write mutex returns `write-in-progress` and never invokes §9.3.

Import replacement, Clear, selected-conversation change, accepted source-root transaction start, view close, and unload remain §17.3 generation invalidators. Any such invalidator makes an already-running Preview stale; its later result cannot win UI state.

Dry-run/Preview performs zero vault mutation.

For a permitted partially-missing or fully-missing root, §7.5 supplies the exact authoritative-first-missing plus synthetic-descendant model and exact parent-first `foldersToCreate`.

### 14.2 Exact bounded raw-Markdown Preview display

The full writable plan always retains the complete `noteContent` string and complete durable bytes. This subsection bounds only the **user-facing raw-Markdown display**; it does not truncate, omit, cap, or alter the durable source note or its hash.

Define:

```ts
const SOURCE_MARKDOWN_PREVIEW_LIMIT_UTF16 = 65_536;

interface SourceMarkdownPreviewDisplay {
  completeness: "complete" | "truncated";
  text: string;
  displayedUtf16Units: number;
  totalUtf16Units: number;
}
```

Input is the well-formed writable `plan.noteContent` from §13.6.

Algorithm:

1. `totalUtf16Units = noteContent.length`.
2. If `totalUtf16Units <= 65_536`:
   - `text = noteContent`;
   - `completeness = "complete"`.
3. Otherwise set `cut = 65_536`.
4. If UTF-16 code unit at index `cut - 1` is in `0xD800..0xDBFF` and the code unit at index `cut` is in `0xDC00..0xDFFF`, decrement `cut` by one so the display never splits a surrogate pair.
5. `text = noteContent.slice(0, cut)`.
6. `completeness = "truncated"`.
7. `displayedUtf16Units = text.length`.

No truncation marker is inserted into `text`; `text` remains an exact prefix of the raw generated Markdown string.

The UI renders `text` inertly using text-only DOM assignment inside a `pre > code`-equivalent raw-text presentation. It must not invoke a Markdown renderer or HTML parser for this display.

The UI separately displays exactly one visible completeness label:

- complete: `Complete source-note Markdown preview.`
- truncated: `Source-note Markdown preview truncated; showing a prefix of at most 65,536 UTF-16 code units.`

The completeness label is not part of `text`, `noteContent`, serialized note bytes, or note hash.

The Save path always uses the complete plan `noteContent`, never `SourceMarkdownPreviewDisplay.text`.

### 14.3 Installed Preview state and UI winner

The installed session Preview wrapper stores only:

- captured source-write generation;
- selected conversation content fingerprint;
- captured settled normalized source root;
- exact §9.2 plan;
- derived §14.2 display state for writable plans.

The wrapper is memory-only and not persisted.

Only these operations may install a current Preview plan:

1. a `planned` result from the one currently serialized Preview invocation; or
2. a current-token Save `replanned` result installed under §17.2 after its fresh plan has already won Save settlement.

Every other Preview/Save result leaves no newly installed writable plan.

A Save that is accepted into the source-write executor clears the installed Preview plan synchronously before its first yield. A `saved` result leaves it cleared. A `replanned` result may install only its returned fresh plan under §17.2; no earlier Preview plan is restored automatically.

## 15. Create-only writer and verification

### 15.1 Allowed mutation surface

Dedicated M03 writer may use reviewed Obsidian create-only APIs to:

- create missing folder at the exact resolved folder path from §7;
- create new Markdown file at the exact resolved target path from §§7.3 and 10.

It may use reads for registry and verification.

Logical paths are never substituted for a different resolved raw spelling when performing I/O.

It must not use source-note:

- modify;
- append;
- delete;
- trash;
- rename;
- overwrite.

Node filesystem write APIs are prohibited.

Read-only native `lstat`/`realpath`, the Windows §7.8.1 generic reparse-point observation, and the macOS §7.8.1 `getattrlist(2)`/`ATTR_VOL_MOUNTPOINT` observation are permitted only in the physical verifier. These platform observations supply only their closed alias-presence results and grant no mutation or general native-I/O authority.

### 15.2 Mutation failure

On mutating-call error:

- stop;
- no destructive retry;
- no overwrite/delete/rename;
- no automatic rollback.

### 15.3 Post-create physical revalidation and read-back verification

After final note `create()` fulfills, post-create verification is read-only and must establish the required parent ancestry again. The final pre-create fence does not substitute for these post-create observations.

Define the **required parent ancestry** as every existing source-root ancestry address from vault root through the exact resolved source-root directory used as the final note's parent.

Post-create verification executes in this exact order and stops at the first failure:

1. **Parent checkpoint A — before trusting parent traversal.**
   - rerun the complete §7.8.3 physical-containment probe sequence over the required parent ancestry using its exact resolved addresses;
   - require every existing parent component to remain Vault-visible under §7.7;
   - on Windows, every required component must receive an authoritative generic-reparse observation; authoritative `reparse-point` fails even when `realpath` remains contained;
   - on macOS, every required component below the vault containment boundary must receive an authoritative `ATTR_VOL_MOUNTPOINT` observation; authoritative `mount-point` fails even when `realpath` remains contained;
   - no fresh enumeration beneath the source-root parent is trusted until this checkpoint passes.
2. Fresh-enumerate the exact resolved source-root parent.
3. Identify exactly one created file whose logical NFC path equals planned logical `targetPath`.
4. Capture its exact raw Vault-relative spelling as created-note `resolvedPath` and require §5.6.1 ingress.
5. Require the resolved created-note path to remain a direct child of the resolved source-root parent.
6. **Created-note physical observation.**
   - require authoritative `lstat: present`; symbolic-link or indeterminate/absent required-object state fails verification;
   - on Windows, require authoritative `not-reparse-point` before trusting non-symlink type; `reparse-point` or `indeterminate` fails verification;
   - require authoritative ingress-valid `realpath: resolved`; absent/indeterminate/invalid external path fails verification;
   - on macOS, invoke the authoritative §7.8.1 mount-point observation using that created-note real path and require `not-mount-point`; `mount-point` or `indeterminate` fails verification;
   - require regular-file type and §7.8.2 containment;
   - ordinary `lstat` type or contained `realpath` never overrides an authoritative Windows reparse or macOS mount-point result.
7. **Parent checkpoint B — after created-note observation and before byte read.**
   - rerun the complete §7.8.3 required-parent ancestry sequence again;
   - require Vault visibility again;
   - on Windows, authoritative `not-reparse-point` is required for every parent component.
   - on macOS, authoritative `not-mount-point` is required for every parent component below the vault containment boundary.
8. Read exact note bytes through the Obsidian-supported binary-read adapter using the exact resolved created-note path.
9. Derive `plannedSerializedNoteBytes = UTF8(plan.noteContent)` under §13.6.
10. Require exact byte equality with `plannedSerializedNoteBytes`.
11. Require recomputed note hash equality with planned `noteContentFingerprint`.
12. **Parent checkpoint C — immediately before registry rediscovery.**
    - rerun the complete §7.8.3 required-parent ancestry sequence a third time;
    - require Vault visibility;
    - on Windows, require authoritative `not-reparse-point` for every required parent component;
    - on macOS, require authoritative `not-mount-point` for every required parent component below the vault containment boundary.
13. Only after checkpoint C passes may §15.4 registry rediscovery begin.

Post-create physical failure precedence is exactly the procedural order above: the first failing checkpoint/observation wins the internal verification reason. All such failures collapse to the one closed execution diagnostic `SOURCE_WRITE_VERIFICATION_FAILED`; no root/path/native diagnostic is emitted as a Save execution diagnostic after final note create has fulfilled.

In particular:

- authoritative required-parent symbolic-link/junction/Windows generic-reparse/macOS mount-point presence after create → verification failure even with contained `realpath`;
- required-parent Windows reparse or macOS mount-point observation `indeterminate` after create → verification failure;
- required-parent `lstat`/`realpath` indeterminate or required-object disappearance after create → verification failure;
- created-note alias/reparse/indeterminate/type/containment failure → verification failure;
- there is no post-create `replanned`, `safety-check-failed`, or destructive rollback branch.

Result mapping is exact:

- token current when verification failure is observed → `verification-failed`, exact `createdPath`, exact `acceptedFolderPaths`, exactly `SOURCE_WRITE_VERIFICATION_FAILED`;
- token stale when verification failure is observed → `post-create-stale`, exact `createdPath`, exact `acceptedFolderPaths`, `verification.status = "verification-failed"`, diagnostics exactly `[STALE_SOURCE_WRITE_PLAN, SOURCE_WRITE_VERIFICATION_FAILED]`;
- token stale but all read-only verification completes successfully → §17.9 `post-create-stale` with verified status.

No verification failure deletes, renames, modifies, or otherwise rolls back the fulfilled source note or any accepted folder.

### 15.4 Registry rediscovery after post-create parent verification

After §15.3 byte/hash verification and parent checkpoint C have passed:

- fresh-run registry discovery through the exact resolved source-root address;
- discovery must independently apply the direct-child §8.1 candidate physical checks, including authoritative Windows generic-reparse observation for the created candidate;
- require the newly written logical target path to parse as one trusted registry entry;
- require provider/content/import identity equality;
- require registry entry `path` to equal planned logical `targetPath`.

If registry rediscovery observes any physical/path/read/UTF-8/trust failure, or the required entry is absent/mismatched, verification fails exactly as §15.3 specifies.

A `saved` result is impossible unless all three required-parent checkpoints, the created-note physical observation, exact byte/hash verification, and registry rediscovery have passed.

## 16. Closed Save execution-result contract

### 16.0 Typed Save action domain and controller entry layer

There are two distinct layers.

**Save action controller entry** applies the synchronous §17.2 root/Preview/Save mutex gates. It may return these closed §16 results without constructing a mutation-executor request:

- `settings-pending`;
- `preview-in-progress`;
- `in-progress`.

Only after those entry gates pass may the controller prove that one current installed Preview plan is writable and construct:

```ts
type WritableSourceWritePlan = NewSourceWritePlan | NewVersionSourceWritePlan;

interface SourceWriteSaveRequest {
  plan: WritableSourceWritePlan;
  previewGeneration: number;
  selectedConversationContentFingerprint: string;
  settledSourceRoot: string;
}
```

A `duplicate`, `blocked`, absent, settings-pending, Preview-in-progress, or non-current Preview state cannot be converted into `SourceWriteSaveRequest`.

If no current writable installed plan exists and none of the three closed entry-gate results applies, the Save action is ineligible: UI keeps Save disabled, programmatic/event reentry performs no mutation, the mutation executor is not invoked, and no `SourceWriteExecutionResult` is synthesized merely to represent an impossible UI action.

After a valid request is captured, the mutation executor owns the source-write mutex and may settle only through the remaining §16 branches.

A once-eligible writable request that later becomes stale remains inside the executor domain and settles through §§16–17.

### 16.1 Result union

Every Save result contains logical paths only.

`acceptedFolderPaths` contains exactly the logical paths whose Chat2Vault `createFolder()` promise fulfilled during this Save attempt, in invocation order.

A folder that appeared externally or already existed is never added to `acceptedFolderPaths`.

```ts
interface SavedSourceWriteResult {
  status: "saved";
  createdPath: string;
  noteContentFingerprint: string;
  disposition: "new" | "new-version";
  acceptedFolderPaths: string[];
  diagnostics: [];
}

interface SourceWriteInProgressResult {
  status: "in-progress";
  acceptedFolderPaths: [];
  diagnostics: [SourceWriteExecutionDiagnostic];
}

interface SourceWritePreviewInProgressResult {
  status: "preview-in-progress";
  acceptedFolderPaths: [];
  diagnostics: [SourceWriteExecutionDiagnostic];
}

interface SourceWriteSettingsPendingResult {
  status: "settings-pending";
  acceptedFolderPaths: [];
  diagnostics: [SourceWriteExecutionDiagnostic];
}

interface StaleSourceWriteResult {
  status: "stale";
  acceptedFolderPaths: string[];
  diagnostics: [SourceWriteExecutionDiagnostic];
}

interface ReplannedSourceWriteResult {
  status: "replanned";
  reason: "stale-plan" | "target-changed";
  plan: SourceWritePlan;
  acceptedFolderPaths: string[];
  diagnostics: [SourceWriteExecutionDiagnostic];
}

interface SourceWriteMutationFailedResult {
  status: "mutation-failed";
  acceptedFolderPaths: string[];
  diagnostics: [SourceWriteExecutionDiagnostic];
}

interface SourceWriteSafetyCheckFailedResult {
  status: "safety-check-failed";
  acceptedFolderPaths: string[];
  diagnostics: [SourceWriteExecutionDiagnostic];
}

interface SourceWriteVerificationFailedResult {
  status: "verification-failed";
  createdPath: string;
  acceptedFolderPaths: string[];
  diagnostics: [SourceWriteExecutionDiagnostic];
}

interface PostCreateStaleSourceWriteResult {
  status: "post-create-stale";
  createdPath: string;
  acceptedFolderPaths: string[];
  verification:
    | {
        status: "verified";
        noteContentFingerprint: string;
      }
    | {
        status: "verification-failed";
      }
    | {
        status: "not-completed";
      };
  diagnostics: SourceWriteExecutionDiagnostic[];
}

type SourceWriteExecutionResult =
  | SavedSourceWriteResult
  | SourceWriteInProgressResult
  | SourceWritePreviewInProgressResult
  | SourceWriteSettingsPendingResult
  | StaleSourceWriteResult
  | ReplannedSourceWriteResult
  | SourceWriteMutationFailedResult
  | SourceWriteSafetyCheckFailedResult
  | SourceWriteVerificationFailedResult
  | PostCreateStaleSourceWriteResult;
```

`createdPath` is always the logical NFC target path from §7.3.

It appears only when the final note `create()` promise fulfilled.

It does not expose raw resolved path spelling and does not assert immunity from later external mutation.

### 16.2 Exact result invariants

- `saved`:
  - final note create fulfilled;
  - byte/hash verification passed;
  - registry rediscovery passed;
  - generation remained current through final publication check;
  - diagnostics `[]`.
- `in-progress`:
  - source-write mutex was already held;
  - no mutation;
  - exactly `SOURCE_WRITE_IN_PROGRESS`.
- `preview-in-progress`:
  - `sourcePreviewMutex` was held when Save entry was attempted;
  - source-write mutex was not acquired;
  - no mutation;
  - exactly `SOURCE_PREVIEW_IN_PROGRESS`.
- `settings-pending`:
  - source-root persistence was pending at Save entry or immediately after source-write mutex acquisition;
  - no source mutation;
  - `acceptedFolderPaths = []`;
  - exactly `SOURCE_ROOT_SETTING_PENDING`.
- `stale`:
  - no final note create promise fulfilled;
  - exactly `STALE_SOURCE_WRITE_PLAN`;
  - earlier fulfilled folder creates may appear in `acceptedFolderPaths`.
- `replanned`:
  - no final note create promise fulfilled;
  - contains one freshly computed §9.2 plan;
  - `reason: "stale-plan"` uses exactly `STALE_SOURCE_WRITE_PLAN`;
  - `reason: "target-changed"` uses exactly `SOURCE_WRITE_TARGET_CHANGED`;
  - refreshed plan's own diagnostics remain governed by §9 and do not absorb the execution diagnostic.
- `mutation-failed`:
  - final note create did not fulfill;
  - exactly `SOURCE_WRITE_FAILED`;
  - earlier fulfilled folder creates may remain.
- `safety-check-failed`:
  - no final note create promise fulfilled;
  - a required concrete native safety probe returned `indeterminate`, or an object required by the current safety snapshot became authoritatively absent during a required probe sequence;
  - exactly `SOURCE_NATIVE_PROBE_INDETERMINATE`;
  - no later source mutation is permitted in that Save attempt;
  - earlier fulfilled folder creates remain exactly in `acceptedFolderPaths`;
  - no refreshed plan is installed from this result; a new Preview is required after the environment/probe issue is resolved.
- `verification-failed`:
  - final note create fulfilled;
  - `createdPath` is present;
  - exactly `SOURCE_WRITE_VERIFICATION_FAILED`;
  - no destructive rollback.
- `post-create-stale`:
  - final note create fulfilled before or while generation became stale;
  - `createdPath` is present and proves only fulfilled create;
  - first diagnostic exactly `STALE_SOURCE_WRITE_PLAN`;
  - append `SOURCE_WRITE_VERIFICATION_FAILED` only when read-only verification failed;
  - no later mutation is permitted.

### 16.3 Exact structural plan equality

Save-time comparisons use `sourceWritePlanEqual(left, right)`.

It is true only when:

- `disposition` is equal;
- both objects have exactly the fields permitted by their §9.2 union branch;
- every string field is exact-equal;
- every array has equal length and exact-equal elements in the same order;
- every diagnostic has exact-equal three fields in the same order;
- for writable plans, `noteContent` and `noteContentFingerprint` are exact-equal;
- for `new-version`, `previousVersionPaths` are exact-equal in order;
- for duplicate, `existingPath` and `duplicatePaths` are exact-equal;
- `foldersToCreate` is exact-equal in order.

No object identity, JSON-key order, filesystem state, or locale comparison substitutes for this comparator.

## 17. Write linearization, folder/note checkpoints, and total rejection classification

### 17.1 Guarantee boundary

M03 serializes and fences operations issued by one loaded Chat2Vault plugin instance.

M03 does not claim atomic linearizability against external filesystem processes, another Obsidian instance, another Chat2Vault instance, sync software, or manual mutation between checkpoint and path-based mutation.

Observable external changes are detected best-effort at required checkpoints and fail/replan closed.

### 17.2 Preview mutex, source-write mutex, and cross-action entry precedence

Plugin owns:

```text
sourceWriteGeneration: monotonically increasing integer
sourcePreviewMutex: binary non-queuing mutex
sourceWriteMutex: binary non-queuing mutex
```

`sourcePreviewMutex` serializes Preview only. `sourceWriteMutex` serializes Save only. Their entry rules mutually exclude Preview and Save without queuing either operation.

Preview entry is defined only in §14.1.

Save entry precedence is exact and executes synchronously without a yield through the mutex decisions:

1. if `sourceRootPersistenceState.status === "pending"`, return `settings-pending` with `acceptedFolderPaths = []`; do not inspect/acquire either source mutex;
2. if `sourcePreviewMutex` is held, return `preview-in-progress` with `acceptedFolderPaths = []` and exactly `SOURCE_PREVIEW_IN_PROGRESS`; do not attempt `sourceWriteMutex`;
3. atomically `tryAcquire(sourceWriteMutex)`;
4. acquisition failure → return `in-progress` with `acceptedFolderPaths = []` and exactly `SOURCE_WRITE_IN_PROGRESS`;
5. after source-write acquisition and before the first yield, recheck:
   - root persistence pending → release source-write mutex and return `settings-pending`;
   - `sourcePreviewMutex` held → release source-write mutex and return `preview-in-progress`;
6. validate/capture the current typed writable `SourceWriteSaveRequest` from §16.0;
7. synchronously clear the installed Preview plan before any yield so the plan being consumed by this Save is not left Save-enabled in UI while mutation/replanning is active;
8. continue under §17.4;
9. settle current Preview UI from the Save result under the rules below;
10. release `sourceWriteMutex` exactly once in `finally`.

No Preview/Save rejected as `settings-pending`, `preview-in-progress`, or `in-progress` is queued or automatically replayed.

While `sourceWriteMutex` is held, a new Preview returns §14.1 `write-in-progress` and never invokes §9.3.

While `sourcePreviewMutex` is held, a new Save returns `preview-in-progress` and never enters the mutation executor.

Save result → installed Preview winner rules, applied before source-write mutex release:

- `replanned`: if its source operation token is still current and root persistence is settled, install exactly the returned fresh `plan` as the new current Preview wrapper using current generation/fingerprint/root and derive its §14.2 display state when writable; this is the only Save result that installs a plan;
- `saved`: leave current Preview plan cleared and show saved result/path only;
- `settings-pending`, `preview-in-progress`, `in-progress`: because these fail before an accepted Save clears the installed plan, preserve the pre-entry installed plan unless another concurrent invalidator already cleared it;
- `stale`, `safety-check-failed`, `mutation-failed`, `verification-failed`, and `post-create-stale`: leave current Preview plan cleared;
- no older Preview plan is restored automatically after any accepted Save attempt.

### 17.3 Generation invalidators and Preview-state invalidation

Increment `sourceWriteGeneration` and clear current installed Preview/source plan on:

- new import/replacement beginning;
- Clear;
- selected conversation change;
- accepted source-root transaction beginning under §6.9;
- preview view close;
- plugin unload.

Preview page-size changes do not increment generation.

Source-root persistence settlement does not increment generation a second time.

A rejected source-root persistence transaction leaves the transaction-start generation increment in place and leaves current plan cleared.

Starting a replacement Preview does **not** increment `sourceWriteGeneration`; overlapping Preview is rejected by `sourcePreviewMutex` instead. The accepted Preview synchronously clears the previously installed plan under §14.1.

Starting an accepted Save does **not** increment `sourceWriteGeneration` because the Save must continue to evaluate its captured source token. Instead it synchronously clears the installed Preview plan under §17.2, and Preview is mutually excluded while the source-write mutex is held.

A fulfilled source Save therefore cannot leave the consumed pre-Save Preview installed. `saved` leaves no writable Preview; `replanned` may install only the fresh returned plan under §17.2.

### 17.4 Exact Preview/Save token and stale predicate

A source operation token contains exactly:

```ts
interface SourceOperationToken {
  operationGeneration: number;
  selectedConversationContentFingerprint: string;
  normalizedSourceRoot: string;
}
```

The root captured in a token is always the current **settled** `settings.sourceRoot`; a staged/pending proposed root is never captured.

Define:

```text
sourceOperationTokenIsCurrent(token) =
  plugin is loaded
  AND sourceRootPersistenceState.status === "settled"
  AND token.operationGeneration === sourceWriteGeneration
  AND token.selectedConversationContentFingerprint
      === current selected conversation contentFingerprint
  AND token.normalizedSourceRoot === current settled settings.sourceRoot
```

The predicate is total and is the only source-state stale-token predicate for Preview and Save.

Preview arbitration additionally requires ownership of `sourcePreviewMutex` at publication time; Save arbitration additionally requires ownership of `sourceWriteMutex` during execution. Mutex ownership is not folded into the token fields.

Any false token conjunct means stale.

On Save click, after §17.2 entry gates, typed request capture, installed-plan clearing, and source-write mutex acquisition:

1. capture or validate the token stored with the consumed Preview plan;
2. if `sourceOperationTokenIsCurrent(token)` is false:
   - if root persistence is currently pending at this pre-planner entry point, return `settings-pending`;
   - otherwise return `stale`;
   - `acceptedFolderPaths = []`;
3. invoke full §9.3 state machine using only current settled root;
4. immediately after §9.3, evaluate `sourceOperationTokenIsCurrent(token)` again;
5. if false, return `stale` with `acceptedFolderPaths = []`; once planner execution has begun, a later root transaction is source-operation staleness rather than new `settings-pending` entry rejection;
6. compare refreshed plan to consumed displayed plan under §16.3;
7. mismatch before source mutation → return `replanned` with:
   - `reason: "stale-plan"`;
   - refreshed plan;
   - `acceptedFolderPaths = []`;
   - execution diagnostic `STALE_SOURCE_WRITE_PLAN`;
8. if equal:
   - `operationPlan = refreshedPlan`;
   - `expectedPlan = operationPlan`;
   - `acceptedFolderPaths = []`.

After a Chat2Vault folder create fulfills, remove that logical folder path from `expectedPlan.foldersToCreate` and leave every other expected-plan field unchanged.

### 17.4.1 Last-point mutation fence

Every source-folder or source-note mutation invocation must use this last-point fence after all yield-capable checks for that mutation have completed.

The fence is:

```text
lastPointMutationFence(token)
```

and performs synchronously, without `await`, Promise continuation, timer, event dispatch, `queueMicrotask`, or any other yield between the fence and the mutation invocation:

1. evaluate `sourceOperationTokenIsCurrent(token)`;
2. if false, do not invoke the mutation and return `stale`, preserving exact `acceptedFolderPaths`; once a Save has passed the pre-planner entry gates, later root-persistence activity is staleness, not a `settings-pending` entry rejection;
3. if true, invoke the already-selected mutation as the immediately following synchronous statement in the same JavaScript run-to-completion turn.

No yield-capable validation, enumeration, replan, Vault lookup, `lstat`, `realpath`, or other asynchronous operation may occur after a passing last-point fence and before the corresponding `createFolder()` or final note `create()` invocation.

This fence is required even when generation/root state was checked earlier in the same checkpoint.

### 17.5 Pre-folder checkpoint table

Before each remaining logical folder in `expectedPlan.foldersToCreate`:

1. if `sourceOperationTokenIsCurrent(token)` is false, return `stale`; preserve exact `acceptedFolderPaths`;
2. run the yield-capable §7.6 checkpoint;
3. classify its result:

| Token after checkpoint | §7.6 checkpoint outcome                            | Required Save result/action                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stale                  | any                                                | return `stale`; no new mutation; preserve exact `acceptedFolderPaths`                                                                                                                                                                                             |
| current                | `missing-safe`                                     | execute §17.4.1 last-point mutation fence; only a passing fence may invoke `createFolder` using checkpoint `resolvedPath`                                                                                                                                         |
| current                | `exact-directory-present`                          | invoke fresh §9.3; return `replanned` with `reason: "target-changed"`, refreshed plan, exact `acceptedFolderPaths`, and `SOURCE_WRITE_TARGET_CHANGED`                                                                                                             |
| current                | `blocked` with `SOURCE_NATIVE_PROBE_INDETERMINATE` | return `safety-check-failed` with exactly `SOURCE_NATIVE_PROBE_INDETERMINATE`; no fresh replan and no later mutation; preserve exact `acceptedFolderPaths`                                                                                                        |
| current                | any other `blocked`                                | invoke fresh §9.3; if refreshed plan differs from `expectedPlan`, return `replanned`/`target-changed`; if refreshed plan is structurally equal despite checkpoint failure, return `mutation-failed` + `SOURCE_WRITE_FAILED`; preserve exact `acceptedFolderPaths` |

If invalidation occurs during §7.6 or after §7.6 returns but before mutation invocation, the mandatory last-point fence observes it and no folder mutation is invoked.

A current-generation root/path failure at a folder checkpoint therefore never leaks a root diagnostic directly into the execution-diagnostic tuple.

The refreshed plan contains the normative root/path diagnostic when blocked.

### 17.6 Deterministic folder-create settlement classifier

Do not classify a rejected folder create using exception message, name, code, stack, OS error number, or implementation-specific Obsidian text.

Classification uses only promise settlement, `sourceOperationTokenIsCurrent(token)`, and specified fresh state checks.

#### Fulfilled folder create

On fulfillment:

1. append this folder's logical path to `acceptedFolderPaths`;
2. remove it from `expectedPlan.foldersToCreate`;
3. if token is stale, return `stale`;
4. if token is current:
   - perform the yield-capable §7.6 post-create re-enumeration, exact-logical match, Vault visibility, and physical-containment checks;
   - immediately after those checks, re-evaluate token;
   - stale token → return `stale` with fulfilled folder recorded;
   - all checks pass + current token → update resolved folder address from exact enumerated raw path and continue;
   - a post-check `SOURCE_NATIVE_PROBE_INDETERMINATE` failure + current token → return `safety-check-failed` immediately with exact `acceptedFolderPaths`; no later mutation;
   - any other post-check failure + current token → invoke fresh §9.3;
   - immediately after that replan, re-evaluate token;
   - stale token → return `stale`;
   - current token + refreshed plan different from `expectedPlan` → return `replanned`/`target-changed` with refreshed plan, exact `acceptedFolderPaths`, and `SOURCE_WRITE_TARGET_CHANGED`;
   - current token + refreshed plan structurally equal despite failed post-check → return `mutation-failed` with `SOURCE_WRITE_FAILED`.

#### Rejected folder create

On rejection:

1. do not append the folder to `acceptedFolderPaths`;
2. if token is stale at settlement, return `stale`;
3. if token is current, invoke full fresh §9.3 without inspecting rejection text;
4. immediately after that replan, re-evaluate token;
5. stale token → return `stale`;
6. current token + refreshed plan blocked specifically by `SOURCE_NATIVE_PROBE_INDETERMINATE` → return `safety-check-failed` with exact `acceptedFolderPaths` and that diagnostic;
7. current token + refreshed plan different from `expectedPlan` → return `replanned`/`target-changed` with refreshed plan, exact `acceptedFolderPaths`, and `SOURCE_WRITE_TARGET_CHANGED`;
8. current token + refreshed plan structurally equal → return `mutation-failed` with exact `SOURCE_WRITE_FAILED`.

This deterministically covers:

- an equivalent directory appearing externally;
- a collision/alias/obstruction appearing;
- registry/classification changes;
- permission/I/O rejection with otherwise unchanged state;
- source-root persistence beginning during settlement/replanning.

A folder-create rejection never yields `post-create-stale`.

### 17.7 Final pre-note-create checkpoint and mutation fence

After every planned folder has either been fulfilled by this Save or no folder remains:

1. require `sourceOperationTokenIsCurrent(token)`; if false return `stale`;
2. invoke full fresh §9.3;
3. re-evaluate token immediately after §9.3; stale wins before further checks;
4. compare refreshed plan to `expectedPlan`;
5. if different, perform no note create and return:
   - `replanned`;
   - `reason: "target-changed"`;
   - refreshed plan;
   - exact `acceptedFolderPaths`;
   - `SOURCE_WRITE_TARGET_CHANGED`;
6. if equal, run the yield-capable exact resolved-parent Vault visibility, occupancy, and physical-containment checkpoint;
7. re-evaluate token after those checks;
8. if stale, return `stale`; preserve accepted folders and perform no note create;
9. if the environment checkpoint fails while token remains current:
   - if failure is exactly `SOURCE_NATIVE_PROBE_INDETERMINATE`, return `safety-check-failed` immediately with exact `acceptedFolderPaths`; no note create and no later mutation;
   - otherwise invoke fresh §9.3;
   - re-evaluate token after the replan;
   - stale wins;
   - refreshed plan blocked specifically by `SOURCE_NATIVE_PROBE_INDETERMINATE` → `safety-check-failed`;
   - differing plan → `replanned`/`target-changed`;
   - structurally equal plan despite failed checkpoint → `mutation-failed`;
10. after every yield-capable final validation has completed and the plan/checkpoint remains valid, execute §17.4.1 last-point mutation fence;
11. only a passing last-point fence may invoke final note create using the operation's resolved target path, with the create invocation as the immediately following non-yielding statement.

Invalidation during final replan, final Vault lookup, final `lstat`/`realpath`, or any other yield-capable final check therefore cannot be followed by a new note-create invocation without a fresh synchronous token sample.

### 17.8 Deterministic note-create settlement classifier

Do not inspect rejection text/code/OS error to distinguish target race from generic failure.

#### Fulfilled note create

On fulfillment:

1. set `createdPath = expectedPlan.targetPath` logical path;
2. evaluate `sourceOperationTokenIsCurrent(token)`;
3. stale token → enter `post-create-stale` and perform only read-only verification where possible;
4. current token → perform §15.3–§15.4 verification.

#### Rejected note create

On rejection:

1. there is no `createdPath`;
2. if token is stale at settlement, return `stale`; staleness wins;
3. if token is current, invoke full fresh §9.3;
4. immediately after that replan, re-evaluate token;
5. stale token → return `stale`;
6. current token + refreshed plan blocked specifically by `SOURCE_NATIVE_PROBE_INDETERMINATE` → return `safety-check-failed` with exact `acceptedFolderPaths` and that diagnostic;
7. current token + refreshed plan different from `expectedPlan` → return `replanned`/`target-changed` with refreshed plan, exact `acceptedFolderPaths`, and `SOURCE_WRITE_TARGET_CHANGED`;
8. current token + refreshed plan structurally equal → return `mutation-failed` with exact `SOURCE_WRITE_FAILED`.

Thus target appearance, collision escalation, duplicate appearance, root persistence/change, and other observable environment changes are identified from fresh authoritative state, never exception text.

### 17.8.1 Exact Windows generic-reparse settlement mappings

The following mappings are mandatory whenever the §7.8.1 Windows generic reparse-point observation participates in Save execution. They do not create a new execution diagnostic or result type.

- **Pre-folder checkpoint, token stale:** `stale` wins; preserve exact `acceptedFolderPaths`; no later mutation.
- **Pre-folder checkpoint, token current, authoritative `reparse-point`:** no folder mutation; run fresh §9.3; the refreshed plan must be `blocked` with `SOURCE_ROOT_PHYSICAL_ALIAS`; return `replanned` with `reason: "target-changed"`, that refreshed plan, exact unchanged `acceptedFolderPaths`, and execution diagnostic `SOURCE_WRITE_TARGET_CHANGED`; zero later mutation in this Save attempt.
- **Pre-folder checkpoint, token current, reparse observation `indeterminate`:** return `safety-check-failed` with `SOURCE_NATIVE_PROBE_INDETERMINATE`, exact unchanged `acceptedFolderPaths`, and zero later mutation.
- **Required Windows reparse-observation capability unavailable before concrete checkpoint probing:** fresh §9.3 returns `blocked` with `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`; return `replanned`/`target-changed` with exact unchanged `acceptedFolderPaths`; no mutation.
- **Fulfilled folder create followed by current-token authoritative `reparse-point` on the created folder/ancestry:** the fulfilled folder remains in `acceptedFolderPaths`; run fresh §9.3; return `replanned`/`target-changed` with refreshed `blocked` + `SOURCE_ROOT_PHYSICAL_ALIAS`; no later mutation.
- **Fulfilled folder create followed by current-token reparse observation `indeterminate`:** return `safety-check-failed` with the fulfilled folder retained in `acceptedFolderPaths`; no later mutation.
- **Fulfilled folder create followed by stale token:** `stale` wins before alias/replan publication; the fulfilled folder remains in `acceptedFolderPaths`; no later mutation.
- **Rejected folder create with current token:** fresh §9.3 is authoritative. If it detects a generic reparse point, return `replanned`/`target-changed` with the refreshed `blocked` + `SOURCE_ROOT_PHYSICAL_ALIAS`; if the reparse observation is `indeterminate`, return `safety-check-failed`; preserve exact `acceptedFolderPaths`.
- **Final pre-note checkpoint, token current, authoritative `reparse-point` in required parent ancestry:** no note create; fresh §9.3 must be `blocked` + `SOURCE_ROOT_PHYSICAL_ALIAS`; return `replanned`/`target-changed` with exact `acceptedFolderPaths`; zero later mutation.
- **Final pre-note checkpoint, token current, reparse observation `indeterminate`:** return `safety-check-failed`; no note create; preserve exact `acceptedFolderPaths`.
- **Rejected note create with current token:** fresh §9.3 remains authoritative. A newly detected generic reparse point yields `replanned`/`target-changed` with refreshed `blocked` + `SOURCE_ROOT_PHYSICAL_ALIAS`; an indeterminate reparse observation yields `safety-check-failed`.
- **Fulfilled note create:** §15.3 must actually invoke parent checkpoints A, B, and C plus the created-note physical observation. Any authoritative reparse detection on the created note or any required parent at any of those checkpoints is a verification failure even when the realpath is contained; no destructive rollback; current token → `verification-failed` with `SOURCE_WRITE_VERIFICATION_FAILED`; stale token → `post-create-stale` with `verification.status = "verification-failed"` and diagnostics `[STALE_SOURCE_WRITE_PLAN, SOURCE_WRITE_VERIFICATION_FAILED]`.
- **Fulfilled note create followed by post-create parent/created-note reparse-observation indeterminacy or another required native-probe indeterminate result:** use the same verification-failure mappings as the previous bullet; because create already fulfilled, `safety-check-failed` is no longer a valid result.

An authoritative generic reparse point never becomes `SOURCE_PATH_OBSTRUCTED`, never becomes `SOURCE_NATIVE_PROBE_INDETERMINATE`, and never passes merely because `realpath` remains inside the vault.

### 17.8.2 Exact macOS mount-point settlement mappings

The following mappings are mandatory whenever the §7.8.1 macOS mount-point observation participates in Save execution. They do not create a new execution diagnostic or result type.

- **Pre-folder checkpoint, token stale:** `stale` wins; preserve exact `acceptedFolderPaths`; no later mutation.
- **Pre-folder checkpoint, token current, authoritative `mount-point`:** no folder mutation; run fresh §9.3; the refreshed plan must be `blocked` with `SOURCE_ROOT_PHYSICAL_ALIAS`; return `replanned` with `reason: "target-changed"`, that refreshed plan, exact unchanged `acceptedFolderPaths`, and execution diagnostic `SOURCE_WRITE_TARGET_CHANGED`; zero later mutation in this Save attempt.
- **Pre-folder checkpoint, token current, mount-point observation `indeterminate`:** return `safety-check-failed` with `SOURCE_NATIVE_PROBE_INDETERMINATE`, exact unchanged `acceptedFolderPaths`, and zero later mutation.
- **Required macOS mount-point-observation capability unavailable before concrete checkpoint probing:** fresh §9.3 returns `blocked` with `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`; return `replanned`/`target-changed` with exact unchanged `acceptedFolderPaths`; no mutation.
- **Fulfilled folder create followed by current-token authoritative `mount-point` on the created folder/ancestry:** the fulfilled folder remains in `acceptedFolderPaths`; run fresh §9.3; return `replanned`/`target-changed` with refreshed `blocked` + `SOURCE_ROOT_PHYSICAL_ALIAS`; no later mutation.
- **Fulfilled folder create followed by current-token mount-point observation `indeterminate`:** return `safety-check-failed` with the fulfilled folder retained in `acceptedFolderPaths`; no later mutation.
- **Fulfilled folder create followed by stale token:** `stale` wins before alias/replan publication; the fulfilled folder remains in `acceptedFolderPaths`; no later mutation.
- **Rejected folder create with current token:** fresh §9.3 is authoritative. If it detects a macOS mount point, return `replanned`/`target-changed` with refreshed `blocked` + `SOURCE_ROOT_PHYSICAL_ALIAS`; if the mount-point observation is `indeterminate`, return `safety-check-failed`; preserve exact `acceptedFolderPaths`.
- **Final pre-note checkpoint, token current, authoritative `mount-point` in required parent ancestry:** no note create; fresh §9.3 must be `blocked` + `SOURCE_ROOT_PHYSICAL_ALIAS`; return `replanned`/`target-changed` with exact `acceptedFolderPaths`; zero later mutation.
- **Final pre-note checkpoint, token current, mount-point observation `indeterminate`:** return `safety-check-failed`; no note create; preserve exact `acceptedFolderPaths`.
- **Rejected note create with current token:** fresh §9.3 remains authoritative. A newly detected macOS mount point yields `replanned`/`target-changed` with refreshed `blocked` + `SOURCE_ROOT_PHYSICAL_ALIAS`; an indeterminate mount-point observation yields `safety-check-failed`.
- **Fulfilled note create:** §15.3 must actually invoke parent checkpoints A, B, and C plus the created-note physical observation. Any authoritative macOS `mount-point` detection on the created note or any required parent below the vault containment boundary is a verification failure even when the realpath is contained; no destructive rollback; current token → `verification-failed` with `SOURCE_WRITE_VERIFICATION_FAILED`; stale token → `post-create-stale` with `verification.status = "verification-failed"` and diagnostics `[STALE_SOURCE_WRITE_PLAN, SOURCE_WRITE_VERIFICATION_FAILED]`.
- **Fulfilled note create followed by post-create parent/created-note macOS mount-point-observation indeterminacy or another required native-probe indeterminate result:** use the same verification-failure mappings as the previous bullet; because create already fulfilled, `safety-check-failed` is no longer a valid result.

An authoritative macOS mount point never becomes `SOURCE_PATH_OBSTRUCTED`, never becomes `SOURCE_NATIVE_PROBE_INDETERMINATE`, and never passes merely because `realpath` remains inside the vault.

### 17.9 Verification completion after fulfilled note create

Verification is read-only and means the entire §§15.3–15.4 sequence, including all three required-parent ancestry checkpoints and the created-note physical observation.

| Verification outcome                                                                                                                    | Source operation token when observed | Required result                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| §§15.3–15.4 fully verified                                                                                                              | current                              | `saved`                                                                                                                                       |
| §§15.3–15.4 fully verified                                                                                                              | stale                                | `post-create-stale`, `verification.status = "verified"`                                                                                       |
| any §15.3/§15.4 verification failure, including parent/created-note Windows reparse, macOS mount-point, or indeterminate physical state | current                              | `verification-failed`                                                                                                                         |
| any verification failure                                                                                                                | stale                                | `post-create-stale`, `verification.status = "verification-failed"`, diagnostics `[STALE_SOURCE_WRITE_PLAN, SOURCE_WRITE_VERIFICATION_FAILED]` |
| verification cannot complete because lifecycle resources closed                                                                         | stale                                | `post-create-stale`, `verification.status = "not-completed"`, diagnostics `[STALE_SOURCE_WRITE_PLAN]`                                         |

Immediately before publishing `saved`, re-evaluate `sourceOperationTokenIsCurrent(token)`.

If token became stale, return/internalize `post-create-stale` with verified status.

No post-create physical/path failure is converted back into `replanned`, `safety-check-failed`, or `mutation-failed` because final note create already fulfilled.

### 17.10 Exhaustive stale/current precedence summary

The following winner rules are absolute:

1. `settings-pending` is permitted only at the Save entry gates in §17.2 before planner execution begins and before any source mutation is attempted;
2. once planner execution for a Save has begun, any later root-persistence transaction makes the source operation stale;
3. after every yield-capable pre-mutation sequence, the §17.4.1 last-point fence is mandatory;
4. at a last-point fence, any false token predicate—including root persistence becoming pending—wins → `stale`;
5. rejected folder create + stale at settlement → `stale`;
6. rejected note create + stale at settlement → `stale`;
7. fulfilled folder create + stale at settlement/post-check → `stale`, with fulfilled folder recorded;
8. fulfilled note create + stale at or after settlement → `post-create-stale`;
9. current-token pre/post-folder environment failure → fresh replan, then `replanned`/`target-changed` if plan differs, otherwise `mutation-failed`;
10. current-token rejected folder/note create → fresh replan, then `replanned`/`target-changed` if plan differs, otherwise `mutation-failed`.

No other status/diagnostic mapping is permitted for these combinations.

### 17.11 External mutation race and view lifecycle

No atomic no-follow primitive is authorized.

If external mutation is visible at a required pre-call checkpoint, behavior follows §§7, 9, and 17 before further mutation.

If external mutation occurs after final checkpoint, post-settlement behavior follows §§17.8–17.9.

No destructive rollback is permitted.

View close/unload:

- increments generation;
- clears session source UI;
- prevents every future mutation not already invoked;
- does not destructively cancel already-invoked create;
- suppresses stale UI completion.

## 18. Architecture boundaries

### `packages/core`

Pure deterministic code for:

- lexical root/path validation independent of configDir;
- registry strict parsing/validation;
- registry indexing;
- classification;
- filename allocation;
- branch-safe topology derivation;
- source-note deterministic rendering;
- inert Markdown encoding;
- dry-run plan/result contracts;
- writer diagnostics.

Core must not import `obsidian`.

### `apps/obsidian-plugin`

Owns:

- settings load/migration/UI;
- configDir exclusion;
- root-state/Vault visibility;
- logical↔resolved Vault path address resolution and exact raw-spelling capture;
- physical-containment verifier, including the Windows read-only generic reparse-point observation and the macOS read-only `getattrlist(2)`/`ATTR_VOL_MOUNTPOINT` observation from §7.8.1;
- current-byte registry adapter using resolved raw paths;
- folder creation;
- create-only note write;
- read-back verification;
- dry-run/save UI;
- generation/mutex lifecycle;
- runtime platform gating.

Vault mutation APIs may appear only in dedicated writer adapter.

## 19. Security and privacy

M03 intentionally permits imported content to persist only inside the explicitly planned source Markdown note after explicit Save.

Imported content must not appear in:

- plugin `data.json`;
- workspace/view serialization;
- logs/console;
- browser storage;
- OPFS/FSA;
- clipboard;
- network;
- unrelated notes;
- config files other than source-root setting text;
- hidden registry artifacts.

`sourceRoot` may persist in settings.

### 19.1 Provenance-scoped non-disclosure

The writer must not intentionally serialize values **from** raw provider message-ID, provider-node-ID, graph-node-ID, diagnostic-identifier, or arbitrary-provider-metadata fields.

Allowed durable provenance is limited to fields explicitly defined by this specification, including `source_conversation_id`.

The non-disclosure rule is not a global character-sequence ban.

Therefore:

- preserved imported title/content may contain a character sequence equal to a forbidden metadata/topology identifier and must not be redacted or omitted solely for that equality;
- `source_conversation_id` may equal another identifier value and remains permitted;
- trusted message refs/fingerprints and topology summaries are application-generated/explicitly permitted outputs;
- field-provenance tests, not global substring absence, determine compliance.

Raw forbidden fields may exist transiently for approved topology/comparison logic but are not selected as writer output fields.

M02 no-network/no-telemetry rules remain.

## 20. UI contract

When a conversation is selected:

- show preservation status;
- expose `Preview source note` only when source writing is otherwise eligible and no Save is active;
- expose `Save source note` only for the one current writable installed Preview plan and only when neither Preview nor Save is active;
- while `sourceRootPersistenceState.status === "pending"`, disable Preview and Save controls and display fixed `SOURCE_ROOT_SETTING_PENDING` message;
- while `sourcePreviewMutex` is held, disable Preview and Save; programmatic Preview reentry returns `preview-in-progress`, and programmatic Save entry returns `preview-in-progress` without mutation;
- while `sourceWriteMutex` is held, disable Preview and Save; programmatic Preview returns `write-in-progress`, while Save reentry follows `in-progress`;
- duplicate → existing/duplicate paths, no Save;
- new-version → explicit label + previous paths;
- blocked → safe diagnostics;
- successful Save → saved path and no stale writable Preview plan;
- replanned Save → replacement plan installed only under §17.2 and a new explicit Save is required.

For writable plans, raw source-note Markdown is displayed only through the exact §14.2 bounded inert display contract and visible complete/truncated label. The displayed prefix is never used as durable Save input.

Settings add `Source folder` with:

- empty default;
- validation feedback;
- explicit-save disclosure;
- warning root changes do not move/rename/delete/modify existing source notes/folders;
- environmental/physical write-eligibility feedback.

Maintain inherited M02 keyboard/focus/theme/narrow-pane behavior.

The additional M03 runtime zoom test is defined only by §23.4 and does not create a broader accessibility requirement beyond the existing controls/states in this section.

## 21. Static verification

Static gate must prove:

- core has no Obsidian import;
- Node filesystem write APIs prohibited;
- read-only `lstat`/`realpath`, any Windows `FILE_ATTRIBUTE_REPARSE_POINT`-equivalent observation, and the exact macOS `getattrlist(2)`/`ATTR_VOL_MOUNTPOINT` observation are confined to the containment verifier;
- no shell/child-process mechanism is used to obtain Windows reparse or macOS mount-point status;
- no macOS `mount`/`unmount`/`setattrlist` or other native mutation capability is exposed by the mount-point observer;
- Windows source writing cannot pass static/runtime qualification if the generic reparse observation capability is omitted or bypassed;
- macOS source writing cannot pass static/runtime qualification if the authoritative mount-point observation capability is omitted or bypassed;
- network/telemetry/provider APIs prohibited;
- unsafe imported-content rendering prohibited;
- forbidden provider/node/graph/diagnostic/arbitrary-metadata fields are not direct writer output sources, while equal strings from allowed source content and `source_conversation_id` remain permitted under §5.1.1;
- Vault mutation APIs confined to writer adapter;
- no source-note modify/append/delete/trash/rename/overwrite;
- no hidden/custom registry store;
- approved M03 spec SHA/bytes unchanged after independent approval.

## 22. Minimum automated/adversarial tests

### 22.1 Settings state machine and Preview/Save cross-transaction gate

Cover:

- valid v1/v2 load and every §6.3 schema category;
- malformed settings and invalid persisted root;
- NFD→NFC root normalization;
- no load-time persistence with byte-identical pre-existing `data.json`;
- invalid page/root edit;
- structural equality under §6.7;
- same-value page edit while no mutex → `unchanged`;
- same-value root edit while no mutex → `unchanged`;
- while page save is pending:
  - same-value page reentry → `in-progress`;
  - different page reentry → `in-progress`;
  - same/current root reentry → `in-progress`;
  - different root reentry → `in-progress`;
  - repeat all with first save fulfill and reject;
- while root save is pending:
  - same-value root reentry → `in-progress`;
  - different root reentry → `in-progress`;
  - same/current page reentry → `in-progress`;
  - different page reentry → `in-progress`;
  - repeat all with first save fulfill and reject;
- page→page, page→root, root→page, root→root ordering;
- assert at most one settings `saveData` promise in flight;
- preview-page save failure restores prior settings without generation change;
- source-root transaction start:
  - increments source generation exactly once;
  - clears plan/cache;
  - stages proposed root;
  - leaves current settled root unchanged while `saveData` is pending;
- root persistence fulfillment:
  - installs proposed root only after fulfillment;
  - settles root persistence;
  - does not restore any old plan;
- root persistence rejection:
  - leaves previous root current;
  - settles root persistence;
  - generation remains advanced;
  - no plan is restored;
- Preview invoked while root persistence already pending → `settings-pending`, no planner invocation;
- Save invoked while root persistence already pending → `settings-pending`, no source-write mutation/mutex work beyond the closed entry gate;
- Preview reentry while `sourcePreviewMutex` is held → `preview-in-progress`, no second planner and no queue;
- Preview while `sourceWriteMutex` is held → `write-in-progress`, no planner;
- Save while `sourcePreviewMutex` is held → `preview-in-progress`, no source-write mutex acquisition/mutation executor;
- accepted Preview clears the previous installed plan before its first yield;
- accepted Save clears the consumed installed plan before its first yield;
- Preview started before root transaction then root transaction begins during any planner await → completion `stale`, computed plan never installed;
- Save started before root transaction:
  - root transaction begins before source planner;
  - during source planner;
  - during folder checks;
  - during final note checks;
  - after note create invocation;
  - assert exact §§16–17 result for both root-persistence fulfillment and rejection;
- after successful root persistence, only a newly run Preview may enable Save under the new root;
- after failed root persistence, only a newly run Preview may enable Save under the restored old root;
- pre-existing valid v1, non-NFC v2, invalid-root v2, malformed, and unsupported-schema `data.json` remain byte-identical in load-only scenarios;
- after loading an unsupported future schema into safe v2 defaults, a later explicit valid M03 settings edit is a new user-triggered v2 save and may replace prior future-schema bytes only if that explicit save fulfills; no load-time rewrite occurs;
- after a fulfilled explicit M03 settings save, fresh parsed persisted data structurally equals exact normalized v2.
- Preview/Save under a settled root whose externally supplied `app.vault.configDir` is ill-formed → `SOURCE_EXTERNAL_PATH_INVALID_UNICODE` before path/collision work and zero mutation.

### 22.2 Root state, logical/resolved addressing, and lexical rules

Cover:

- unconfigured/existing/partially-missing/fully-missing states;
- exact `VaultPathAddress` logical/resolved fields;
- raw NFD existing segment + desired NFC logical segment:
  - accepted as one logical path;
  - resolved path remains exact raw NFD;
  - all subsequent enumeration/read/native lookup uses raw resolved parent;
- case-equivalent non-exact segment → `SOURCE_ROOT_NAME_COLLISION`;
- multiple logical-equivalent candidates → collision;
- complete Windows-invalid character set `< > : " | ? *` rejected on every OS;
- lone high surrogate, lone low surrogate, and mixed ill-formed source-root strings rejected before NFC/UTF-8/filesystem work;
- valid surrogate pairs remain valid Unicode input subject to all other path rules;
- backslash/control/dot/trailing-space/trailing-dot/device-name cases;
- exact parent-first logical `foldersToCreate`;
- provisional resolved paths for partially/fully missing roots;
- first missing segment uses authoritative collision enumeration plus exact native absence under its actual existing parent;
- at least two consecutive later missing segments use §7.5 `synthetic-parent-missing` with no Vault enumeration/native probe against the non-existent immediate parent;
- Preview target occupancy under a planned-missing source-root parent is synthetic/provisional only and is never recorded as native `absent`;
- Save re-enumerates/captures each accepted folder before checking the next child and performs authoritative final target occupancy only after the actual source-root parent exists;
- configDir comparison uses logical collision keys;
- regular-file obstruction;
- symlink/junction/reparse alias;
- realpath escape;
- physical verification unavailable;
- non-Vault-visible existing path;
- exact root error precedence;
- exact resolved path captured after fulfilled folder create.
- ill-formed `app.vault.configDir` string → `SOURCE_EXTERNAL_PATH_INVALID_UNICODE` before `pathCollisionKey`;
- ill-formed Vault-enumerated root child path → `SOURCE_EXTERNAL_PATH_INVALID_UNICODE` before NFC/collision classification;
- ill-formed desktop vault-base path → `SOURCE_EXTERNAL_PATH_INVALID_UNICODE` before native-path construction;
- ill-formed native `realpath` return → `SOURCE_EXTERNAL_PATH_INVALID_UNICODE` before containment comparison;
- ill-formed created-folder re-enumeration path after fulfilled `createFolder()` is never normalized and permits no later mutation;
- every external path ingress fixture asserts that the invalid raw string is not displayed, persisted, NFC-normalized, UTF-8 encoded, or passed to later filesystem/Vault path operations.

- `isNativePathContainedByVault` golden cases:
  - POSIX vault `/` contains `/Sources`;
  - POSIX vault `/vault` contains `/vault/Sources` but not `/vault2`;
  - Windows drive root `C:\` contains `C:\Sources`;
  - Windows non-root `C:\Vault` contains `C:\Vault\Sources` but not `C:\Vault2`;
  - a separator-terminated Windows share/root form returned by the qualified native `realpath` implementation contains its child without a double-separator false rejection;
- native `lstat` outcome algebra:
  - fulfilled normal directory/file/symlink/other → exact `present` kind;
  - authoritative `ENOENT` on a permitted not-yet-required child probe → `absent`;
  - `ENOENT` for an object required to exist → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
  - `ENOTDIR`, permission denial, I/O failure, capability failure, and unknown rejection → `indeterminate`;
- native `realpath` outcome algebra:
  - fulfilled ingress-valid path → `resolved`;
  - authoritative not-found while a required object is expected → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
  - permission/I/O/capability/unknown rejection → `indeterminate`;
  - ill-formed returned path remains `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
- Windows generic reparse-point observation algebra:
  - ordinary non-reparse directory/file with authoritative `FILE_ATTRIBUTE_REPARSE_POINT` bit clear → `not-reparse-point`;
  - junction, mount point, symbolic-link-adjacent or other generic reparse object with the bit set → `reparse-point`;
  - a `reparse-point` result maps to `SOURCE_ROOT_PHYSICAL_ALIAS` before `objectKind` obstruction and regardless of contained `realpath`;
  - permission/I/O/capability-loss/malformed/ambiguous observation after capability establishment → `indeterminate` → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
  - missing Windows generic-reparse observation capability before concrete probing → `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`;
  - an in-vault junction/reparse fixture whose `realpath` remains under the vault still blocks solely because the reparse observation is authoritative;
- macOS mount-point observation algebra:
  - capability establishment uses the exact read-only `getattrlist(2)` request from §7.8 with `ATTR_CMN_RETURNED_ATTRS`, `ATTR_VOL_INFO | ATTR_VOL_MOUNTPOINT`, and `FSOPT_NOFOLLOW_ANY | FSOPT_REPORT_FULLSIZE`;
  - capability state is exactly `available/macos-mount-point` or `unavailable/macos-mount-point`;
  - the vault-base capability probe may report the vault's containing volume mount point without classifying the vault base itself as a prohibited nested mount point;
  - an ordinary directory/file below the vault base whose object real path differs from the returned volume mount-point real path → `not-mount-point`;
  - a non-symbolic mounted filesystem root below the vault base whose object real path equals the returned volume mount-point real path → `mount-point`;
  - a `mount-point` result maps to `SOURCE_ROOT_PHYSICAL_ALIAS` regardless of contained object `realpath`;
  - capability absence, missing returned attribute, malformed initial attrreference, or unusable initial mount-point bytes before concrete probing → `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`;
  - permission/I/O/capability-loss/malformed-attribute/invalid-UTF-8/mount-point-realpath absence/failure after capability establishment → `indeterminate` → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
  - a contained-realpath macOS mount-point fixture blocks solely because the mount-point observation is authoritative;
  - golden adapter tests assert exact attrlist bitmaps/options and reject any shell, mount/unmount, setter, or filesystem-write fallback;
- every indeterminate `lstat`/`realpath`/Windows-reparse/macOS-mount-point root or segment probe asserts zero later source mutation from that invocation;

### 22.3 Filename and target occupancy

Cover:

- total `isCanonicalM03Timestamp` grammar/calendar predicate:
  - valid ordinary date;
  - leap-day valid/invalid;
  - impossible month/day;
  - malformed string;
  - non-string value;
  - leap second;
  - extended year;
  - year `0000`;
- required importedAt invalid/extended-year cases handled under render validation;
- optional invalid/extended-year createdAt/updatedAt → absent/Undated/unavailable;
- exact sanitation, Unicode/CJK, NFC, controls/reserved replacements;
- lone-surrogate title transforms each unpaired code unit to U+FFFD before NFC/sanitation;
- valid surrogate-pair title remains the represented scalar value;
- component/path byte/unit limits;
- invalid `conversation.contentFingerprint` never reaches suffix allocation;
- 12→20→32→64 suffix derivation from valid fingerprint;
- logical case-equivalent target occupancy;
- logical normalization-equivalent target occupancy with different raw spelling;
- existing file/directory/malformed-note occupancy;
- target logical path versus resolved create path under raw-NFD parent;
- full collision;
- never overwrite.
- target native occupancy `lstat: absent` is authoritative unoccupied only for the explicit not-yet-created target check;
- target native occupancy `lstat: indeterminate` → `SOURCE_NATIVE_PROBE_INDETERMINATE`, never unoccupied;
- permission/I/O/capability/unknown target-probe failures produce no writable plan;

### 22.4 Registry access, malformed-warning predicate, and self-trust

Cover:

- existing-root direct-child discovery through exact root `resolvedPath`;
- candidate logical path is NFC(raw resolved path);
- registry `path` exposes logical path while read/lstat/realpath use resolved path;
- nested directory not traversed;
- descendant/direct-child alias behavior remains fail-closed;
- enumeration failure → `SOURCE_REGISTRY_ENUMERATION_FAILED`;
- read/disappearance/type/address instability → `SOURCE_REGISTRY_READ_FAILED`;
- exact trusted frontmatter byte grammar;
- canonical timestamp fields use the total §11.3 predicate without `Date` exceptions;
- invalid/extended-year required `imported_at` makes candidate untrusted;
- invalid/extended-year optional source timestamp field makes candidate untrusted when the field is present;
- decoded JSON string containing a lone surrogate makes candidate untrusted;
- exact raw malformed-warning golden fixtures:
  - BOM + exact opening/discriminator lines → warning;
  - CRLF + exact opening/discriminator lines → warning;
  - missing closing delimiter + both exact discriminators → warning;
  - duplicate discriminator line + both exact discriminators → warning;
  - broken/missing opening delimiter → unrelated/no warning;
  - malformed discriminator value → does not satisfy that discriminator;
  - ordinary Markdown body containing discriminator text without first-line opening delimiter → unrelated/no warning;
  - only one exact discriminator → unrelated/no warning;
- stable malformed warning logical-path ordering;
- duplicate warning after malformed warnings;
- stale metadata cache ignored;
- exact duplicate/version/absent-ID precedence;
- generated frontmatter round-trips through same parser;
- worst-case JSON escaping near 16,384-byte boundary;
- oversized escaped provider conversation ID blocked before write.
- ill-formed Vault-enumerated direct-child registry path → `SOURCE_EXTERNAL_PATH_INVALID_UNICODE` before lowercase `.md` filtering or NFC;
- raw invalid UTF-8 in a non-discriminator JSON-string field makes trusted parsing fail in fatal mode with no U+FFFD replacement;
- invalid UTF-8 + exact raw ASCII opening/type/knowledge-status discriminator lines → exactly one malformed warning;
- invalid UTF-8 inside one discriminator line prevents that line from matching the raw-byte malformed predicate;
- invalid UTF-8 with no exact discriminator pair → no malformed warning;
- writer-self-trust uses the identical fatal decoder and round-trips generated UTF-8 bytes successfully;
- post-write registry rediscovery uses the identical fatal decoder.

- registry candidate required-object `lstat`/`realpath` authoritative absence after enumeration → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
- registry candidate `lstat`/`realpath`/Windows-reparse/macOS-mount-point observation permission/I/O/capability/unknown failure → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
- Windows direct-child registry candidate with authoritative generic `reparse-point` and an otherwise contained `realpath` → `SOURCE_REGISTRY_PHYSICAL_ALIAS`; it never enters trusted identity;
- macOS direct-child registry candidate whose authoritative `ATTR_VOL_MOUNTPOINT` observation yields `mount-point` and whose object `realpath` remains contained → `SOURCE_REGISTRY_PHYSICAL_ALIAS`; it never enters trusted identity;
- no indeterminate native probe is treated as registry-candidate absence, non-reparse/non-mount-point status, or ignored identity input;

### 22.5 Exact topology runtime schema and rendering

Cover all §13.1 schema branches:

- valid `nodeCount`;
- negative/non-integer/unsafe/wrong-type `nodeCount`;
- `nodeCount < messages.length`;
- missing each required graph property;
- graph null/array/non-object;
- selected-path array with non-string element;
- alternative-leaf array with non-string element;
- duplicate element within selected path;
- duplicate element within alternative leaves;
- empty string array element accepted;
- `currentNodeId` null accepted;
- non-empty string current node accepted;
- empty/wrong-type current node rejected;
- unexpected extra graph fields ignored;
- providerNodeId missing/wrong-type/duplicate;
- parent/provider message ID wrong type;
- cross-array overlap represented independently;
- linear/branching/ambiguous/orphan/duplicate-ID topology;
- trusted refs are emitted without intentionally serializing raw provider message/node/graph/diagnostic/arbitrary-metadata fields from those provenance fields;
- deliberate source-text collision: message text exactly equals a raw provider message ID and remains in the exact inert content position;
- deliberate source-text collision: title/code/reference/unsupported content equals raw provider node/graph/diagnostic/arbitrary-metadata values and remains preserved through its allowed source provenance;
- deliberate identifier-domain collision: `source_conversation_id` equals a raw provider message/node/graph/diagnostic/arbitrary-metadata value and remains in the explicitly allowed frontmatter field;
- differential provenance fixture varies forbidden metadata/topology values while preserving allowed source/topology semantics and proves no direct forbidden-field serialization;
- no test uses global substring absence as the sole proof of provenance-scoped non-disclosure;
- exact title/body/content-block grammar;
- lone high/low surrogate fixtures in title, text, code text/language, reference text/URL, and unsupported description;
- golden output proves every unpaired surrogate becomes U+FFFD with UTF-8 bytes `0xEF 0xBF 0xBD`;
- valid surrogate-pair content preserves its Unicode scalar value;
- ill-formed non-empty provider conversation ID blocks before classification/render;
- required importedAt malformed/extended-year blocks deterministically;
- optional conversation/message malformed/extended-year timestamps are omitted/unavailable;
- golden byte fixtures for opening/closing frontmatter delimiters;
- exact `0x0A` joining/final LF;
- frontmatter JSON string values containing literal U+2028/U+2029 → §11.6 requires exactly six ASCII escape bytes for each separator;
- imported source-content body strings containing literal U+2028/U+2029 remain source-content scalars under §12.3 and are not subject to the frontmatter-only §11.6 escape transform;
- hostile Markdown/HTML/wikilink/embed/URL/frontmatter/fence inertness;
- exact note hash.

### 22.6 Authoritative planning state machine

Cover every §9.3 gate in exact order.

Required fixtures include:

- root settings persistence pending → only `SOURCE_ROOT_SETTING_PENDING`, no later planner stage;
- unsupported platform;
- unsupported provider;
- root error;
- invalid content fingerprint:
  - returns only `INVALID_SOURCE_RENDER_INPUT`;
  - performs no registry enumeration;
  - performs no duplicate/version classification;
  - performs no path allocation;
- ill-formed non-empty provider conversation ID → only `INVALID_SOURCE_RENDER_INPUT` before registry access/version classification;
- registry enumeration/read/physical errors;
- every malformed-warning predicate outcome;
- topology failure after malformed warnings;
- exact duplicate one/multiple entries;
- absent-ID/new-version precedence;
- path error after valid content fingerprint;
- render/self-trust error after allocation;
- writable plan.

Assert exact warning/error arrays and order.

- external-path ingress failure at root/config stage returns only `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
- external-path ingress failure at registry candidate stage returns only `SOURCE_EXTERNAL_PATH_INVALID_UNICODE`;
- fatal registry UTF-8 trust failure then exact raw malformed-warning predicate produces the deterministic warning/no-warning outcome before topology/classification.

### 22.7 Save folder-checkpoint and rejection classifier

Cover every current/stale pre-folder branch from §17.5:

- stale before checkpoint;
- invalidation while §7.6 enumeration is pending;
- invalidation while final folder physical-containment/Vault check is pending;
- invalidation after the last yield-capable folder check returns but before §17.4.1 fence executes;
- passing §17.4.1 fence followed immediately by createFolder with no yield;
- current + missing-safe;
- current + exact-directory-present;
- current + blocked with refreshed plan different;
- current + blocked with refreshed plan structurally equal.

Cover fulfilled folder create:

- current + post-check pass;
- stale after fulfillment;
- current + post-check fail + refreshed plan different;
- current + post-check fail + refreshed plan equal.

Cover rejected folder create without inspecting exception text:

- stale at settlement;
- current + external exact directory appeared;
- current + collision/alias/root change;
- current + registry/classification change;
- current + state unchanged → mutation-failed.

Assert exact `acceptedFolderPaths` in every result. A rejected/external-satisfied folder never enters that array.

- pre-folder checkpoint native probe `indeterminate` with current token → `safety-check-failed`, exact accepted folders, zero later mutation;
- fulfilled-folder post-check native probe `indeterminate` with current token → `safety-check-failed`, fulfilled folder retained in `acceptedFolderPaths`, zero later mutation;
- rejected-folder fresh replan blocked by `SOURCE_NATIVE_PROBE_INDETERMINATE` → `safety-check-failed`, without exception-text classification;
- stale token observed before direct safety settlement retains stale precedence;
- current pre-folder Windows generic `reparse-point` → fresh blocked plan `SOURCE_ROOT_PHYSICAL_ALIAS` + `replanned`/`target-changed`, unchanged `acceptedFolderPaths`, zero mutation;
- fulfilled-folder post-check Windows generic `reparse-point` → fulfilled folder remains in `acceptedFolderPaths`, refreshed blocked plan `SOURCE_ROOT_PHYSICAL_ALIAS`, `replanned`/`target-changed`, zero later mutation;
- Windows reparse observation `indeterminate` at pre/post-folder checkpoint → `safety-check-failed` with exact `acceptedFolderPaths`;
- Windows reparse observation capability unavailable before concrete checkpoint probing → refreshed blocked plan `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE` and `replanned`/`target-changed`;
- current pre-folder macOS authoritative `mount-point` → fresh blocked plan `SOURCE_ROOT_PHYSICAL_ALIAS` + `replanned`/`target-changed`, unchanged `acceptedFolderPaths`, zero mutation;
- fulfilled-folder post-check macOS authoritative `mount-point` → fulfilled folder remains in `acceptedFolderPaths`, refreshed blocked plan `SOURCE_ROOT_PHYSICAL_ALIAS`, `replanned`/`target-changed`, zero later mutation;
- macOS mount-point observation `indeterminate` at pre/post-folder checkpoint → `safety-check-failed` with exact `acceptedFolderPaths`;
- macOS mount-point observation capability unavailable before concrete checkpoint probing → refreshed blocked plan `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE` and `replanned`/`target-changed`;

### 22.8 Final note-create and verification cross-product

Cover:

- initial displayed-plan mismatch → `replanned`/`stale-plan`;
- final expected-plan mismatch → `replanned`/`target-changed`;
- invalidation during final §9.3 replan;
- invalidation during final Vault occupancy lookup;
- invalidation during final `lstat`/`realpath`;
- invalidation after the last yield-capable note check returns but before §17.4.1 fence executes;
- passing §17.4.1 fence followed immediately by note create with no yield;
- final containment checkpoint failure + refreshed plan different/equal;
- note create fulfilled/current;
- note create fulfilled/stale;
- note create rejected/stale → `stale`;
- note create rejected/current + fresh plan different → `replanned`/`target-changed`;
- note create rejected/current + fresh plan equal → `mutation-failed`;
- rejection classifier ignores exception message/code/OS error;
- target appears externally;
- duplicate appears externally;
- root/alias changes externally;
- generic permission/I/O rejection with unchanged state;
- verification success/failure × current/stale;
- post-create stale verified/failure/not-completed;
- `createdPath` present only after fulfilled note create;
- every result's exact `acceptedFolderPaths`;
- view close/unload suppression.

All M01/M02 regression tests remain green.

- typed Save executor accepts only a current `new`/`new-version` `SourceWriteSaveRequest`;
- duplicate, blocked, absent, settings-pending, Preview-in-progress, and non-current Preview states do not enter the mutation executor; Save entry while Preview is active returns the closed `preview-in-progress` controller result without source-write mutex acquisition;
- ill-formed created-note/read-back path first observed after fulfilled note create yields exact verification settlement without normalizing/persisting the invalid path.

- final pre-note native occupancy/containment probe `indeterminate` with current token → `safety-check-failed`, no note create;
- rejected-note fresh replan blocked by `SOURCE_NATIVE_PROBE_INDETERMINATE` → `safety-check-failed`;
- `safety-check-failed` never carries `createdPath`, never mutates after the indeterminate probe, and preserves exact `acceptedFolderPaths`;
- fault injection covers permission denial, I/O failure, capability absence, unexpected rejection, and required-object disappearance for `lstat` and `realpath`;
- final pre-note Windows generic `reparse-point` → no note create, refreshed blocked plan `SOURCE_ROOT_PHYSICAL_ALIAS`, `replanned`/`target-changed`, exact `acceptedFolderPaths`;
- final pre-note Windows reparse observation `indeterminate` → `safety-check-failed`, no note create;
- final pre-note macOS authoritative `mount-point` → no note create, refreshed blocked plan `SOURCE_ROOT_PHYSICAL_ALIAS`, `replanned`/`target-changed`, exact `acceptedFolderPaths`;
- final pre-note macOS mount-point observation `indeterminate` → `safety-check-failed`, no note create;
- fulfilled note create followed by created-note/parent Windows generic reparse or macOS mount-point detection → current `verification-failed` or stale `post-create-stale` verification failure, never destructive rollback;
- fulfilled note create followed by Windows reparse or macOS mount-point observation `indeterminate` uses post-create verification-failure settlement, not pre-create `safety-check-failed`;
- assert §15.3 parent checkpoints A, B, and C are actually invoked in order, with the created-note physical observation between A and B and byte/hash verification between B and C;
- inject a contained-realpath Windows generic reparse transition independently at parent checkpoints A, B, and C and require the exact verification-failure mapping;
- inject a contained-realpath macOS mount-point transition independently at parent checkpoints A, B, and C and require the exact verification-failure mapping;
- a parent physical failure after fulfilled note create never returns `replanned`, `safety-check-failed`, or `mutation-failed`.

### 22.9 Preview arbitration, bounded raw-Markdown display, and post-create parent races

Automated tests must cover:

**Preview arbitration**

- Preview while root persistence pending → `settings-pending`, no Preview mutex acquisition;
- Preview while Save/source-write mutex held → `write-in-progress`, no planner invocation;
- Preview reentry while Preview mutex held → `preview-in-progress`, no queue, running Preview remains sole possible winner;
- Save entry while Preview mutex held → `preview-in-progress`, no source-write mutex acquisition and zero mutation;
- accepted Preview clears previously installed plan before first yield;
- import replacement, selection change, Clear, root transaction start, view close, and unload while Preview planner is awaiting → result `stale`, no plan publication;
- accepted Save clears consumed Preview plan before first yield;
- `saved` leaves no installed writable plan;
- `replanned` installs only the returned refreshed plan when token is current;
- all other accepted Save terminal results leave current plan cleared;
- old Preview completion can never overwrite a newer lifecycle state or Save result.

**Raw-Markdown display bound**

- complete note lengths `65_535` and `65_536` UTF-16 code units display completely;
- length `65_537` truncates deterministically;
- an astral Unicode scalar whose surrogate pair would cross the 65,536 boundary causes `cut` to decrement so no pair is split;
- truncated `text` is an exact prefix with no embedded marker;
- complete/truncated visible labels are exact;
- `displayedUtf16Units` and `totalUtf16Units` are exact;
- raw preview uses inert text assignment and never Markdown/HTML rendering;
- Save still receives full original `plan.noteContent` and exact full note hash.

**Post-create required-parent races**

- final pre-create parent is ordinary, note create fulfills, then Windows required parent becomes authoritative generic `reparse-point` with contained `realpath` before parent checkpoint A → verification failure;
- same Windows mutation between parent checkpoint A and created-note observation → parent checkpoint B detects and fails;
- same Windows mutation between byte read and registry rediscovery → parent checkpoint C detects and fails;
- Windows parent reparse observation `indeterminate` at A/B/C → verification failure;
- final pre-create parent is ordinary on macOS, note create fulfills, then the required parent becomes an authoritative non-symbolic `mount-point` with contained `realpath` before parent checkpoint A → verification failure;
- same macOS mount-point transition between parent checkpoint A and created-note observation → parent checkpoint B detects and fails;
- same macOS mount-point transition between byte read and registry rediscovery → parent checkpoint C detects and fails;
- macOS parent mount-point observation `indeterminate` at A/B/C → verification failure;
- analogous POSIX required-parent symbolic-link/realpath-escape injection at A/B/C → verification failure;
- current-token failures return `verification-failed` with exact `acceptedFolderPaths`;
- stale-token failures return `post-create-stale` with verification-failed status and exact diagnostic order;
- no post-create physical failure causes destructive rollback or a later source mutation.

## 23. Supported desktop OS scope and runtime matrix

### 23.1 Supported M03 source-writer platforms

M03 source writing is qualified for:

- macOS desktop;
- Windows 11 desktop.

Linux source writing is explicitly unverified and unsupported in M03.

On unsupported desktop OS:

- import preview remains governed by M02;
- M03 planning returns `blocked` + `UNSUPPORTED_SOURCE_WRITER_PLATFORM`;
- `Preview source note`/`Save source note` writer actions that could mutate source content remain disabled;
- display the exact diagnostic message from §9.1;
- perform zero source-folder/source-note mutation.

Supporting Linux source writing requires a later separately reviewed compatibility amendment/milestone and is not implied by M03.

### 23.2 Required runtime matrix for commit readiness

Run all core M03 write/idempotence/lifecycle/accessibility scenarios on four rows:

| OS         | Obsidian                                                     |
| ---------- | ------------------------------------------------------------ |
| macOS      | exact 1.7.4                                                  |
| macOS      | exact public stable from official metadata at execution time |
| Windows 11 | exact 1.7.4                                                  |
| Windows 11 | exact public stable from official metadata at execution time |

### 23.3 Platform-specific path and physical tests

Every macOS and Windows row must exercise canonical logical versus resolved I/O path behavior.

For each OS:

- exercise source-root lone high surrogate, lone low surrogate, and mixed ill-formed strings and prove lexical rejection occurs before any filesystem I/O;
- exercise title/body lone-surrogate fixtures and prove identical U+FFFD/UTF-8 output bytes across the OS/runtime rows;
- create or otherwise prepare an existing source-root parent whose raw filesystem/Vault spelling is Unicode NFD while its NFC form equals the configured logical NFC segment;
- require root walk to accept exactly one logical match;
- require captured `resolvedPath` to remain the exact raw enumerated spelling;
- require subsequent Vault enumeration, registry reads, native `lstat`/`realpath`, folder creation below that parent, note creation, read-back, and verification to use the resolved raw spelling rather than reconstructing the logical NFC spelling;
- require exposed `sourceRoot`, `foldersToCreate`, `targetPath`, `createdPath`, registry `path`, and collision keys to remain canonical logical NFC values;
- exercise a normalization-equivalent second child and prove it collides rather than creating a second logical path.

macOS rows additionally must exercise:

- POSIX symlink ancestry;
- `realpath` escape;
- hidden/dot root;
- ordinary file obstruction;
- an actual non-symbolic macOS mount point prepared by the external runtime harness at a direct source-root ancestry component below the disposable vault base, with the mounted filesystem's mount path physically inside the same disposable vault so ordinary `lstat` type and `realpath` containment would otherwise pass;
- for that fixture, `observeMacOSMountPoint` must report `mount-point` solely from the authoritative `ATTR_VOL_MOUNTPOINT` observation and the root must block with `SOURCE_ROOT_PHYSICAL_ALIAS`;
- an ordinary directory on the same runtime must report authoritative `not-mount-point`;
- mount-point observation capability-unavailable and concrete `indeterminate` fault-injection cases must produce the exact §7.8 diagnostics and zero later mutation;
- the host test harness may prepare and remove the mount fixture outside plugin execution, but the Chat2Vault plugin itself must never receive mount/unmount authority.

Windows rows additionally must exercise:

- an actual directory junction/mount-point/generic-reparse ancestry fixture whose target/resolved pathname remains inside the same disposable vault; the Windows generic reparse observation must report `reparse-point` and the root must block with `SOURCE_ROOT_PHYSICAL_ALIAS` without relying on an outside-vault `realpath` escape;
- directory junction/reparse-point ancestry targeting outside vault;
- an ordinary non-reparse directory with authoritative reparse bit clear;
- symbolic link where test privileges permit;
- realpath/native resolved-path escape;
- every lexical Windows-invalid character `< > : " | ? *`;
- Windows reserved device names;
- case-equivalent occupancy;
- ordinary file obstruction.

If Windows symbolic-link creation is unavailable due local privilege policy, junction/reparse coverage remains mandatory and the unavailable symlink case must be recorded explicitly.

A required OS/runtime row cannot be replaced by another OS.

If any four-row matrix row is unavailable, AC-30 and AC-31 remain NOT VERIFIED and M03 cannot be commit-ready.

### 23.4 Exact 200% application-zoom runtime procedure

The mandatory M03 `zoom` scenario means **Electron renderer application/page zoom factor 2.0**, controlled only by the external runtime harness. Production Chat2Vault code must not import Electron merely to satisfy this test.

On every required §23.2 row:

1. open the Chat2Vault view in a disposable vault with a writable Preview plan available;
2. using the external harness's host-level Electron `webContents` control, set the Obsidian renderer zoom factor to exactly `1.0` and verify `abs(getZoomFactor() - 1.0) <= 0.001`;
3. set the same renderer zoom factor to exactly `2.0` using the host-level equivalent of `webContents.setZoomFactor(2.0)`;
4. verify `abs(getZoomFactor() - 2.0) <= 0.001`; if the required host-level zoom control/readback is unavailable, the runtime row is NOT VERIFIED rather than substituting OS scaling, text zoom, CSS `zoom`, pinch zoom, or browser emulation;
5. while zoom remains `2.0`, resize the Obsidian split/window through the external harness until the Chat2Vault view-content box reports `clientWidth` in the inclusive range `358..362` CSS pixels;
6. do not alter the plugin DOM/CSS to manufacture the width;
7. after two `requestAnimationFrame` turns, record the view-content `clientWidth`, `scrollWidth`, relevant interactive-control bounding rectangles, raw-Markdown Preview container rectangle, and active-element transitions;
8. require all of these pass criteria:
   - outer Chat2Vault view-content `scrollWidth <= clientWidth + 1` CSS pixel;
   - `Preview source note`, enabled `Save source note`, and the source-root status/control region each have non-zero rectangles wholly within the horizontal bounds of the view-content box with at most 1 CSS pixel measurement tolerance;
   - Preview and Save interactive rectangles do not overlap each other;
   - the §14.2 raw-Markdown Preview container rectangle remains inside the view-content horizontal bounds; internal scrolling inside the raw `pre` container is permitted and is not outer-view overflow;
   - keyboard navigation can move focus to the Preview control and, when the current plan is writable, the Save control, with `document.activeElement` matching the expected control after the corresponding keyboard step;
   - no control required by the current M03 source-preservation state is hidden solely because zoom is 2.0;
9. capture one screenshot of the Chat2Vault leaf at zoom 2.0 and the DOM metric/result JSON above;
10. restore the renderer zoom factor to `1.0` and verify the readback within `0.001` before the row ends.

This test intentionally combines 200% application zoom with an approximately 360-CSS-pixel leaf after zoom. The existing inherited M02 360-pixel test at normal zoom remains a separate regression case.

## 24. Runtime verification scenarios

On every required runtime row execute:

1. M02 preview regression.
2. Settings load/migration states relevant to runtime, including load-only byte-preservation evidence for:
   - valid v1;
   - non-NFC valid v2 root;
   - invalid-root v2;
   - malformed settings;
   - unsupported future schema.
3. Settings persistence mutex same-value reentry:
   - page save pending + same page edit;
   - root save pending + same root edit;
   - first-save fulfillment and rejection.
4. Root-persistence versus Preview/Save cross-transaction matrix:
   - Preview before root transaction, then transaction starts while Preview planner is pending;
   - Preview while root transaction already pending;
   - Preview after fulfilled root transaction;
   - Preview after rejected root transaction;
   - Save before root transaction, with root transaction beginning during source planning;
   - Save during root transaction already pending;
   - Save after fulfilled root transaction;
   - Save after rejected root transaction;
   - root persistence fulfillment and rejection for each applicable interleaving;
   - prove proposed pending root is never used for source mutation.
5. Configure existing safe root.
6. Configure partially missing root and verify exact logical/resolved addresses plus `foldersToCreate`.
7. Configure fully missing root and verify exact logical/resolved addresses plus `foldersToCreate`.
8. Case-equivalent missing-root segment is blocked.
9. Raw NFD existing segment with logical NFC configuration:
   - accepted as one logical root;
   - all I/O uses exact resolved raw path;
   - public plan/result/registry paths remain logical NFC.
10. Windows rows reject each `< > : " | ? *` root character before writable planning.
11. Lone-surrogate source-root fixtures:

- lone high surrogate;
- lone low surrogate;
- mixed ill-formed string;
- all block before NFC/UTF-8/filesystem access.

12. Dry-run proves zero source-folder/source-note mutation.
13. Invalid canonical `conversation.contentFingerprint` returns `INVALID_SOURCE_RENDER_INPUT` before registry/path allocation.
14. Ill-formed non-empty provider conversation ID returns `INVALID_SOURCE_RENDER_INPUT` before registry/version classification.
15. Timestamp matrix:

- ordinary valid timestamp;
- invalid date text;
- impossible date;
- leap-day valid/invalid;
- extended year;
- required invalid importedAt blocks;
- optional invalid createdAt/updatedAt becomes absent/Undated/unavailable.

16. Save through missing-root creation and verify each collision/containment checkpoint.
17. Final folder mutation-fence races:

- invalidation during collision-aware enumeration;
- invalidation during Vault visibility check;
- invalidation during native containment check;
- invalidation immediately after last yield-capable check and before synchronous fence;
- prove no folder mutation after stale fence.

18. Exercise current-token pre-folder blocked state and assert refreshed-plan result.
19. Exercise fulfilled-folder post-check failure and assert deterministic settlement.
20. Exercise folder-create rejection with:

- externally appeared exact directory;
- collision/root change;
- unchanged environment/generic rejection;
- stale token.

21. Final note mutation-fence races:

- invalidation during final §9.3 replan;
- invalidation during final Vault occupancy check;
- invalidation during final physical containment check;
- invalidation immediately after last yield-capable check and before synchronous fence;
- prove no note-create invocation after stale fence.

22. Exercise note-create rejection with:

- externally appeared target/changed plan;
- unchanged environment/generic rejection;
- stale token.

23. Verify exact `acceptedFolderPaths` for every race branch.
24. Exact bytes/frontmatter/body/hash verification including frontmatter-only U+2028/U+2029 ASCII escaping and preserved body-source separator scalars under their respective §11.6/§12.3 rules.
25. Lone-surrogate durable-rendering fixtures:

- title;
- text;
- code text and language;
- reference text and URL;
- unsupported description;
- exact output replacement bytes `0xEF 0xBF 0xBD`.

26. Reload and fresh direct-child registry rediscovery.
27. Malformed-registry warning golden cases:

- BOM;
- CRLF;
- missing closing delimiter;
- broken opening delimiter;
- ordinary body discriminator text;
- invalid timestamp field;
- extended-year timestamp field;
- decoded lone-surrogate string field.

28. Nested descendant alias directory is not traversed by registry.
29. Direct-child registry alias candidate blocks/fails closed.
30. Registry enumeration/read instability fixtures fail closed.
31. Exact duplicate produces zero Chat2Vault vault-content mutation.
32. Changed present conversation ID produces new immutable version.
33. Duplicate-registry anomaly with deterministic warning order.
34. Unrelated/case/Unicode target collisions.
35. Candidate `.md` directory occupancy.
36. Malicious title/content.
37. Valid and malformed topology runtime-schema fixtures, including wrong array element types and duplicate topology-array IDs.
38. Branched/ambiguous/orphan/duplicate-ID topology rendering.
39. Platform-specific path/alias scenarios from §23.3.
40. Root setting change may change settings while existing source notes/folders remain unchanged.
41. After a fulfilled explicit M03 settings save, fresh parsed persisted settings equal exact normalized v2.
42. Inherited M02 accessibility/theme/360-CSS-pixel regression at normal application zoom; the additional M03 zoom requirement is tested separately and exclusively by item 50 using §23.4.
43. External path-ingress fault-injection on every required runtime row:

- ill-formed `app.vault.configDir`;
- ill-formed root-child enumeration path;
- ill-formed registry-candidate enumeration path;
- ill-formed vault-base or `realpath` return supplied by the instrumented adapter boundary;
- ill-formed created-folder re-enumeration path;
- ill-formed created-note/read-back path;
- prove no NFC/path construction occurs before the fail-closed ingress result.

44. Raw invalid-UTF-8 registry byte fixtures:

- invalid bytes in `source_conversation_id` with exact ASCII discriminators → untrusted + malformed warning;
- invalid bytes inside a discriminator line → exact raw predicate behavior;
- no replacement decoding;
- duplicate/version identity excludes every fatal-decode candidate.

45. Provenance-collision source-preservation fixtures:

- preserved content equals provider message/node/graph/diagnostic/arbitrary-metadata values;
- `source_conversation_id` equals one or more of those forbidden-provenance values;
- allowed occurrences remain byte-exact at their deterministic source/frontmatter positions;
- no additional structural output is sourced from forbidden metadata/topology fields;
- global substring-absence assertions are not used for these collisions.

46. Multiple-missing-segment Preview model:

- at least three configured root segments with at least two consecutive missing descendants;
- first missing child proved absent authoritatively under its actual existing parent;
- second/later descendants use only §7.5 synthetic Preview state and perform no enumeration/native probe against a non-existent parent;
- exact parent-first `foldersToCreate`;
- Save creates parent-first and performs authoritative enumeration/native/reparse checks immediately after each accepted create and before the next mutation;
- an externally appeared descendant between folder creates is detected and settled through refreshed-plan rules.

47. Post-create required-parent race matrix:

- Windows generic reparse with contained realpath injected after final pre-create fence and before parent checkpoint A;
- injected between parent checkpoint A and created-note observation;
- injected between created-note observation and parent checkpoint B;
- injected after byte verification and before parent checkpoint C/registry rediscovery;
- indeterminate Windows reparse observation at each checkpoint;
- POSIX symlink/realpath-escape equivalents where supported;
- exact current/stale verification result and `acceptedFolderPaths` with zero rollback.

48. Raw-Markdown Preview display boundaries:

- complete 65,535 and 65,536 UTF-16-unit note strings;
- truncated 65,537+ strings;
- astral scalar crossing the truncation boundary;
- exact complete/truncated label;
- displayed prefix remains inert and Save/hash uses complete note.

49. Preview/Save arbitration matrix:

- Preview → Preview reentry;
- Preview while Save active;
- Save while Preview active;
- Preview invalidated by import/selection/Clear/root/view-close/unload;
- accepted Save clears installed plan;
- `saved` leaves no writable plan;
- `replanned` fresh plan is the only Save-derived UI winner;
- stale completion never overwrites current UI state.

50. Exact §23.4 application-zoom procedure at factor 2.0, including 358..362 CSS-pixel leaf width, DOM metrics, keyboard focus checks, screenshot, and restored 1.0 zoom factor.

### 24.1 Additional physical-path and platform-alias runtime scenarios

In addition to every existing scenario above, run on the required platform rows:

- total containment boundary:
  - supported separator-terminated vault real roots, or an isolated harness invoking the exact production containment function when the application cannot place the test vault at that native root;
  - POSIX `/` child containment;
  - Windows drive/share-root child containment;
  - non-root component-boundary near-prefix rejection;
- root-walk native-probe fault injection:
  - authoritative missing child where absence is meaningful;
  - permission, I/O, capability, and unexpected `lstat`/`realpath` failures;
- target-occupancy fault injection:
  - authoritative target absence;
  - indeterminate target probe;
- folder and final-note checkpoint fault injection:
  - pre-folder;
  - fulfilled-folder post-check;
  - rejected-folder fresh replan;
  - final pre-note occupancy/containment;
  - rejected-note fresh replan;
- Windows generic reparse-point qualification:
  - ordinary object with authoritative `not-reparse-point`;
  - in-vault junction/mount-point/generic reparse with authoritative `reparse-point` while `realpath` remains contained;
  - capability unavailable before first concrete reparse probe → `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`;
  - per-path reparse observation permission/I/O/capability-loss/malformed failure → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
  - direct-child registry candidate injected/fixture `reparse-point` with contained realpath → `SOURCE_REGISTRY_PHYSICAL_ALIAS`;
  - post-folder and final-note mappings exactly follow §17.8.1;
- macOS mount-point qualification:
  - ordinary directory/file with authoritative `not-mount-point`;
  - actual non-symbolic in-vault mount-point ancestry fixture whose object `realpath` remains contained → authoritative `mount-point` and `SOURCE_ROOT_PHYSICAL_ALIAS`;
  - capability unavailable before first concrete mount-point probe → `SOURCE_ROOT_PHYSICAL_VERIFICATION_UNAVAILABLE`;
  - per-path `getattrlist`/attribute-buffer/UTF-8/mount-point-realpath permission/I/O/capability-loss/malformed failure → `SOURCE_NATIVE_PROBE_INDETERMINATE`;
  - direct-child registry-candidate injected or actual mount fixture with authoritative `mount-point` and contained realpath → `SOURCE_REGISTRY_PHYSICAL_ALIAS`;
  - post-folder and final-note mappings exactly follow §17.8.2;
  - after fulfilled note create, inject authoritative contained-realpath mount-point transitions independently at required-parent checkpoints A, B, and C and require verification failure;
- every indeterminate probe must produce the exact planner or `safety-check-failed` Save outcome before mutation, preserve exact accepted paths, and prove zero later mutation from that checkpoint; after a fulfilled note create, §15.3 parent checkpoints A/B/C and created-note observation must actually execute, and any indeterminate/Windows-reparse/macOS-mount-point observation on the required parent or created note must follow the exact §15.3/§17.9 verification-failure mapping; include contained-realpath parent alias races after the final pre-create fence on both required platforms.

## 25. Runtime write/privacy evidence

For every required runtime row retain raw evidence:

- three disabled baselines;
- recursive before/after vault/config manifests for mutation evidence;
- direct Vault write tripwire;
- privileged/native process filesystem trace appropriate to OS;
- root logical↔resolved address map at every checkpoint;
- raw parent-child enumeration used for collision-key decisions;
- physical-containment/alias results, including raw normalized Windows generic reparse-point observations;
- registry direct-child enumeration/read/physical-check evidence, including Windows reparse status before any candidate is trusted;
- browser/storage/clipboard/network tripwires;
- dry-run;
- new-save;
- duplicate;
- new-version;
- collision;
- stale/interleaving/rejection windows.

### 25.1 Persisted settings evidence by origin

The no-load-write policy and M03-emitted-settings policy are distinct evidence states.

#### Pre-existing `data.json` bytes

In a load-only scenario before any M03-initiated settings save:

- existing `data.json` bytes may be valid v1;
- existing bytes may be valid v2 with a non-NFC but lexically valid root;
- existing bytes may be exact-shape v2 with a root that §6.4 disables in memory;
- existing bytes may be malformed or use an unsupported schema;
- plugin load/migration/normalization must not rewrite those bytes.

Runtime evidence must retain the exact pre-load and post-load raw `data.json` bytes and prove byte identity for every load-only fixture.

The in-memory settings object must independently match the exact §6.4 state-table result.

A pre-existing file is therefore **not** required to already be normalized M03 v2.

#### M03-initiated fulfilled settings save

Whenever an explicit M03 settings transaction fulfills:

- the object passed to `saveData` must be exactly the normalized `Chat2VaultSettingsV2` object from §6;
- it must have exactly the keys `schemaVersion`, `previewMessagesPerPage`, and `sourceRoot`;
- after fulfilled persistence, a fresh `loadData`/JSON semantic read must equal that exact normalized v2 object under §6.7 structural equality;
- no source content or additional field may be present.

Raw JSON whitespace, indentation, and property byte ordering produced internally by Obsidian `saveData` are Obsidian-owned and are not a Chat2Vault byte grammar. The semantic parsed object and allowed key set are normative.

#### Rejected settings save

For a rejected `saveData` transaction:

- in-memory rollback follows §§6.8–6.9;
- runtime evidence records raw before/after `data.json` bytes and the rejected result;
- Chat2Vault must not report that the proposed setting was durably saved;
- no automatic retry is performed.

A later plugin reload is governed again by the total §6.4 loader based on whatever bytes actually exist.

Settings persistence is excluded from source-root vault-content confinement.

At most one Chat2Vault settings `saveData` operation may be in flight.

Evidence must include the same-value settings reentry cases from §22.1 and the root-persistence-versus-Preview/Save cases from §22.1.

### 25.2 Allowed source vault-content mutation

Only after explicit writable Save:

- planned missing source-root folders may be created;
- exactly one planned source Markdown note may be created.

No existing source note/folder may be modified, moved, renamed, deleted, or trashed.

### 25.3 Provenance-aware marker and non-disclosure evidence

Imported source markers are expected only inside the intentionally saved source note.

`source_conversation_id` is explicitly allowed there.

For forbidden provider message/node/graph/diagnostic/arbitrary-metadata provenance:

- do not require global substring absence when an equal sequence is present in allowed imported title/content or `source_conversation_id`;
- use dedicated forbidden-only sentinels that do not occur in any allowed source field when substring absence is useful;
- include deliberate collision fixtures where the same sequence occurs both in a forbidden metadata/topology field and an allowed source field;
- prove the allowed occurrence remains at its exact deterministic content/frontmatter position;
- prove no additional structural occurrence is emitted from the forbidden provenance field;
- use differential/golden renderer evidence to show that forbidden metadata/topology fields are not writer output sources.

Markers remain forbidden in settings, logs, workspace state, browser stores, clipboard, network, config, unrelated notes, and external/temp files.

### 25.4 Duplicate evidence

Exact duplicate attempt produces zero Chat2Vault-issued vault-content mutation.

### 25.5 Root-change evidence

Persisting a new root may modify settings.

It must modify/move/rename/delete zero existing source note/folder.

### 25.6 Logical/resolved path and physical-containment evidence

Evidence must prove:

- every exposed plan/result/registry path is canonical logical NFC;
- every existing-object Vault/native I/O operation uses the exact captured resolved raw path;
- a raw NFD existing parent is not accessed by reconstructing its NFC logical spelling;
- case-equivalent but logically non-exact children collide;
- normalization-equivalent raw spelling maps to one logical path;
- resolved ancestry remains inside vault real path at every required checkpoint;
- collision-aware child enumeration occurs immediately before missing-folder mutation;
- post-folder-create enumeration captures the exact raw resolved child address;
- final note create uses resolved target path while `createdPath` exposes logical target path;
- read-back resolves actual raw created path and NFC-normalizes to the planned logical path;
- no observed physical escape;
- on Windows, every trusted existing ancestry component records an authoritative `not-reparse-point` result;
- any authoritative Windows `reparse-point` blocks even when its `realpath` remains contained;
- any indeterminate Windows reparse observation permits zero later mutation before create, or maps to verification failure after a fulfilled note create;
- on macOS, every trusted existing ancestry component below the vault containment boundary records an authoritative `not-mount-point` result from the exact §7.8.1 `ATTR_VOL_MOUNTPOINT` observation;
- any authoritative macOS `mount-point` blocks even when its object `realpath` remains contained;
- any indeterminate macOS mount-point observation permits zero later mutation before create, or maps to verification failure after a fulfilled note create;
- after every fulfilled note create, raw evidence proves §15.3 parent checkpoints A, B, and C each ran over the complete required ancestry, including authoritative platform alias observation for every required component;
- a post-create required-parent contained-realpath Windows `reparse-point` fixture and a contained-realpath macOS `mount-point` fixture each fail verification and never reach `saved`.

This supports checkpointed one-instance guarantees only and does not claim atomic immunity to adversarial external mutation between check and path-based create.

### 25.7 Registry warning/identity evidence

Retain raw bytes and parser/probe results for:

- every trusted registry candidate;
- every malformed candidate that emits a warning;
- every malformed candidate classified unrelated/no-warning;
- exact logical path used to sort warnings;
- exact resolved raw path used for read/physical checks.

Warning membership must reproduce §8.4 byte predicate exactly.

### 25.8 Save race/result evidence

For every tested race branch retain:

- generation before/after settlement;
- operation/displayed/expected/refreshed plans as applicable;
- exact `sourceWritePlanEqual` result;
- promise settlement only as fulfilled/rejected, without exception-text-based classification;
- exact `acceptedFolderPaths`;
- exact execution result status/reason/diagnostic;
- refreshed plan for `replanned`;
- sourcePreviewMutex/sourceWriteMutex ownership at Preview/Save entry and settlement;
- installed Preview plan identity before action, after accepted action start, and after result publication;
- proof that rejected Preview/Save reentry never queues or later overwrites UI state.

No unexplained external/temp/config/vault write may remain.

### 25.9 External-path and registry-byte evidence

For each required runtime row retain:

- adapter-ingress fault records proving every ill-formed external path-like string is rejected before NFC, collision-key derivation, UTF-8 work, or path construction;
- exact stage/diagnostic/result mapping for configDir, root enumeration, registry candidate, native base/realpath, created-folder, and read-back path ingress failures;
- raw invalid-UTF-8 registry candidate bytes;
- fatal-decoder success/failure result with no replacement decoding;
- exact strict-parser result;
- exact raw-byte malformed-warning probe result;
- duplicate/version classification proving fatal-decode candidates are never trusted.

### 25.10 Native containment-boundary and probe-outcome evidence

For every required runtime row retain:

- exact native separator;
- ingress-valid `vaultRealPath`;
- exact `nativeContainmentPrefix` result;
- candidate real path;
- exact `isNativePathContainedByVault` boolean result;
- separator-terminated-root fixtures and component-boundary near-prefix rejection;
- every normalized native `lstat`/`realpath` outcome as `present`, `absent`, `resolved`, or `indeterminate`;
- on Windows, every normalized `WindowsReparsePointProbe` outcome as `reparse-point`, `not-reparse-point`, or `indeterminate`, plus proof that the observation is equivalent to the `FILE_ATTRIBUTE_REPARSE_POINT` bit;
- on macOS, every normalized `MacOSMountPointProbe` outcome as `mount-point`, `not-mount-point`, or `indeterminate`, plus the exact requested attrlist bitmaps/options, returned-attribute-set bits, bounded `ATTR_VOL_MOUNTPOINT` attrreference metadata, raw mount-point bytes, fatal UTF-8 decode result, §5.6.1 ingress result, object real path, returned mount-point real path, and equality classification proving that the observer used the exact §7.8 `getattrlist(2)` contract;
- the authoritative not-found classification used to produce `absent`;
- fault-injected permission, I/O, capability, unknown-rejection, and required-object disappearance cases;
- exact planner diagnostic or Save execution result for each indeterminate probe;
- exact `acceptedFolderPaths` at failure;
- evidence that no later mutation was invoked after an indeterminate safety probe;
- target occupancy evidence proving `indeterminate` was never treated as absence;
- a Windows in-vault generic-reparse fixture whose contained `realpath` still produced `SOURCE_ROOT_PHYSICAL_ALIAS`;
- a macOS non-symbolic in-vault mount-point fixture whose ordinary `lstat` and contained `realpath` would otherwise pass but whose authoritative mount-point observation produced `SOURCE_ROOT_PHYSICAL_ALIAS`;
- exact planner/Save/post-create result and `acceptedFolderPaths` for every authoritative Windows reparse and reparse-observation failure branch from §17.8.1;
- exact planner/Save/post-create result and `acceptedFolderPaths` for every authoritative macOS mount-point and mount-point-observation failure branch from §17.8.2;
- explicit invocation/evidence for §15.3 required-parent checkpoints A, B, and C after fulfilled note create;
- at each A/B/C checkpoint on Windows, authoritative generic-reparse observation for every required parent component, including a contained-realpath reparse race;
- at each A/B/C checkpoint on macOS, authoritative mount-point observation for every required parent component below the vault containment boundary, including a contained-realpath mount-point race;
- created-note physical observation between checkpoints A and B, with exact regular-file/platform-alias/realpath/containment result;
- proof that a post-create parent/created-note Windows reparse, macOS mount-point, or indeterminate observation maps only to current `verification-failed` or stale `post-create-stale` verification failure and never to `saved`.

### 25.11 Preview display, arbitration, and zoom evidence

For every required runtime row retain:

- raw `SourceMarkdownPreviewDisplay` values for complete/truncated boundary fixtures;
- exact displayed prefix hash or bytes, `displayedUtf16Units`, `totalUtf16Units`, and completeness label;
- evidence that full `plan.noteContent`/serialized note hash is unchanged by UI truncation;
- Preview/Save mutex ownership and entry-result records for the complete §14/§17 arbitration matrix;
- UI-state winner record proving stale/rejected completions did not replace the current plan/result;
- for zoom, external harness call log showing host-level zoom factor set/readback at `1.0`, then `2.0`, then restored `1.0`;
- exact 2.0 zoom factor readback, Chat2Vault view `clientWidth`/`scrollWidth`, required control/raw-preview bounding rectangles, active-element keyboard transitions, and one screenshot;
- evidence that the 2.0 zoom test used 358..362 CSS-pixel Chat2Vault view width and did not substitute OS scaling, CSS zoom, text zoom, or pinch zoom.

## 26. Network evidence

M03 remains offline.

Layer A + Layer B over dry-run/save/duplicate/new-version on every required runtime row must show:

```text
zero Direct Chat2Vault network violations
zero unexplained non-baseline egress
```

## 27. Evidence package

Retain raw:

- runtime/OS identity;
- final production artifact hashes;
- approved frozen M03 spec SHA;
- official Obsidian release metadata capture;
- settings load/save/reentry evidence;
- root-persistence pending/fulfill/reject versus Preview/Save interleaving evidence;
- exact source-operation tokens, generation values, settled/proposed roots, and root-persistence state transitions;
- root-state logical/resolved address maps;
- collision-aware direct-child enumerations;
- physical-containment results, including Windows generic reparse-point capability/results and macOS `ATTR_VOL_MOUNTPOINT` capability/results with the exact returned mount-point path/realpath comparison evidence;
- dry-run plan JSON;
- exact planned Markdown bytes/hash;
- pre-allocation invalid-fingerprint fixture evidence;
- topology runtime-schema validation result;
- before/after manifests;
- source-note bytes/hash;
- registry candidate raw bytes, logical/resolved paths, strict-parser results, and malformed-warning probe results;
- registry rediscovery result;
- duplicate/revision/collision/interleaving diffs;
- raw filesystem traces for macOS/Windows;
- Save promise settlement + generation + fresh-plan classifier evidence;
- final last-point mutation-fence samples proving the token was sampled after the final yield-capable check and immediately before each mutation invocation;
- total timestamp predicate fixtures/results;
- lone-surrogate input classification and exact transformed output bytes;
- external-path-ingress fault-injection results for configDir, Vault enumeration, native/base/realpath, created-child, and read-back path strings;
- raw invalid-UTF-8 registry candidate bytes, fatal-decoder result, strict-parser result, and malformed-warning raw-byte probe result;
- provenance-collision fixtures and differential/golden field-provenance evidence demonstrating preserved equal source strings without direct forbidden-field serialization;
- raw tripwire/network logs;
- marker scans;
- accessibility results, including exact §23.4 zoom-factor/viewport DOM metrics and screenshot;
- raw-Markdown Preview complete/truncated boundary evidence from §§14.2 and 25.11;
- Preview/Save arbitration and installed-UI-winner evidence from §§14.1, 17.2, and 25.11;
- post-create required-parent checkpoints A/B/C and contained-realpath platform-alias race evidence, including both Windows generic reparse and macOS non-symbolic mount-point transitions;
- multi-segment missing-root synthetic-Preview versus authoritative-Save checkpoint evidence;
- exact harnesses/analyzers;
- informational performance measurements for near-limit M02 canonical inputs and large synthetic direct-child registries under §27.1, without inventing an unapproved numerical product threshold.

Summaries alone are insufficient.

### 27.1 Implementation/performance caution — no new numerical product threshold

M03 correctness requires complete deterministic source-note rendering and fresh direct-child registry trust checks.

This specification does not authorize a new M03 source-note size limit, registry candidate-count limit, registry aggregate-byte limit, or new numerical main-thread performance acceptance threshold.

Implementation and runtime evidence must nevertheless exercise:

- near-limit canonical inputs already permitted by the immutable M02 import boundary;
- large synthetic direct-child source-root registries sufficient to expose obvious pathological behavior;
- complete note rendering/hashing and registry scanning under those fixtures.

Measurements are implementation evidence and must be reported with known limitations.

They are not a new product pass/fail threshold unless a later independently reviewed specification amendment defines one.

Implementers must not invent truncation, omission, a hidden cap, or source-content loss to improve performance.

## 28. Acceptance criteria

AC-01 — Baseline identity: exact immutable M02 commit `e7350887f8da44d931a648a0f30a9aac87ffce6f`.

AC-02 — Scope: M03 source registry/source-note writer only; no M04+.

AC-03 — Core/contract closure: deterministic core remains Obsidian-independent; exact topology/runtime/render/path contracts, the authoritative-first-missing plus synthetic-descendant Preview model, bounded raw-Markdown display algorithm, Preview/Save arbitration, closed diagnostics/plans/results, total timestamp/Unicode policies, fatal registry UTF-8 decoding, provenance-scoped non-disclosure, native containment/probe algebra, Windows generic-reparse observation, and macOS authoritative mount-point observation require no implementer-invented state or coercion.

AC-04 — Total settings/root-persistence contract: §6 load categories and settings-save transitions are total; settings persistence is serialized; a pending root is staged but never authoritative for Preview/Save; fulfillment/rejection settlement, generation, plan invalidation, and no-load-write evidence are deterministic.

AC-05 — Root-state determinism: unconfigured/blocked/existing/partially-missing/fully-missing roots produce exact logical/resolved addresses, registry behavior, and logical `foldersToCreate`; the first missing segment is authoritatively absent under an existing parent, every deeper planned-missing descendant uses the exact §7.5 synthetic Preview state, and Save converts each descendant to authoritative state parent-first before mutation; external path ingress, containment, native indeterminacy, Windows generic-reparse, and macOS mount-point requirements remain fail-closed.

AC-06 — Root safety and portability: user root lexical validation rejects ill-formed UTF-16 and the complete Windows-invalid/reserved set before NFC/UTF-8/filesystem work; every external config/Vault/native path string is fail-closed by §5.6.1 before transformation; configDir/name-collision/native-probe-indeterminate/obstruction/alias/verification/visibility failures follow exact precedence; Windows generic `FILE_ATTRIBUTE_REPARSE_POINT`-equivalent observation and macOS `getattrlist(2)`/`ATTR_VOL_MOUNTPOINT` observation are mandatory and fail-closed on their supported platforms; authoritative reparse or mount-point presence maps to physical alias even for an in-vault resolved target; the §7.8 component-containment function supports separator-terminated native roots without weakening path boundaries; NFD/NFC existing paths use ingress-valid resolved raw I/O addresses without assuming filesystem normalization.

AC-07 — Source-content confinement: every Chat2Vault-issued source mutation uses a settled authoritative root, is preceded by authoritative non-indeterminate collision/containment probes using the total §7.8 boundary, with authoritative non-reparse observations on Windows and authoritative non-mount-point observations on macOS for every trusted existing component below the vault containment boundary, and passes a synchronous last-point source-operation-token fence after the final yield-capable check and immediately before mutation invocation; indeterminate probes or authoritative reparse/mount-point states permit zero later mutation before create; settings are excluded and external atomicity is not claimed.

AC-08 — Passive actions: import/select/view/status/registry discovery create/modify zero source folder/note.

AC-09 — Preview/dry-run determinism: root-persistence and Preview/Save arbitration outcomes are closed; §9.3 is the sole planner order; multi-segment missing roots use exact authoritative-first-missing/synthetic-descendant semantics; exact diagnostics/root/addresses/folders/path/bytes/hash are produced with zero mutation; writable raw-Markdown UI display follows the exact §14.2 UTF-16 bound without changing durable bytes.

AC-10 — Registry authority: existing roots trust only fresh physically contained, authoritative non-alias direct-child lowercase `.md` raw bytes addressed through ingress-valid resolved paths; every trusted direct-child candidate has authoritative `not-reparse-point` on Windows or `not-mount-point` on macOS as applicable; frontmatter fields decode only with fatal UTF-8; registry identity exposes logical NFC paths; missing valid roots use empty registry; nested descendants are never traversed; no proprietary store.

AC-11 — Registry fail-closed behavior: ingress-invalid candidate paths, enumeration/read/address/physical instability, Windows generic reparse presence/observation indeterminacy, and fatal UTF-8 decode failure have exact closed outcomes; a generic Windows reparse candidate maps to `SOURCE_REGISTRY_PHYSICAL_ALIAS` even when its realpath remains contained; malformed warning membership follows the raw-byte §8.4 predicate after trust failure; decoded string/timestamp fields satisfy total contracts; unrelated files and stale metadata cannot become trusted entries; warning order is deterministic.

AC-12 — Exact idempotence: duplicate causes zero Chat2Vault-issued vault-content mutation within one plugin instance.

AC-13 — Duplicate-registry safety: malformed warnings are logical-path ordered, optional duplicate warning follows them, canonical duplicate logical paths are deterministic, and zero extra mutation occurs.

AC-14 — Version classification: only present/equal provider conversation ID + different valid content fingerprint yields new-version; absent IDs never match; exact duplicate wins.

AC-15 — Filename: the total four-digit-year proleptic-Gregorian timestamp predicate defines UTC/Undated behavior; title lone surrogates are deterministically replaced before NFC/sanitation; fit/suffix/path allocation occurs only after required pre-allocation gates.

AC-16 — Collision: every root/filename used for path construction is well-formed; existing-parent occupancy is authoritative, while descendants under a planned-missing parent use only the explicitly synthetic Preview state and are fully rechecked after each accepted folder create; case/NFC-equivalent collisions, native indeterminacy, suffix escalation, and no-overwrite behavior remain deterministic.

AC-17 — Frontmatter byte contract: byte-level delimiter/LF grammar, exact derivation/order/quoting, total timestamp acceptance, fatal UTF-8 registry decoding, well-formed decoded/persisted strings, U+2028/U+2029 ASCII escaping, writer-self-trust byte/line validation, explicit `source_conversation_id` allowance, and provenance-scoped forbidden-field non-disclosure are deterministic.

AC-18 — Branch-safe completeness and topology schema: `chatgptGraph` and canonical message topology fields satisfy exact §13.1 runtime types/invariants before rendering; every canonical message/block + trusted topology persists without asserting chronology; forbidden raw metadata/topology fields are not intentional output provenance, while equal preserved source strings remain allowed.

AC-19 — Message provenance: trusted message refs + exact canonical fingerprints for every message; writer output never selects raw provider message/node/graph identifiers as provenance fields, while equal character sequences from preserved content or `source_conversation_id` are permitted.

AC-20 — Deterministic inert Markdown bytes: exact title/body/block grammar applies `toM03WellFormedString` before durable serialization; every lone surrogate becomes U+FFFD with bytes `0xEF 0xBF 0xBD`; explicit `0x0A` joining/final LF and exact hash are deterministic; hostile content remains inert and is never redacted solely because it equals a forbidden identifier string.

AC-21 — Create-only boundary: mutation is confined to writer adapter; no Node filesystem writes or source modify/delete/rename; containment verifier is read-only and may use only the exact authorized `lstat`/`realpath`, Windows reparse, and macOS `ATTR_VOL_MOUNTPOINT` observations; every externally supplied path string passes fail-closed ingress before resolved/native I/O use.

AC-22 — One-instance stale/concurrency safety: Preview is non-queuing serialized by `sourcePreviewMutex`, Save is serialized by `sourceWriteMutex`, Preview and Save cannot execute planners/mutations concurrently, source-root persistence remains authoritative only after settlement, token staleness is exact, and every folder/note mutation retains the mandatory last-point fence.

AC-23 — Post-write conformance: after fulfilled note create, the complete required-parent ancestry is authoritatively reverified at §15.3 checkpoints A/B/C and the created note is independently physically observed before trust; Windows generic-reparse or macOS mount-point presence/indeterminacy on any required parent or created note fails verification even with contained realpath; only then may exact byte/hash and fresh registry rediscovery produce `saved`.

AC-24 — Non-destructive total Save outcomes: Preview-active/Save-active entry arbitration, root-settings-pending entry rejection, stale/replanned states, native `safety-check-failed`, every folder/note checkpoint and settlement, Windows reparse/macOS mount-point alias settlements, post-create required-parent/created-note physical failures, post-create staleness, and verification combinations map deterministically to one §16 result; accepted paths remain exact and no destructive rollback/overwrite occurs.

AC-25 — Root-change safety: a proposed sourceRoot is non-authoritative until settings persistence fulfills; success/failure never restores an old plan automatically; existing source notes/folders are not modified/moved/renamed/deleted by root setting transitions.

AC-26 — Lifecycle: overlapping Preview is rejected rather than queued, Preview and Save are mutually excluded, accepted Preview/Save clears stale installed plan state at the defined entry point, source-state invalidators suppress stale Preview publication, and Save result winner rules plus post-create stale behavior follow §§14, 16–17 exactly.

AC-27 — Privacy/provenance: imported material persists only in intentionally saved source note; sourceRoot only in settings; resolved raw paths are transient adapter state; forbidden metadata/topology fields are not intentional writer sources, while equal strings from preserved content and explicitly allowed `source_conversation_id` are permitted; forbidden persistence surfaces remain clean.

AC-28 — Offline: no network/telemetry/provider/clipboard/remote behavior; M02 attribution model passes M03 windows.

AC-29 — Automated verification: pinned formatting, lint, typecheck, M01/M02/M03 tests, build, static/frozen-spec/worker gates pass, including prior cases plus multi-segment synthetic missing-root Preview, Preview/Save serialization, raw-Markdown 65,536-UTF-16 display boundaries, post-create parent checkpoints A/B/C with contained-realpath Windows-reparse and macOS-mount-point races, exact macOS mount-observer capability/probe fixtures, exact zoom harness contract helpers, and all previously closed native/UTF-8/provenance fixtures.

AC-30 — Runtime compatibility: complete four-row macOS/Windows × minimum/current-stable matrix passes all required M03 scenarios, including the actual contained-realpath non-symbolic macOS mount-point prohibition, multi-segment missing-root Preview/Save transitions, post-create required-parent platform-alias races, Preview/Save arbitration, exact raw-Markdown display boundaries, and the reproducible §23.4 200% application-zoom procedure, in addition to every previously closed runtime family.

AC-31 — Raw runtime evidence: four-row evidence additionally records all §15.3 post-create parent checkpoints, contained-realpath Windows-reparse and macOS-mount-point races, authoritative macOS `ATTR_VOL_MOUNTPOINT` capability/probe evidence, synthetic missing-descendant Preview state versus authoritative Save-time checks, Preview/Save mutex/UI-winner arbitration, exact raw-Markdown display-bound data, and §23.4 zoom-factor/viewport metrics/screenshots, while retaining every previously required settings/path/native/registry/privacy/network trace.

AC-32 — Governance/publication: approved spec bytes frozen; any byte change invalidates approval; no commit/push/tag/PR/merge/release/deploy/Community submission/M04 before independent implementation/evidence review and explicit authorization.

All AC-01 through AC-32 must pass for M03 commit readiness.

## 29. Documentation after specification approval

Before approval, `docs/M03_SPEC.md` may change only through specification remediation/re-review.

After independent approval, implementation must not change `docs/M03_SPEC.md`.

Implementation may add/update only milestone-relevant non-spec docs:

- `docs/12_M03_IMPLEMENTATION_NOTES.md`;
- `docs/13_M03_RUNTIME_GATE_REPORT.md`;
- `docs/00_DOCUMENT_INDEX.md`;
- README;
- `docs/04_KNOWLEDGE_SCHEMA.md` only for implementation-status clarification without changing higher-authority semantics.

Historical M02 evidence remains unchanged.

Any proposed byte change to approved M03 spec requires a new SHA/package and fresh independent whole-spec review before implementation resumes.

## 30. Publication limits

M03 implementation authorization does not authorize publication.

Before independent M03 implementation/evidence review:

- no commit;
- no push;
- no tag;
- no PR/merge;
- no release/deploy;
- no Community Plugin submission;
- no M04 work.

Only explicit:

```text
GO — M03 COMMIT READY
```

may authorize separate commit/push governance.

Community release remains M10.

## 31. Governance loop

```text
M03 spec
→ independent whole-spec review
→ remediation/re-review until GO
→ freeze exact approved SHA/bytes
→ implementation
→ automated/runtime evidence
→ independent implementation/evidence review
→ remediation/re-review until GO
→ separate commit/push authorization
```

Independent review must not be performed by the same agent/context that authored or remediated the artifact.

## 32. Human-decision boundary

The Product Owner has resolved the previously identified source-preservation/non-disclosure choice by approving §5.1.1 provenance-scoped non-disclosure.

That decision is normative for this specification:

- no content redaction or omission occurs solely because an allowed source string equals a forbidden identifier value;
- `source_conversation_id` remains explicitly allowed even when equal to another identifier;
- compliance is proven by field provenance, structural/golden output, and deliberate collision fixtures rather than global substring absence.

No Product Owner decision is currently missing after that resolution.

End-user source-root selection and explicit Save are runtime choices, not specification blockers.

Escalate only if implementation reveals a genuine product choice unresolved by this specification or higher authority.
