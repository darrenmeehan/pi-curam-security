import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import membrane from "./index.ts";

/**
 * A crashed engine must not disable the layer for the rest of the session, and
 * the footer must say `on` again once it is scrubbing again. Driven through the
 * real extension entry point, with a fixture engine that dies inside its first
 * mask request (tests/fake-engine.mjs, mode crash-once).
 */
describe("recovery after the engine dies", () => {
  test("degrades, respawns on the next tool result, and reports on again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "membrane-recovery-"));
    const wrapper = join(dir, "engine.sh");
    writeFileSync(
      wrapper,
      `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "tests", "fake-engine.mjs")} crash-once\n`,
    );
    chmodSync(wrapper, 0o755);
    process.env.MEMBRANE_ENGINE = wrapper;
    process.env.FIXTURE_CRASH_MARKER = join(dir, "crashed");

    const statuses: string[] = [];
    const notifications: string[] = [];
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
    const pi = {
      on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers[name] = handler;
      },
      registerCommand: () => undefined,
    };
    const ctx = {
      hasUI: true,
      cwd: dir,
      ui: {
        setStatus: (_key: string, value: string) => statuses.push(value),
        notify: (text: string) => notifications.push(text),
      },
      sessionManager: { getSessionId: () => "recovery-test" },
    };
    const block = { type: "text", text: "token ghp_abcdefghijklmnop" };
    const result = { toolName: "bash", content: [block] } as unknown as Parameters<
      (typeof handlers)[string]
    >[0];

    // biome-ignore lint/suspicious/noExplicitAny: the extension's hook surface is `pi.on`
    membrane(pi as any);

    await handlers.session_start({}, ctx);
    expect(statuses.at(-1)).toBe("membrane: on \u00b7 fixture-v1");

    // The engine exits inside this request: the result passes through, footer says so.
    await handlers.tool_result(result, ctx);
    expect(statuses.at(-1)).toBe("membrane: degraded (results pass through)");
    expect(notifications.join("\n")).toContain("NOT scrubbed");

    // Next one respawns the engine and scrubs, so the footer must say `on` again.
    const patch = (await handlers.tool_result(result, ctx)) as
      | { content?: { text?: string }[] }
      | undefined;
    expect(statuses.at(-1)).toBe("membrane: on \u00b7 fixture-v1");
    expect(patch?.content?.[0]?.text).toContain("{REDACTED}:github_pat");

    await handlers.session_shutdown({}, ctx);
    delete process.env.MEMBRANE_ENGINE;
    delete process.env.FIXTURE_CRASH_MARKER;
    rmSync(dir, { recursive: true, force: true });
  });
});
