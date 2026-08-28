import { describe, expect, it } from "vitest";

import {
  distillationPage,
  distillationPageCount,
} from "../src/distillation-model.js";

describe("M04 distillation preview paging", () => {
  it.each([
    [0, 1],
    [1, 1],
    [10, 1],
    [11, 2],
    [64, 7],
  ])("maps %i candidates to %i pages of 10", (total, pages) => {
    expect(distillationPageCount(total, 10)).toBe(pages);
  });

  it("clamps pages and never mounts more than the selected page size", () => {
    const values = Array.from({ length: 64 }, (_unused, index) => index);
    expect(distillationPage(values, -1, 10)).toEqual(values.slice(0, 10));
    expect(distillationPage(values, 99, 10)).toEqual(values.slice(60));
    expect(distillationPage(values, 2, 25)).toEqual(values.slice(25, 50));
    expect(distillationPage(values, 2, 50)).toEqual(values.slice(50));
  });
});
