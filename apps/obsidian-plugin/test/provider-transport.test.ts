/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers are intentionally typed as any. */
import { EventEmitter } from "node:events";
import type { checkServerIdentity as CheckServerIdentity } from "node:tls";
import { classifyPublicAddress } from "@chat2vault/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  sendOpenAICompatibleRequest,
  type ProviderTransportDependencies,
  type ProviderTransportInput,
  type ProviderTransportRequestOptions,
  type ProviderTransportStage,
} from "../src/provider-transport.js";

const BODY = JSON.stringify({ synthetic: "prompt" });
const ENVELOPE = Buffer.from(
  JSON.stringify({ choices: [{ message: { content: "synthetic-result" } }] }),
);

function input(
  overrides: Partial<ProviderTransportInput> = {},
): ProviderTransportInput {
  return {
    config: {
      endpoint: "https://api.example.com/v1/chat/completions",
      hostname: "api.example.com",
      port: 443,
      model: "synthetic-model",
      timeoutMs: 10_000,
      maxOutputTokens: 100,
    },
    secret: "synthetic-key",
    body: BODY,
    signal: new AbortController().signal,
    lifecycleFence: () => true,
    ...overrides,
  };
}

class FakeSocket extends EventEmitter {
  public remoteFamily: string | undefined = "IPv4";
  public remoteAddress: string | undefined = "8.8.8.8";
  public destroyed = false;

  public destroy(): this {
    this.destroyed = true;
    return this;
  }
}

class FakeResponse extends EventEmitter {
  public destroyed = false;
  public readonly resume = vi.fn(() => this);

  public constructor(
    public readonly statusCode: number | undefined = 200,
    public readonly headers: Record<string, string | string[] | undefined> = {
      "content-type": "application/json; charset=utf-8",
    },
    public readonly rawHeaders: string[] = [],
  ) {
    super();
  }

  public destroy(): this {
    this.destroyed = true;
    return this;
  }
}

class FakeRequest extends EventEmitter {
  public destroyed = false;
  public reusedSocket = false;
  public readonly end = vi.fn((body?: string) => void body);

  public destroy(): this {
    this.destroyed = true;
    return this;
  }
}

interface Scenario {
  lookupCalls?: number;
  peer?: string;
  family?: string;
  reusedSocket?: boolean;
  status?: number;
  headers?: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
  chunks?: Uint8Array[];
  requestError?: NodeJS.ErrnoException;
  socketError?: NodeJS.ErrnoException;
  postSecureRequestError?: NodeJS.ErrnoException;
  postSecureSocketError?: NodeJS.ErrnoException;
  stopAfter?: "lookup" | "socket" | "secure-connect" | "headers";
}

function requestScenario(scenario: Scenario = {}) {
  const requests: FakeRequest[] = [];
  const responses: FakeResponse[] = [];
  const sockets: FakeSocket[] = [];
  const optionsSeen: ProviderTransportRequestOptions[] = [];
  const request = vi.fn(
    (
      options: ProviderTransportRequestOptions,
      onResponse: (response: FakeResponse) => void,
    ) => {
      optionsSeen.push({ ...options, headers: { ...options.headers } });
      const outgoing = new FakeRequest();
      outgoing.reusedSocket = scenario.reusedSocket ?? false;
      requests.push(outgoing);
      queueMicrotask(() => {
        if (scenario.requestError !== undefined) {
          outgoing.emit("error", scenario.requestError);
          return;
        }
        const lookupCalls = scenario.lookupCalls ?? 1;
        for (let count = 0; count < lookupCalls; count += 1) {
          options.lookup(options.hostname, { family: 0 }, () => undefined);
        }
        if (scenario.stopAfter === "lookup") return;
        const socket = new FakeSocket();
        socket.remoteAddress = scenario.peer ?? "8.8.8.8";
        socket.remoteFamily = scenario.family ?? "IPv4";
        sockets.push(socket);
        outgoing.emit("socket", socket);
        if (scenario.socketError !== undefined) {
          socket.emit("error", scenario.socketError);
          return;
        }
        if (scenario.stopAfter === "socket") return;
        socket.emit("secureConnect");
        if (scenario.postSecureRequestError !== undefined) {
          outgoing.emit("error", scenario.postSecureRequestError);
          return;
        }
        if (scenario.postSecureSocketError !== undefined) {
          socket.emit("error", scenario.postSecureSocketError);
          return;
        }
        if (scenario.stopAfter === "secure-connect") return;
        const response = new FakeResponse(
          scenario.status ?? 200,
          scenario.headers ?? { "content-type": "application/json" },
          scenario.rawHeaders ?? [],
        );
        responses.push(response);
        onResponse(response);
        if (scenario.stopAfter === "headers") return;
        for (const chunk of scenario.chunks ?? [ENVELOPE]) {
          response.emit("data", Buffer.from(chunk));
        }
        response.emit("end");
      });
      return outgoing;
    },
  );
  return { request, requests, responses, sockets, optionsSeen };
}

