/**
 * Crash probe: SIGKILL the engine mid-session and prove the driver recovers.
 *
 * Two behaviours matter and they are different: the client respawns on the next
 * request, and the extension keeps the client instead of dropping it (dropping it
 * used to disable scrubbing until the next session). The footer transition is
 * covered by drivers/pi/index.test.ts; this one exercises the real engine binary.
 */
import { readFileSync } from "node:fs";

import { MembraneClient, resolveEngine } from "../membrane.ts";

const engine = resolveEngine();
if (!engine) {
  console.log("SKIP: no engine (set MEMBRANE_ENGINE or put curam-membrane on PATH)");
  process.exit(0);
}

const children = (pid: number): number[] => {
  try {
    return readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
};

const client = new MembraneClient(engine);
await client.status();
const pids = children(process.pid);
if (!pids.length) {
  console.log("SKIP: no engine child process found (non-Linux /proc layout)");
  process.exit(0);
}
for (const pid of pids) process.kill(pid, "SIGKILL");

const failed = await client.status().then(
  () => false,
  () => true,
);
const recovered = await client.status().then(
  () => true,
  () => false,
);
client.close();

if (!failed) {
  console.error("FAIL: the request in flight when the engine died did not fail — is the probe killing the right process?");
  process.exit(1);
}
if (!recovered) {
  console.error("FAIL: the engine was not respawned after a crash; scrubbing stays off for the session");
  process.exit(1);
}
console.log(`PASS: one request lost, engine respawned (source=${engine.source})`);
