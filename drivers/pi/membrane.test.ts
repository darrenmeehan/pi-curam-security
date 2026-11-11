import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { type EngineRef, MembraneClient, maskTextBlocks, resolveEngine } from "./membrane.ts";

const fakeEngine = join(import.meta.dir, "tests", "fake-engine.mjs");

const engine = (mode = "default"): EngineRef => ({
  command: process.execPath,
  args: [fakeEngine, mode],
  source: "env",
});

const client = (mode = "default", timeoutMs = 2000) =>
  new MembraneClient(engine(mode), { timeoutMs, spawnRetryDelayMs: 10 });

describe("resolveEngine", () => {
  test("env wins, then PATH, then the workspace build", () => {
    expect(resolveEngine({ MEMBRANE_ENGINE: "/opt/engine", PATH: "" }, "/home/x")).toEqual({
      command: "/opt/engine",
      source: "env",
    });

    const pathEnv = { PATH: "/usr/bin:/bin", MEMBRANE_ENGINE: "" };
    const fromPath = resolveEngine(pathEnv, "/home/x");
    // /usr/bin/curam-membrane is not installed in CI, so only assert the shape when found.
    if (fromPath) expect(fromPath.source).toBe("path");

    expect(resolveEngine({ PATH: "" }, "/home/nobody")).toBeUndefined();
  });
});

describe("MembraneClient", () => {
  test("mask round-trips the scrubbed text and fingerprints", async () => {
    const c = client();
    try {
      const reply = await c.mask("token ghp_abcdef123456 end");
      expect(reply.scrubbed).toBe("token {REDACTED}:github_pat end");
      expect(reply.hits).toEqual([{ kind: "github_pat", fingerprint: "fixture123456" }]);
      expect(reply.manifest).toEqual([{ kind: "github_pat", count: 1 }]);
    } finally {
      c.close();
    }
  });

  test("serializes concurrent requests", async () => {
    const c = client();
    try {
      const replies = await Promise.all([c.mask("ghp_one"), c.mask("ghp_two"), c.status()]);
      expect(replies[0].scrubbed).toBe("{REDACTED}:github_pat");
      expect(replies[1].scrubbed).toBe("{REDACTED}:github_pat");
      expect(replies[2].rules_version).toBe("fixture-v1");
    } finally {
      c.close();
    }
  });

  test("reassembles a reply split across chunks", async () => {
    const c = client("split");
    try {
      const reply = await c.mask("ghp_splitkey");
      expect(reply.scrubbed).toBe("{REDACTED}:github_pat");
    } finally {
      c.close();
    }
  });

  test("times out and rejects instead of hanging the turn", async () => {
    const c = client("silent", 150);
    try {
      await expect(c.mask("ghp_never")).rejects.toThrow(/timeout/);
    } finally {
      c.close();
    }
  });

  test("rejects when the engine cannot be spawned", async () => {
    const c = new MembraneClient(
      { command: join(import.meta.dir, "tests", "does-not-exist"), source: "env" },
      { timeoutMs: 500, spawnRetryDelayMs: 10 },
    );
    await expect(c.status()).rejects.toThrow(/cannot spawn engine/);
    c.close();
  });
});

describe("maskTextBlocks", () => {
  test("watermarks and rewrites a text block with hits", async () => {
    const c = client();
    try {
      const result = await maskTextBlocks(
        [
          { type: "text", text: "before ghp_abcdef123456 after", textSignature: "sig" },
          { type: "image", data: "base64", mimeType: "image/png" },
        ],
        (text) => c.mask(text),
      );

      expect(result.changed).toBe(true);
      expect(result.manifest).toEqual([{ kind: "github_pat", count: 1 }]);
      const text = result.content[0].text as string;
      expect(text).toContain("[membrane] 1 secret redacted (github_pat\u00d71)");
      expect(text).toContain("{REDACTED}:github_pat");
      expect(text).not.toContain("ghp_abcdef123456");
      expect(result.content[0].textSignature).toBeUndefined();
      expect(result.content[1]).toEqual({ type: "image", data: "base64", mimeType: "image/png" });
    } finally {
      c.close();
    }
  });

  test("leaves clean blocks untouched", async () => {
    const c = client();
    try {
      const clean = { type: "text", text: "nothing secret here", textSignature: "keep" };
      const result = await maskTextBlocks([clean], (text) => c.mask(text));
      expect(result.changed).toBe(false);
      expect(result.content[0]).toBe(clean);
      expect(result.content[0].textSignature).toBe("keep");
    } finally {
      c.close();
    }
  });
});
