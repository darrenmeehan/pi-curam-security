# Verification — phase 1 boundary and failure modes

**Date:** 2026-11-14 · **Verdict:** boundary holds; one defect found and fixed
**Scope:** the layer as installed on the laptop, not a workspace build.

## Environment

| | |
|---|---|
| engine | `/nix/store/msrcmpmc…-curam-membrane-0.1.0/bin/curam-membrane` (pinned release build, journal ops present) |
| engine discovery | `source=path` (`~/.nix-profile/bin/curam-membrane`) |
| driver | curam-membrane `74a8177`, compiled into pi-bolt 1.2.1 |
| harnesses | pi-bolt 1.2.1 (compiled-in driver), Pi 1.5.0 (run-time driver) |
| model | `deepseek/deepseek-v4.1-flash-1017` via openrouter (flash, 5 calls total) |

## Gates

| gate | command | result |
|---|---|---|
| planted secret, pi-bolt | `E2E_COMPILED_DRIVER=1 make gate-e2e` | PASS — scrubbed at the boundary, journal fingerprints only |
| planted secret, Pi | `PI_BIN=pi bash drivers/pi/tests/e2e_spy.sh` | PASS |
| every class | `bash drivers/pi/tests/probe_kinds.sh` | PASS — 10 classes absent from payloads; `email` leaks **by default design** (`exclude: ["email"]`) |
| documented gaps | `bash drivers/pi/tests/probe_gaps.sh` | PASS — prompt and tool-call argument both leak, as documented |
| latency | `python3 drivers/pi/tests/probe_latency.py` | PASS — 1 MB / 200 hits = 14 ms p50, 210× inside the 3000 ms timeout |
| crash recovery | `bun drivers/pi/tests/probe_respawn.ts` | PASS — one request lost, engine respawned |
| custody | `CUSEC_JOURNAL=<tmp> … verify` | PASS — mode 600; `chain_ok:true`; after an `UPDATE`, `chain_ok:false, corrupt_rows:1` |

## Defect found: a crash disabled scrubbing for the rest of the session

`drivers/pi/index.ts` set `client = undefined` inside `degraded()`, and
`tool_result` bails when the client is missing. So one engine crash — a
SIGKILL, an OOM, a segfault — meant **every later tool result in that session went
out unscrubbed**, while `MembraneClient` would have respawned it on the next
request.

Measured before the fix: `ok 16 ms → SIGKILL → FAILED (engine exited) → ok 2 ms`
at the client level, but the extension never got there because it had thrown the
client away.

Fixed by keeping the client and restoring the footer on the first successful
answer (`healthy()`), with a regression test that fails against the old code:
`drivers/pi/index.test.ts` (fixture engine mode `crash-once`).

The footer also never returned to `on` after a recovery; that is the same fix.

## Notes for the next run

- `e2e_spy.sh` used to default its engine to the workspace debug build, so the
  headline gate could pass while testing a binary that is not installed. It now
  takes the engine from `PATH` first.
- `email` leaking is intended but easy to mistake for a failure: it is an
  explicit `exclude` in `ScrubCfg::default_cfg`, not a regex miss.
- `generic_sk` never appears in a manifest for `sk-…` values: `openai` matches
  first, by the documented first-match-wins ordering.

## Not covered here

- A week of ordinary work (false-positive soak, `email` off by default).
- Image blocks, and the v1.5 features (prompt scrub, tool-call argument scrub).
- Anything on a host other than the laptop; the engine is pinned per machine.
