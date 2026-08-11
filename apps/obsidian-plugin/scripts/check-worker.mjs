import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";
import { Worker } from "node:worker_threads";

const root = new URL("..", import.meta.url).pathname;
const fixture = readFileSync(join(root, "../../fixtures/chatgpt/minimal.json"));
const worker = new Worker(join(root, "worker.js"));
const timeout = setTimeout(() => {
  void worker.terminate();
  process.stderr.write("Worker smoke timed out.\n");
  process.exitCode = 1;
}, 5000);

worker.once("error", (error) => {
  clearTimeout(timeout);
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
worker.once("message", (reply) => {
  clearTimeout(timeout);
  void worker.terminate();
  if (reply?.ok !== true || reply.result?.conversations?.length !== 1) {
    process.stderr.write("Worker smoke returned an invalid result.\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(
      "Bundled worker smoke passed (1 synthetic conversation).\n",
    );
  }
});
worker.postMessage([
  { fileName: "minimal.json", data: new Uint8Array(fixture) },
]);
