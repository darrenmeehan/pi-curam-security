# e02s03 — Journal log/audit + planted-secret contract test

**type:** feat · **risk:** P1 · **bcps:** 2

## Context

The journal is the cross-harness ABI: every driver writes it, every audit
tool reads it. The engine owns storage; drivers never touch SQLite. This
story adds the journal ops to `mem/1` and proves the custody rule with a
contract test: a planted secret never appears in a journal payload or a
provider-bound payload, only its kind and fingerprint.

## Requirements (ADDED)

1. Ops `log`, `audit`, `verify` on the `mem/1` server:
   - `log` → `{seq, seal}`; writes `session_meta` when `harness` is given.
   - `audit` → `{rows: [{seq, ts, etype, payload}], seal}` (optionally
     filtered by `session_id`).
   - `verify` → `{chain_ok, rows, corrupt_rows, seal}`.
2. Journal file created `0600` and tightened on every open (SQLite copies
   the mode onto `-wal`/`-shm`). `PRAGMA file_permissions` does not exist;
   it was a silent no-op that left the file `0644`.
3. Retention: telemetry rows older than 90 days purged on open, chain
   rebuilt over the retained window.
4. Planted-secret contract test (Python, stdlib): `mask` a generated
   placeholder secret, `log` the receipt, assert the journal row contains
   the kind + fingerprint and **not** the raw value.

## Implementation Steps

1. `journal.rs`: schema, hash chain, purge/rebuild, `log/audit/verify`.
2. `restrict_0600` before `Connection::open` + unit test for an existing
   `0644` file.
3. `tests/test_mem_contract.py`: spawn the engine, drive NDJSON, assert the
   custody invariant against a temp `CUSEC_JOURNAL`.

## Out of scope

- Raw-value retention (`retention.raw`), encryption at rest, per-project
  journals.
- Driver-side journal access.

## Risks

- Hash-chain rebuild after purge changes seals; retention must stay
  documented as "provable-deleted-to-the-last-seal".
