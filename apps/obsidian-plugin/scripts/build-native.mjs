import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(root);
const source = join(pluginRoot, "native", "source_observer.cc");
const output = join(pluginRoot, "native", "source_observer.node");

if (process.platform === "darwin" && process.arch === "x64") {
  const include = join(dirname(dirname(process.execPath)), "include", "node");
  if (!existsSync(join(include, "node_api.h")))
    throw new Error("Node N-API headers are unavailable.");
  const result = spawnSync(
    "xcrun",
    [
      "clang++",
      "-std=c++17",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      `-I${include}`,
      "-o",
      output,
      source,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0)
    throw new Error("The macOS source observer failed to build.");
} else {
  throw new Error("M03.1 source writing supports only macOS x86_64.");
}
