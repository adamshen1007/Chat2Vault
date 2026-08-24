import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preview performance styles", () => {
  it("contains offscreen conversation-row rendering without reducing the 200-row DOM bound", () => {
    const styles = readFileSync(
      new URL("../styles.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(
      /\.c2v-row\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 2\.5rem;/s,
    );
  });

  it("stacks by leaf container width and lets controls shrink at 200% zoom", () => {
    const styles = readFileSync(
      new URL("../styles.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(
      /\.c2v-preview\s*\{[^}]*container-type:\s*inline-size;/s,
    );
    expect(styles).toMatch(/@container\s*\(max-width:\s*480px\)/);
    expect(styles).toMatch(
      /\.c2v-toolbar input\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s,
    );
    expect(styles).toMatch(
      /\.c2v-source pre\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s,
    );
  });
});
