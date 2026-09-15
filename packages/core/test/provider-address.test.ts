import { describe, expect, it } from "vitest";

import { classifyPublicAddress } from "../src/index.js";

function ipv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

describe("M05 public IPv4 classification", () => {
  it.each([
    ["8.8.8.8", true],
    ["127.0.0.1", false],
    ["10.0.0.1", false],
    ["169.254.1.1", false],
    ["192.0.2.1", false],
    ["2001:4860:4860::8888", false],
    ["::1", false],
    ["fc00::1", false],
    ["::ffff:8.8.8.8", false],
    ["64:ff9b::808:808", false],
    ["2002:c000:0204::", false],
    ["2001:0000:4136:e378:8000:63bf:3fff:fdd2", false],
    ["fe80::1%en0", false],
  ])("classifies %s", (address, allowed) => {
    expect(classifyPublicAddress(address)).toEqual(
      allowed ? { ok: true, family: 4, address } : { ok: false },
    );
  });

  it.each([
    [0x00000000, 8],
    [0x0a000000, 8],
    [0x64400000, 10],
    [0x7f000000, 8],
    [0xa9fe0000, 16],
    [0xac100000, 12],
    [0xc0000000, 24],
    [0xc0000200, 24],
    [0xc01fc400, 24],
    [0xc034c100, 24],
    [0xc0586300, 24],
    [0xc0a80000, 16],
    [0xc0af3000, 24],
    [0xc6120000, 15],
    [0xc6336400, 24],
    [0xcb007100, 24],
    [0xe0000000, 3],
  ])(
    "denies both endpoints and admits each available adjacent complement for %s/%s",
    (network, bits) => {
      const size = 2 ** (32 - bits);
      const first = network >>> 0;
      const last = (network + size - 1) >>> 0;
      expect(classifyPublicAddress(ipv4(first))).toEqual({ ok: false });
      expect(classifyPublicAddress(ipv4(last))).toEqual({ ok: false });
      if (first > 0)
        expect(classifyPublicAddress(ipv4(first - 1))).toEqual({
          ok: true,
          family: 4,
          address: ipv4(first - 1),
        });
      if (last < 0xffffffff)
        expect(classifyPublicAddress(ipv4(last + 1))).toEqual({
          ok: true,
          family: 4,
          address: ipv4(last + 1),
        });
    },
  );

  it.each([
    "01.2.3.4",
    "1.2.3.04",
    "1.2.3",
    "1.2.3.4.5",
    "256.0.0.1",
    "1.2.3.-1",
    " 8.8.8.8",
    "8.8.8.8 ",
    "8.8.8.8%eth0",
    "0x08080808",
    "134744072",
  ])("rejects non-canonical numeric input %s", (address) => {
    expect(classifyPublicAddress(address)).toEqual({ ok: false });
  });
});
