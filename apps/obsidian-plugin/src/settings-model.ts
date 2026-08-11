export interface Chat2VaultSettingsV1 {
  schemaVersion: 1;
  previewMessagesPerPage: 10 | 25 | 50;
}

export const DEFAULT_SETTINGS: Chat2VaultSettingsV1 = {
  schemaVersion: 1,
  previewMessagesPerPage: 25,
};

export function readSettings(value: unknown): Chat2VaultSettingsV1 {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const page = record.previewMessagesPerPage;
    if (
      record.schemaVersion === 1 &&
      (page === 10 || page === 25 || page === 50)
    )
      return { schemaVersion: 1, previewMessagesPerPage: page };
  }
  return DEFAULT_SETTINGS;
}
