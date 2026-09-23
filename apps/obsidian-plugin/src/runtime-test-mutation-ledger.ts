export type M06MutationSurface = "vault" | "adapter";
export type M06MutationPhase =
  | "inactive"
  | "production"
  | "fixture"
  | "fixture-setup"
  | "review-accept-edit-reject"
  | "multi-select-dry-run"
  | "stale-preview-disabled"
  | "verified-create"
  | "idempotent-retry-no-op"
  | "conflict-fixture"
  | "conflict-refusal"
  | "source-backlink"
  | "source-note-unchanged"
  | "provider-not-called";

export interface M06MutationAttempt {
  surface: M06MutationSurface;
  method: string;
  path: string;
  phase: M06MutationPhase;
  blocked: boolean;
}

export interface M06MutationLedger {
  entries(): readonly M06MutationAttempt[];
  setPhase(phase: M06MutationPhase): void;
  restore(): void;
}

type MutableSurface = Record<string, unknown>;

export const M06_MUTATION_METHODS = [
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

function attemptPath(value: unknown): string {
  const candidate =
    typeof value === "string"
      ? value
      : typeof value === "object" &&
          value !== null &&
          "path" in value &&
          typeof value.path === "string"
        ? value.path
        : "[unknown-path]";
  return candidate.startsWith("/") || candidate.includes("..")
    ? "[unsafe-path-redacted]"
    : candidate;
}

export function installM06MutationLedger(
  vaultValue: unknown,
  sourcePath: string,
  initialPhase: M06MutationPhase = "production",
): M06MutationLedger {
  const vault = vaultValue as MutableSurface;
  const adapterValue = vault.adapter;
  if (typeof adapterValue !== "object" || adapterValue === null)
    throw new Error("M06 mutation ledger requires a vault adapter");
  const adapter = adapterValue as MutableSurface;
  const attempts: M06MutationAttempt[] = [];
  const restores: (() => void)[] = [];
  let phase = initialPhase;

  const wrap = (
    surfaceName: M06MutationSurface,
    surface: MutableSurface,
    method: string,
  ): void => {
    const original = surface[method];
    if (typeof original !== "function") return;
    const callable = original as (...arguments_: unknown[]) => unknown;
    const own = Object.getOwnPropertyDescriptor(surface, method);
    const wrapped = function (this: unknown, ...arguments_: unknown[]) {
      const path = attemptPath(arguments_[0]);
      const targetPath = attemptPath(arguments_[1]);
      const sourceMutation = path === sourcePath || targetPath === sourcePath;
      const allowedFixtureSourceCreate =
        phase === "fixture-setup" &&
        ((surfaceName === "vault" && method === "create") ||
          (surfaceName === "adapter" && method === "write")) &&
        path === sourcePath &&
        targetPath !== sourcePath;
      const blocked = sourceMutation && !allowedFixtureSourceCreate;
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
          new Error(`M06 source mutation prohibited: ${surfaceName}.${method}`),
        );
      return Reflect.apply(callable, this, arguments_);
    };
    surface[method] = wrapped;
    restores.push(() => {
      if (own === undefined) Reflect.deleteProperty(surface, method);
      else Object.defineProperty(surface, method, own);
    });
  };

  for (const method of M06_MUTATION_METHODS) wrap("vault", vault, method);
  for (const method of M06_MUTATION_METHODS) wrap("adapter", adapter, method);

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
