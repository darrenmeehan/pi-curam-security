# Curam Membrane — Plan

**Status:** proposal · **Phase:** 0 (idea → contract) · **Owner:** darrenmeehan

---

## 1. Thesis

Coding agents leak. Whatever the model sees is serialized to a third-party API
provider on the next turn — keys, PEMs, tokens, and user data that landed in
tool output leave the machine permanently. Auditing is equally broken: session
transcripts record only what fits in context, so "what the model was shown" and
"what actually happened" are conflated.

**Membrane** is a boundary security plugin for coding agents: it scrubs what
crosses the agent→provider boundary, keeps the raw/scrubbed pair in a local
journal, and exposes the audit. It ships first as a pi plugin, and is
deliberately architected as the **test bed for the curam security solution**:
every detection rule it proves in real use lands upstream in `curam-core`, and
the engine it runs on is the same one a future full curam harness will link.

Non-goals (this release): sandboxed execution (cage stays out of scope), budget
enforcement, dependency-vuln scanning, denial-of-service defense. The
classifier/deny gate is out of scope for v1 — **audit and redaction only**.

---

## 2. Branding & naming

**Name (locked): `curam-membrane`** — engine binary `curam-membrane`, config
`~/.config/curam/curam-membrane.toml`, commands `/membrane …` (aliased as
`/curam-membrane`). "Membrane" survives only as informal shorthand.

The name _is_ the function: a selectively permeable membrane between the agent
and the outside world. Raw secrets stay; scrubbed context passes.

| Name | Metaphor | Verdict |
| --- | --- | --- |
| **Membrane** | Selective permeability; boundary control | **Recommended** — exact match to function |
| Veil | Context concealed from view | Good; slightly mystical, implies _hiding_ |
| Bastion | Defense structure | Fine, but implies blocking — v1 doesn't block |
| Scribe | Keeps records | Only covers the audit half |
| Cleanroom | Contamination-controlled assembly | Strong methodology echo; odd for a plugin |

Tagline: _"Zero-trust context for AI coding agents."_ Or the two-line
elevator: _"What the agent sees is scrubbed. What it did is kept."_

Command surface (pi): `/membrane status` · `/membrane audit [--jsonl]` ·
`/membrane watch` (TUI) · `/membrane rules`.

Config file: `~/.config/curam/curam-membrane.toml` — reuses the curam brand
and the `[pii]` key names of `curam.toml` so config is portable across
harnesses.

---

## 3. Architecture

One design rule, stated loudly:

> **No detection logic lives outside `curam-core`. Ever.**

The plugin and every future driver are dumb pipes + thin UI. This is the
anti-drift rule that makes "test bed" real: rules improve in the core, not in
forks.

```
┌─ pi driver (TS) ──────────┐   ┌─ Claude Code driver ──┐   ┌─ Codex driver ──┐
│ forward tool results,     │   │  (PreToolUse/Stop      │   │  (pre/post      │
│ /membrane commands, TUI,  │   │   hooks, JSON stdin)    │   │   tool_use)     │
│ watermark + warnings      │   │                        │   │                 │
└──────────┬────────────────┘   └───────────┬────────────┘   └───────┬─────────┘
           │  stdio, mem/1      one thin driver per harness          │
           ▼                                                            ▼
┌────────────────────────────────────────────────────────────────────┐
│  curam-membrane  (engine CLI, lives in curam-security workspace)   │
│  ops: mask · scan · log · audit · rules                            │
│  - policy matrix (per data-class, per tool)                        │
│  - scrubber driver, placeholder fingerprinting                     │
│  - injection/entropy scan (indicator only)                         │
│  - journal writer (reuses journal.rs semantics)                    │
└───────────────┬──────────────────────────────────┬─────────────────┘
                ▼                                  ▼
      curam-core (Rust lib)             journal.sqlite (0600)
      single source of truth            schema = curam journal
      rules · scrub · classify          + pii_scrubbed /
                                        injection_warning events
```

