import {
  M05_ENDPOINT_MAX_UTF8_BYTES,
  M05_MODEL_MAX_UTF16,
  M05_MODEL_MAX_UTF8_BYTES,
  M05_OUTPUT_TOKEN_MAX,
  M05_SECRET_MAX_ASCII,
  M05_TIMEOUTS,
  type M05ProviderTimeout,
} from "./contracts.js";
import { isM03WellFormedString } from "../source-writer/primitives.js";

interface InvalidResult {
  ok: false;
}
type EndpointResult =
  | { ok: true; endpoint: string; hostname: string; port: number }
  | InvalidResult;
type ModelResult = { ok: true; model: string } | InvalidResult;
type SecretResult = { ok: true; secret: string } | InvalidResult;
type TimeoutResult =
  { ok: true; timeoutMs: M05ProviderTimeout } | InvalidResult;
type OutputCapResult = { ok: true; maxOutputTokens: number } | InvalidResult;

const encoder = new TextEncoder();
const DNS_LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const DISALLOWED_MODEL_SCALAR = /[\p{Cc}\p{Cf}\p{Z}\p{Co}]/u;

function invalidConfig(): InvalidResult {
  return { ok: false };
}

function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

function isNoncharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint & 0xffff) === 0xfffe ||
    (codePoint & 0xffff) === 0xffff
  );
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return false;
    }
  }
  return true;
}

function validHostname(hostname: string): boolean {
  return (
    hostname.length > 0 &&
    hostname.length <= 253 &&
    isAscii(hostname) &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(hostname) &&
    hostname.split(".").every((label) => DNS_LABEL.test(label))
  );
}

export function validateProviderEndpoint(value: unknown): EndpointResult {
  if (
    typeof value !== "string" ||
    !isM03WellFormedString(value) ||
    !isAscii(value) ||
    !value.startsWith("https://")
  ) {
    return invalidConfig();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidConfig();
  }
  const hostname = parsed.hostname;
  const port = parsed.port === "" ? 443 : Number(parsed.port);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/v1/chat/completions" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !validHostname(hostname) ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return invalidConfig();
  }
  const endpoint = `https://${hostname}${parsed.port === "" ? "" : `:${String(port)}`}/v1/chat/completions`;
  const authority = value.slice("https://".length, -parsed.pathname.length);
  const colonIndex = authority.lastIndexOf(":");
  const inputHostname =
    colonIndex === -1 ? authority : authority.slice(0, colonIndex);
  const inputPort = colonIndex === -1 ? "" : authority.slice(colonIndex);
  const normalizedInput = `https://${inputHostname.toLowerCase()}${inputPort}${parsed.pathname}`;
  const explicitDefaultPort = `https://${hostname}:443/v1/chat/completions`;
  if (
    inputHostname.toLowerCase() !== hostname ||
    (normalizedInput !== endpoint && normalizedInput !== explicitDefaultPort) ||
    utf8Length(endpoint) > M05_ENDPOINT_MAX_UTF8_BYTES
  ) {
    return invalidConfig();
  }
  return { ok: true, endpoint, hostname, port };
}

export function validateProviderModel(value: unknown): ModelResult {
  if (
    typeof value !== "string" ||
    !isM03WellFormedString(value) ||
    value.length < 1 ||
    value.length > M05_MODEL_MAX_UTF16 ||
    utf8Length(value) > M05_MODEL_MAX_UTF8_BYTES ||
    value !== value.normalize("NFC") ||
    /^\s|\s$/u.test(value)
  ) {
    return invalidConfig();
  }
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0);
    if (
      DISALLOWED_MODEL_SCALAR.test(scalar) ||
      codePoint === undefined ||
      isNoncharacter(codePoint)
    ) {
      return invalidConfig();
    }
  }
  return { ok: true, model: value };
}

export function validateProviderSecret(value: unknown): SecretResult {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= M05_SECRET_MAX_ASCII &&
    /^[\x21-\x7e]+$/u.test(value)
    ? { ok: true, secret: value }
    : invalidConfig();
}

export function validateProviderTimeout(value: unknown): TimeoutResult {
  return M05_TIMEOUTS.some((item) => item === value)
    ? { ok: true, timeoutMs: value as M05ProviderTimeout }
    : invalidConfig();
}

export function validateProviderOutputCap(value: unknown): OutputCapResult {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= M05_OUTPUT_TOKEN_MAX
    ? { ok: true, maxOutputTokens: value }
    : invalidConfig();
}
