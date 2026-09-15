export type AddressResult =
  { ok: true; family: 4; address: string } | { ok: false };

const IPV4_DENY_RANGES: readonly (readonly [number, number])[] = [
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
];

function parseExactIpv4(address: string): number | undefined {
  const match =
    /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/u.exec(
      address,
    );
  if (match === null) return undefined;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return undefined;
  const [first = -1, second = -1, third = -1, fourth = -1] = octets;
  return (((first << 24) >>> 0) | (second << 16) | (third << 8) | fourth) >>> 0;
}

function inIpv4Range(address: number, network: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) >>> 0 === (network & mask) >>> 0;
}

export function classifyPublicAddress(address: string): AddressResult {
  const ipv4 = parseExactIpv4(address);
  if (ipv4 === undefined) return { ok: false };
  return IPV4_DENY_RANGES.some(([network, bits]) =>
    inIpv4Range(ipv4, network, bits),
  )
    ? { ok: false }
    : { ok: true, family: 4, address };
}
