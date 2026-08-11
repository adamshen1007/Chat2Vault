import { describe, expect, it } from "vitest";
import { validateInputEnvelope } from "../src/input.js";

const file = (name: string, size: number) => ({ name, size });

describe("input envelope", () => {
  it("accepts exact limits and rejects mixed, excessive, unsupported, or folder-like input", () => {
    expect(
      validateInputEnvelope([file("export.zip", 64 * 1024 * 1024)]).ok,
    ).toBe(true);
    expect(
      validateInputEnvelope([file("export.json", 64 * 1024 * 1024)]).ok,
    ).toBe(true);
    expect(
      validateInputEnvelope([file("a.json", 1), file("b.zip", 1)]).ok,
    ).toBe(false);
    expect(
      validateInputEnvelope([file("a.json", 64 * 1024 * 1024 + 1)]).ok,
    ).toBe(false);
    expect(
      validateInputEnvelope(
        Array.from({ length: 17 }, (_, i) => file(`${String(i)}.json`, 1)),
      ).ok,
    ).toBe(false);
    expect(
      validateInputEnvelope(
        Array.from({ length: 16 }, (_, i) =>
          file(`${String(i)}.json`, 8 * 1024 * 1024),
        ),
      ).ok,
    ).toBe(true);
    expect(validateInputEnvelope([file("folder/", 0)]).ok).toBe(false);
    expect(validateInputEnvelope([file("note.txt", 1)]).ok).toBe(false);
    expect(
      validateInputEnvelope([
        file("a.json", 64 * 1024 * 1024),
        file("b.json", 64 * 1024 * 1024),
      ]).ok,
    ).toBe(true);
    expect(
      validateInputEnvelope([
        file("a.json", 64 * 1024 * 1024),
        file("b.json", 64 * 1024 * 1024),
        file("c.json", 1),
      ]).ok,
    ).toBe(false);
  });
});
