import {
  promises as dns,
  type LookupAddress,
  type LookupOptions,
} from "node:dns";
import { request as nodeHttpsRequest } from "node:https";
import {
  checkServerIdentity as nodeCheckServerIdentity,
  type PeerCertificate,
} from "node:tls";
import {
  classifyPublicAddress,
  M05_REQUEST_MAX_UTF8_BYTES,
  M05_RESPONSE_MAX_UTF8_BYTES,
  type M05DiagnosticCode,
  type M05ProviderConfig,
  type AddressResult,
} from "@chat2vault/core";

export interface ProviderTransportInput {
  config: M05ProviderConfig;
  secret: string | undefined;
  body: string;
  signal: AbortSignal;
  lifecycleFence: (stage: ProviderTransportStage) => boolean;
}

export type ProviderTransportStage =
  "dns" | "pre-connect" | "headers" | "chunk";

interface ResolverAnswer {
  address: string;
  ttl: number;
}

export type ProviderTransportResolver = (
  hostname: string,
  options: { ttl: true },
) => Promise<unknown>;

export type ProviderTransportAddressClassifier = (
  address: string,
) => AddressResult;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

interface TransportSocket {
  remoteAddress?: string;
  remoteFamily?: string;
  once(
    event: "error" | "secureConnect",
    listener: (error?: Error) => void,
  ): this;
  destroy(): unknown;
}

interface TransportResponse {
  statusCode?: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders?: string[] | undefined;
  on(event: "data", listener: (chunk: Uint8Array) => void): this;
  once(event: "end" | "error", listener: (error?: Error) => void): this;
  resume(): unknown;
  destroy(): unknown;
}

interface TransportRequest {
  reusedSocket?: boolean;
  once(
    event: "error" | "socket",
    listener: (value: Error | TransportSocket) => void,
  ): this;
  end(body: string): unknown;
  destroy(): unknown;
}

export interface ProviderTransportRequestOptions {
  method: "POST";
  hostname: string;
  port: number;
  family: 4;
  path: "/v1/chat/completions";
  agent: false;
  setHost: false;
  servername: string;
  minVersion: "TLSv1.2";
  rejectUnauthorized: true;
  headers: Record<string, string>;
  lookup: (
    hostname: string,
    options: LookupOptions,
    callback: LookupCallback,
  ) => void;
  checkServerIdentity: (
    hostname: string,
    certificate: PeerCertificate,
  ) => Error | undefined;
}

export type ProviderTransportRequest = (
  options: ProviderTransportRequestOptions,
  onResponse: (response: TransportResponse) => void,
) => TransportRequest;

export interface ProviderTransportDependencies {
  resolve4: ProviderTransportResolver;
  request: ProviderTransportRequest;
  classifyAddress: ProviderTransportAddressClassifier;
}

type TransportFailureCode = Extract<
  M05DiagnosticCode,
  | "PROVIDER_AUTH_REJECTED"
  | "PROVIDER_CANCELLED"
  | "PROVIDER_DNS_FAILED"
  | "PROVIDER_DNS_UNSAFE"
  | "PROVIDER_ENVELOPE_INVALID"
  | "PROVIDER_NETWORK_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_REDIRECT_REJECTED"
  | "PROVIDER_REQUEST_REJECTED"
  | "PROVIDER_REQUEST_TOO_LARGE"
  | "PROVIDER_RESPONSE_METADATA_INVALID"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_SERVICE_FAILED"
  | "PROVIDER_STATUS_INVALID"
  | "PROVIDER_STALE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_TLS_FAILED"
>;

export type ProviderStatusCategory =
  "auth" | "invalid" | "rate-limit" | "redirect" | "request" | "service";

export type ProviderTransportResult =
  | {
      ok: true;
      status: 200;
      body: Uint8Array;
      requestId?: string;
    }
  | {
      ok: false;
      code: TransportFailureCode;
      statusCategory?: ProviderStatusCategory;
      retryAfterSeconds?: number;
      requestId?: string;
    };

const defaultDependencies: ProviderTransportDependencies = {
  resolve4: (hostname, options) => dns.resolve4(hostname, options),
  request: (options, onResponse) => nodeHttpsRequest(options, onResponse),
  classifyAddress: classifyPublicAddress,
};

