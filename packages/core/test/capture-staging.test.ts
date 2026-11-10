import { describe, expect, test } from "vitest";
import {
  CAPTURE_STAGING_MAX_BYTES,
  CAPTURE_TEXT_MAX_UTF8_BYTES,
  parseStagingCapture,
  validateCapture,
} from "../src/index.js";

const encoder = new TextEncoder();
const conversationUrl =
  "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111";

function stagingNote(
  input: {
    text?: string;
    title?: string;
    url?: string;
  } = {},
): string {
  const lines = [
    "---",
    "chat2vault_capture: 1",
    'capture_method: "obsidian-web-clipper"',
    'capture_scope: "visible-page-unverified"',
    'source_provider: "chatgpt"',
    `source_url: ${JSON.stringify(input.url ?? conversationUrl)}`,
  ];
  if (input.title !== undefined)
    lines.push(`capture_title: ${JSON.stringify(input.title)}`);
  lines.push("---", input.text ?? "Synthetic capture");
  return `${lines.join("\n")}\n`;
}

describe("M08 Web Clipper staging parser", () => {
  test("accepts the exact staging envelope, strips URL secrets, and delegates normalization", () => {
    const raw = stagingNote({
      text: "first\r\nsecond\rthird",
      title: "  Synthetic / title  ",
      url: `${conversationUrl}?secret=x#tail`,
    });

    expect(parseStagingCapture(encoder.encode(raw))).toEqual(
      validateCapture({
        method: "obsidian-web-clipper",
        text: "first\r\nsecond\rthird\n",
        title: "  Synthetic / title  ",
        sourceUrl: `${conversationUrl}?secret=x#tail`,
      }),
    );
    const result = parseStagingCapture(encoder.encode(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.sourceUrl).toBe(conversationUrl);
    expect(result.draft.title).toBe("Synthetic - title");
  });

  test("accepts an omitted optional title", () => {
    const result = parseStagingCapture(
      encoder.encode(stagingNote({ text: "No title" })),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.title).toBeUndefined();
  });

  test.each([
    [
      "duplicate identity field",
      stagingNote().replace(
        'source_provider: "chatgpt"',
        'source_provider: "chatgpt"\nsource_provider: "chatgpt"',
      ),
    ],
    [
      "unknown identity field",
      stagingNote().replace(
        'source_provider: "chatgpt"',
        'source_provider: "chatgpt"\nconversation_id: "invented"',
      ),
    ],
    [
      "YAML alias",
      stagingNote().replace(JSON.stringify(conversationUrl), "*url"),
    ],
    [
      "wrong marker",
      stagingNote().replace("chat2vault_capture: 1", "chat2vault_capture: 2"),
    ],
    [
      "wrong method",
      stagingNote().replace("obsidian-web-clipper", "manual-paste"),
    ],
    [
      "wrong scope",
      stagingNote().replace("visible-page-unverified", "complete"),
    ],
    ["wrong provider", stagingNote().replace('"chatgpt"', '"other"')],
    [
      "unquoted URL",
      stagingNote().replace(JSON.stringify(conversationUrl), conversationUrl),
    ],
    ["CRLF frontmatter", stagingNote().replace(/\n/gu, "\r\n")],
    ["leading BOM", `\ufeff${stagingNote()}`],
    [
      "missing close",
      stagingNote().replace("---\nSynthetic capture", "Synthetic capture"),
    ],
  ])("rejects %s with a content-free closed error", (_label, raw) => {
    expect(parseStagingCapture(encoder.encode(raw))).toEqual({
      ok: false,
      code: "INVALID_CAPTURE_INPUT",
    });
  });

  test("rejects malformed UTF-8 without decoding replacement text", () => {
    const prefix = encoder.encode(stagingNote({ text: "" }));
    const bytes = new Uint8Array(prefix.length + 1);
    bytes.set(prefix);
    bytes[bytes.length - 1] = 0xff;

    expect(parseStagingCapture(bytes)).toEqual({
      ok: false,
      code: "INVALID_CAPTURE_INPUT",
    });
  });

  test("accepts exactly the raw staging byte boundary and rejects one byte over", () => {
    const text = "x".repeat(CAPTURE_TEXT_MAX_UTF8_BYTES - 1);
    const withoutTitle = stagingNote({ text, title: "" });
    const titleBytes =
      CAPTURE_STAGING_MAX_BYTES - encoder.encode(withoutTitle).length;
    const exact = encoder.encode(
      stagingNote({ text, title: "t".repeat(titleBytes) }),
    );
    const over = encoder.encode(
      stagingNote({ text, title: "t".repeat(titleBytes + 1) }),
    );

    expect(exact.length).toBe(CAPTURE_STAGING_MAX_BYTES);
    expect(parseStagingCapture(exact).ok).toBe(true);
    expect(over.length).toBe(CAPTURE_STAGING_MAX_BYTES + 1);
    expect(parseStagingCapture(over)).toEqual({
      ok: false,
      code: "INVALID_CAPTURE_INPUT",
    });
  });
});
