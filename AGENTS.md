# curam-membrane — AI Agents

> **Multi-agent context** — This file is the canonical project context for **Cline**, **Aider**, **OpenCode**, and other AGENTS.md-native tools. Claude Code and Cursor read it via the `CLAUDE.md` symlink.

Read CONVENTIONS.md before any GitHub or git operation.

<!-- BEGIN bigpowers:context-routing -->
## Context Routing

Load subdirectory context by file glob — see project-specific routing table (seeded by `seed-conventions`).
<!-- END bigpowers:context-routing -->

<!-- BEGIN bigpowers:learned-preferences -->
## Learned User Preferences

- (none yet — updated via `session-state`)

## Workspace Facts

- (none yet — durable facts discovered across sessions)
<!-- END bigpowers:learned-preferences -->

<!-- BEGIN bigpowers:project -->
## Project

Zero-trust boundary security for AI coding agents: scrubs agent→provider context, journals the audit, exposes receipts via CLI/commands.
Stack: Rust (engine linking `crates/curam-core`), TypeScript (pi driver), Python (contract tests), SQLite.

## Commands

| Action | Command |
| -------- | --------- |
| Run | `pi-bolt -e drivers/pi/index.ts` (dev); install: `pi-bolt install ./drivers/pi` then `pi-bolt compile --only curam-membrane-pi` |
| Test | `bun test drivers/pi` + `python3 drivers/pi/tests/test_mem_contract.py`; engine: `cargo test -p curam-membrane` in `~/code/curam-security` |
| Build | engine: `cargo build -p curam-membrane` in `~/code/curam-security` (no bundling for the driver) |
| Lint | `bun x tsc --noEmit -p drivers/pi` (setup in `drivers/pi/README.md`); Rust: `cargo fmt --check` + clippy |
| Preflight | `bun x tsc --noEmit -p drivers/pi && bun test drivers/pi && python3 drivers/pi/tests/test_mem_contract.py` |
| CI | none wired yet |

## Test

`cargo test` + `python -m pytest tests/`

## Lint

`cargo fmt --check` + clippy (Rust), `ruff check` (Python)

## Build

`cargo build`

## Architecture

Thin drivers (TS) per harness over one Rust engine (`bin/curam-membrane`).
Drivers speak the `mem/1` NDJSON contract over stdio. The engine links
`crates/curam-core` and owns detection, policy, and the SQLite journal. The
journal is the cross-harness ABI.

## Conventions

- Conventional Commits; scope tags: `engine`, `driver`, `journal`, `contract`, `config`, `core`
- No detection logic outside `crates/curam-core` — drivers MUST stay dumb pipes
- Email data-class OFF by default; store `sha256(value)[:12]` fingerprints, never raw secret values
- Journal 0600; telemetry retention 90 days; raw table (opt-in) 30 days

## Never

- Never place or port detection/scrub rules into drivers or the pi extension
- Never store or log raw secret values by default
- Never commit real secrets or key material in fixtures
- Never change curam-core rules without updating the parity fixture
- Never dismiss reproducible gate failures as pre-existing or out of scope
- Never proceed on red Preflight or red CI — invoke quick-fix or fix-bug first

## Agent Rules

- **Workflow Mandate:** Use bigpowers skills (e.g. `plan-work`, `develop-tdd`) for structured work.
- **Always Green:** Preflight and CI must be green before forward work.
- Read specs/ and CONVENTIONS.md before writing code.
- Write the minimum code that solves the stated problem.
- Run tests after every change. Show evidence before declaring done.
- All planning output goes in specs/.

## Token Economy — Minimal Footprint

> Production-safe subset of the 8-rule AGENTS.md pattern (Vercel engineer, ~60B tokens).
> Rule 1 ("no backward compatibility") is excluded deliberately: it risks data loss in production.

1. **Check existing dependencies first.** DO inspect what your current dependencies already do before adding a package or writing your own code.
2. **Prefer mature, maintained libraries.** DO NOT rewrite a capability a maintained library provides without a documented reason.
3. **Copy validated patterns.** DO study how established products solve the same problem before inventing a new approach.
4. **Keep the simplest working implementation.** DO write the least code that satisfies the stated requirement. NEVER add preventive abstraction or unused config layers.
<!-- END bigpowers:project -->