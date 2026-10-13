import {
  parseKnowledgeCatalogNote,
  sha256,
  type KnowledgeReviewEdit,
} from "@chat2vault/core";
import type {
  CandidateMatch,
  CombinedPreviewResult,
  DedupDiagnostic,
  DedupWriteResult,
} from "./knowledge-dedup-controller.js";

interface PanelCandidate {
  id: string;
  title: string;
  summary: string;
  body: string;
  tags: readonly string[];
  decision: string;
}
export interface DedupPanelSnapshot {
  candidates: readonly PanelCandidate[];
  matches: readonly Pick<CandidateMatch, "candidateId" | "result">[];
  diagnostics: readonly DedupDiagnostic[];
}
export interface DedupPanelServices {
  previewCombined(
    id: string,
    path: string,
    draft: KnowledgeReviewEdit,
    displayedSelectedDigest: string,
  ): Promise<CombinedPreviewResult>;
  createCombined(): Promise<DedupWriteResult>;
  readKnowledgeNote(path: string): Promise<Uint8Array>;
  openKnowledgeNote(path: string): Promise<void>;
}

/** DOM-only M07 presentation. The gate, not this panel, owns every write. */
export class KnowledgeDedupPanel {
  private snapshot: DedupPanelSnapshot = {
    candidates: [],
    matches: [],
    diagnostics: [],
  };
  private candidateId: string | undefined;
  private selectedPath: string | undefined;
  private selectedText = "";
  private selectedDigest: string | undefined;
  private draft: KnowledgeReviewEdit | undefined;
  private confirmed = false;
  private preview:
    Extract<CombinedPreviewResult, { status: "ready" }> | undefined;
  private diagnostic = "";
  private generation = 0;

  public constructor(
    private readonly root: HTMLElement,
    private readonly services: DedupPanelServices,
  ) {}

  public invalidate(): void {
    this.generation += 1;
    this.preview = undefined;
    this.confirmed = false;
    this.selectedPath = undefined;
    this.selectedText = "";
    this.selectedDigest = undefined;
    this.draft = undefined;
    this.diagnostic = "";
    this.draw();
  }

  public render(snapshot: DedupPanelSnapshot): void {
    const prior = JSON.stringify(this.snapshot);
    this.snapshot = snapshot;
    if (prior !== JSON.stringify(snapshot)) this.invalidate();
    else this.draw();
  }

  private button(
    parent: HTMLElement,
    label: string,
    action: () => void,
  ): HTMLButtonElement {
    const button = parent.ownerDocument.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", action);
    parent.append(button);
    return button;
  }

  private draw(): void {
    this.root.replaceChildren();
    this.root.setAttribute(
      "aria-label",
      "Knowledge duplicate and combined-note review",
    );
    const heading = this.root.ownerDocument.createElement("h5");
    heading.textContent = "Duplicate and related knowledge";
    this.root.append(heading);
    for (const match of this.snapshot.matches) {
      const groups: [string, readonly string[]][] = [
        ["Exact duplicate notes", match.result.exact.map((note) => note.path)],
        [
          "Changed source content",
          match.result.sameSourceDetails
            .filter((item) => item.kind === "changed-source-content")
            .map((item) => item.path),
        ],
        [
          "Alternative extraction of unchanged source",
          match.result.sameSourceDetails
            .filter((item) => item.kind === "alternative-extraction")
            .map((item) => item.path),
        ],
        ["Related suggestions", match.result.related.map((note) => note.path)],
      ];
      for (const [label, paths] of groups) {
        const group = this.root.ownerDocument.createElement("section");
        group.setAttribute("aria-label", label);
        const title = this.root.ownerDocument.createElement("h6");
        title.textContent = `${label === "Exact duplicate notes" ? "Exact duplicates" : label} for ${match.candidateId}`;
        group.append(title);
        if (paths.length === 0) {
          const none = this.root.ownerDocument.createElement("p");
          none.textContent = "none";
          group.append(none);
        }
        for (const path of paths) {
          this.button(group, `Open ${path}`, () => {
            void this.services.openKnowledgeNote(path);
          });
          this.button(group, `Select existing note ${path}`, () => {
            void this.select(match.candidateId, path);
          });
        }
        this.root.append(group);
      }
    }
    for (const diagnostic of this.snapshot.diagnostics) {
      const message = this.root.ownerDocument.createElement("p");
      message.textContent = diagnostic.message;
      this.root.append(message);
    }
    if (this.selectedPath === undefined || this.draft === undefined) return;
    const selected = this.root.ownerDocument.createElement("section");
    selected.setAttribute("aria-label", "Selected existing note, read only");
    const selectedPath = this.root.ownerDocument.createElement("p");
    selectedPath.textContent = `Existing note: ${this.selectedPath}`;
    selected.append(selectedPath);
    const existing = this.root.ownerDocument.createElement("pre");
    existing.textContent = this.selectedText;
    selected.append(existing);
    this.root.append(selected);
    const fields: [keyof KnowledgeReviewEdit, string, string][] = [
      ["title", "Combined title", this.draft.title],
      ["summary", "Combined summary", this.draft.summary],
      ["body", "Combined body", this.draft.body],
      ["tags", "Combined tags, one per line", this.draft.tags.join("\n")],
    ];
    for (const [key, label, value] of fields) {
      const input = this.root.ownerDocument.createElement(
        key === "body" ? "textarea" : "input",
      );
      input.setAttribute("aria-label", label);
      input.value = value;
      input.addEventListener("input", () => {
        if (this.draft === undefined) return;
        this.draft = {
          ...this.draft,
          [key]:
            key === "tags"
              ? input.value
                  .split("\n")
                  .map((tag) => tag.trim())
                  .filter(Boolean)
              : input.value,
        };
        this.confirmed = false;
        this.preview = undefined;
        this.generation += 1;
        this.draw();
      });
      this.root.append(input);
    }
    const confirmation = this.root.ownerDocument.createElement("input");
    confirmation.type = "checkbox";
    confirmation.checked = this.confirmed;
    confirmation.setAttribute("aria-label", "Confirm combined draft");
    confirmation.addEventListener("change", () => {
      this.confirmed = confirmation.checked;
      this.preview = undefined;
      this.generation += 1;
      this.draw();
    });
    this.root.append(confirmation);
    const previewButton = this.button(
      this.root,
      "Preview combined note",
      () => {
        void this.runPreview();
      },
    );
    previewButton.disabled = !this.confirmed;
    if (this.preview !== undefined) {
      const exact = this.root.ownerDocument.createElement("section");
      exact.setAttribute("aria-label", "Exact combined-note dry-run");
      const path = this.root.ownerDocument.createElement("p");
      path.textContent = `Target path: ${this.preview.entry.targetPath}; action: ${this.preview.action}`;
      exact.append(path);
      const source = this.root.ownerDocument.createElement("p");
      source.textContent = `Sources: ${this.preview.sourcePaths.join(", ")}; existing note: ${this.preview.selectedPath}`;
      exact.append(source);
      const markdown = this.root.ownerDocument.createElement("pre");
      markdown.textContent = this.preview.entry.noteContent;
      exact.append(markdown);
      this.root.append(exact);
    }
    const create = this.button(this.root, "Create combined note", () => {
      void this.runCreate();
    });
    create.disabled = this.preview === undefined || !this.confirmed;
    if (this.diagnostic !== "") {
      const status = this.root.ownerDocument.createElement("p");
      status.setAttribute("role", "status");
      status.textContent = this.diagnostic;
      this.root.append(status);
    }
  }

