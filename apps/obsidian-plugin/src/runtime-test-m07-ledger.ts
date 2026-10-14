export type M07MutationPhase =
  | "inactive"
  | "fixture-setup"
  | "exact-duplicate-blocked"
  | "combined-preview-approved"
  | "create-only-combined-note"
  | "inputs-unchanged"
  | "provider-not-called";

export interface M07MutationAttempt {
  surface: "vault" | "adapter";
  method: string;
  path: string;
  phase: M07MutationPhase;
  blocked: boolean;
}

export interface M07MutationLedger {
  entries(): readonly M07MutationAttempt[];
  setPhase(phase: M07MutationPhase): void;
  restore(): void;
}

type MutableSurface = Record<string, unknown>;

const METHODS = [
  "append",
  "appendBinary",
  "appendFile",
  "copy",
  "create",
  "createBinary",
  "createFolder",
  "delete",
  "mkdir",
  "modify",
  "modifyBinary",
  "process",
  "remove",
  "rename",
  "rm",
  "rmdir",
  "trash",
  "trashFile",
  "trashLocal",
  "trashSystem",
  "truncate",
  "unlink",
  "write",
  "writeBinary",
  "writeFile",
] as const;

function safePath(value: unknown): string {
  const path =
    typeof value === "string"
      ? value
      : typeof value === "object" &&
          value !== null &&
          "path" in value &&
          typeof value.path === "string"
        ? value.path
        : "[unknown-path]";
  return path.startsWith("/") || path.includes("..")
    ? "[unsafe-path-redacted]"
    : path;
}

/** Records all vault mutation surfaces and makes fixture inputs immutable. */
export function installM07MutationLedger(
  vaultValue: unknown,
  protectedPaths: readonly string[],
): M07MutationLedger {
  const vault = vaultValue as MutableSurface;
  const adapterValue = vault.adapter;
  if (typeof adapterValue !== "object" || adapterValue === null)
    throw new Error("M07 mutation ledger requires a vault adapter");
  const adapter = adapterValue as MutableSurface;
  const protectedSet = new Set(protectedPaths);
  const attempts: M07MutationAttempt[] = [];
  const restores: (() => void)[] = [];
  let phase: M07MutationPhase = "inactive";

  const wrap = (
    surfaceName: M07MutationAttempt["surface"],
    surface: MutableSurface,
    method: string,
  ): void => {
    const original = surface[method];
    if (typeof original !== "function") return;
    const callable = original as (...arguments_: unknown[]) => unknown;
    const descriptor = Object.getOwnPropertyDescriptor(surface, method);
    surface[method] = function (this: unknown, ...arguments_: unknown[]) {
      const path = safePath(arguments_[0]);
      const secondPath = safePath(arguments_[1]);
      const protectedInput =
        protectedSet.has(path) || protectedSet.has(secondPath);
      const blocked = protectedInput && phase !== "fixture-setup";
      if (phase !== "inactive")
        attempts.push({
          surface: surfaceName,
          method,
          path,
          phase,
          blocked,
        });
      if (blocked)
        return Promise.reject(
          new Error(
            `M07 protected input mutation prohibited: ${surfaceName}.${method}`,
          ),
        );
      return Reflect.apply(callable, this, arguments_);
    };
    restores.push(() => {
      if (descriptor === undefined) Reflect.deleteProperty(surface, method);
      else Object.defineProperty(surface, method, descriptor);
    });
  };

  for (const method of METHODS) wrap("vault", vault, method);
  for (const method of METHODS) wrap("adapter", adapter, method);

  let restored = false;
  return {
    entries: () => attempts.map((attempt) => ({ ...attempt })),
    setPhase: (next) => {
      phase = next;
    },
    restore: () => {
      if (restored) return;
      restored = true;
      for (const restore of restores.reverse()) restore();
    },
  };
}