function dependencies(
  scenario: Scenario = {},
  answers: { address: string; ttl: number }[] = [
    { address: "8.8.8.8", ttl: 300 },
  ],
) {
  const harness = requestScenario(scenario);
  const resolve4 = vi.fn(() => Promise.resolve(answers));
  const classifyAddress = vi.fn(classifyPublicAddress);
  return {
    harness,
    deps: {
      resolve4,
      request: harness.request,
      classifyAddress,
    } satisfies ProviderTransportDependencies,
    resolve4,
    classifyAddress,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("pinned-DNS HTTPS request", () => {
  test("uses the injected classifier for both the DNS answer and actual connected peer", async () => {
    const { deps, harness, classifyAddress } = dependencies(
      { peer: "127.0.0.1" },
      [{ address: "127.0.0.1", ttl: 60 }],
    );
    classifyAddress.mockImplementation((address) =>
      address === "127.0.0.1"
        ? { ok: true, family: 4, address }
        : { ok: false },
    );

    expect(await sendOpenAICompatibleRequest(input(), deps)).toMatchObject({
      ok: true,
    });
    expect(classifyAddress).toHaveBeenCalledTimes(2);
    expect(classifyAddress).toHaveBeenNthCalledWith(1, "127.0.0.1");
    expect(classifyAddress).toHaveBeenNthCalledWith(2, "127.0.0.1");
    expect(harness.requests[0]?.end).toHaveBeenCalledOnce();
  });

  test("fails closed when an injected peer-classification result is hostile", async () => {
    const { deps, harness, classifyAddress } = dependencies();
    classifyAddress
      .mockReturnValueOnce({ ok: true, family: 4, address: "8.8.8.8" })
      .mockReturnValueOnce(
        Object.defineProperty({}, "ok", {
          get: () => {
            throw new Error("hostile classifier result");
          },
        }) as never,
      );

    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_DNS_UNSAFE",
    });
    expect(harness.requests[0]?.end).not.toHaveBeenCalled();
  });

  test("pins the first validated address and supplies the exact HTTPS options and seven headers", async () => {
    const { deps, harness, resolve4 } = dependencies();
    const result = await sendOpenAICompatibleRequest(input(), deps);

    expect(result).toEqual({ ok: true, status: 200, body: ENVELOPE });
    expect(resolve4).toHaveBeenCalledOnce();
    expect(resolve4).toHaveBeenCalledWith("api.example.com", { ttl: true });
    expect(harness.request).toHaveBeenCalledOnce();
    expect(harness.optionsSeen[0]).toEqual(
      expect.objectContaining({
        method: "POST",
        hostname: "api.example.com",
        port: 443,
        family: 4,
        path: "/v1/chat/completions",
        agent: false,
        setHost: false,
        servername: "api.example.com",
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        lookup: expect.any(Function),
        checkServerIdentity: expect.any(Function),
        headers: {
          Accept: "application/json",
          Authorization: "Bearer synthetic-key",
          Connection: "close",
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": String(Buffer.byteLength(BODY)),
          Host: "api.example.com",
          "User-Agent": "Chat2Vault/0.1.0",
        },
      }),
    );
    expect(harness.optionsSeen[0]).not.toHaveProperty("ca");
    expect(harness.request.mock.calls[0]?.[0].headers.Authorization).toBe("");
    expect(harness.requests[0]?.end).toHaveBeenCalledOnce();
    expect(harness.requests[0]?.end).toHaveBeenCalledWith(BODY);
  });

  test("uses the canonical non-default port in the request and Host header", async () => {
    const { deps, harness } = dependencies();
    const value = input({
      config: {
        ...input().config,
        endpoint: "https://api.example.com:8443/v1/chat/completions",
        port: 8443,
      },
    });
    expect(await sendOpenAICompatibleRequest(value, deps)).toMatchObject({
      ok: true,
    });
    expect(harness.optionsSeen[0]).toMatchObject({
      port: 8443,
      headers: expect.objectContaining({ Host: "api.example.com:8443" }),
    });
  });

  test("preserves resolver order and pins only the first safe A answer", async () => {
    const { deps, harness } = dependencies({}, [
      { address: "8.8.4.4", ttl: 60 },
      { address: "8.8.8.8", ttl: 60 },
    ]);
    harness.request.mockImplementationOnce((options, onResponse) => {
      const request = new FakeRequest();
      queueMicrotask(() => {
        options.lookup(options.hostname, {}, (_error, address, family) => {
          expect(address).toBe("8.8.4.4");
          expect(family).toBe(4);
        });
        const socket = new FakeSocket();
        socket.remoteAddress = "8.8.4.4";
        request.emit("socket", socket);
        socket.emit("secureConnect");
        const response = new FakeResponse(200, {
          "content-type": "application/json",
        });
        onResponse(response);
        response.emit("data", ENVELOPE);
        response.emit("end");
      });
      return request;
    });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toMatchObject({
      ok: true,
    });
  });

  test.each([
    ["empty", []],
    [
      "17 answers",
      Array.from({ length: 17 }, (_, index) => ({
        address: `8.8.8.${String(index + 1)}`,
        ttl: 60,
      })),
    ],
    [
      "duplicate",
      [
        { address: "8.8.8.8", ttl: 60 },
        { address: "8.8.8.8", ttl: 60 },
      ],
    ],
    ["zero TTL", [{ address: "8.8.8.8", ttl: 0 }]],
    ["fractional TTL", [{ address: "8.8.8.8", ttl: 1.5 }]],
    ["unsafe address", [{ address: "127.0.0.1", ttl: 60 }]],
    ["IPv6 answer", [{ address: "2001:4860:4860::8888", ttl: 60 }]],
    ["malformed answer", [{ address: "008.8.8.8", ttl: 60 }]],
  ])(
    "rejects an unsafe %s DNS answer set without requesting",
    async (_name, answers) => {
      const { deps, harness } = dependencies({}, answers);
      expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
        ok: false,
        code: "PROVIDER_DNS_UNSAFE",
      });
      expect(harness.request).not.toHaveBeenCalled();
    },
  );

  test("maps resolver failures without exposing the thrown value", async () => {
    const harness = requestScenario();
    const deps = {
      resolve4: vi.fn(() =>
        Promise.reject(new Error("sensitive resolver detail")),
      ),
      request: harness.request,
      classifyAddress: classifyPublicAddress,
    } satisfies ProviderTransportDependencies;
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_DNS_FAILED",
    });
    expect(harness.request).not.toHaveBeenCalled();
  });

  test.each([
    ["non-array output", () => Promise.resolve(null)],
    [
      "throwing accessor",
      () =>
        Promise.resolve([
          Object.defineProperty({ ttl: 60 }, "address", {
            enumerable: true,
            get: () => {
              throw new Error("sensitive accessor detail");
            },
          }),
        ]),
    ],
    [
      "throwing proxy",
      () =>
        Promise.resolve([
          new Proxy(
            { address: "8.8.8.8", ttl: 60 },
            {
              getOwnPropertyDescriptor: () => {
                throw new Error("sensitive proxy detail");
              },
            },
          ),
        ]),
    ],
  ])(
    "rejects hostile resolver %s without HTTPS",
    async (_name, resolveHostile) => {
      vi.useFakeTimers();
      const harness = requestScenario();
      const pending = sendOpenAICompatibleRequest(input(), {
        resolve4: resolveHostile,
        request: harness.request,
        classifyAddress: classifyPublicAddress,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({
        ok: false,
        code: "PROVIDER_DNS_UNSAFE",
      });
      expect(harness.request).not.toHaveBeenCalled();
    },
  );

  test("rejects resolver-array mutation while snapshotting without HTTPS", async () => {
    const harness = requestScenario();
    const first = { address: "8.8.8.8", ttl: 60 };
    const second = { address: "8.8.4.4", ttl: 60 };
    let reads = 0;
    const answers = new Proxy([first], {
      get: (target, property, receiver) => {
        if (property === "0" && reads++ > 0) return second;
        const reflected: unknown = Reflect.get(target, property, receiver);
        return reflected;
      },
    });
    const result = await sendOpenAICompatibleRequest(input(), {
      resolve4: vi.fn(() => Promise.resolve(answers)),
      request: harness.request,
      classifyAddress: classifyPublicAddress,
    });
    expect(result).toEqual({ ok: false, code: "PROVIDER_DNS_UNSAFE" });
    expect(harness.request).not.toHaveBeenCalled();
  });

  test.each(["127.0.0.1", "[2001:db8::1]", "2001:db8::1"])(
    "rejects an IP-literal endpoint hostname %s before DNS",
    async (hostname) => {
      const { deps, resolve4, harness } = dependencies();
      expect(
        await sendOpenAICompatibleRequest(
          input({ config: { ...input().config, hostname } }),
          deps,
        ),
      ).toEqual({ ok: false, code: "PROVIDER_DNS_UNSAFE" });
      expect(resolve4).not.toHaveBeenCalled();
      expect(harness.request).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["zero", 0],
    ["second", 2],
  ])("fails closed on %s custom lookup calls", async (_name, lookupCalls) => {
    const { deps, harness } = dependencies({ lookupCalls });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_DNS_UNSAFE",
    });
    expect(harness.requests[0]?.end).not.toHaveBeenCalled();
  });

  test.each([
    ["different peer", { peer: "8.8.4.4" }],
    ["IPv6 peer", { peer: "2001:4860:4860::8888", family: "IPv6" }],
    ["IPv4-mapped peer", { peer: "::ffff:8.8.8.8", family: "IPv6" }],
    ["reused socket", { reusedSocket: true }],
  ])("rejects a %s before sending sensitive bytes", async (_name, scenario) => {
    const { deps, harness } = dependencies(scenario);
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_DNS_UNSAFE",
    });
    expect(harness.requests[0]?.end).not.toHaveBeenCalled();
    expect(harness.requests[0]?.destroyed).toBe(true);
  });

  test("does not use global/proxy agents, environment proxies, CONNECT, or extra headers", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid:8080");
    vi.stubEnv("HTTP_PROXY", "http://proxy.invalid:8080");
    vi.stubEnv("NO_PROXY", "api.example.com");
    const { deps, harness } = dependencies();
    const forbiddenAgent = { request: vi.fn() };
    const attemptedInjection = Object.assign({}, deps, {
      agent: forbiddenAgent,
      proxyAgent: forbiddenAgent,
    });
    expect(
      await sendOpenAICompatibleRequest(input(), attemptedInjection),
    ).toMatchObject({ ok: true });
    const options = harness.optionsSeen[0];
    expect(options).toBeDefined();
    if (options === undefined) throw new Error("missing synthetic options");
    expect(options.agent).toBe(false);
    expect(options.method).toBe("POST");
    expect(options.path).toBe("/v1/chat/completions");
    expect(Object.keys(options.headers)).toHaveLength(7);
    expect(JSON.stringify(options)).not.toContain("proxy.invalid");
    expect(options.headers).not.toHaveProperty("Proxy-Authorization");
    expect(options.headers).not.toHaveProperty("Accept-Encoding");
    expect(options.headers).not.toHaveProperty("Transfer-Encoding");
    expect(forbiddenAgent.request).not.toHaveBeenCalled();
  });

  test("delegates certificate verification to Node for the canonical hostname", async () => {
    const { deps, harness } = dependencies();
    await sendOpenAICompatibleRequest(input(), deps);
    const verify = harness.optionsSeen[0]
      ?.checkServerIdentity as typeof CheckServerIdentity;
    const error = verify("different.example.com", {} as never);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("closed status and response contract", () => {
  test.each([
    [300, "PROVIDER_REDIRECT_REJECTED", "redirect"],
    [399, "PROVIDER_REDIRECT_REJECTED", "redirect"],
    [401, "PROVIDER_AUTH_REJECTED", "auth"],
    [403, "PROVIDER_AUTH_REJECTED", "auth"],
    [429, "PROVIDER_RATE_LIMITED", "rate-limit"],
    [400, "PROVIDER_REQUEST_REJECTED", "request"],
    [499, "PROVIDER_REQUEST_REJECTED", "request"],
    [500, "PROVIDER_SERVICE_FAILED", "service"],
    [599, "PROVIDER_SERVICE_FAILED", "service"],
    [199, "PROVIDER_STATUS_INVALID", "invalid"],
    [600, "PROVIDER_STATUS_INVALID", "invalid"],
  ])(
    "maps HTTP %i without retaining its body",
    async (status, code, statusCategory) => {
      const { deps, harness } = dependencies({
        status,
        chunks: [Buffer.from("sensitive provider error")],
      });
      expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
        ok: false,
        code,
        statusCategory,
      });
      expect(harness.responses[0]?.resume).toHaveBeenCalledOnce();
      expect(harness.requests[0]?.destroyed).toBe(true);
      expect(harness.responses[0]?.destroyed).toBe(true);
      expect(() => {
        harness.responses[0]?.emit("data", Buffer.from("late"));
        harness.responses[0]?.emit("error", new Error("late"));
        harness.responses[0]?.emit("end");
        harness.requests[0]?.emit("error", new Error("late"));
      }).not.toThrow();
    },
  );

  test.each([
    ["0", 0],
    ["86400", 86_400],
    ["86401", undefined],
    ["-1", undefined],
    ["1.5", undefined],
    ["tomorrow", undefined],
  ])(
    "bounds Retry-After %s without retrying",
    async (header, retryAfterSeconds) => {
      const { deps, harness } = dependencies({
        status: 429,
        headers: { "retry-after": header },
      });
      const result = await sendOpenAICompatibleRequest(input(), deps);
      expect(result).toEqual({
        ok: false,
        code: "PROVIDER_RATE_LIMITED",
        statusCategory: "rate-limit",
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      });
      expect(harness.request).toHaveBeenCalledOnce();
    },
  );

  test("returns one bounded visible request ID as untrusted metadata", async () => {
    const { deps } = dependencies({
      headers: {
        "content-type": "application/json",
        "x-request-id": "synthetic-request-123",
      },
    });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: true,
      status: 200,
      body: ENVELOPE,
      requestId: "synthetic-request-123",
    });
  });

  test.each([
    ["empty", "", []],
    ["too long", "x".repeat(201), []],
    ["non-visible", "synthetic\nrequest", []],
    ["single space", " ", []],
    ["embedded space", "synthetic request", []],
    ["leading space", " synthetic-request", []],
    ["trailing space", "synthetic-request ", []],
    [
      "duplicate",
      "synthetic-request",
      ["x-request-id", "one", "x-request-id", "two"],
    ],
  ])("omits an %s request ID", async (_name, value, rawHeaders) => {
    const { deps } = dependencies({
      headers: {
        "content-type": "application/json",
        "x-request-id": value,
      },
      rawHeaders,
    });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: true,
      status: 200,
      body: ENVELOPE,
    });
  });

  test.each([
    ["compressed", { "content-encoding": "gzip" }],
    ["encoding array", { "content-encoding": ["identity", "identity"] }],
    ["wrong type", { "content-type": "text/plain" }],
    ["extra type parameter", { "content-type": "application/json; profile=x" }],
    ["type array", { "content-type": ["application/json"] }],
    ["negative length", { "content-length": "-1" }],
    ["fractional length", { "content-length": "1.5" }],
    ["ambiguous length", { "content-length": ["1", "1"] }],
  ])(
    "rejects %s response metadata before reading body",
    async (_name, headers) => {
      const { deps, harness } = dependencies({ headers });
      expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
        ok: false,
        code: "PROVIDER_RESPONSE_METADATA_INVALID",
      });
      expect(harness.responses[0]?.resume).not.toHaveBeenCalled();
      expect(harness.requests[0]?.destroyed).toBe(true);
      expect(harness.responses[0]?.destroyed).toBe(true);
      expect(() => {
        harness.responses[0]?.emit("data", Buffer.from("late"));
        harness.responses[0]?.emit("error", new Error("late"));
        harness.responses[0]?.emit("end");
        harness.requests[0]?.emit("error", new Error("late"));
      }).not.toThrow();
    },
  );

  test.each([undefined, "application/json", "APPLICATION/JSON; CHARSET=UTF-8"])(
    "accepts allowed content type %s",
    async (contentType) => {
      const headers =
        contentType === undefined ? {} : { "content-type": contentType };
      const { deps } = dependencies({ headers });
      expect(await sendOpenAICompatibleRequest(input(), deps)).toMatchObject({
        ok: true,
      });
    },
  );

  test("accepts explicit identity content encoding", async () => {
    const { deps } = dependencies({
      headers: { "content-encoding": "identity" },
    });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toMatchObject({
      ok: true,
    });
  });

  test("rejects an oversized declared body before consuming it", async () => {
    const { deps, harness } = dependencies({
      headers: { "content-length": "1048577" },
    });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_RESPONSE_TOO_LARGE",
    });
    expect(harness.responses[0]?.resume).not.toHaveBeenCalled();
    expect(harness.requests[0]?.destroyed).toBe(true);
    expect(harness.responses[0]?.destroyed).toBe(true);
    expect(() => {
      harness.responses[0]?.emit("data", Buffer.alloc(2_000_000));
      harness.responses[0]?.emit("error", new Error("late"));
      harness.responses[0]?.emit("end");
      harness.requests[0]?.emit("error", new Error("late"));
    }).not.toThrow();
  });

  test("accepts the inclusive response limit and rejects the next chunked byte", async () => {
    const exact = dependencies({
      headers: {
        "content-type": "application/json",
        "content-length": "1048576",
      },
      chunks: [Buffer.alloc(1_048_576, 0x20)],
    });
    expect(
      await sendOpenAICompatibleRequest(input(), exact.deps),
    ).toMatchObject({
      ok: true,
      body: expect.any(Uint8Array),
    });
    const overflow = dependencies({
      chunks: [Buffer.alloc(1_048_576), Buffer.from([0])],
    });
    expect(await sendOpenAICompatibleRequest(input(), overflow.deps)).toEqual({
      ok: false,
      code: "PROVIDER_RESPONSE_TOO_LARGE",
    });
    expect(overflow.harness.responses[0]?.destroyed).toBe(true);
  });

  test("rejects invalid UTF-8 after the bounded body read", async () => {
    const { deps } = dependencies({ chunks: [Uint8Array.from([0xc3, 0x28])] });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_ENVELOPE_INVALID",
    });
  });

  test("rejects an oversized request before DNS or HTTPS", async () => {
    const { deps, resolve4, harness } = dependencies();
    expect(
      await sendOpenAICompatibleRequest(
        input({ body: "x".repeat(300_001) }),
        deps,
      ),
    ).toEqual({ ok: false, code: "PROVIDER_REQUEST_TOO_LARGE" });
    expect(resolve4).not.toHaveBeenCalled();
    expect(harness.request).not.toHaveBeenCalled();
  });

  test("accepts the inclusive request-body limit", async () => {
    const body = "x".repeat(300_000);
    const { deps, harness } = dependencies();
    expect(
      await sendOpenAICompatibleRequest(input({ body }), deps),
    ).toMatchObject({ ok: true });
    expect(harness.optionsSeen[0]?.headers["Content-Length"]).toBe("300000");
    expect(harness.requests[0]?.end).toHaveBeenCalledWith(body);
  });
});