- **Engine** (`bin/membrane` in the `curam-security` workspace): links
  `curam-core` directly — no FFI, no duplication, PRs land in the core repo.
  Owns _all_ detection, policy, and storage. One-shot process per call in v1
  (sub-10ms cost per tool result); daemon only if measured.
- **Drivers** (new repo `pi-curam-security`): ~300-line adapters per harness over
  one frozen contract. Nothing else.
- The **contract** (`mem/1`, NDJSON over stdio) is a sibling of the existing
  `cage/1` protocol — same transport-agnostic, replayable philosophy (curam's
  T6 property), same test pattern (`contract_replay.py`).

### The mem/1 contract (v1 sketch)

One request per line on stdin, one result per line on stdout. Ops:

| op | request payload | response |
| --- | --- | --- |
| `mask` | text, tool id, data-class policy | scrubbed text + manifest (pattern → n, placeholder ids) |
| `scan` | text | injection warnings + entropy hits (indicator, not verdict) |
| `log` | event type, raw + scrubbed payload | rowid |
| `audit` | filters (session, since) | event rows / JSONL export |
| `rules` | — | ruleset version + `rules_hash` |

Every response carries the ruleset hash, so every audit row is traceable to a
specific rules version — the existing `rules_hash()` open-source-audit property
carried through to the journal.

---

## 4. Code reuse analysis

What exists today in `~/code/curam-harness-rs` and `~/code/curam-security`,
and what actually transfers:

| Asset | Where it lives | Reuse |
| --- | --- | --- |
| Sanitizer (scrub + patterns + placeholder) | `curam-harness-rs/src/sanitize.rs` (~180 ln) | **Promote wholesale into `curam-core`** (new `scrub.rs`) — first PR; engine links it |
| Injection patterns + threshold | `curam-core/src/rules.rs` (`INJECTION_PATTERNS`, `scan_context`) | Link directly (in spirit; v1 scans, profile later) |
| Rules versioning / `rules_hash()` | `curam-core/src/rules.rs` | Reuse; stamp every journal event and mask response |
| Journal schema + WAL + export | `curam-harness-rs/src/journal.rs` (~220 ln) | Engine reuses the SQLite schema/event taxonomy as-is; the TS driver never touches storage |
| `[pii]` config keys (level, placeholder, internal_domains) | `curam-harness-rs/src/config.rs` | Mirror key names in `membrane.toml` for cross-harness portability |
| stdio NDJSON client pattern | `curam-security/harness-wiring/cage.py` | Contract **pattern** for `mem/1` (replayable, transport-agnostic) |
| Parity/contract test style | `tests/test_parity.py`, `tests/contract_replay.py` | Replicate for mask parity + mem/1 contract |
| Aho-Corasick matcher dep | `curam-core` already depends on it | Single-pass scrub pass to replace 12 sequential regex walks (in `curam-core`) |
| OSV, host matching, cage | `curam-core`, `bin/curam-run` | **Out of scope for v1**; future hooks |

**New code (the small part):** pi driver in TS (~300–500 ln), engine bin
wrapper (~150–250 ln), policy matrix + manifest + fingerprinting (~300–400 ln
in `curam-core`), audit/report + bench harness (~300 ln).

**Honest estimate: ~60–70% of the security substance is lifting code that
already exists**; the pi-specific surface is the only genuinely new
implementation.

---

## 5. The journal — the stable ABI

The journal is the cross-harness currency: the one artifact every driver
produces and every audit tool reads.

- Schema: curam's `events(seq, session_id, ts, etype, payload)` (SQLite WAL),
  extended with `session_meta` so a session records which harness/driver
  produced it.
- Event types: existing (`user_message`, `model_message`, `model_response`,
  `tool_call`, `tool_result`, `error`) + new:
  - `pii_scrubbed` — {tool, pattern → n, placeholder_ids, rules_hash}
  - `injection_warning` — {tool, rule_id, evidence}
  - `policy_applied` — {data-class profile in use}
