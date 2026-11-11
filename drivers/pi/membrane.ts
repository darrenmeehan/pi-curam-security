/**
 * mem/1 client + tool-result transform for the pi driver.
 *
 * No pi imports and no detection logic: this file only speaks the engine's
 * NDJSON contract and rewrites text blocks with what the engine returns.
 * All rules live in curam-core (anti-drift rule).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const MEMBRANE_VERSION = "mem/1";

export interface ManifestEntry {
  kind: string;
  count: number;
}

export interface Hit {
  kind: string;
  fingerprint: string;
}

export interface MaskReply {
  scrubbed: string;
  manifest: ManifestEntry[];
  hits: Hit[];
  rules_version: string;
  rules_hash: string;
  scrub_hash: string;
}

export interface StatusReply {
  rules_version: string;
  rules_hash: string;
  classes: string[];
  journal: string;
  seal: string;
  engine: string;
}

export interface AuditRow {
  seq: number;
  ts: number;
  etype: string;
  payload: unknown;
}

export interface AuditReply {
  rows: AuditRow[];
  seal: string;
}

export type EngineSource = "env" | "path" | "workspace-debug" | "workspace-release";

export interface EngineRef {
  command: string;
  args?: string[];
  source: EngineSource;
}

export interface ClientOptions {
  timeoutMs?: number;
  spawnRetryDelayMs?: number;
}

export interface TextBlock {
  type: "text";
  text: string;
  textSignature?: string;
  [key: string]: unknown;
}

export type ContentBlock = { type: string; [key: string]: unknown };

export interface MaskedContent {
  content: ContentBlock[];
  manifest: ManifestEntry[];
  hits: Hit[];
  changed: boolean;
  rules?: MaskReply;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onPath(name: string, pathEnv: string): string | undefined {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resolve the engine: explicit env, then PATH, then the local workspace
 * build. The source is reported by `/membrane status` so a silent fallback
 * is visible.
 */
export function resolveEngine(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): EngineRef | undefined {
  const explicit = env.MEMBRANE_ENGINE?.trim();
  if (explicit) return { command: explicit, source: "env" };

  const found = onPath("curam-membrane", env.PATH ?? "");
  if (found) return { command: found, source: "path" };

  const debug = join(home, "code", "curam-security", "target", "debug", "curam-membrane");
  if (existsSync(debug)) return { command: debug, source: "workspace-debug" };

  const release = join(home, "code", "curam-security", "target", "release", "curam-membrane");
  if (existsSync(release)) return { command: release, source: "workspace-release" };

  return undefined;
}

/**
 * One engine process per session. Requests are serialized (the contract is
 * one line in, one line out), each with a timeout; a timeout kills the
 * child so the next call respawns cleanly.
 */
export class MembraneClient {
  readonly engine: EngineRef;
  private readonly timeoutMs: number;
  private readonly spawnRetryDelayMs: number;
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: {
    id: number;
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private stderr = "";

  constructor(engine: EngineRef, options: ClientOptions = {}) {
    this.engine = engine;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.MEMBRANE_TIMEOUT_MS ?? 3000);
    this.spawnRetryDelayMs = options.spawnRetryDelayMs ?? 200;
  }