  private async select(candidateId: string, path: string): Promise<void> {
    const candidate = this.snapshot.candidates.find(
      (item) =>
        item.id === candidateId &&
        (item.decision === "accepted" || item.decision === "edited"),
    );
    if (candidate === undefined) return;
    const generation = ++this.generation;
    this.selectedPath = path;
    this.candidateId = candidateId;
    this.draft = {
      title: candidate.title,
      summary: candidate.summary,
      body: candidate.body,
      tags: [...candidate.tags],
    };
    this.confirmed = false;
    this.preview = undefined;
    this.diagnostic = "";
    this.selectedText = "Loading existing note…";
    this.selectedDigest = undefined;
    this.draw();
    try {
      const bytes = await this.services.readKnowledgeNote(path);
      if (generation !== this.generation) return;
      const parsed = parseKnowledgeCatalogNote(path, bytes);
      if (parsed.status !== "eligible")
        throw new Error("Selected note invalid");
      this.selectedText = parsed.note.payload;
      this.selectedDigest = sha256(bytes);
    } catch {
      if (generation !== this.generation) return;
      this.selectedText = "Existing note unavailable; refresh selection.";
      this.selectedDigest = undefined;
      this.draft = undefined;
    }
    this.draw();
  }

  private async runPreview(): Promise<void> {
    if (
      !this.confirmed ||
      this.draft === undefined ||
      this.candidateId === undefined ||
      this.selectedPath === undefined ||
      this.selectedDigest === undefined
    )
      return;
    const generation = ++this.generation;
    this.preview = undefined;
    this.diagnostic = "";
    const result = await this.services.previewCombined(
      this.candidateId,
      this.selectedPath,
      this.draft,
      this.selectedDigest,
    );
    if (generation !== this.generation) return;
    if (
      (result.status === "stale" &&
        result.diagnostics.some(
          (item) => item.code === "M07_SELECTED_CHANGED",
        )) ||
      (result.status === "ready" &&
        result.selectedByteDigest !== this.selectedDigest)
    ) {
      const candidateId = this.candidateId;
      const selectedPath = this.selectedPath;
      await this.select(candidateId, selectedPath);
      this.diagnostic =
        "The selected note changed. Review the refreshed note and confirm again.";
    } else if (result.status === "ready") this.preview = result;
    else
      this.diagnostic = result.diagnostics
        .map((item) => item.message)
        .join(" ");
    this.draw();
  }

  private async runCreate(): Promise<void> {
    if (this.preview === undefined || !this.confirmed) return;
    this.preview = undefined;
    this.confirmed = false;
    this.draw();
    const result = await this.services.createCombined();
    const ledger = result.ledger[0];
    this.diagnostic =
      result.status === "saved" && ledger?.status === "created"
        ? `Combined note created: ${ledger.targetPath} (created).`
        : result.status === "saved" && ledger?.status === "identical-no-op"
          ? `Identical combined note already exists: ${ledger.targetPath} (identical-no-op).`
          : `Combined note not created${ledger === undefined ? "" : ` at ${ledger.targetPath} (${ledger.status})`}. ${result.diagnostics.map((item) => item.message).join(" ")}`;
    this.draw();
  }
}
