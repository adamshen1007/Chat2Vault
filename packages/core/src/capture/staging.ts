import { isM03WellFormedString } from "../source-writer/primitives.js";
import type { CaptureValidation } from "./contracts.js";
import { validateCapture } from "./normalize.js";

export const CAPTURE_STAGING_MAX_BYTES = 1_064_960;

const REQUIRED = [
  "chat2vault_capture",
  "capture_method",
  "capture_scope",
  "source_provider",
  "source_url",
] as const;
const ALLOWED = new Set([...REQUIRED, "capture_title"]);
const KEY = /^[a-z0-9_]+$/u;

function invalid(): CaptureValidation {
  return { ok: false, code: "INVALID_CAPTURE_INPUT" };
}

function jsonString(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('"') || !value.endsWith('"'))
    return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isM03WellFormedString(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseStagingCapture(bytes: Uint8Array): CaptureValidation {
  if (bytes.length === 0 || bytes.length > CAPTURE_STAGING_MAX_BYTES)
    return invalid();

  let note: string;
  try {
    note = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return invalid();
  }
  if (!note.startsWith("---\n")) return invalid();
  const close = note.indexOf("\n---\n", 4);
  if (close === -1) return invalid();

  const fields = new Map<string, string>();
  for (const line of note.slice(4, close).split("\n")) {
    const delimiter = line.indexOf(": ");
    if (delimiter <= 0) return invalid();
    const key = line.slice(0, delimiter);
    const value = line.slice(delimiter + 2);
    if (!KEY.test(key) || !ALLOWED.has(key) || fields.has(key))
      return invalid();
    fields.set(key, value);
  }
  if (REQUIRED.some((key) => !fields.has(key))) return invalid();
  if (
    fields.get("chat2vault_capture") !== "1" ||
    fields.get("capture_method") !== '"obsidian-web-clipper"' ||
    fields.get("capture_scope") !== '"visible-page-unverified"' ||
    fields.get("source_provider") !== '"chatgpt"'
  )
    return invalid();

  const sourceUrl = jsonString(fields.get("source_url"));
  const title = fields.has("capture_title")
    ? jsonString(fields.get("capture_title"))
    : undefined;
  if (
    sourceUrl === undefined ||
    (fields.has("capture_title") && title === undefined)
  )
    return invalid();

  return validateCapture({
    method: "obsidian-web-clipper",
    text: note.slice(close + 5),
    sourceUrl,
    ...(title === undefined ? {} : { title }),
  });
}