function failure(code: TransportFailureCode): ProviderTransportResult {
  return { ok: false, code };
}

function canonicalHostname(hostname: string): boolean {
  return (
    hostname.length > 0 &&
    hostname.length <= 253 &&
    !/^\d+\.\d+\.\d+\.\d+$/u.test(hostname) &&
    hostname
      .split(".")
      .every((label) =>
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/u.test(label),
      )
  );
}

function expectedEndpoint(config: M05ProviderConfig): string {
  const port = config.port === 443 ? "" : `:${String(config.port)}`;
  return `https://${config.hostname}${port}/v1/chat/completions`;
}

async function resolvePinned(
  hostname: string,
  resolve4: ProviderTransportResolver,
  classifyAddress: ProviderTransportAddressClassifier,
): Promise<
  | { ok: true; address: string; family: 4 }
  | { ok: false; code: "PROVIDER_DNS_FAILED" | "PROVIDER_DNS_UNSAFE" }
> {
  let rawAnswers: unknown;
  try {
    rawAnswers = await resolve4(hostname, { ttl: true });
  } catch {
    return { ok: false, code: "PROVIDER_DNS_FAILED" };
  }
  const answers = snapshotResolverAnswers(rawAnswers);
  if (answers === undefined) return { ok: false, code: "PROVIDER_DNS_UNSAFE" };
  const checked = answers.map((answer) => ({
    answer,
    address: classifyAddressSafely(answer.address, classifyAddress),
  }));
  if (
    checked.some(
      ({ answer, address }) =>
        !address.ok || !Number.isSafeInteger(answer.ttl) || answer.ttl <= 0,
    ) ||
    new Set(checked.map(({ answer }) => answer.address)).size !== checked.length
  ) {
    return { ok: false, code: "PROVIDER_DNS_UNSAFE" };
  }
  const first = answers[0];
  return first === undefined
    ? { ok: false, code: "PROVIDER_DNS_UNSAFE" }
    : { ok: true, address: first.address, family: 4 };
}

function classifyAddressSafely(
  address: string,
  classifyAddress: ProviderTransportAddressClassifier,
): AddressResult {
  try {
    const result: unknown = classifyAddress(address);
    if (result === null || typeof result !== "object") return { ok: false };
    const prototype = Reflect.getPrototypeOf(result);
    if (prototype !== Object.prototype && prototype !== null)
      return { ok: false };
    if (Reflect.ownKeys(result).some((key) => typeof key === "symbol"))
      return { ok: false };
    const descriptors = Object.getOwnPropertyDescriptors(result);
    const ok = descriptors.ok;
    if (ok === undefined || !("value" in ok) || typeof ok.value !== "boolean")
      return { ok: false };
    if (!ok.value) return { ok: false };
    const family = descriptors.family;
    const classifiedAddress = descriptors.address;
    if (
      Object.keys(descriptors).length !== 3 ||
      family === undefined ||
      classifiedAddress === undefined ||
      !("value" in family) ||
      !("value" in classifiedAddress) ||
      family.value !== 4 ||
      classifiedAddress.value !== address
    )
      return { ok: false };
    return { ok: true, family: 4, address };
  } catch {
    return { ok: false };
  }
}

function snapshotResolverAnswers(value: unknown): ResolverAnswer[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = value.length;
    if (length < 1 || length > 16) return undefined;
    const entries: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      entries.push(value[index]);
    }
    if (
      value.length !== length ||
      entries.some((entry, index) => value[index] !== entry)
    )
      return undefined;

    const snapshot: ResolverAnswer[] = [];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) return undefined;
      const prototype: unknown = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null)
        return undefined;
      const address = Object.getOwnPropertyDescriptor(entry, "address");
      const ttl = Object.getOwnPropertyDescriptor(entry, "ttl");
      if (
        address === undefined ||
        ttl === undefined ||
        !("value" in address) ||
        !("value" in ttl) ||
        typeof address.value !== "string" ||
        typeof ttl.value !== "number"
      )
        return undefined;
      const secondAddress = Object.getOwnPropertyDescriptor(entry, "address");
      const secondTtl = Object.getOwnPropertyDescriptor(entry, "ttl");
      if (
        secondAddress === undefined ||
        secondTtl === undefined ||
        !("value" in secondAddress) ||
        !("value" in secondTtl) ||
        secondAddress.value !== address.value ||
        secondTtl.value !== ttl.value
      )
        return undefined;
      snapshot.push({ address: address.value, ttl: ttl.value });
    }
    if (
      value.length !== length ||
      entries.some((entry, index) => value[index] !== entry)
    )
      return undefined;
    return snapshot;
  } catch {
    return undefined;
  }
}

