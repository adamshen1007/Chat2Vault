export type M06MutationSurface = "vault" | "adapter";
export type M06MutationPhase = "production" | "fixture";

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

const VAULT_MUTATIONS = Object.freeze([
  "create",
  "createBinary",
  "createFolder",
  "write",
  "writeBinary",
  "append",
  "process",
  "modify",
  "modifyBinary",
  "delete",
  "remove",
  "rename",
  "copy",
  "trash",
  "trashFile",
  "mkdir",
  "rmdir",
] as const);

const ADAPTER_MUTATIONS = Object.freeze([
  "write",
  "writeBinary",
  "append",
  "process",
  "modify",
  "modifyBinary",
  "delete",
  "remove",
  "rename",
  "copy",
  "trash",
  "trashFile",
  "mkdir",
  "rmdir",
  "create",
  "createBinary",
  "createFolder",
] as const);

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
): M06MutationLedger {
  const vault = vaultValue as MutableSurface;
  const adapterValue = vault.adapter;
  if (typeof adapterValue !== "object" || adapterValue === null)
    throw new Error("M06 mutation ledger requires a vault adapter");
  const adapter = adapterValue as MutableSurface;
  const attempts: M06MutationAttempt[] = [];
  const restores: (() => void)[] = [];
  let phase: M06MutationPhase = "production";

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
      const blocked = path === sourcePath || targetPath === sourcePath;
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

  for (const method of VAULT_MUTATIONS) wrap("vault", vault, method);
  for (const method of ADAPTER_MUTATIONS) wrap("adapter", adapter, method);

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
