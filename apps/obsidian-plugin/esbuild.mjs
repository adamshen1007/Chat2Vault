import { readFile } from "node:fs/promises";

import esbuild from "esbuild";

const common = {
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  target: "node20",
  minify: true,
  sourcemap: false,
  outdir: ".",
  entryNames: "[name]",
  logLevel: "info",
  metafile: true,
};

const workerResult = await esbuild.build({
  ...common,
  entryPoints: { worker: "src/worker.ts" },
});
const workerSource = await readFile("worker.js", "utf8");
const mainResult = await esbuild.build({
  ...common,
  entryPoints: { main: "src/main.ts" },
  define: { __C2V_WORKER_SOURCE__: JSON.stringify(workerSource) },
});

for (const result of [workerResult, mainResult])
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports) {
      if (
        imported.external &&
        imported.path !== "obsidian" &&
        !imported.path.startsWith("node:")
      )
        throw new Error(`Unexpected external dependency: ${imported.path}`);
    }
  }
