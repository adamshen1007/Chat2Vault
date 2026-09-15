# Milestone 05.1 File-Based macOS Keychain Amendment

Version: 1.0.0  
Date: 2026-09-01  
Status: **Product Owner authorized; independent technical review pending**

## 1. Decision and purpose

The Product Owner authorizes M05 to store its one provider credential in the
logged-in user's default file-based macOS Keychain, normally the login
Keychain. This replaces the infeasible data-protection Keychain requirement in
the approved M05 specification while preserving the M05 secret, identity,
mutation-verification, privacy, and fail-closed contracts.

The amendment is necessary because the signed Obsidian host does not expose a
usable application identifier or Keychain access group. The required
data-protection `SecItemAdd` and `SecItemDelete` operations fail inside an
actual Obsidian renderer with `errSecMissingEntitlement` (`-34018`). A native
plugin library inherits the host executable's entitlements and cannot add that
authority itself.

## 2. Authority, immutability, and precedence

The approved base specification remains the exact UTF-8 bytes of
`docs/M05_SPEC.md` with SHA-256:

```text
895504880bc369bfbe64d60f60f675064f538458a563b2476fb9cf2e9c4876fd
```

Those bytes remain unchanged. Before implementation resumes, a genuinely
independent read-only review must approve one exact UTF-8 byte sequence of this
amendment and its SHA-256 with the exact verdict:

```text
GO — M05.1 FILE KEYCHAIN AMENDMENT APPROVED
```

After that verdict, the approved amendment bytes are frozen. Any byte change
invalidates amendment approval and requires a new hash and independent review.

For M05.1 only, this amendment supersedes the base specification solely for
the clauses listed in §§4–7. It has precedence for those clauses. Every
unlisted base requirement remains unchanged and mandatory.

## 3. Scope and non-goals

The amended credential store is:

- the current logged-in macOS user's default file-based Keychain, normally
  `login.keychain-db`;
- addressed through the Security-framework `SecItem` API plus the single
  read-only `SecKeychainCopyDefault` operation bounded by §4;
- one generic-password item per persisted Chat2Vault installation identity;
- local to the macOS user and governed by the file-based Keychain's access
  control and lock state.

M05.1 does not add a signed helper application, provisioning profile,
Keychain access group, App Group, iCloud synchronization, custom Keychain file,
secret fallback, plaintext storage, environment-variable credential, browser
credential store, Windows support, Apple Silicon support, packaging, release,
or M06 behavior.

The file-based Keychain is a compatibility boundary for the current Obsidian
plugin host. Migration to a data-protection Keychain requires a separately
specified host/helper architecture and is outside M05.1.

## 4. Superseded native Keychain selection contract

This section supersedes base §7 paragraphs requiring
`kSecUseDataProtectionKeychain = true` on every query and referring to the same
data-protection Keychain domain.

Every native entry first resolves the current user's default file-based
Keychain with `SecKeychainCopyDefault`. Failure to resolve it fails closed.
Within one Set or Delete call, the exact retained `SecKeychainRef` resolved at
entry is reused for the observation, mutation, and verification phases so an
external default-Keychain change cannot split one transaction across stores.

Searches are pinned to only that Keychain with a one-element `CFArray` under
`kSecMatchSearchList`. This includes status, Provider read, Set's preliminary
presence query, the selector passed to `SecItemUpdate`, the selector passed to
`SecItemDelete`, post-Set verification, and post-Delete absence verification.
The dictionary passed to `SecItemAdd` instead selects that same retained
Keychain with `kSecUseKeychain` and contains no `kSecMatchSearchList`. Thus
searches cannot observe a same-service/account item in another search-list
Keychain while additions still target the resolved default.

Every query continues to omit all of:

- `kSecUseDataProtectionKeychain`;
- `kSecAttrAccessGroup`;
- `kSecAttrSynchronizable`.

`kSecUseKeychain` is permitted only in an Add dictionary and its value must be
the exact retained `SecKeychainRef` returned by `SecKeychainCopyDefault` for
that call. `kSecMatchSearchList` is permitted only in a search/mutation selector
and its value must be a one-element array containing that exact retained
reference. No production input can supply or replace either value.

The implementation must not open, construct, select by path, change the
default, change the search list, or persist a custom Keychain. It relies on the
Security framework's logged-in user context and current default selection. If
that Keychain is absent, locked, unavailable, or rejects the operation, the
existing closed native and TypeScript failure results remain authoritative.
There is no fallback store.

No other `SecKeychain` operation is permitted in production. Retain/release of
the returned `SecKeychainRef` through ordinary CoreFoundation reference
lifecycle is permitted and required; it is not a Keychain selection or
mutation operation.