function rawHeaderCount(response: TransportResponse, name: string): number {
  const raw = response.rawHeaders ?? [];
  let count = 0;
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() === name) count += 1;
  }
  return count;
}

function oneHeader(
  response: TransportResponse,
  name: string,
): string | undefined | null {
  const value = response.headers[name];
  if (Array.isArray(value)) return null;
  if (rawHeaderCount(response, name) > 1) return null;
  return value;
}

function requestId(response: TransportResponse): string | undefined {
  const value = oneHeader(response, "x-request-id");
  return value !== null &&
    value !== undefined &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[\x21-\x7e]+$/u.test(value)
    ? value
    : undefined;
}

function retryAfter(response: TransportResponse): number | undefined {
  const value = oneHeader(response, "retry-after");
  if (value === null || value === undefined || !/^(?:0|[1-9]\d*)$/u.test(value))
    return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 86_400
    ? seconds
    : undefined;
}

function statusFailure(
  status: number,
  response: TransportResponse,
): ProviderTransportResult {
  const id = requestId(response);
  if (status >= 300 && status <= 399)
    return {
      ok: false,
      code: "PROVIDER_REDIRECT_REJECTED",
      statusCategory: "redirect",
      ...(id === undefined ? {} : { requestId: id }),
    };
  if (status === 401 || status === 403)
    return {
      ok: false,
      code: "PROVIDER_AUTH_REJECTED",
      statusCategory: "auth",
      ...(id === undefined ? {} : { requestId: id }),
    };
  if (status === 429) {
    const seconds = retryAfter(response);
    return {
      ok: false,
      code: "PROVIDER_RATE_LIMITED",
      statusCategory: "rate-limit",
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
      ...(id === undefined ? {} : { requestId: id }),
    };
  }
  if (status >= 400 && status <= 499)
    return {
      ok: false,
      code: "PROVIDER_REQUEST_REJECTED",
      statusCategory: "request",
      ...(id === undefined ? {} : { requestId: id }),
    };
  if (status >= 500 && status <= 599)
    return {
      ok: false,
      code: "PROVIDER_SERVICE_FAILED",
      statusCategory: "service",
      ...(id === undefined ? {} : { requestId: id }),
    };
  return {
    ok: false,
    code: "PROVIDER_STATUS_INVALID",
    statusCategory: "invalid",
    ...(id === undefined ? {} : { requestId: id }),
  };
}

function validateResponseMetadata(response: TransportResponse):
  | { ok: true; declaredLength?: number }
  | {
      ok: false;
      code:
        "PROVIDER_RESPONSE_METADATA_INVALID" | "PROVIDER_RESPONSE_TOO_LARGE";
    } {
  const encoding = oneHeader(response, "content-encoding");
  const contentType = oneHeader(response, "content-type");
  const contentLength = oneHeader(response, "content-length");
  if (
    encoding === null ||
    (encoding !== undefined && encoding !== "identity") ||
    contentType === null ||
    (contentType !== undefined &&
      !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(contentType)) ||
    contentLength === null ||
    (contentLength !== undefined && !/^(?:0|[1-9]\d*)$/u.test(contentLength))
  ) {
    return { ok: false, code: "PROVIDER_RESPONSE_METADATA_INVALID" };
  }
  if (contentLength === undefined) return { ok: true };
  const declaredLength = Number(contentLength);
  if (!Number.isSafeInteger(declaredLength))
    return { ok: false, code: "PROVIDER_RESPONSE_METADATA_INVALID" };
  return declaredLength > M05_RESPONSE_MAX_UTF8_BYTES
    ? { ok: false, code: "PROVIDER_RESPONSE_TOO_LARGE" }
    : { ok: true, declaredLength };
}

