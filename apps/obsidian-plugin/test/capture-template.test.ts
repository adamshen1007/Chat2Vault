import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  parseCaptureSource,
  renderCaptureSource,
  validateCapture,
} from "@chat2vault/core";

const repositoryRoot = join(process.cwd(), "../..");
const workflowPath = join(repositoryRoot, "docs", "M08_CAPTURE_WORKFLOW.md");
const templatePath = join(
  repositoryRoot,
  "assets",
  "web-clipper",
  "chatgpt-capture.json",
);

describe("M08 capture companion qualification", () => {
  test("ships only the observed create-only selected-text template with a bounded ChatGPT trigger", () => {
    expect(existsSync(templatePath)).toBe(true);
    const template = JSON.parse(readFileSync(templatePath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(template).sort()).toEqual(
      [
        "schemaVersion",
        "name",
        "behavior",
        "noteContentFormat",
        "properties",
        "triggers",
        "noteNameFormat",
        "path",
      ].sort(),
    );
    expect(template.schemaVersion).toBe("0.1.0");
    expect(template.behavior).toBe("create");
    expect(template.properties).toEqual([]);
    expect(template.path).toBe("Chat2Vault-M08-Staging");
    expect(template.noteNameFormat).toContain("{{time|date:");
    expect(template.noteContentFormat).toBe(
      '---\nchat2vault_capture: 1\ncapture_method: "obsidian-web-clipper"\ncapture_scope: "visible-page-unverified"\nsource_provider: "chatgpt"\nsource_url: "{{url}}"\n---\n{{content}}',
    );
    const triggers = template.triggers as string[];
    expect(triggers).toHaveLength(1);
    const trigger = triggers[0];
    if (trigger === undefined) throw new Error("missing trigger");
    expect(trigger.startsWith("/") && trigger.endsWith("/")).toBe(true);
    const matcher = new RegExp(trigger.slice(1, -1));
    for (const url of [
      "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111",
      "https://chatgpt.com/c/6adc6a20-fcc4-83ea-b6cc-e30a911e719d",
    ])
      expect(matcher.test(url)).toBe(true);
    for (const url of [
      "https://example.com/",
      "https://chatgpt.com/",
      "https://chatgpt.com/c/not-a-uuid",
      "https://evil.chatgpt.com/c/11111111-1111-4111-8111-111111111111",
      "http://chatgpt.com/c/11111111-1111-4111-8111-111111111111",
    ])
      expect(matcher.test(url)).toBe(false);
    const workflow = readFileSync(workflowPath, "utf8");
    for (const required of [
      "Web Clipper route: SELECTED-TEXT ONLY / PARTIAL CAPTURE",
      "selected-text Web Clipper staging-to-source locally verified",
      "generic fallback template above Chat2Vault",
      "unselected extraction failed fidelity",
      "Preview ChatGPT capture",
      "ChatGPT capture text",
      "Paste ChatGPT capture",
      "Save capture source",
      "visible-page-unverified",
      "No provider-page URL will be preserved",
      "query and fragment",
      "existing-identical",
      "does not read the clipboard",
      "does not delete the staging note",
    ])
      expect(workflow).toContain(required);
    expect(workflow).not.toContain("Web Clipper route: COMPLETE-CONVERSATION");
    expect(workflow).not.toContain("only qualified M08 capture route");
  });

  test("the documented manual route produces a strict synthetic capture source", () => {
    const validated = validateCapture({
      method: "manual-paste",
      text: "Synthetic manual capture text only.",
    });
    if (!validated.ok) throw new Error(validated.code);
    const markdown = renderCaptureSource(validated.draft);
    const parsed = parseCaptureSource(
      new TextEncoder().encode(markdown),
      "Sources/Synthetic capture.md",
    );
    expect(parsed).toMatchObject({
      ok: true,
      entry: {
        method: "manual-paste",
        scope: "visible-page-unverified",
      },
    });
    expect(markdown).toContain('type: "ai-conversation-web-capture"');
    expect(markdown).not.toContain("source_url:");
    expect(markdown).not.toContain("mapping:");
    expect(markdown).not.toContain("current_node:");
  });
});