  available(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  async status(): Promise<StatusReply> {
    return this.request<StatusReply>("status");
  }

  async rules(): Promise<{ rules_version: string; rules_hash: string; classes: string[] }> {
    return this.request("rules");
  }

  async mask(text: string): Promise<MaskReply> {
    return this.request<MaskReply>("mask", { text });
  }

  async log(payload: Record<string, unknown>): Promise<{ seq: number; seal: string }> {
    return this.request("log", payload);
  }

  async audit(sessionId?: string): Promise<AuditReply> {
    return this.request<AuditReply>("audit", sessionId ? { session_id: sessionId } : {});
  }

  close(): void {
    this.failPending(new Error("engine closed"));
    const child = this.child;
    this.child = undefined;
    if (child) {
      try {
        child.stdin.end();
      } catch {
        // already gone
      }
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
  }

  private request<T>(op: string, payload?: Record<string, unknown>): Promise<T> {
    const run = this.queue.then(
      () => this.doRequest(op, payload),
      () => this.doRequest(op, payload),
    );
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run as Promise<T>;
  }

  private async doRequest(
    op: string,
    payload?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.ensureChild();
    const id = this.nextId++;
    const envelope = { id, v: MEMBRANE_VERSION, op, ...(payload ? { payload } : {}) };

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failPending(new Error(`engine timeout after ${this.timeoutMs}ms on op=${op}`));
        this.killChild();
      }, this.timeoutMs);

      this.pending = { id, resolve, reject, timer };
      try {
        this.child!.stdin.write(JSON.stringify(envelope) + "\n");
      } catch (error) {
        this.failPending(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async ensureChild(): Promise<void> {
    if (this.child && this.child.exitCode === null && !this.child.killed) return;

    const attempt = () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(this.engine.command, this.engine.args ?? [], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        let settled = false;

        child.once("spawn", () => {
          settled = true;
          this.child = child;
          this.buffer = "";
          child.stdout.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => this.onData(chunk));
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (chunk: string) => {
            this.stderr = (this.stderr + chunk).slice(-2000);
          });
          child.once("exit", () => {
            if (this.child === child) this.child = undefined;
            this.failPending(new Error(`engine exited (${child.exitCode ?? "signal"})`));
          });
          resolve();
        });

        child.once("error", (error) => {
          if (settled) return;
          reject(
            new Error(
              `cannot spawn engine ${this.engine.command}: ${error.message}${this.stderr ? ` (${this.stderr.trim()})` : ""}`,
            ),
          );
        });
      });

    try {
      await attempt();
    } catch (first) {
      await delay(this.spawnRetryDelayMs);
      try {
        await attempt();
      } catch {
        throw first;
      }
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf("\n");
      if (!line) continue;
      this.settle(line);
    }
  }

  private settle(line: string): void {
    const pending = this.pending;
    if (!pending) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // not a contract line; keep waiting for the reply
    }
    if (typeof message.id === "number" && message.id !== pending.id) return;

    this.pending = undefined;
    clearTimeout(pending.timer);
    if (message.ok === false) {
      pending.reject(new Error(String(message.error ?? "engine error")));
    } else {
      pending.resolve(message);
    }
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private killChild(): void {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

/**
 * Rewrite text blocks with the engine's scrubbed text. Text blocks without
 * hits are returned by reference; images and unknown blocks are untouched.
 * A stale `textSignature` is dropped whenever the text changes.
 */
export async function maskTextBlocks(
  content: ContentBlock[],
  mask: (text: string) => Promise<MaskReply>,
): Promise<MaskedContent> {
  const out: ContentBlock[] = [];
  const manifest = new Map<string, number>();
  const hits: Hit[] = [];
  let changed = false;
  let rules: MaskReply | undefined;

  for (const block of content) {
    if (block.type !== "text" || typeof block.text !== "string") {
      out.push(block);
      continue;
    }

    const reply = await mask(block.text);
    if (!reply.hits || reply.hits.length === 0) {
      out.push(block);
      continue;
    }

    changed = true;
    rules = reply;
    for (const entry of reply.manifest ?? []) {
      manifest.set(entry.kind, (manifest.get(entry.kind) ?? 0) + entry.count);
    }
    hits.push(...reply.hits);

    const count = (reply.manifest ?? []).reduce((total, entry) => total + entry.count, 0);
    const summary = (reply.manifest ?? []).map((entry) => `${entry.kind}\u00d7${entry.count}`).join(", ");
    const watermark = `[membrane] ${count} secret${count === 1 ? "" : "s"} redacted (${summary})`;

    out.push({ ...block, text: `${watermark}\n${reply.scrubbed}`, textSignature: undefined });
  }

  return {
    content: changed ? out : content,
    manifest: [...manifest].map(([kind, count]) => ({ kind, count })),
    hits,
    changed,
    rules,
  };
}
