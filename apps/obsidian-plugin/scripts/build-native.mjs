import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(root);
const modules = [
  {
    source: join(pluginRoot, "native", "source_observer.cc"),
    output: join(pluginRoot, "native", "source_observer.node"),
    frameworks: [],
    label: "source observer",
  },
  {
    source: join(pluginRoot, "native", "keychain.cc"),
    output: join(pluginRoot, "native", "keychain.node"),
    frameworks: ["Security", "CoreFoundation"],
    label: "Keychain module",
  },
];

if (process.platform === "darwin" && process.arch === "x64") {
  const include = join(dirname(dirname(process.execPath)), "include", "node");
  if (!existsSync(join(include, "node_api.h")))
    throw new Error("Node N-API headers are unavailable.");
  for (const module of modules) {
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
        module.output,
        module.source,
        ...module.frameworks.flatMap((framework) => ["-framework", framework]),
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0)
      throw new Error(`The macOS ${module.label} failed to build.`);
  }
} else {
  throw new Error("M03.1 source writing supports only macOS x86_64.");
}
