# pi-curam-security

Zero-trust boundary security for AI coding agents: scrub agent→provider
context, journal the audit, expose receipts.

This is one of four curam repos — see [`docs/REPOS.md`](https://github.com/darrenmeehan/curam-harness-poc/blob/main/docs/REPOS.md)
for the whole set and why it is split.

One Rust engine (`bin/curam-membrane` in the `curam-security` workspace)
speaks the `mem/1` NDJSON contract over stdio. Harness drivers are dumb
pipes: they forward tool results, inject the scrubbed text, and surface
`/membrane` commands. Detection rules and storage live only in the engine
(`curam-core`), so rules improve in one place.

```
pi driver (TS) ──mem/1 stdio──▶ curam-membrane ──▶ curam-core (rules, scrub)
                                      └──────────▶ journal.db (0600, hash chain)
```

## Status

| Piece | Where | State |
| --- | --- | --- |
| Sanitizer → `curam-core/src/scrub.rs` | `curam-security` | done |
| Engine `mem/1` (`mask`, `rules`, `status`, `log`, `audit`, `verify`) | `curam-security/bin/curam-membrane` | done |
| Journal + 0600 + retention | `curam-security/bin/curam-membrane/src/journal.rs` | done |
| **pi driver** | `drivers/pi` | done (v1: tool results) |
| Claude Code / Codex drivers | — | not started |

Out of scope for v1: user-prompt scrub, tool-call-argument scrub, injection
scan, cage exec, budget enforcement, npm distribution.

## Quickstart

```bash
# 1. engine (separate repo)
cd ~/code/curam-security && cargo build -p curam-membrane

# 2. try the driver
cd ~/code/pi-curam-security
pi-bolt -e drivers/pi/index.ts

# 3. install for daily use (absolute path)
pi-bolt install "$PWD/drivers/pi"
```

Full setup, environment variables, limits, and troubleshooting:
[`drivers/pi/README.md`](drivers/pi/README.md).

## Commands

```text
/membrane                 status: engine, rules hash, classes, journal seal
/membrane audit [--jsonl] journal rows for this session
/membrane rules           rules version + classes
```

Engine source of truth and discovery order:

1. `$MEMBRANE_ENGINE`
2. `curam-membrane` on `PATH`
3. `~/code/curam-security/target/{debug,release}/curam-membrane`

## Tests

```bash
cargo test -p curam-membrane                          # engine (in curam-security)
bun test drivers/pi                                   # driver client + transform
python3 drivers/pi/tests/test_mem_contract.py         # mem/1 contract + custody
bash drivers/pi/tests/e2e_spy.sh                      # planted-secret gate (needs pi-bolt + model)
```

## Docs

- [`drivers/pi/README.md`](drivers/pi/README.md) — driver setup and limits
- [`PLAN.md`](PLAN.md) — architecture and roadmap
- [`CONVENTIONS.md`](CONVENTIONS.md) — commit, test, and custody rules
- [`specs/`](specs/) — scope, epics, execution state
