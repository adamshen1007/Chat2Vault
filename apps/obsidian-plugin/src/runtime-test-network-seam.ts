/* eslint-disable @typescript-eslint/no-unnecessary-boolean-literal-compare, @typescript-eslint/no-unnecessary-condition -- the runtime seam reasserts production request invariants even when production types carry literals. */
import { request as nodeHttpsRequest } from "node:https";
import type { AddressResult } from "@chat2vault/core";
import type {
  ProviderTransportDependencies,
  ProviderTransportRequestOptions,
} from "./provider-transport.js";

export const M05_RUNTIME_HOST = "m05.invalid";
export const M05_RUNTIME_ADDRESS = "127.0.0.1";

export interface RuntimeNetworkSeamOptions {
  mismatchPeer?: boolean;
  mismatchPeerAddress?: string;
  unsafeDnsAddress?: string;
  acceptedHostname?: string;
}

function runtimeClassifier(
  address: string,
  mismatchPeerAddress: string | undefined,
): AddressResult {
  return address === M05_RUNTIME_ADDRESS ||
    (mismatchPeerAddress !== undefined && address === mismatchPeerAddress)
    ? { ok: true, family: 4, address }
    : { ok: false };
}

export function createRuntimeNetworkDependencies(
  options: RuntimeNetworkSeamOptions = {},
): ProviderTransportDependencies {
  const resolvedAddress = options.unsafeDnsAddress ?? M05_RUNTIME_ADDRESS;
  const acceptedHostname = options.acceptedHostname ?? M05_RUNTIME_HOST;
  const mismatchPeerAddress = options.mismatchPeerAddress;
  if (options.mismatchPeer === true && mismatchPeerAddress === undefined)
    throw new Error("runtime mismatch destination unavailable");
  return {
    resolve4: (hostname) =>
      Promise.resolve(
        hostname === acceptedHostname
          ? [{ address: resolvedAddress, ttl: 60 }]
          : [],
      ),
    classifyAddress:
      options.unsafeDnsAddress === undefined
        ? (address) => runtimeClassifier(address, mismatchPeerAddress)
        : () => ({ ok: false }),
    request: (requestOptions, onResponse) => {
      const expectedHost =
        requestOptions.port === 443
          ? acceptedHostname
          : `${acceptedHostname}:${String(requestOptions.port)}`;
      if (
        requestOptions.method !== "POST" ||
        requestOptions.hostname !== acceptedHostname ||
        requestOptions.servername !== acceptedHostname ||
        requestOptions.path !== "/v1/chat/completions" ||
        requestOptions.agent !== false ||
        requestOptions.setHost !== false ||
        requestOptions.rejectUnauthorized !== true ||
        requestOptions.minVersion !== "TLSv1.2" ||
        requestOptions.headers.Host !== expectedHost ||
        typeof requestOptions.headers.Authorization !== "string" ||
        !requestOptions.headers.Authorization.startsWith("Bearer ")
      )
        throw new Error("runtime transport option invariant failed");
      let effectiveOptions: ProviderTransportRequestOptions = requestOptions;
      if (options.mismatchPeer === true) {
        if (mismatchPeerAddress === undefined)
          throw new Error("runtime mismatch destination unavailable");
        effectiveOptions = {
          ...requestOptions,
          lookup: (_hostname, _lookupOptions, callback) => {
            callback(null, mismatchPeerAddress, 4);
          },
        };
      }
      return nodeHttpsRequest(effectiveOptions, onResponse);
    },
  };
}
