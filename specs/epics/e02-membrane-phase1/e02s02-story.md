# e02s02 — Engine bin: mem/1 mask/rules/status over stdio

**type:** feat · **risk:** P1 · **bcps:** 3

## Context

The engine is the boundary every driver talks to. It must be a dumb,
contract-tested stdio server (the cage/1 pattern) that links curam-core and
owns all policy. Story scope: envelope + first three ops; journal ops and
contract tests land in e02s03.

## Requirements (ADDED)

1. `bin/curam-membrane` is a workspace member; speaks mem/1 NDJSON over
   stdio — one request per line `{id, v: "mem/1", op, payload}`, one result
   line back; unknown/bad envelopes get `{ok: false, error}`.
2. `mask` — scrub `payload.text` with `default_cfg()`; reply
   `{scrubbed, manifest: [{kind, count}], rules_version, rules_hash}`.
3. `rules` — `{rules_version, rules_hash, classes: [kinds]}`.
4. `status` — version/hash/journal-mode summary; `--version` on argv prints
   the contract version and exits 0.

## Implementation Steps

1. Add `bin/curam-membrane` to workspace members; Cargo.toml with
   `curam-core = { path = "../../crates/curam-core" }`
2. main.rs: argv `--version` path + stdin line loop dispatching ops
3. mask/rules/status handlers composing mem/1 envelopes
4. `cargo build`; smoke: `echo '{...mask...}' | target/debug/curam-membrane`

## Out of scope

- Journal log/audit ops (s03); config file loading; injection scan;
  daemon mode

## Risks

- Dialect/toolchain minutiae — mirror curam-run's main.rs loop, keep ops thin.