- **Retention model: retain no raw values by default.** The journal stores
  events, scrubbed payloads, and per-hit **secret fingerprints**
  (`sha256(value)[:12]` — enough to identify a leaked key for rotation,
  not the key itself). Raw values are an explicit opt-in
  (`retention.raw = true`, separate table, encrypted), for environments
  that require exact-bytes capture.
- **Defaults:** telemetry (events, scrubbed payloads, fingerprints,
  receipts) **90 days**; raw table (if enabled) **30 days**; configurable
  `0` (purge at session end) to `365`. Engine purges lazily on open,
  inside WAL.
- Journal chmod 0600 on create. Column encryption applies to the opt-in
  raw table only.
- **Why no raw by default:** a leaked secret's copy of record is already at
  the provider — storing the value locally adds exposure and cannot
  "un-leak" anything; you rotate, never recover. Fingerprints keep the
  full incident-response story without the liability.
- Export: `audit` op → JSONL, ingestible by whatever report tool comes later.

### Journal integrity — tamper _evidence_, not tamper _prevention_

Nothing stops a same-user adversary — the harness itself, or a
prompt-injected model with `bash` — from editing the SQLite file, dropping
rows, or calling the engine's own `log` op. 0600 only deters other users;
that is a single-user limitation, not a bug. If the harness can rewrite the
journal it can rewrite the repo, and the journal is the least of that
compromise. What the schema _can_ add is evidence:

- `prev_hash` + `seal` columns in the schema from v1 (one-time design cost,
  no migration later): a hash chain — every row commits the previous row's
  hash — so modification or row-drop is detectable on replay.
- A periodic root-hash "seal" written by the engine to an independent
  location the driver cannot reach, verified later via `membrane verify`.
- Encryption at rest is **not** the remedy: the key lives with the same
  user/process that reads the journal, so it defends only against media loss
  / leaked backups, not against the agent. The real at-rest story is host
  FDE (FileVault/LUKS). Column encryption stays deferred until a
  media-loss threat model exists (roadmap Phase 3).

---

## 6. Shipping as a pi plugin

- **Dev:** project-local `.pi/extensions/` — hot-reloadable with `/reload`.
- **User install:** `~/.pi/agent/extensions/` (auto-discovered), distributed as
  the driver repo checkout + a 5-line install script that also builds the
  engine (`cargo build` in `curam-security` workspace) and symlinks `membrane`
  into PATH. Optionally a skill doc in the user's skills dir.
- **Engine discovery (resolve in order):** explicit `engine.path` in
  `curam-membrane.toml` → `PATH` → `target/debug/curam-membrane` relative to the
  workspace. `membrane status` fails loudly with the resolution trace.
