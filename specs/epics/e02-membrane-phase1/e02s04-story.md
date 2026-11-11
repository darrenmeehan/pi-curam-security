# e02s04 — pi driver (TS): forward/watermark/degrade + /membrane status

**type:** feat · **risk:** P1 · **bcps:** 1

## Context

The engine is useless to a daily driver until pi routes tool results through
it. This is the first driver and the only genuinely new harness surface.
It is a dumb pipe plus thin UI: no detection logic, no storage access, no
provider proxy. Engine discovery, failure policy, and the command surface are
the whole story.

## Requirements (ADDED)

1. `drivers/pi/membrane.ts` — `mem/1` client: one spawned engine per
   session, NDJSON line framing, serialized requests, per-request timeout
   (3 s default), one spawn retry with 200 ms backoff, and clean degrade.
   No pi imports so it is unit-testable.
2. Engine discovery, in order: `MEMBRANE_ENGINE` → `curam-membrane` on
   `PATH` → `~/code/curam-security/target/{debug,release}/curam-membrane`.
   The resolution trace is reported by `/membrane status`.
3. `drivers/pi/index.ts` — hooks:
   - `session_start`: resolve + spawn + `status`; footer
     `membrane: on · <rules_version>` or `membrane: off (...)`.
   - `tool_result`: mask every `text` block; on hits replace the text with
     the scrubbed text behind a watermark line, drop the stale
     `textSignature`, preserve `details`/`structuredContent`, and journal one
     `pii_scrubbed` event (manifest + fingerprints + rules hash).
   - `session_shutdown`: kill the child.
4. `/membrane [status|audit [--jsonl]|rules]` commands.
5. Degrade: engine missing, dead, or timing out leaves tool results
   untouched and shows a degraded footer; it never fails the turn.

## Implementation Steps

1. `membrane.ts` + unit tests with a fixture engine (framing, timeout,
   retry, serialization, transform).
2. `index.ts` hooks and commands.
3. `tests/spy.ts` + `tests/e2e_spy.sh`: planted-secret gate (the spy dumps
   every `before_provider_request` payload).
4. Install path: `pi-bolt install ./drivers/pi`, then
   `pi-bolt compile --only curam-membrane-pi` for AOT startup.

## Out of scope

- Whole-message user-prompt scrub, tool **call argument** scrub, image
  blocks, injection/scan, budget, provider proxy, daemon, npm packaging.
- Claude Code / Codex drivers.

## Risks

- `tool_result` shapes drift; guard on block type and preserve unknown
  fields.
- A compiled pi-bolt extension must still spawn a child process. If compile
  rejects `node:child_process`, leave the driver uncompiled (file-loaded)
  and record it.
- V1 leaves secrets in user prompts and tool-call arguments; documented.
