import { normalizeSourceRoot } from "@chat2vault/core";

export type PreviewMessagesPerPage = 10 | 25 | 50;

export interface Chat2VaultSettingsV1 {
  schemaVersion: 1;
  previewMessagesPerPage: PreviewMessagesPerPage;
}

export interface Chat2VaultSettingsV2 {
  schemaVersion: 2;
  previewMessagesPerPage: PreviewMessagesPerPage;
  sourceRoot: string;
}

export const DEFAULT_SETTINGS: Chat2VaultSettingsV2 = {
  schemaVersion: 2,
  previewMessagesPerPage: 25,
  sourceRoot: "",
};

export type SettingsLoadDiagnosticCode =
  | "INVALID_PERSISTED_SOURCE_ROOT"
  | "INVALID_PERSISTED_SETTINGS"
  | "UNSUPPORTED_SETTINGS_SCHEMA";

export interface SettingsLoadDiagnostic {
  code: SettingsLoadDiagnosticCode;
  severity: "warning";
  message: string;
}

export interface SettingsLoadResult {
  settings: Chat2VaultSettingsV2;
  diagnostics: SettingsLoadDiagnostic[];
}

export type SettingsSaveResult =
  | { status: "saved" }
  | { status: "unchanged" }
  | {
      status: "in-progress";
      message: "A Chat2Vault setting is already being saved.";
    }
  | {
      status: "invalid";
      message:
        "The preview setting is invalid." | "The source folder is invalid.";
    }
  | {
      status: "failed";
      message:
        | "The preview setting could not be saved."
        | "The source folder setting could not be saved.";
    };

export type SourceRootPersistenceState =
  | { status: "settled" }
  | { status: "pending"; previousRoot: string; proposedRoot: string };

const MESSAGES: Record<SettingsLoadDiagnosticCode, string> = {
  INVALID_PERSISTED_SOURCE_ROOT:
    "The saved source folder is invalid and was disabled in memory.",
  INVALID_PERSISTED_SETTINGS:
    "The saved Chat2Vault settings are invalid; safe defaults were loaded in memory.",
  UNSUPPORTED_SETTINGS_SCHEMA:
    "The saved Chat2Vault settings schema is unsupported; safe defaults were loaded in memory.",
};

function diagnostic(code: SettingsLoadDiagnosticCode): SettingsLoadDiagnostic {
  return { code, severity: "warning", message: MESSAGES[code] };
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return ownJsonObject(value);
}

function ownJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(isJsonValue);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function validPage(value: unknown): value is PreviewMessagesPerPage {
  return value === 10 || value === 25 || value === 50;
}

export function readSettings(value: unknown): SettingsLoadResult {
  if (value === undefined || value === null)
    return { settings: DEFAULT_SETTINGS, diagnostics: [] };
  if (!ownJsonObject(value))
    return {
      settings: DEFAULT_SETTINGS,
      diagnostics: [diagnostic("INVALID_PERSISTED_SETTINGS")],
    };
  const schema = value.schemaVersion;
  if (typeof schema === "number" && Number.isSafeInteger(schema) && schema >= 3)
    return {
      settings: DEFAULT_SETTINGS,
      diagnostics: [diagnostic("UNSUPPORTED_SETTINGS_SCHEMA")],
    };
  if (
    schema === 1 &&
    exactKeys(value, ["schemaVersion", "previewMessagesPerPage"]) &&
    validPage(value.previewMessagesPerPage)
  )
    return {
      settings: {
        schemaVersion: 2,
        previewMessagesPerPage: value.previewMessagesPerPage,
        sourceRoot: "",
      },
      diagnostics: [],
    };
  if (
    schema === 2 &&
    exactKeys(value, [
      "schemaVersion",
      "previewMessagesPerPage",
      "sourceRoot",
    ]) &&
    validPage(value.previewMessagesPerPage) &&
    typeof value.sourceRoot === "string"
  ) {
    const normalized = normalizeSourceRoot(value.sourceRoot);
    if (normalized.status === "configured")
      return {
        settings: {
          schemaVersion: 2,
          previewMessagesPerPage: value.previewMessagesPerPage,
          sourceRoot: normalized.sourceRoot,
        },
        diagnostics: [],
      };
    if (normalized.status === "unconfigured")
      return {
        settings: {
          schemaVersion: 2,
          previewMessagesPerPage: value.previewMessagesPerPage,
          sourceRoot: "",
        },
        diagnostics: [],
      };
    return {
      settings: {
        schemaVersion: 2,
        previewMessagesPerPage: value.previewMessagesPerPage,
        sourceRoot: "",
      },
      diagnostics: [diagnostic("INVALID_PERSISTED_SOURCE_ROOT")],
    };
  }
  return {
    settings: DEFAULT_SETTINGS,
    diagnostics: [diagnostic("INVALID_PERSISTED_SETTINGS")],
  };
}

