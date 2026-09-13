# e02s01 — Promote sanitizer to curam-core scrub.rs

**type:** feat · **risk:** P1 · **bcps:** 2

## Context

The harness sanitizer (sanitize.rs) is the single proven scrubber. The
anti-drift rule says detection lives in curam-core; the engine must link one
copy. This story promotes (moves the authority of) the scrubber into
curam-core with two engine-facing extensions — exclude list and manifest —
while keeping byte-identical pattern behavior.

## Requirements (ADDED)

1. `crates/curam-core/src/scrub.rs` ports the harness sanitizer: 12 ordered
   patterns + internal_domains, `{REDACTED}:<kind>` placeholders, deterministic
   tier, `spans_masked` counter.
2. `ScrubCfg` — level, placeholder, internal_domains, `exclude: Vec<String>`
   (kinds to skip); `default_cfg()` excludes `email` (the FP footgun).
3. `scrub_with_manifest` returns scrubbed text + per-kind hit counts (the
   receipt) + spans_masked; `scrub()` stays a thin wrapper.
4. Port the five harness unit tests; add email-excluded-by-default and
   manifest tests.

## Implementation Steps

1. Port sanitize.rs → scrub.rs, replacing harness `PiiCfg` with `ScrubCfg`
2. Add `exclude` handling + `scrub_with_manifest` + `pattern_kinds()`
3. Export `pub mod scrub;` in lib.rs; run `cargo test -p curam-core`
4. (Follow-up PR, not this story) switch harness sanitize.rs to curam-core

## Out of scope

- Harness sanitize.rs rewrite; per-class policy matrix; single-pass
  Aho-Corasick matcher (Phase 2); entropy detection (v1.5)

## Risks

- Pattern behavior drift during port; the five ported tests are the guard.