describe("bounded lifecycle", () => {
  test.each([
    ["false", "dns", false],
    ["throw", "dns", true],
    ["false", "pre-connect", false],
    ["throw", "pre-connect", true],
    ["false", "headers", false],
    ["throw", "headers", true],
    ["false", "chunk", false],
    ["throw", "chunk", true],
  ] as const)(
    "settles stale when the %s lifecycle fence wins at %s",
    async (_behavior, targetStage, throws) => {
      const observed: ProviderTransportStage[] = [];
      const lifecycleFence = vi.fn((stage: ProviderTransportStage) => {
        observed.push(stage);
        if (stage !== targetStage) return true;
        if (throws) throw new Error("private stale-fence detail");
        return false;
      });
      const { deps, harness } = dependencies({
        ...(targetStage === "headers" ? { stopAfter: "headers" as const } : {}),
        ...(targetStage === "chunk"
          ? { chunks: [Buffer.from("first"), Buffer.from("later")] }
          : {}),
      });

      expect(
        await sendOpenAICompatibleRequest(input({ lifecycleFence }), deps),
      ).toEqual({ ok: false, code: "PROVIDER_STALE" });

      const expectedOrder: ProviderTransportStage[] = ["dns"];
      if (targetStage !== "dns") expectedOrder.push("pre-connect");
      if (targetStage === "headers" || targetStage === "chunk")
        expectedOrder.push("headers");
      if (targetStage === "chunk") expectedOrder.push("chunk");
      expect(observed).toEqual(expectedOrder);

      if (targetStage === "dns" || targetStage === "pre-connect") {
        expect(harness.request).not.toHaveBeenCalled();
        expect(harness.requests).toHaveLength(0);
      } else {
        expect(harness.request).toHaveBeenCalledOnce();
        expect(harness.requests[0]?.end).toHaveBeenCalledOnce();
        expect(harness.requests[0]?.destroyed).toBe(true);
        expect(harness.responses[0]?.destroyed).toBe(true);
        expect(() => {
          harness.responses[0]?.emit("data", Buffer.from("late"));
          harness.responses[0]?.emit("error", new Error("late"));
          harness.responses[0]?.emit("end");
          harness.requests[0]?.emit("error", new Error("late"));
        }).not.toThrow();
      }
    },
  );

  test("invokes each successful lifecycle stage exactly once and in order", async () => {
    const lifecycleFence = vi.fn<(stage: ProviderTransportStage) => boolean>(
      () => true,
    );
    const chunks = [Buffer.from("first"), Buffer.from("second")];
    const { deps } = dependencies({ chunks });
    expect(
      await sendOpenAICompatibleRequest(input({ lifecycleFence }), deps),
    ).toEqual({
      ok: true,
      status: 200,
      body: Buffer.concat(chunks),
    });
    expect(lifecycleFence.mock.calls.map(([stage]) => stage)).toEqual([
      "dns",
      "pre-connect",
      "headers",
      "chunk",
      "chunk",
    ]);
  });

  test.each([
    [
      "certificate",
      Object.assign(new Error("private certificate text"), {
        code: "CERT_HAS_EXPIRED",
      }),
    ],
    [
      "TLS protocol",
      Object.assign(new Error("private TLS text"), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      }),
    ],
    [
      "local issuer",
      Object.assign(new Error("private issuer text"), {
        code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      }),
    ],
    [
      "invalid CA",
      Object.assign(new Error("private CA text"), { code: "INVALID_CA" }),
    ],
    [
      "untrusted certificate",
      Object.assign(new Error("private trust text"), {
        code: "CERT_UNTRUSTED",
      }),
    ],
  ])(
    "closes a %s failure without exposing details",
    async (_name, requestError) => {
      const { deps } = dependencies({ requestError });
      expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
        ok: false,
        code: "PROVIDER_TLS_FAILED",
      });
    },
  );

  test.each([
    "CERT_HAS_EXPIRED",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "INVALID_CA",
    "CERT_UNTRUSTED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ])("maps TLS-coded socket error %s without leaking details", async (code) => {
    const { deps } = dependencies({
      socketError: Object.assign(new Error("private socket TLS text"), {
        code,
      }),
    });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_TLS_FAILED",
    });
  });

  test.each(["request", "socket"] as const)(
    "maps %s EPROTO during TLS connection without leaking details",
    async (surface) => {
      const protocolError = Object.assign(new Error("private protocol text"), {
        code: "EPROTO",
      });
      const { deps } = dependencies({
        ...(surface === "request"
          ? { requestError: protocolError }
          : { socketError: protocolError }),
      });
      expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
        ok: false,
        code: "PROVIDER_TLS_FAILED",
      });
    },
  );

  test("closes a non-TLS request failure without exposing details", async () => {
    const { deps } = dependencies({
      requestError: Object.assign(new Error("private network text"), {
        code: "ECONNRESET",
      }),
    });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_NETWORK_FAILED",
    });
  });

  test("keeps an ordinary socket ECONNRESET classified as network failure", async () => {
    const { deps } = dependencies({
      socketError: Object.assign(new Error("private socket network text"), {
        code: "ECONNRESET",
      }),
    });
    expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
      ok: false,
      code: "PROVIDER_NETWORK_FAILED",
    });
  });

  test.each(["request", "socket"] as const)(
    "does not classify %s EPROTO after secureConnect as TLS failure",
    async (surface) => {
      const protocolError = Object.assign(new Error("private protocol text"), {
        code: "EPROTO",
      });
      const { deps } = dependencies({
        ...(surface === "request"
          ? { postSecureRequestError: protocolError }
          : { postSecureSocketError: protocolError }),
      });
      expect(await sendOpenAICompatibleRequest(input(), deps)).toEqual({
        ok: false,
        code: "PROVIDER_NETWORK_FAILED",
      });
    },
  );

  test("clears the caller-visible secret ownership slot during hanging DNS cancellation", async () => {
    const controller = new AbortController();
    const ownershipSlot = input({ signal: controller.signal });
    const harness = requestScenario();
    const resolve4 = vi.fn(() => new Promise<never>(() => undefined));

    const pending = sendOpenAICompatibleRequest(ownershipSlot, {
      resolve4,
      request: harness.request,
      classifyAddress: classifyPublicAddress,
    });

    expect(ownershipSlot.secret).toBeUndefined();
    controller.abort();
    expect(await pending).toEqual({ ok: false, code: "PROVIDER_CANCELLED" });
    expect(ownershipSlot.secret).toBeUndefined();
    expect(resolve4).toHaveBeenCalledOnce();
    expect(harness.request).not.toHaveBeenCalled();
  });

  test("clears the caller-visible secret ownership slot during hanging DNS timeout", async () => {
    vi.useFakeTimers();
    const ownershipSlot = input();
    const harness = requestScenario();
    const resolve4 = vi.fn(() => new Promise<never>(() => undefined));

    const pending = sendOpenAICompatibleRequest(ownershipSlot, {
      resolve4,
      request: harness.request,
      classifyAddress: classifyPublicAddress,
    });

    expect(ownershipSlot.secret).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, code: "PROVIDER_TIMEOUT" });
    expect(ownershipSlot.secret).toBeUndefined();
    expect(resolve4).toHaveBeenCalledOnce();
    expect(harness.request).not.toHaveBeenCalled();
  });

  test("cancels explicitly and destroys active streams", async () => {
    const controller = new AbortController();
    const { deps, harness } = dependencies({ stopAfter: "headers" });
    const pending = sendOpenAICompatibleRequest(
      input({ signal: controller.signal }),
      deps,
    );
    await vi.waitFor(() => expect(harness.responses).toHaveLength(1));
    controller.abort();
    expect(await pending).toEqual({ ok: false, code: "PROVIDER_CANCELLED" });
    expect(harness.requests[0]?.destroyed).toBe(true);
    expect(harness.responses[0]?.destroyed).toBe(true);
  });

  test("an already-cancelled operation performs no DNS or network access", async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, resolve4, harness } = dependencies();
    expect(
      await sendOpenAICompatibleRequest(
        input({ signal: controller.signal }),
        deps,
      ),
    ).toEqual({ ok: false, code: "PROVIDER_CANCELLED" });
    expect(resolve4).not.toHaveBeenCalled();
    expect(harness.request).not.toHaveBeenCalled();
  });

  test.each([
    ["DNS", undefined],
    ["connect", "lookup"],
    ["TLS", "socket"],
    ["headers", "secure-connect"],
    ["body", "headers"],
  ] as const)(
    "uses the one total timeout during %s",
    async (_phase, stopAfter) => {
      vi.useFakeTimers();
      const harness = requestScenario(
        stopAfter === undefined ? {} : { stopAfter },
      );
      let resolveDns:
        ((value: { address: string; ttl: number }[]) => void) | undefined;
      const resolve4 =
        stopAfter === undefined
          ? vi.fn(
              () =>
                new Promise<{ address: string; ttl: number }[]>((resolve) => {
                  resolveDns = resolve;
                }),
            )
          : vi.fn(() => Promise.resolve([{ address: "8.8.8.8", ttl: 60 }]));
      const pending = sendOpenAICompatibleRequest(input(), {
        resolve4,
        request: harness.request,
        classifyAddress: classifyPublicAddress,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ ok: false, code: "PROVIDER_TIMEOUT" });
      expect(harness.requests[0]?.destroyed ?? true).toBe(true);
      expect(harness.responses[0]?.destroyed ?? true).toBe(true);
      resolveDns?.([{ address: "8.8.8.8", ttl: 60 }]);
    },
  );

  test("ignores late response events after cancellation without double settlement", async () => {
    const controller = new AbortController();
    const { deps, harness } = dependencies({ stopAfter: "headers" });
    const pending = sendOpenAICompatibleRequest(
      input({ signal: controller.signal }),
      deps,
    );
    await vi.waitFor(() => expect(harness.responses).toHaveLength(1));
    controller.abort();
    expect(await pending).toEqual({ ok: false, code: "PROVIDER_CANCELLED" });
    expect(() => {
      harness.responses[0]?.emit("data", Buffer.alloc(2_000_000));
      harness.responses[0]?.emit("error", new Error("late"));
      harness.responses[0]?.emit("end");
      harness.requests[0]?.emit("error", new Error("late"));
      harness.sockets[0]?.emit("secureConnect");
    }).not.toThrow();
  });
});