function settingsEqual(left: object, right: object): boolean {
  return (
    Reflect.get(left, "schemaVersion") ===
      Reflect.get(right, "schemaVersion") &&
    Reflect.get(left, "previewMessagesPerPage") ===
      Reflect.get(right, "previewMessagesPerPage") &&
    Reflect.get(left, "sourceRoot") === Reflect.get(right, "sourceRoot")
  );
}

export class SettingsController {
  private saving = false;
  public sourceWriteGeneration = 0;
  public sourceRootPersistenceState: SourceRootPersistenceState = {
    status: "settled",
  };

  public constructor(
    public settings: Chat2VaultSettingsV2,
    private readonly persist: (settings: Chat2VaultSettingsV2) => Promise<void>,
    private readonly invalidateSourceState: () => void,
  ) {}

  public get isSaving(): boolean {
    return this.saving;
  }

  private tryAcquire(): boolean {
    if (this.saving) return false;
    this.saving = true;
    return true;
  }

  private inProgress(): SettingsSaveResult {
    return {
      status: "in-progress",
      message: "A Chat2Vault setting is already being saved.",
    };
  }

  public async savePreviewMessagesPerPage(
    value: unknown,
  ): Promise<SettingsSaveResult> {
    if (!this.tryAcquire()) return this.inProgress();
    try {
      if (!validPage(value))
        return {
          status: "invalid",
          message: "The preview setting is invalid.",
        };
      const previous = this.settings;
      const next: Chat2VaultSettingsV2 = {
        ...previous,
        previewMessagesPerPage: value,
      };
      if (settingsEqual(previous, next)) return { status: "unchanged" };
      this.settings = next;
      try {
        await this.persist(next);
        return { status: "saved" };
      } catch {
        this.settings = previous;
        return {
          status: "failed",
          message: "The preview setting could not be saved.",
        };
      }
    } finally {
      this.saving = false;
    }
  }

  public async saveSourceRoot(value: unknown): Promise<SettingsSaveResult> {
    if (!this.tryAcquire()) return this.inProgress();
    try {
      const normalized = normalizeSourceRoot(value);
      if (normalized.status === "invalid")
        return { status: "invalid", message: "The source folder is invalid." };
      const root =
        normalized.status === "configured" ? normalized.sourceRoot : "";
      const previous = this.settings;
      const next: Chat2VaultSettingsV2 = { ...previous, sourceRoot: root };
      if (settingsEqual(previous, next)) return { status: "unchanged" };
      this.sourceWriteGeneration += 1;
      this.invalidateSourceState();
      this.sourceRootPersistenceState = {
        status: "pending",
        previousRoot: previous.sourceRoot,
        proposedRoot: root,
      };
      try {
        await this.persist(next);
        this.settings = next;
        return { status: "saved" };
      } catch {
        return {
          status: "failed",
          message: "The source folder setting could not be saved.",
        };
      } finally {
        this.sourceRootPersistenceState = { status: "settled" };
      }
    } finally {
      this.saving = false;
    }
  }
}