const NODE_CERTIFICATE_ERROR_CODES = new Set([
  "APPLICATION_VERIFICATION",
  "CRL_HAS_EXPIRED",
  "CRL_NOT_YET_VALID",
  "CRL_SIGNATURE_FAILURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERROR_IN_CERT_NOT_AFTER_FIELD",
  "ERROR_IN_CERT_NOT_BEFORE_FIELD",
  "ERROR_IN_CRL_LAST_UPDATE_FIELD",
  "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
  "HOSTNAME_MISMATCH",
  "INVALID_CA",
  "INVALID_PURPOSE",
  "OUT_OF_MEM",
  "PATH_LENGTH_EXCEEDED",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
  "UNABLE_TO_GET_CRL",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function isTlsError(error: unknown, secureConnected: boolean): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === "string" &&
    ((!secureConnected && code === "EPROTO") ||
      code.startsWith("CERT_") ||
      code.startsWith("ERR_TLS_") ||
      code.startsWith("ERR_SSL_") ||
      NODE_CERTIFICATE_ERROR_CODES.has(code))
  );
}

function discard(response: TransportResponse): void {
  let observed = 0;
  response.on("data", (chunk) => {
    observed += chunk.byteLength;
    if (observed > M05_RESPONSE_MAX_UTF8_BYTES) response.destroy();
  });
  response.once("error", () => undefined);
  response.once("end", () => undefined);
  response.resume();
}

