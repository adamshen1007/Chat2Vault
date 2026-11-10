export type CaptureMethod = "obsidian-web-clipper" | "manual-paste";

export interface CaptureInput {
  method: CaptureMethod;
  text: string;
  sourceUrl?: string;
  title?: string;
}

export interface CaptureDraft {
  method: CaptureMethod;
  scope: "visible-page-unverified";
  text: string;
  sourceUrl?: string;
  title?: string;
  fingerprint: `sha256:${string}`;
}

export type CaptureValidationCode =
  | "INVALID_CAPTURE_INPUT"
  | "INVALID_CAPTURE_METHOD"
  | "INVALID_CAPTURE_TEXT"
  | "EMPTY_CAPTURE_TEXT"
  | "CAPTURE_TEXT_TOO_LARGE"
  | "CAPTURE_URL_REQUIRED"
  | "INVALID_CAPTURE_URL"
  | "INVALID_CAPTURE_TITLE";

export type CaptureValidation =
  | { ok: true; draft: CaptureDraft }
  | { ok: false; code: CaptureValidationCode };
