import { sha256 } from "../fingerprint/stable-json.js";
import {
  isM03WellFormedString,
  safeSourceTitle,
} from "../source-writer/primitives.js";
import type {
  CaptureDraft,
  CaptureInput,
  CaptureMethod,
  CaptureValidation,
  CaptureValidationCode,
} from "./contracts.js";

export const CAPTURE_TEXT_MAX_UTF8_BYTES = 1_048_576;
export const CAPTURE_URL_MAX_UTF8_BYTES = 2_048;

const CAPTURE_SCOPE = "visible-page-unverified" as const;
const CAPTURE_IDENTITY_VERSION = "m08-capture-v1";
const CHATGPT_CONVERSATION_PATH =
  /^\/c\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const encoder = new TextEncoder();
interface CaptureFailure {
  ok: false;
  code: CaptureValidationCode;
}

function isCaptureMethod(value: unknown): value is CaptureMethod {
  return value === "obsidian-web-clipper" || value === "manual-paste";
}

function normalizeText(
  text: unknown,
): { ok: true; text: string } | CaptureFailure {
  if (!isM03WellFormedString(text) || text.includes("\0")) {
    return { ok: false, code: "INVALID_CAPTURE_TEXT" };
  }

  const normalized = text.replace(/^\ufeff/u, "").replace(/\r\n?/gu, "\n");
  const byteLength = encoder.encode(normalized).length;
  if (byteLength === 0) return { ok: false, code: "EMPTY_CAPTURE_TEXT" };
  if (byteLength > CAPTURE_TEXT_MAX_UTF8_BYTES) {
    return { ok: false, code: "CAPTURE_TEXT_TOO_LARGE" };
  }
  return { ok: true, text: normalized };
}

function normalizeUrl(
  sourceUrl: unknown,
): { ok: true; sourceUrl: string } | CaptureFailure {
  if (
    !isM03WellFormedString(sourceUrl) ||
    sourceUrl.includes("\0") ||
    encoder.encode(sourceUrl).length > CAPTURE_URL_MAX_UTF8_BYTES
  ) {
    return { ok: false, code: "INVALID_CAPTURE_URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { ok: false, code: "INVALID_CAPTURE_URL" };
  }
  const authorityStart = sourceUrl.indexOf("://") + 3;
  const rawRemainder = sourceUrl.slice(authorityStart);
  const authorityEndOffset = rawRemainder.search(/[/?#]/u);
  const authorityEnd =
    authorityEndOffset === -1
      ? sourceUrl.length
      : authorityStart + authorityEndOffset;
  const rawAuthority = sourceUrl.slice(authorityStart, authorityEnd);
  const rawPathEndCandidates = [
    sourceUrl.indexOf("?", authorityEnd),
    sourceUrl.indexOf("#", authorityEnd),
  ].filter((index) => index !== -1);
  const rawPathEnd =
    rawPathEndCandidates.length === 0
      ? sourceUrl.length
      : Math.min(...rawPathEndCandidates);
  const rawPath = sourceUrl.slice(authorityEnd, rawPathEnd);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "chatgpt.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    rawAuthority.includes("@") ||
    rawPath !== parsed.pathname ||
    !CHATGPT_CONVERSATION_PATH.test(parsed.pathname)
  ) {
    return { ok: false, code: "INVALID_CAPTURE_URL" };
  }

  return { ok: true, sourceUrl: `https://chatgpt.com${parsed.pathname}` };
}

function frameIdentity(fields: readonly string[]): Uint8Array {
  const frames = fields.flatMap((field) => {
    const bytes = encoder.encode(field);
    return [encoder.encode(`${String(bytes.length)}:`), bytes];
  });
  const length = frames.reduce((total, frame) => total + frame.length, 0);
  const framed = new Uint8Array(length);
  let offset = 0;
  for (const frame of frames) {
    framed.set(frame, offset);
    offset += frame.length;
  }
  return framed;
}

export function validateCapture(input: CaptureInput): CaptureValidation {
  const candidate: unknown = input;
  if (candidate === null || typeof candidate !== "object") {
    return { ok: false, code: "INVALID_CAPTURE_INPUT" };
  }
  const capture = candidate as CaptureInput;
  if (!isCaptureMethod(capture.method)) {
    return { ok: false, code: "INVALID_CAPTURE_METHOD" };
  }

  const normalizedText = normalizeText(capture.text);
  if (!normalizedText.ok) return normalizedText;

  if (capture.sourceUrl === undefined) {
    if (capture.method === "obsidian-web-clipper") {
      return { ok: false, code: "CAPTURE_URL_REQUIRED" };
    }
  }

  const normalizedUrl =
    capture.sourceUrl === undefined
      ? undefined
      : normalizeUrl(capture.sourceUrl);
  if (normalizedUrl !== undefined && !normalizedUrl.ok) return normalizedUrl;
  if (
    capture.title !== undefined &&
    (!isM03WellFormedString(capture.title) || capture.title.includes("\0"))
  ) {
    return { ok: false, code: "INVALID_CAPTURE_TITLE" };
  }

  const sourceUrl = normalizedUrl?.sourceUrl;
  const fingerprint = sha256(
    frameIdentity([
      CAPTURE_IDENTITY_VERSION,
      capture.method,
      sourceUrl === undefined ? "absent" : "url",
      sourceUrl ?? "",
      normalizedText.text,
    ]),
  ) as `sha256:${string}`;
  const draft: CaptureDraft = {
    method: capture.method,
    scope: CAPTURE_SCOPE,
    text: normalizedText.text,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(capture.title === undefined
      ? {}
      : { title: safeSourceTitle(capture.title) }),
    fingerprint,
  };
  return { ok: true, draft };
}
