# M08 ChatGPT Capture Workflow

Version: 1.0  
Date: 2026-10-27  
Status: Manual-paste and selected-text Web Clipper staging-to-source locally verified; candidate uncommitted and unpublished  
Web Clipper route: SELECTED-TEXT ONLY / PARTIAL CAPTURE

## Qualification boundary

The manual-paste workflow below is documented and contract-tested. Exact-candidate minimum/current-stable macOS x86_64 host rows exercise create-only save plus crash/reload and persistence-failure blocking. The host staging fixture is explicitly `synthetic-staging-contract`. Separate 2026-10-25 disposable-vault observations show an actual official Web Clipper selected-text staging-to-source path. The importable [ChatGPT template](../assets/web-clipper/chatgpt-capture.json) is the exact exported candidate observed there (SHA-256 `3326b5cfc696b6e49ce446fc73d48ef330d0b20025d8f7beeea7be7f5e08c02c`). It is qualified only for user-selected text as a partial, visible-page-unverified capture; unselected extraction failed fidelity. The [implementation report](26_M08_IMPLEMENTATION_REPORT.md) records exact-candidate gate results and publication status. On 2026-10-20, the Product Owner confirmed that the official Web Clipper companion remains a required M08 deliverable; manual-only completion is not authorized.

The official [Obsidian Web Clipper documentation](https://obsidian.md/help/web-clipper) was reachable in Chrome on 2026-10-16. On 2026-10-20, browser control rejected direct Chrome Web Store navigation; Chat2Vault did not bypass that restriction or install the extension. The Product Owner then supplied a minimal template exported from the installed official Chrome extension, version 1.7.1 (export SHA-256 `45dba0effc7939dac924a1443bfae7e08bb7defaf896d8de9995f9a75dfdf259`). Its top-level schema was inspected without copying its original path or private browser state into the repository. The Product Owner imported a separate temporary create-only, ChatGPT-triggered candidate (SHA-256 `3326b5cfc696b6e49ce446fc73d48ef330d0b20025d8f7beeea7be7f5e08c02c`). On 2026-10-24/25, the Chrome popup displayed “Please try reloading the page” after a page reload. Relaunching Chrome on its updated installed build cleared that popup blocker, but causality is not proven. Two first, unselected clips created distinct staging notes with valid structure but captured unrelated page UI/accessibility text and an iframe instead of the visible synthetic conversation. Unselected default `{{content}}` extraction therefore fails the content-fidelity gate; only the later selected-text partial-capture path is qualified.

The exported asset uses **Create a new note**, strict staging frontmatter, and a ChatGPT conversation-URL regex; it does not use Interpreter or prompt variables. In official Web Clipper 1.7.1, the first template in the list is also the fallback when no trigger matches ([Obsidian template documentation](https://obsidian.md/help/web-clipper/templates)). Keep a generic fallback template above Chat2Vault. The Product Owner observed the generic template selected on `https://example.com/` and Chat2Vault selected on a synthetic ChatGPT conversation after ordering them this way, without saving an off-site clip. This is browser selection evidence, not a claim that the extension itself prevents a user from manually choosing the Chat2Vault template on another site; inspect the proposed URL and note before **Add to Obsidian**.

Selected-text tests for synthetic conversations A and B subsequently created two distinct 298-byte staging notes. A had SHA-256 `e203120a311b4b2e78a856c8ad5ca3ac9dc091757f7def6a9159780275f8a6cd`; B had SHA-256 `2bad158e76922eddf5deb7fcd4026ad39cd4aa3f65c9312fa515d7e72a76e0ad`. Both contain their exact prompt and reply, without the unrelated UI text or iframe. The current strict parser accepted both and normalized their URLs. The prior staging-note hashes remained unchanged after B was created. In the disposable Obsidian 1.13.7 vault, Chat2Vault preview/save produced two distinct immutable source notes from those actual Web Clipper staging notes. Both source files passed strict parsing and matched their planned renderings byte-for-byte; all staging-note hashes remained unchanged, and a repeated B save was a no-op. This establishes the selected-text staging-to-source path, not general ChatGPT extraction completeness. On ChatGPT, the user must select only the conversation text before invoking the candidate `{{content}}` template and inspect the proposed note before **Add to Obsidian**; unselected default extraction is known to capture unrelated content.

## Manual-paste candidate workflow

### Prerequisites

1. Use the supported macOS x86_64 plugin environment. Continue using a disposable vault while M08 remains unmerged and unreleased.
2. In Chat2Vault settings, configure a vault-relative **Source folder** and a separate **Knowledge folder**. They must not overlap.
3. Resolve any displayed capture-reconciliation warning before another save. Never delete a `.chat2vault-private-*` candidate solely because the UI names it; inspect the filesystem outcome first.
4. Open the ChatGPT conversation you intend to preserve. Expand or scroll content yourself as needed. Chat2Vault cannot prove that lazy-loaded, collapsed, selected, or off-screen content is present.

### Capture and preview

1. Select and copy only the ChatGPT text you intend to preserve. Do not include credentials, account details, or unrelated private material. Chat2Vault does not read the clipboard; you explicitly paste into its textarea.
2. In Obsidian, run the command **Chat2Vault: Preview ChatGPT capture**.
3. In the **ChatGPT capture text** textarea, paste the selected text.
4. Optionally enter the conversation URL in **ChatGPT capture URL**. It must be an HTTPS `chatgpt.com/c/<canonical-UUID>` URL. Chat2Vault removes any query and fragment before preview, hashing, or source persistence. Inspect the normalized URL shown in the preview. If you omit the URL, the UI must show **No provider-page URL will be preserved for this capture.**
5. Select **Paste ChatGPT capture**. This is an explicit preview action; it does not access the system clipboard.
6. Before saving, inspect all of the following:

   - `Origin: Manual paste`;
   - scope `visible-page-unverified` and the incomplete-capture warning;
   - normalized URL or the missing-URL warning;
   - captured byte count and complete captured-text preview;
   - exact target path;
   - complete proposed capture-source Markdown.

7. If anything is wrong, edit the text or URL and preview again. Any edit invalidates the previous preview and keeps saving disabled until a fresh preview succeeds.

### Save and verify

1. Select **Save capture source** only after the current preview is exact.
2. A successful create opens the new source note when Obsidian can open it. If automatic opening fails, use the displayed saved path.
3. Verify that the note is under the configured source folder and contains:

   - `chat2vault_schema: 2`;
   - `type: "ai-conversation-web-capture"`;
   - `source_provider: "chatgpt"`;
   - `capture_method: "manual-paste"`;
   - `capture_scope: "visible-page-unverified"`;
   - the displayed SHA-256 capture fingerprint;
   - `source_url` only when a valid normalized URL was supplied;
   - the exact reviewed text and the partial-capture warning.

4. Confirm that existing source and knowledge notes were not modified, renamed, deleted, or overwritten.

## Duplicate and changed-content behavior

- Repeating the exact normalized manual capture yields `existing-identical`; Chat2Vault reuses the existing path and performs no second source write.
- Changing the captured text changes the fingerprint and plans a new create-only source note.
- A different file already occupying the preferred path blocks the save. Chat2Vault does not overwrite it.
- If publication becomes uncertain, capture remains blocked across view close and plugin reload until the filesystem outcome is independently reconciled and **I reconciled this capture artifact** is explicitly selected.

## Privacy and limitations

- The saved artifact is a page/text capture, not a complete ChatGPT export. Selection, lazy loading, collapsed turns, and site changes may omit content.
- Manual capture makes no Chat2Vault provider request and performs no background browser or session access.
- Draft text, title, and URL remain in memory until save; the content-free reconciliation record never contains them.
- The saved capture is local Markdown, but Obsidian Sync, iCloud, or another vault-sync service may transmit it independently of Chat2Vault.
- The selected-text Web Clipper route uses create-new behavior, no Interpreter or prompt variables, a user-selected staging folder, and strict staging frontmatter. Unselected extraction failed fidelity; select only the intended visible conversation text and inspect it before adding. The local exact-candidate gates pass, but publication and release remain unauthorized. Chat2Vault does not delete the staging note; the user controls its later removal.

## Web Clipper qualification evidence

Qualification evidence and retained limitation:

1. Record exact browser, official extension, and Obsidian versions.
2. Export a minimal template from the installed official extension and retain its actual current JSON schema. This was completed for Chrome Web Clipper 1.7.1 on 2026-10-20; the selected-text clipping behavior was subsequently observed, but general extraction completeness is not established.
3. Verify the actual output of `{{url}}`, `{{title}}`, and the chosen bounded content variable on synthetic content.
4. The exported regex passed local positive/negative URL cases. The Product Owner observed the generic fallback on `https://example.com/` and Chat2Vault selection on a synthetic conversation after ordering a generic template first. Web Clipper's first-template fallback means mere selection on an unrelated page is not proof of a regex match.
5. Confirm **Create a new note** behavior with no Interpreter, prompt, append, prepend, daily-note, or overwrite mode.
6. In a disposable vault, clip two distinct synthetic pages and prove that two distinct staging notes are created without mutation of the first.
7. Inspect both staging notes with the strict parser, compare visible and captured synthetic text, and record partial extraction honestly.
8. The exported JSON and positive/negative template-contract tests are included. Exact-candidate aggregate and retained host-gate results are recorded in the implementation report. A later included-byte change requires fresh host binding and aggregate verification; passing local gates does not authorize commit, publication, or release.
