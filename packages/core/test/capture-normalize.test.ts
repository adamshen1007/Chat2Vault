import { describe, expect, test } from "vitest";
import {
  CAPTURE_TEXT_MAX_UTF8_BYTES,
  CAPTURE_URL_MAX_UTF8_BYTES,
  validateCapture,
} from "../src/index.js";

const conversationUrl =
  "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111";

describe("M08 capture normalization and identity", () => {
  test("normalizes an allowed ChatGPT conversation URL without secrets", () => {
    const result = validateCapture({
      method: "obsidian-web-clipper",
      text: "Synthetic capture",
      sourceUrl: `${conversationUrl}?secret=x#tail`,
    });

    expect(result).toEqual({
      ok: true,
      draft: {
        method: "obsidian-web-clipper",
        scope: "visible-page-unverified",
        text: "Synthetic capture",
        sourceUrl: conversationUrl,
        fingerprint:
          "sha256:8de698164fdad5bea082e619356894780299ef04b1ff5c7a21009164092fbdfb",
      },
    });
  });

  test.each(["6", "7", "8"])(
    "accepts a canonical version-%s ChatGPT conversation URL",
    (version) => {
      const sourceUrl = `https://chatgpt.com/c/11111111-1111-${version}111-8111-111111111111`;
      const result = validateCapture({
        method: "obsidian-web-clipper",
        text: "Synthetic capture",
        sourceUrl: `${sourceUrl}?discard=1#tail`,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.draft.sourceUrl).toBe(sourceUrl);
    },
  );

  test("allows manual paste without a provider URL", () => {
    const result = validateCapture({ method: "manual-paste", text: "Text" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.sourceUrl).toBeUndefined();
    expect(result.draft.scope).toBe("visible-page-unverified");
  });

  test.each([
    "http://chatgpt.com/c/11111111-1111-4111-8111-111111111111",
    "https://example.com/c/11111111-1111-4111-8111-111111111111",
    "https://chatgpt.com:444/c/11111111-1111-4111-8111-111111111111",
    "https://user@chatgpt.com/c/11111111-1111-4111-8111-111111111111",
    "https://chatgpt.com/share/11111111-1111-4111-8111-111111111111",
    "https://chatgpt.com/c/not-a-uuid",
    "https://chatgpt.com/c/11111111-1111-0111-8111-111111111111",
    "https://chatgpt.com/c/11111111-1111-9111-8111-111111111111",
  ])("rejects unsupported URL %s with a content-free code", (sourceUrl) => {
    expect(
      validateCapture({
        method: "manual-paste",
        text: "Synthetic capture",
        sourceUrl,
      }),
    ).toEqual({ ok: false, code: "INVALID_CAPTURE_URL" });
  });

  test("normalizes one leading BOM and all CR line endings", () => {
    const result = validateCapture({
      method: "manual-paste",
      text: "\ufefffirst\r\nsecond\rthird",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.text).toBe("first\nsecond\nthird");
  });

  test.each([
    ["lone surrogate", "bad\ud800text", "INVALID_CAPTURE_TEXT"],
    ["NUL", "bad\0text", "INVALID_CAPTURE_TEXT"],
    ["empty", "", "EMPTY_CAPTURE_TEXT"],
    ["BOM only", "\ufeff", "EMPTY_CAPTURE_TEXT"],
    [
      "over the UTF-8 byte limit",
      "a".repeat(CAPTURE_TEXT_MAX_UTF8_BYTES + 1),
      "CAPTURE_TEXT_TOO_LARGE",
    ],
  ])("rejects %s text", (_label, text, code) => {
    expect(validateCapture({ method: "manual-paste", text })).toEqual({
      ok: false,
      code,
    });
  });

  test("accepts exactly the UTF-8 text byte limit", () => {
    const result = validateCapture({
      method: "manual-paste",
      text: "a".repeat(CAPTURE_TEXT_MAX_UTF8_BYTES),
    });

    expect(result.ok).toBe(true);
  });

  test("measures multibyte text at the exact and over-limit UTF-8 boundaries", () => {
    const exact = "😀".repeat(CAPTURE_TEXT_MAX_UTF8_BYTES / 4);

    expect(validateCapture({ method: "manual-paste", text: exact }).ok).toBe(
      true,
    );
    expect(
      validateCapture({ method: "manual-paste", text: `${exact}a` }),
    ).toEqual({ ok: false, code: "CAPTURE_TEXT_TOO_LARGE" });
  });

  test("measures raw URL input at the exact and over-limit UTF-8 boundaries", () => {
    const exact = `${conversationUrl}?${"a".repeat(
      CAPTURE_URL_MAX_UTF8_BYTES - conversationUrl.length - 1,
    )}`;

    const exactResult = validateCapture({
      method: "manual-paste",
      text: "Synthetic capture",
      sourceUrl: exact,
    });
    expect(new TextEncoder().encode(exact).length).toBe(
      CAPTURE_URL_MAX_UTF8_BYTES,
    );
    expect(exactResult.ok).toBe(true);
    if (!exactResult.ok) return;
    expect(exactResult.draft.sourceUrl).toBe(conversationUrl);
    expect(
      validateCapture({
        method: "manual-paste",
        text: "Synthetic capture",
        sourceUrl: `${exact}a`,
      }),
    ).toEqual({ ok: false, code: "INVALID_CAPTURE_URL" });
  });

  test("includes the capture method in identity", () => {
    const clipper = validateCapture({
      method: "obsidian-web-clipper",
      text: "Same text",
      sourceUrl: conversationUrl,
    });
    const paste = validateCapture({
      method: "manual-paste",
      text: "Same text",
      sourceUrl: conversationUrl,
    });

    expect(clipper.ok).toBe(true);
    expect(paste.ok).toBe(true);
    if (!clipper.ok || !paste.ok) return;
    expect(clipper.draft.fingerprint).not.toBe(paste.draft.fingerprint);
  });

  test("returns the same fingerprint for repeated exact input", () => {
    const input = {
      method: "manual-paste" as const,
      text: "Repeatable text",
      sourceUrl: conversationUrl,
      title: "Synthetic title",
    };

    const first = validateCapture(input);
    const second = validateCapture(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.draft.fingerprint).toBe(second.draft.fingerprint);
  });

  test("excludes title, query, and fragment changes from identity", () => {
    const base = validateCapture({
      method: "manual-paste",
      text: "Stable text",
      sourceUrl: conversationUrl,
      title: "First title",
    });
    const titleChanged = validateCapture({
      method: "manual-paste",
      text: "Stable text",
      title: "Second title",
      sourceUrl: conversationUrl,
    });
    const queryChanged = validateCapture({
      method: "manual-paste",
      text: "Stable text",
      sourceUrl: `${conversationUrl}?different=query`,
      title: "First title",
    });
    const fragmentChanged = validateCapture({
      method: "manual-paste",
      text: "Stable text",
      sourceUrl: `${conversationUrl}#different-fragment`,
      title: "First title",
    });

    expect(base.ok).toBe(true);
    expect(titleChanged.ok).toBe(true);
    expect(queryChanged.ok).toBe(true);
    expect(fragmentChanged.ok).toBe(true);
    if (!base.ok || !titleChanged.ok || !queryChanged.ok || !fragmentChanged.ok)
      return;
    expect(
      new Set([
        base.draft.fingerprint,
        titleChanged.draft.fingerprint,
        queryChanged.draft.fingerprint,
        fragmentChanged.draft.fingerprint,
      ]).size,
    ).toBe(1);
  });

  test.each([
    `https://@chatgpt.com/c/11111111-1111-4111-8111-111111111111`,
    `https://:@chatgpt.com/c/11111111-1111-4111-8111-111111111111`,
  ])("rejects raw empty userinfo marker in %s", (sourceUrl) => {
    expect(
      validateCapture({
        method: "manual-paste",
        text: "Synthetic capture",
        sourceUrl,
      }),
    ).toEqual({ ok: false, code: "INVALID_CAPTURE_URL" });
  });

  test.each([
    `https://chatgpt.com/x/../c/11111111-1111-4111-8111-111111111111`,
    `https://chatgpt.com/c/../c/11111111-1111-4111-8111-111111111111`,
  ])("rejects raw dot-segment path normalization in %s", (sourceUrl) => {
    expect(
      validateCapture({
        method: "manual-paste",
        text: "Synthetic capture",
        sourceUrl,
      }),
    ).toEqual({ ok: false, code: "INVALID_CAPTURE_URL" });
  });

  test("requires a URL for Web Clipper capture", () => {
    expect(
      validateCapture({
        method: "obsidian-web-clipper",
        text: "Synthetic capture",
      }),
    ).toEqual({ ok: false, code: "CAPTURE_URL_REQUIRED" });
  });

  test("rejects malformed display titles with a content-free code", () => {
    expect(
      validateCapture({
        method: "manual-paste",
        text: "Synthetic capture",
        title: "bad\ud800title",
      }),
    ).toEqual({ ok: false, code: "INVALID_CAPTURE_TITLE" });
  });
});
