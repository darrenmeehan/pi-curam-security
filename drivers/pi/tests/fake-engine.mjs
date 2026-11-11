#!/usr/bin/env node
// Fixture mem/1 engine for the driver tests. Modes: default | split | silent.
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "default";
const out = (value, chunks = 1) => {
  const line = JSON.stringify(value) + "\n";
  if (chunks <= 1) {
    process.stdout.write(line);
    return;
  }
  const cut = Math.floor(line.length / 2);
  process.stdout.write(line.slice(0, cut));
  setTimeout(() => process.stdout.write(line.slice(cut)), 20);
};

const scrub = (text) => {
  const hits = [];
  const manifest = new Map();
  const scrubbed = text.replace(/ghp_[A-Za-z0-9]+/g, () => {
    hits.push({ kind: "github_pat", fingerprint: "fixture123456" });
    manifest.set("github_pat", (manifest.get("github_pat") ?? 0) + 1);
    return "{REDACTED}:github_pat";
  });
  return {
    scrubbed,
    hits,
    manifest: [...manifest].map(([kind, count]) => ({ kind, count })),
    rules_version: "fixture-v1",
    rules_hash: "fixture-rules-hash",
    scrub_hash: "fixture-scrub-hash",
  };
};

const reply = (id, body) =>
  out({ id, v: "mem/1", ok: true, ...body }, mode === "split" ? 2 : 1);

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (mode === "silent") return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    out({ id: 0, v: "mem/1", ok: false, error: "bad json" });
    return;
  }
  if (request.v !== "mem/1") {
    out({ id: request.id ?? 0, v: "mem/1", ok: false, error: "bad envelope" });
    return;
  }
  switch (request.op) {
    case "mask":
      reply(request.id, scrub(String(request.payload?.text ?? "")));
      break;
    case "rules":
      reply(request.id, { rules_version: "fixture-v1", rules_hash: "fixture-rules-hash", classes: ["github_pat"] });
      break;
    case "status":
      reply(request.id, {
        rules_version: "fixture-v1",
        rules_hash: "fixture-rules-hash",
        classes: ["github_pat"],
        journal: "/tmp/fixture-journal.db",
        seal: "fixture-seal",
        engine: "mem/1",
      });
      break;
    case "log":
      reply(request.id, { seq: 1, seal: "fixture-seal" });
      break;
    case "audit":
      reply(request.id, { rows: [], seal: "fixture-seal" });
      break;
    default:
      out({ id: request.id ?? 0, v: "mem/1", ok: false, error: `unknown op ${request.op}` });
  }
});
