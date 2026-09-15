/* global URL */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function normalizedInput(pluginRoot, input) {
  return relative(pluginRoot, resolve(pluginRoot, input)).replaceAll("\\", "/");
}

function inputInventory(record) {
  return new Map(
    Object.keys(record.metafile.inputs).map((input) => {
      const normalized = normalizedInput(record.pluginRoot, input);
      return [
        normalized,
        {
          bytes: readFileSync(resolve(record.pluginRoot, input)).length,
          sha256: sha256(readFileSync(resolve(record.pluginRoot, input))),
        },
      ];
    }),
  );
}

function contribution(record, suffix) {
  const output = Object.values(record.metafile.outputs)[0];
  const match = Object.entries(output.inputs).find(([input]) =>
    normalizedInput(record.pluginRoot, input).endsWith(suffix),
  );
  return match?.[1]?.bytesInOutput;
}

export function compareM05RuntimeArtifacts(production, runtime) {
  const failures = [];
  if (
    JSON.stringify(production.buildOptions) !==
    JSON.stringify(runtime.buildOptions)
  )
    failures.push("build option mismatch");
  const productionInputs = inputInventory(production);
  const runtimeInputs = inputInventory(runtime);
  const allowedRuntimeOnly = new Set([
    "src/runtime-test-entry.ts",
    "src/runtime-test-network-seam.ts",
    "src/runtime-test-keychain.ts",
  ]);
  for (const [input, identity] of productionInputs) {
    const runtimeIdentity = runtimeInputs.get(input);
    if (runtimeIdentity === undefined)
      failures.push(`runtime graph omitted shared input ${input}`);
    else if (
      runtimeIdentity.bytes !== identity.bytes ||
      runtimeIdentity.sha256 !== identity.sha256
    )
      failures.push(`shared input identity mismatch ${input}`);
  }
  for (const input of runtimeInputs.keys())
    if (!productionInputs.has(input) && !allowedRuntimeOnly.has(input))
      failures.push(`unexpected runtime-only input ${input}`);
  for (const input of allowedRuntimeOnly)
    if (!runtimeInputs.has(input))
      failures.push(`missing runtime-only input ${input}`);
  if (!runtimeInputs.has("src/main.ts"))
    failures.push("runtime graph omitted source production composition");
  if (runtimeInputs.has("main.js"))
    failures.push("runtime graph imported generated production artifact");

  const transportSuffix = "src/provider-transport.ts";
  const sourceIdentity = productionInputs.get(transportSuffix);
  if (
    sourceIdentity === undefined ||
    JSON.stringify(sourceIdentity) !==
      JSON.stringify(runtimeInputs.get(transportSuffix))
  )
    failures.push("production transport source identity mismatch");
  const productionContribution = contribution(production, transportSuffix);
  const runtimeContribution = contribution(runtime, transportSuffix);
  if (
    productionContribution === undefined ||
    runtimeContribution === undefined ||
    productionContribution !== runtimeContribution
  )
    failures.push(
      `production transport output contribution mismatch (${String(productionContribution)} != ${String(runtimeContribution)})`,
    );
  return {
    ok: failures.length === 0,
    failures,
    sharedInputCount: productionInputs.size,
    runtimeOnlyInputs: [...allowedRuntimeOnly],
    providerTransport: {
      ...sourceIdentity,
      bytesInOutput: productionContribution,
    },
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [productionPath, runtimePath] = process.argv.slice(2);
  if (productionPath === undefined || runtimePath === undefined)
    throw new Error(
      "usage: compare-m05-runtime-artifact.mjs PRODUCTION_JSON RUNTIME_JSON",
    );
  const result = compareM05RuntimeArtifacts(
    JSON.parse(readFileSync(productionPath, "utf8")),
    JSON.parse(readFileSync(runtimePath, "utf8")),
  );
  if (!result.ok) {
    process.stderr.write(`${result.failures.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `M05 runtime artifact comparison passed (${String(result.sharedInputCount)} shared inputs; transport=${result.providerTransport.sha256}/${String(result.providerTransport.bytesInOutput)} output bytes).\n`,
    );
  }
}
