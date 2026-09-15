import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe.runIf(process.platform === "darwin" && process.arch === "x64")(
  "M05 Darwin native Keychain lifecycle",
  () => {
    function security(args: string[]): string {
      const result = spawnSync("security", args, { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    }

    function userSearchList(): string[] {
      return [
        ...security(["list-keychains", "-d", "user"]).matchAll(/"([^"]+)"/gu),
      ].flatMap((match) => (typeof match[1] === "string" ? [match[1]] : []));
    }

    test("pins every operation to the resolved default file-based Keychain", () => {
      const source = readFileSync(
        join(process.cwd(), "native", "keychain.cc"),
        "utf8",
      );
      expect(source).toContain("SecKeychainCopyDefault");
      expect(source).toContain("kSecMatchSearchList");
      expect(source).toContain("kSecUseKeychain");
      expect(source).not.toContain("kSecUseDataProtectionKeychain");
      expect(source).not.toContain("kSecAttrAccessible");
      expect(source).not.toContain("kSecAttrSynchronizable");
      expect(source).not.toContain("kSecAttrAccessGroup");
      expect(source).not.toContain("SecKeychainOpen");
      expect(source).not.toContain("SecKeychainSetDefault");
      expect(source).not.toContain("SecKeychainSetSearchList");
    });

    test("creates, replaces, reads, deletes, and verifies a unique inert synthetic credential", () => {
      const lifecycle = `
        import { createRequire } from "node:module";
        import { join } from "node:path";
        import { randomUUID } from "node:crypto";
        const native = createRequire(import.meta.url)(join(process.cwd(), "native", "keychain.node"));
        const service = "com.chat2vault.obsidian.openai-compatible";
        const account = "runtime-test/" + randomUUID();
        const first = "synthetic-task4-first";
        const replacement = "synthetic-task4-replaced";
        const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
        try {
          if (!exact(native.credentialStatus(service, account), { tag: "missing" })) throw new Error("initial status");
          if (!exact(native.setCredential(service, account, first), { tag: "success", state: "configured", effect: "created" })) throw new Error("create");
          if (!exact(native.readCredential(service, account), { tag: "configured", secret: first })) throw new Error("read");
          if (!exact(native.setCredential(service, account, replacement), { tag: "success", state: "configured", effect: "replaced" })) throw new Error("replace");
          if (!exact(native.deleteCredential(service, account), { tag: "success", state: "missing", effect: "deleted" })) throw new Error("delete");
          if (!exact(native.credentialStatus(service, account), { tag: "missing" })) throw new Error("verified absence");
        } finally {
          native.deleteCredential(service, account);
          if (!exact(native.credentialStatus(service, account), { tag: "missing" })) throw new Error("cleanup absence");
        }
        process.stdout.write(JSON.stringify({ lifecycle: "ok", cleanup: "missing" }));
      `;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", lifecycle],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        lifecycle: "ok",
        cleanup: "missing",
      });
    });

    test("ignores an exact service/account collision in a secondary search-list Keychain", () => {
      const native = createRequire(import.meta.url)(
        join(process.cwd(), "native", "keychain.node"),
      ) as {
        credentialStatus(service: string, account: string): unknown;
        readCredential(service: string, account: string): unknown;
        setCredential(
          service: string,
          account: string,
          secret: string,
        ): unknown;
        deleteCredential(service: string, account: string): unknown;
      };
      const service = "com.chat2vault.obsidian.openai-compatible";
      const account = `runtime-test/${randomUUID()}`;
      const primarySecret = "synthetic-task4-primary";
      const secondarySecret = "synthetic-task4-secondary";
      const keychainPassword = "synthetic-task4-keychain-password";
      const directory = mkdtempSync(join(tmpdir(), "chat2vault-m05-keychain-"));
      const secondaryKeychain = join(directory, "secondary.keychain-db");
      const originalSearchList = userSearchList();
      let keychainCreated = false;
      let searchListChanged = false;
      try {
        security([
          "create-keychain",
          "-p",
          keychainPassword,
          secondaryKeychain,
        ]);
        keychainCreated = true;
        security([
          "unlock-keychain",
          "-p",
          keychainPassword,
          secondaryKeychain,
        ]);
        security([
          "add-generic-password",
          "-a",
          account,
          "-s",
          service,
          "-w",
          secondarySecret,
          secondaryKeychain,
        ]);
        security([
          "list-keychains",
          "-d",
          "user",
          "-s",
          ...originalSearchList,
          secondaryKeychain,
        ]);
        searchListChanged = true;

        expect(native.credentialStatus(service, account)).toEqual({
          tag: "missing",
        });
        expect(native.setCredential(service, account, primarySecret)).toEqual({
          tag: "success",
          state: "configured",
          effect: "created",
        });
        expect(native.readCredential(service, account)).toEqual({
          tag: "configured",
          secret: primarySecret,
        });
        expect(native.setCredential(service, account, primarySecret)).toEqual({
          tag: "success",
          state: "configured",
          effect: "replaced",
        });
        expect(native.deleteCredential(service, account)).toEqual({
          tag: "success",
          state: "missing",
          effect: "deleted",
        });
        expect(native.credentialStatus(service, account)).toEqual({
          tag: "missing",
        });
        expect(
          security([
            "find-generic-password",
            "-a",
            account,
            "-s",
            service,
            "-w",
            secondaryKeychain,
          ]).trim(),
        ).toBe(secondarySecret);
      } finally {
        expect(native.deleteCredential(service, account)).toMatchObject({
          tag: "success",
          state: "missing",
        });
        expect(native.credentialStatus(service, account)).toEqual({
          tag: "missing",
        });
        try {
          if (searchListChanged)
            security([
              "list-keychains",
              "-d",
              "user",
              "-s",
              ...originalSearchList,
            ]);
          expect(userSearchList()).toEqual(originalSearchList);
        } finally {
          try {
            if (keychainCreated)
              security(["delete-keychain", secondaryKeychain]);
            expect(existsSync(secondaryKeychain)).toBe(false);
          } finally {
            rmSync(directory, { recursive: true, force: true });
            expect(existsSync(directory)).toBe(false);
          }
        }
      }
    });
  },
);
