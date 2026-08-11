import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, readSettings } from "../src/settings-model.js";

describe("settings", () => {
  it("accepts only the exact versioned page-size contract", () => {
    expect(
      readSettings({ schemaVersion: 1, previewMessagesPerPage: 10 }),
    ).toEqual({
      schemaVersion: 1,
      previewMessagesPerPage: 10,
    });
    expect(
      readSettings({ schemaVersion: 2, previewMessagesPerPage: 10 }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(
      readSettings({ schemaVersion: 1, previewMessagesPerPage: 20 }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(
      readSettings({
        schemaVersion: 1,
        previewMessagesPerPage: 25,
        importedData: "private",
      }),
    ).toEqual({
      schemaVersion: 1,
      previewMessagesPerPage: 25,
    });
  });
});
