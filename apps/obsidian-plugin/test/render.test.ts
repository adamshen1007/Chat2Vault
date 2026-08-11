// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderText } from "../src/render.js";

describe("inert rendering", () => {
  it("renders hostile markup and URLs only as text", () => {
    const host = document.createElement("div");
    const hostile = [
      "<img src=x onerror=alert(1)>",
      "<script>alert(1)</script>",
      '<svg><a href="javascript:alert(1)">x</a></svg>',
      '<iframe srcdoc="private"></iframe>',
      "[click](javascript:alert(1))",
      "https://example.com",
    ].join(" ");
    renderText(host, hostile);
    for (const selector of ["img", "script", "svg", "a", "iframe"])
      expect(host.querySelector(selector)).toBeNull();
    expect(host.textContent).toBe(hostile);
  });
});
