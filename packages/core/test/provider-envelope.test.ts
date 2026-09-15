import { describe, expect, it } from "vitest";

import {
  M05_REQUEST_MAX_UTF8_BYTES,
  buildProviderRequest,
  parseProviderResponse,
} from "../src/index.js";

const encoder = new TextEncoder();

function response(value: string): Uint8Array {
  return encoder.encode(value);
}

function envelope(content = "exact content", extra = ""): string {
  return `{"choices":[{"message":{"content":${JSON.stringify(content)}${extra}}}]}`;
}

function nested(kind: "object" | "array" | "mixed", depth: number): string {
  let value = "null";
  for (let index = 0; index < depth - 1; index += 1) {
    const object = kind === "object" || (kind === "mixed" && index % 2 === 0);
    value = object ? `{"x":${value}}` : `[${value}]`;
  }
  return `{"choices":[{"message":{"content":"exact"}}],"extra":${value}}`;
}

describe("M05 provider envelope", () => {
  it("serializes the exact golden OpenAI-compatible body", () => {
    expect(
      buildProviderRequest({
        model: "gpt-5",
        prompt: "exact prompt\n",
        maxOutputTokens: 4096,
      }),
    ).toEqual({
      ok: true,
      body: '{"model":"gpt-5","messages":[{"role":"user","content":"exact prompt\\n"}],"response_format":{"type":"json_object"},"max_tokens":4096,"stream":false}',
      utf8Bytes: 147,
    });
  });

  it("rejects request bodies over the inclusive UTF-8 limit", () => {
    expect(
      buildProviderRequest({
        model: "m",
        prompt: "x".repeat(M05_REQUEST_MAX_UTF8_BYTES),
        maxOutputTokens: 1,
      }),
    ).toEqual({ ok: false, code: "PROVIDER_REQUEST_TOO_LARGE" });
  });

  it("forwards exactly one validated content string and valid usage", () => {
    const content = '{"candidates":[]}';
    expect(
      parseProviderResponse(
        response(
          `{"choices":[{"message":{"content":${JSON.stringify(content)},"content_parts":[{"type":"text","text":"ignored"}],"refusal":{"unexpected":true},"tool_calls":[null],"function_call":false},"finish_reason":null,"finish_metadata":{"ignored":true}}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3,"extra":null},"provider_extra":[{"any":"value"}]}`,
        ),
      ),
    ).toEqual({
      ok: true,
      content,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
  });

  it.each([
    [
      "escaped duplicate decoded name",
      '{"choices":[{"message":{"content":"exact","\\u0063ontent":"duplicate"}}]}',
    ],
    [
      "nested __proto__",
      '{"choices":[{"message":{"content":"exact","extra":{"__proto__":null}}}]}',
    ],
    [
      "nested prototype",
      '{"choices":[{"message":{"content":"exact","extra":{"prototype":null}}}]}',
    ],
    [
      "nested constructor",
      '{"choices":[{"message":{"content":"exact","extra":{"constructor":null}}}]}',
    ],
  ])("rejects nested ignored-extra security case: %s", (_name, raw) => {
    expect(parseProviderResponse(response(raw))).toEqual({
      ok: false,
      code: "PROVIDER_ENVELOPE_INVALID",
    });
  });

  it.each([
    ["duplicate decoded keys", '{"choices":[],"\\u0063hoices":[]}'],
    ["prototype key", '{"__proto__":null,"choices":[]}'],
    ["prototype member", '{"prototype":null,"choices":[]}'],
    ["constructor key", '{"constructor":null,"choices":[]}'],
    ["BOM", `\ufeff${envelope()}`],
    ["trailing content", `${envelope()} {}`],
    ["comment", '{"choices":/* no */[]}'],
    [
      "escaped lone surrogate",
      '{"choices":[{"message":{"content":"\\ud800"}}]}',
    ],
    ["non-finite number", '{"choices":[],"extra":1e999}'],
  ])("rejects %s globally", (_name, raw) => {
    expect(parseProviderResponse(response(raw))).toEqual({
      ok: false,
      code: "PROVIDER_ENVELOPE_INVALID",
    });
  });

  it("uses fatal UTF-8 decoding", () => {
    expect(parseProviderResponse(new Uint8Array([0xc3, 0x28]))).toEqual({
      ok: false,
      code: "PROVIDER_ENVELOPE_INVALID",
    });
  });

  it.each([31, 32])("accepts pure-object depth %i", (depth) => {
    expect(parseProviderResponse(response(nested("object", depth)))).toEqual({
      ok: true,
      content: "exact",
    });
  });

  it.each([31, 32])("accepts pure-array-below-root depth %i", (depth) => {
    expect(parseProviderResponse(response(nested("array", depth)))).toEqual({
      ok: true,
      content: "exact",
    });
  });

  it.each([31, 32])("accepts mixed depth %i", (depth) => {
    expect(parseProviderResponse(response(nested("mixed", depth)))).toEqual({
      ok: true,
      content: "exact",
    });
  });

  it.each(["object", "array", "mixed"] as const)(
    "rejects %s depth 33 before projection",
    (kind) => {
      expect(parseProviderResponse(response(nested(kind, 33)))).toEqual({
        ok: false,
        code: "PROVIDER_ENVELOPE_INVALID",
      });
    },
  );

  it.each([
    ["no choices", '{"choices":[]}'],
    [
      "multiple choices",
      '{"choices":[{"message":{"content":"one"}},{"message":{"content":"two"}}]}',
    ],
    ["null content", '{"choices":[{"message":{"content":null}}]}'],
    ["array content", '{"choices":[{"message":{"content":["part"]}}]}'],
    ["missing content", '{"choices":[{"message":{}}]}'],
  ])("rejects malformed projection: %s", (_name, raw) => {
    expect(parseProviderResponse(response(raw))).toEqual({
      ok: false,
      code: "PROVIDER_ENVELOPE_INVALID",
    });
  });

  it.each([
    ['{"prompt_tokens":1.5}'],
    ['{"prompt_tokens":-1}'],
    ['{"prompt_tokens":9007199254740992}'],
    ['{"prompt_tokens":1,"completion_tokens":2,"total_tokens":4}'],
    ["null"],
  ])("omits malformed usage while retaining content", (usage) => {
    expect(
      parseProviderResponse(
        response(
          `{"choices":[{"message":{"content":"exact"}}],"usage":${usage}}`,
        ),
      ),
    ).toEqual({ ok: true, content: "exact" });
  });

  it("retains a valid partial usage projection", () => {
    expect(
      parseProviderResponse(
        response(
          '{"choices":[{"message":{"content":"exact"}}],"usage":{"prompt_tokens":1}}',
        ),
      ),
    ).toEqual({ ok: true, content: "exact", usage: { promptTokens: 1 } });
  });
});
