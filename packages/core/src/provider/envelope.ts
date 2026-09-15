import { parseStrictJson } from "../internal/strict-json.js";
import {
  M05_REQUEST_MAX_UTF8_BYTES,
  type ProviderRequestInput,
  type ProviderRequestResult,
  type ProviderResponseResult,
  type ProviderUsage,
} from "./contracts.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function providerFailure<
  Code extends "PROVIDER_REQUEST_TOO_LARGE" | "PROVIDER_ENVELOPE_INVALID",
>(code: Code): { ok: false; code: Code } {
  return { ok: false, code };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validUsage(value: unknown): ProviderUsage | undefined {
  if (!isObject(value)) return undefined;
  const fields = [
    ["prompt_tokens", "promptTokens"],
    ["completion_tokens", "completionTokens"],
    ["total_tokens", "totalTokens"],
  ] as const;
  const usage: Partial<ProviderUsage> = {};
  for (const [rawKey, outputKey] of fields) {
    if (!Object.hasOwn(value, rawKey)) continue;
    const count = value[rawKey];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
      return undefined;
    usage[outputKey] = count;
  }
  if (
    usage.promptTokens !== undefined &&
    usage.completionTokens !== undefined &&
    usage.totalTokens !== undefined &&
    usage.totalTokens !== usage.promptTokens + usage.completionTokens
  )
    return undefined;
  return usage;
}

export function buildProviderRequest(
  input: ProviderRequestInput,
): ProviderRequestResult {
  const body = JSON.stringify({
    model: input.model,
    messages: [{ role: "user", content: input.prompt }],
    response_format: { type: "json_object" },
    max_tokens: input.maxOutputTokens,
    stream: false,
  });
  const utf8Bytes = encoder.encode(body).length;
  return utf8Bytes > M05_REQUEST_MAX_UTF8_BYTES
    ? providerFailure("PROVIDER_REQUEST_TOO_LARGE")
    : { ok: true, body, utf8Bytes };
}

export function parseProviderResponse(
  bytes: Uint8Array,
): ProviderResponseResult {
  let decoded: string;
  let parsed: unknown;
  try {
    decoded = decoder.decode(bytes);
    if (decoded.startsWith("\ufeff")) throw new Error("bom");
    parsed = parseStrictJson(decoded, {
      maxContainerDepth: 32,
      rejectPrototypeNames: true,
      rejectLiteralUnpairedSurrogates: true,
    });
  } catch {
    return providerFailure("PROVIDER_ENVELOPE_INVALID");
  }
  if (!isObject(parsed) || !Object.hasOwn(parsed, "choices"))
    return providerFailure("PROVIDER_ENVELOPE_INVALID");
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length !== 1 || !isObject(choices[0]))
    return providerFailure("PROVIDER_ENVELOPE_INVALID");
  const choice = choices[0];
  if (!Object.hasOwn(choice, "message") || !isObject(choice.message))
    return providerFailure("PROVIDER_ENVELOPE_INVALID");
  const message = choice.message;
  if (!Object.hasOwn(message, "content") || typeof message.content !== "string")
    return providerFailure("PROVIDER_ENVELOPE_INVALID");
  const usage = Object.hasOwn(parsed, "usage")
    ? validUsage(parsed.usage)
    : undefined;
  return usage === undefined
    ? { ok: true, content: message.content }
    : { ok: true, content: message.content, usage };
}