export function sendOpenAICompatibleRequest(
  input: ProviderTransportInput,
  dependencies: ProviderTransportDependencies = defaultDependencies,
): Promise<ProviderTransportResult> {
  let ownedSecret = input.secret;
  input.secret = undefined;
  const bodyBytes = Buffer.byteLength(input.body, "utf8");
  if (bodyBytes > M05_REQUEST_MAX_UTF8_BYTES) {
    ownedSecret = undefined;
    return Promise.resolve(failure("PROVIDER_REQUEST_TOO_LARGE"));
  }
  if (
    !canonicalHostname(input.config.hostname) ||
    input.config.endpoint !== expectedEndpoint(input.config)
  ) {
    ownedSecret = undefined;
    return Promise.resolve(failure("PROVIDER_DNS_UNSAFE"));
  }

  return new Promise((resolve) => {
    let settled = false;
    let request: TransportRequest | undefined;
    let response: TransportResponse | undefined;
    let lookupCount = 0;
    let socketCount = 0;
    let sent = false;
    let secureConnected = false;

    const destroyActive = (): void => {
      request?.destroy();
      response?.destroy();
    };
    const finish = (
      result: ProviderTransportResult,
      destroyStreams = false,
    ): void => {
      ownedSecret = undefined;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", cancel);
      if (destroyStreams) destroyActive();
      resolve(result);
    };
    const cancel = (): void => {
      finish(failure("PROVIDER_CANCELLED"), true);
    };
    const lifecycleCurrent = (stage: ProviderTransportStage): boolean => {
      try {
        return input.lifecycleFence(stage);
      } catch {
        return false;
      }
    };

    const timer = setTimeout(() => {
      finish(failure("PROVIDER_TIMEOUT"), true);
    }, input.config.timeoutMs);
    if (input.signal.aborted) {
      cancel();
      return;
    }
    input.signal.addEventListener("abort", cancel, { once: true });

    void (async () => {
      const pinned = await resolvePinned(
        input.config.hostname,
        dependencies.resolve4,
        dependencies.classifyAddress,
      );
      // The timer or AbortSignal can settle while the resolver promise is pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (settled) return;
      if (!pinned.ok) {
        finish(failure(pinned.code));
        return;
      }
      if (!lifecycleCurrent("dns")) {
        finish(failure("PROVIDER_STALE"), true);
        return;
      }

      if (!lifecycleCurrent("pre-connect")) {
        finish(failure("PROVIDER_STALE"), true);
        return;
      }

      const options: ProviderTransportRequestOptions = {
        method: "POST",
        hostname: input.config.hostname,
        port: input.config.port,
        family: 4,
        path: "/v1/chat/completions",
        agent: false,
        setHost: false,
        servername: input.config.hostname,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + (ownedSecret ?? ""),
          Connection: "close",
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": String(bodyBytes),
          Host:
            input.config.port === 443
              ? input.config.hostname
              : `${input.config.hostname}:${String(input.config.port)}`,
          "User-Agent": "Chat2Vault/0.1.0",
        },
        lookup: (hostname, _options, callback) => {
          lookupCount += 1;
          if (
            settled ||
            lookupCount !== 1 ||
            hostname !== input.config.hostname
          ) {
            callback(new Error("unsafe DNS lookup"), "", 4);
            if (!settled) finish(failure("PROVIDER_DNS_UNSAFE"), true);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
        checkServerIdentity: (_hostname, certificate) =>
          nodeCheckServerIdentity(input.config.hostname, certificate),
      };
      ownedSecret = undefined;
      try {
        request = dependencies.request(options, (incoming) => {
          if (settled) {
            incoming.destroy();
            return;
          }
          response = incoming;
          if (!lifecycleCurrent("headers")) {
            incoming.once("error", () => undefined);
            finish(failure("PROVIDER_STALE"), true);
            return;
          }
          if (lookupCount !== 1 || !sent) {
            finish(failure("PROVIDER_DNS_UNSAFE"), true);
            return;
          }
          const status = incoming.statusCode;
          if (status !== 200) {
            discard(incoming);
            finish(statusFailure(status ?? 0, incoming), true);
            return;
          }
          const metadata = validateResponseMetadata(incoming);
          if (!metadata.ok) {
            incoming.once("error", () => undefined);
            finish(failure(metadata.code), true);
            return;
          }

          const chunks: Buffer[] = [];
          let observed = 0;
          incoming.on("data", (chunk) => {
            if (settled) return;
            if (!lifecycleCurrent("chunk")) {
              finish(failure("PROVIDER_STALE"), true);
              return;
            }
            observed += chunk.byteLength;
            if (observed > M05_RESPONSE_MAX_UTF8_BYTES) {
              finish(failure("PROVIDER_RESPONSE_TOO_LARGE"), true);
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          incoming.once("error", () => {
            finish(failure("PROVIDER_NETWORK_FAILED"), true);
          });
          incoming.once("end", () => {
            if (settled) return;
            if (lookupCount !== 1) {
              finish(failure("PROVIDER_DNS_UNSAFE"), true);
              return;
            }
            const body = Buffer.concat(chunks, observed);
            try {
              new TextDecoder("utf-8", { fatal: true }).decode(body);
            } catch {
              finish(failure("PROVIDER_ENVELOPE_INVALID"), true);
              return;
            }
            const id = requestId(incoming);
            finish({
              ok: true,
              status: 200,
              body,
              ...(id === undefined ? {} : { requestId: id }),
            });
          });
        });
      } catch {
        finish(failure("PROVIDER_NETWORK_FAILED"), true);
        return;
      } finally {
        options.headers.Authorization = "";
      }

      request.once("error", (value) => {
        finish(
          failure(
            isTlsError(value, secureConnected)
              ? "PROVIDER_TLS_FAILED"
              : "PROVIDER_NETWORK_FAILED",
          ),
          true,
        );
      });
      request.once("socket", (value) => {
        const socket = value as TransportSocket;
        socketCount += 1;
        if (settled) {
          socket.destroy();
          return;
        }
        if (socketCount !== 1 || request?.reusedSocket === true) {
          finish(failure("PROVIDER_DNS_UNSAFE"), true);
          return;
        }
        socket.once("error", (error) => {
          finish(
            failure(
              isTlsError(error, secureConnected)
                ? "PROVIDER_TLS_FAILED"
                : "PROVIDER_NETWORK_FAILED",
            ),
            true,
          );
        });
        socket.once("secureConnect", () => {
          if (settled) return;
          secureConnected = true;
          const peer =
            socket.remoteAddress === undefined
              ? { ok: false as const }
              : classifyAddressSafely(
                  socket.remoteAddress,
                  dependencies.classifyAddress,
                );
          if (
            lookupCount !== 1 ||
            socket.remoteFamily !== "IPv4" ||
            !peer.ok ||
            peer.address !== pinned.address ||
            sent
          ) {
            finish(failure("PROVIDER_DNS_UNSAFE"), true);
            return;
          }
          sent = true;
          request?.end(input.body);
        });
      });
    })().catch(() => {
      ownedSecret = undefined;
      finish(failure("PROVIDER_NETWORK_FAILED"), true);
    });
  });
}
