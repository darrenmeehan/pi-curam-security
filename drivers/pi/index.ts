/**
 * curam-membrane pi driver — a dumb pipe from pi's tool results to the
 * mem/1 engine, plus /membrane commands.
 *
 * No detection logic and no journal access live here: the engine owns both.
 * If the engine is missing or unreachable the driver degrades (tool results
 * pass through untouched) and the footer says so.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { type ContentBlock, MembraneClient, maskTextBlocks, resolveEngine } from "./membrane.ts";

const STATUS_KEY = "membrane";
const HARNESS = "pi";

export default function membrane(pi: ExtensionAPI) {
  let client: MembraneClient | undefined;
  let warned = false;
  let rulesVersion = "";
  let state: "off" | "on" | "degraded" = "off";

  const setStatus = (ctx: ExtensionContext | ExtensionCommandContext, text: string) => {
    if (!ctx.hasUI) return;
    try {
      ctx.ui.setStatus(STATUS_KEY, text);
    } catch {
      // status is best-effort
    }
  };

  const notify = (ctx: ExtensionContext | ExtensionCommandContext, text: string, kind: "info" | "warning" = "info") => {
    try {
      ctx.ui.notify(text, kind);
    } catch {
      // notify is best-effort
    }
  };

  const sessionId = (ctx: ExtensionContext | ExtensionCommandContext): string => {
    try {
      return ctx.sessionManager.getSessionId();
    } catch {
      return "unknown";
    }
  };

  /**
   * The engine answered, so the layer is scrubbing again. A degraded session is
   * not terminal: the client keeps its engine handle and respawns it on the next
   * request, so the footer has to come back to `on` — otherwise a recovered
   * session looks broken for the rest of its life. The client is deliberately NOT
   * dropped on failure; dropping it was what made one crash disable the layer
   * until the next session.
   */
  const healthy = (ctx: ExtensionContext | ExtensionCommandContext, version?: string) => {
    if (version) rulesVersion = version;
    warned = false;
    if (state === "on") return;
    state = "on";
    setStatus(ctx, `membrane: on \u00b7 ${rulesVersion}`);
  };

  const degraded = (ctx: ExtensionContext, reason: string) => {
    state = "degraded";
    setStatus(ctx, "membrane: degraded (results pass through)");
    if (!warned) {
      warned = true;
      notify(ctx, `membrane degraded: ${reason}. Tool results are NOT scrubbed.`, "warning");
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const engine = resolveEngine();
    if (!engine) {
      state = "off";
      setStatus(ctx, "membrane: off (no engine found)");
      return;
    }

    client = new MembraneClient(engine);
    try {
      const status = await client.status();
      healthy(ctx, status.rules_version);
    } catch (error) {
      degraded(ctx, `engine ${engine.command} (${engine.source}) unreachable: ${String(error)}`);
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    const active = client;
    if (!active) return;

    const content = event.content as unknown as ContentBlock[] | undefined;
    if (!Array.isArray(content) || !content.some((block) => block.type === "text")) return;

    try {
      const masked = await maskTextBlocks(content, (text) => active.mask(text));
      // Any answer proves the engine is alive again, with or without hits.
      healthy(ctx, masked.rules?.rules_version);
      if (!masked.changed) return;

      const rules = masked.rules;
      try {
        await active.log({
          session_id: sessionId(ctx),
          harness: HARNESS,
          etype: "pii_scrubbed",
          payload: {
            tool: event.toolName,
            manifest: masked.manifest,
            fingerprints: masked.hits,
            rules_hash: rules?.rules_hash,
            rules_version: rules?.rules_version,
            scrub_hash: rules?.scrub_hash,
          },
        });
      } catch {
        // A journal miss must not break the tool result.
      }

      const patch: Record<string, unknown> = { content: masked.content };
      if ("details" in event) patch.details = event.details;
      if ("structuredContent" in event) patch.structuredContent = event.structuredContent;
      return patch;
    } catch (error) {
      degraded(ctx, String(error));
    }
  });

  pi.on("session_shutdown", async () => {
    client?.close();
    client = undefined;
  });

  pi.registerCommand("membrane", {
    description: "curam membrane: status, audit [--jsonl], rules",
    handler: async (args, ctx) => {
      const [sub, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const command = sub || "status";
      const engine = resolveEngine();

      if (!client) {
        const where = engine ? `${engine.command} (${engine.source})` : "not found";
        notify(ctx, `membrane: off \u2014 engine ${where}\nBuild it with: cargo build -p curam-membrane (in ~/code/curam-security)`, "warning");
        return;
      }

      try {
        if (command === "status") {
          const status = await client.status();
          const where = engine ? `${engine.command} (${engine.source})` : "unknown";
          healthy(ctx, status.rules_version);
          notify(
            ctx,
            [
              `membrane ${status.engine} \u00b7 ${status.rules_version}`,
              `engine: ${where}`,
              `rules: ${status.rules_hash}`,
              `classes: ${status.classes.join(", ")}`,
              `journal: ${status.journal} (seal ${status.seal})`,
              `session: ${sessionId(ctx)}`,
            ].join("\n"),
          );
          return;
        }

        if (command === "rules") {
          const rules = await client.rules();
          notify(
            ctx,
            [`rules: ${rules.rules_version}`, `hash: ${rules.rules_hash}`, `classes: ${rules.classes.join(", ")}`].join("\n"),
          );
          return;
        }

        if (command === "audit") {
          const sid = sessionId(ctx);
          const audit = await client.audit(sid);
          const jsonl = rest.includes("--jsonl");
          if (jsonl) {
            const path = join(ctx.cwd, `membrane-audit-${sid.replace(/[^A-Za-z0-9_.-]/g, "_")}.jsonl`);
            writeFileSync(path, audit.rows.map((row) => JSON.stringify(row)).join("\n") + (audit.rows.length ? "\n" : ""));
            notify(ctx, `membrane audit: ${audit.rows.length} row(s) \u2192 ${path} (seal ${audit.seal})`);
            return;
          }

          const lines = audit.rows.slice(-10).map((row) => {
            const payload = JSON.stringify(row.payload);
            return `#${row.seq} ${row.etype} ${payload.length > 160 ? payload.slice(0, 157) + "..." : payload}`;
          });
          notify(
            ctx,
            [`membrane audit \u00b7 ${audit.rows.length} row(s) \u00b7 seal ${audit.seal}`, ...lines].join("\n"),
          );
          return;
        }

        notify(ctx, `membrane: unknown subcommand "${command}" (status|audit [--jsonl]|rules)`, "warning");
      } catch (error) {
        notify(ctx, `membrane: ${String(error)}`, "warning");
      }
    },
  });
}
