# CONVENTIONS.md — curam-membrane
<!-- BEGIN bigpowers:project -->

## Preflight

- PASS `cargo fmt --check && cargo test && python -m pytest tests/` before any commit.
- DO NOT merge, push, or declare done on red Preflight.
- CI exists when a `.github` workflow is added; keep CI green once wired.

## Commits

- Use Conventional Commits: `feat|fix|docs|chore|refactor|test|perf(scope): subject`.
- Use scopes: `engine`, `driver`, `journal`, `contract`, `config`, `core`, `docs`.
- Write the subject imperative, lowercase after the colon, under 50 characters.
- DO NOT commit generated artifacts or real secrets.

## Architecture Rules

- MUST NOT place detection or scrub logic outside `crates/curam-core`. Drivers are dumb pipes.
- The `mem/1` NDJSON contract and the SQLite journal schema are stable ABIs.
- Change the journal schema ONLY with a migration or version bump.
- Email data-class is OFF by default. Store `sha256(value)[:12]` fingerprints, NEVER raw secret values.
- Journal file chmod 0600 on create. Telemetry retention 90 days; opt-in raw table 30 days.

## Tests

- Non-trivial logic ships a test: unit (Rust), contract (NDJSON wire), parity (rules).
- Changing curam-core rules REQUIRES updating the parity fixture and rerunning `pytest -m parity`.
- Fixtures use generated placeholder secrets; NEVER real key material.
- Keep the agentic-ste validator green on generated prose.

## Defensive Code Categories (in force)

| Category | Apply? | Where |
| --- | --- | --- |
| Timeout | Yes | engine subprocess calls MUST carry a timeout |
| Graceful degradation | Yes | driver degrades silently when the engine binary is missing (mirror `cage.py`) |
| Retry | Yes | one retry on engine spawn, short backoff |
| Rate limit | No | — |
| Circuit breaker | No | — |

## specs/ Output

- ALL planning output lives in `specs/` — scopes, plans, audits, bugs, ADRs.
- Update `specs/state.yaml` on every significant decision or milestone.
<!-- END bigpowers:project -->