- **What the pi driver does:**
  - Forwards every tool result to `mask` + journal via `log` (never reads raw
    results into TS memory as strings for display; raw stays engine-side).
  - Injects the scrubbed text (or a watermark line: _"a private key was
    redacted from read output"_).
  - Surfaces `injection_warning` as a visible banner + journal entry.
  - Whole-message outbound scrub of _user_ prompts (secrets-only classes by
    default — configurable; off by default until v1.5).
  - `/membrane …` commands and the `watch` TUI.
- **Self-protection & custody:** journal at
  `~/.local/state/curam/journal.db` (0600), per-project journals later; no
  raw secret values at rest by default (fingerprints only) — the custody
  liability is designed out rather than managed. `retention.raw = true`
  opts into value capture, with 30-day default TTL and encryption.

---

## 7. Test-bed loop — how the plugin hardens curam

The point of shipping in pi first is a real, hostile corpus: real sessions,
real secret shapes, real false-positive noise. Every lesson flows upstream:

1. **Promote** `sanitize.rs` → `curam-core/src/scrub.rs` (first PR, engine links
   it — nothing forks).
2. **Improve in core**: single-pass Aho-Corasick matcher, entropy detector
   (v1.5), split-key/base64-unwrap detection (v2), per-class toggles with
   **email class OFF by default** (the footgun from the harsh review).
3. **Measure**: `/membrane bench` replays a tagged corpus → precision/recall per
   class; a failing FP gate blocks any pattern merge. Mirrors curam's parity
   fixture discipline (`test_parity.py`).
4. **Fold back**: real-world findings become `curam-core` regression fixtures;
   new detection classes land as `curam-core` PRs; the plugin's policy-matrix
   requirements inform the future `classify` API.
5. **Version**: every event stamped with `rules_hash`, so an audit replay says
   _which_ ruleset made each call — the open-source audit property.

---

## 8. Release to other harnesses (post-proof)

Contract and journal freeze first; then each harness gets a driver, not a
port.

- **Claude Code** — hooks surface exists today: `PreToolUse`/`PostToolUse`/
  `Stop` as external commands receiving JSON on stdin, exit-code governed.
  Maps to: forward tool output to `mask` (PostToolUse), journal on `Stop`.
  Driver: ~200 ln shell + JSON. Note: hook runtime is the deterministic
  control point — good fit.
- **Codex (openai/codex)** — hook lifecycle (`pre_tool_use`,
  `post_tool_use`, `session_stop`, `user_prompt_submit`) modeled on Claude
  Code's, with hash-trust review for non-managed hooks. Same driver shape.
  **Caveat to verify at the gate:** current hooks may not fire for non-shell
  tools reliably in all builds — driver feasibility must be re-validated.
- **Sequence:** curam-security keeps the engine and owns compliance; the
  `pi-curam-security` repo holds `drivers/{pi,claude,codex}`. The journal is the
  proof of cross-harness coherence: _replay one session's journal in another
  tool_ is a demo, not a migration.

**Gate before any second driver:** two weeks of dogfood on pi + contract v1
frozen + journal ABI test + zero false-positive regressions on the bench
corpus.

---

## 9. Roadmap

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0 | This plan; contract sketch; repo layout | Sign-off on naming + architecture |
| 1 | `bin/membrane` engine (mask/log/audit/rules) + pi driver + `/membrane` cmds; 0600 + retention | Runs a real session; secrets caught; normal work unregressed (email OFF) |
| 2 | Promote sanitizer → `curam-core`; single-pass matcher; policy matrix; manifest; fingerprinting; watermark; bench | precision/recall gates pass; ≥1 upstream PR landed |
| 3 | Whole-message scrub (opt-in); entropy class; encryption for the opt-in raw table; per-project journals | audit replay from a _different_ harness reads cleanly |
| 4 | Contract + journal freeze → `drivers/claude`, `drivers/codex` | re-validated hook surfaces; cross-harness journal replay demo |

---

## 10. Risks & open questions

- **Custody liability** — **resolved by design**: raw secret values are not
  retained by default (fingerprints only), so there is no secret corpus to
  protect or purge. Opt-in `retention.raw` re-imposes the trade, mitigated
  by 30-day TTL + encryption.
- **False positives are endless** — email class OFF is the first of many
  calibrations; the bench gate is the only thing that keeps tuning honest.
- **Hook-surface drift** — pi extension events and Codex hooks change; the
  frozen contract + journal ABI insulate the engine, but driver maintenance is
  real. Mitigation: one thin driver file per harness, contract tests only.
- **User-prompt scrubbing is a UX surprise** — must be loudly opt-in.
- **Engine↔driver round trip** — subprocess per tool result costs ~ms; fine for
  v1, revisit only on measurement.
- **Platform** — engine is portable; cage remains out of scope for v1.
- **Open decision:** exact `rules_hash`-stamping granularity (per event vs per
  session) and whether `mem/1` daemonizes at contract freeze.