The item remains `kSecClassGenericPassword` with the exact fixed service and
derived `installation/<installationId>` account from base §7. The amendment
supersedes and removes the base
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` requirement. Production must
not set `kSecAttrAccessible` or `kSecAttrAccessControl`, because those are
data-protection Keychain contracts. No synchronizable attribute is ever set.

Production also does not set `kSecAttrAccess`; the item uses the file-based
Keychain access object assigned by the Security framework to the creating
Obsidian host. M05.1 relies only on the default Keychain's ordinary lock and
host access-control behavior. It makes no biometric, Secure Enclave,
after-first-unlock, ThisDeviceOnly, backup/migration, or per-plugin isolation
claim. Other code executing with the same Obsidian host identity is not
cryptographically isolated from Chat2Vault by this storage choice; that is a
disclosed limitation of the authorized compatibility architecture.

All other native contracts remain unchanged, including:

- status and absence queries never request secret data;
- Provider read and native post-Set verification are the only secret reads;
- Set uses missing/configured observation followed by `SecItemAdd` or
  `SecItemUpdate` and exact byte verification;
- Delete uses `SecItemDelete` and an independent absence query;
- native results expose no OS message, OSStatus, pointer, or secret except the
  successful Provider-read secret;
- mutation failure and indeterminate-verification semantics remain exact;
- the module remains linked only to Security and CoreFoundation.

## 5. Superseded security and operational disclosure

This section supersedes only base statements that characterize the credential
as a data-protection Keychain item.

The API key still persists only as the single generic-password item and never
enters plugin settings, logs, diagnostics, reports, fixtures, telemetry, Git
artifacts, vault content, or another fallback. The user's default file-based
Keychain may require normal macOS unlock or access-control interaction. A
denial, locked Keychain, missing default Keychain, or unexpected prompt failure
must fail closed through the existing `KEYCHAIN_*` results and must not start
DNS or provider network access.

The settings disclosure must identify storage as the current local macOS
default/login Keychain rather than the data-protection Keychain. It must state
that access is governed by that Keychain and the Obsidian host identity. It
must not claim iCloud sync, Secure Enclave protection, biometric protection,
after-first-unlock availability, device-only backup behavior, or independence
from the Obsidian host's code-signing identity.

## 6. Superseded automated and runtime evidence

This section supersedes base §§20–21 only where they require proof that every
query uses the data-protection Keychain domain.

Automated native-source and runtime evidence must instead prove:

1. each operation resolves the default with `SecKeychainCopyDefault`; every
   search/update/delete selector uses a one-element `kSecMatchSearchList`; Add
   alone uses `kSecUseKeychain`; both point to the exact retained default
   `SecKeychainRef` for that call;
2. production omits every prohibited attribute in §4, including
   `kSecAttrAccessible`, `kSecAttrAccessControl`, `kSecAttrAccessGroup`,
   `kSecAttrSynchronizable`, and `kSecUseDataProtectionKeychain`;
3. no custom Keychain path, `SecKeychainOpen`, default/search-list mutation,
   alternate store, or fallback exists in production;
4. one unique inert synthetic account completes status, create, Provider read,
   replace, delete, and final absence verification in a logged-in macOS user
   context;
5. a temporary secondary search-list Keychain containing the same synthetic
   service/account cannot affect status, read, update, delete, or verification
   in the resolved default Keychain; both synthetic items and the temporary
   Keychain are removed and independently proven absent in `finally`;
6. cleanup runs in `finally` and final absence is independently verified;
7. the same production native bytes pass both required Obsidian runtime rows;
8. locked/unavailable/denied and malformed native outcomes fail closed with
   zero network access and no secret persistence outside the Keychain item.

The standalone Node lifecycle is supporting native evidence. Both required
Obsidian rows remain mandatory because library behavior and access control are
governed by the actual host process. No real credential is required or allowed
in committed or retained evidence.

## 7. Superseded acceptance criteria

The following text supersedes only the data-protection-domain clauses of base
AC-03, AC-19, and AC-22.

**AC-03 — file-based Keychain state machine:** The exact ABI-1
native/TypeScript boundary implements the total credential
observation/mutex/read/mutation state machine for each durably authoritative
installation identity without exposing secret/error bytes. Every native entry
resolves the current default file-based Keychain; every search/update/delete
selector is pinned to only that retained reference and Add targets the same
reference. Competing search-list items cannot be observed or mutated;
status/absence retrieve no data; invalid input and pre-authority initialization
perform zero native access; every valid mutation advances generation before
native access.

**AC-19 — closed persistence allowlist:** The API key persists only in the one
generic-password item in the logged-in user's default file-based macOS
Keychain. Every other base AC-19 persistence, privacy, synthetic-data, and
redaction restriction remains unchanged.

**AC-22 — two-row runtime proof:** Both required Obsidian rows bind identical
production hashes and approved authorities; the strictly delimited runtime
bundle executes the byte/source-identical production Provider path and proves
identity initialization, the complete synthetic file-based Keychain lifecycle
and cleanup, expected network attempts, zero M05 vault mutation, zero
application persistence of secret/content, and every other base AC-22 path.

All other acceptance criteria remain unchanged. M05.1 commit readiness still
requires every amended and retained criterion to pass simultaneously.

## 8. Required implementation alignment

After the exact amendment receives independent approval:

1. replace the data-protection query constructor with default-Keychain
   resolution plus the exact Add/search pinning split in §4;
2. remove `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and add a
   source-level gate for every prohibited selector, attribute, path, mutation,
   and fallback named in §4;
3. add the secondary-search-list collision and complete cleanup proof;
4. keep the fixed service/account and every closed ABI/state transition;
5. add red-first tests for the status/mutation mutex and accepted-operation
   read stale fence identified by Task 4 review;
6. rerun the complete synthetic native lifecycle and verify cleanup;
7. update M05 UI disclosure, plan, implementation notes, runtime evidence, and
   final report consistently;
8. obtain a fresh independent R2 implementation/evidence review before any
   commit-readiness decision.

## 9. Authorization and current decision

The Product Owner authorized the recommended file-based Keychain amendment on
2026-09-01. That authorization permits preparation and independent review of
this exact amendment. Implementation resumes only after the §2 review verdict.

Current decision:

```text
NO-GO — independent M05.1 amendment review pending
```

This authorization does not authorize staging, commit, push, PR, merge, tag,
deployment, release, publication, paid provider use, real-credential use, or
M06 work.
