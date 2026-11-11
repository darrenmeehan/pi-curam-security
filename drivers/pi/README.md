# curam-membrane · pi driver

Thin pi extension: every tool result is masked by the `mem/1` engine before
the model sees it, the receipt is journaled, and `/membrane` exposes the
status. No detection logic lives here — the engine owns rules and storage.

## What it does

| Hook | Behaviour |
| --- | --- |
| `session_start` | Resolves the engine, spawns one child, calls `status`, sets the footer (`membrane: on · <rules_version>`). |
| `tool_result` | Masks each `text` block. On hits it replaces the text with the scrubbed text behind a watermark line, drops the stale `textSignature`, and journals one `pii_scrubbed` event (manifest + fingerprints + rules hash). Images, `details`, and `structuredContent` are untouched. |
| `session_shutdown` | Kills the child. |
| `/membrane` | `status` (default), `audit [--jsonl]`, `rules`. |

Degrade policy: if the engine is missing, dead, or times out, tool results
pass through **unscrubbed** and the footer says `membrane: degraded
(results pass through)`. It never fails a turn.

### What is not covered in v1

- User prompts (whole-message scrub is v1.5).
- Tool **call arguments** (`write`/`edit` content the assistant sends).
- Image blocks.
- Injection scanning.

Those are deliberate gaps, not silent ones.

## Setup

### 1. Build the engine

The engine lives in the `curam-security` workspace, not this repo:

```bash
cd ~/code/curam-security
cargo build -p curam-membrane
```

### 2. Engine discovery

The driver resolves, in order:

1. `$MEMBRANE_ENGINE` (absolute path)
2. `curam-membrane` on `PATH`
3. `~/code/curam-security/target/debug/curam-membrane`
4. `~/code/curam-security/target/release/curam-membrane`

`/membrane status` reports which one won, so a fallback is never silent.
For a stable setup, export `MEMBRANE_ENGINE` in your shell profile (via
`~/code/nix-config`) or install the binary as `curam-membrane` on `PATH`.

### 3. Load the driver

**Dev (file-loaded, hot):**

```bash
pi-bolt -e ~/code/curam-membrane/drivers/pi/index.ts
```

**Project-local:** copy or symlink into `.pi/extensions/` (never compiled
by pi-bolt):

```bash
mkdir -p .pi/extensions
ln -s ~/code/curam-membrane/drivers/pi .pi/extensions/membrane
```

**Global (daily driver):**

```bash
cd ~/code/curam-membrane
pi-bolt install "$PWD/drivers/pi"     # absolute path: relative entries are resolved from ~/.pi/agent
```

That entry runs file-loaded. One small TS file costs a few ms at startup;
there is nothing to compile for the driver to work.

### Compiled (AOT) mode

`pi-bolt compile` turns installed extensions into machine code. It only
works on an **installer-based** pi-bolt; a nix-managed pi-bolt lives in an
immutable store and refuses:

```
error: this Pi-Bolt is not in an installation (...): use --out DIR, or install it with the installer
```

Options:

1. **Leave it file-loaded** (default, verified working).
2. `pi-bolt compile --out DIR` to build a standalone binary with the driver
   baked in, then run `DIR/pi-bolt`. This bypasses the nix wrapper (which
   sets `TMPDIR`), so wire it through `~/code/nix-config` rather than
   hand-rolling a shell alias.
3. Use an installer-based pi-bolt for daily use.

`pi-bolt compile --list` shows what would be compiled in. A changed copy
always loads from files again until recompiled.

### 4. Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEMBRANE_ENGINE` | discovery order above | Engine binary |
| `MEMBRANE_TIMEOUT_MS` | `3000` | Per-request timeout; a timeout kills the child so the next call respawns |
| `CUSEC_JOURNAL` | `~/.local/state/curam/journal.db` | Journal path (engine-side; useful for tests) |

The journal is created `0600`; SQLite copies the mode onto its `-wal`/`-shm`
siblings. It stores event payloads and secret **fingerprints**, never raw
values.

## Commands

```text
/membrane                 # status: engine, rules hash, classes, journal seal
/membrane audit           # last 10 journal rows for this session
/membrane audit --jsonl   # all rows -> ./membrane-audit-<session>.jsonl
/membrane rules           # rules version, hash, classes
```

## Tests

```bash
bun test drivers/pi                                  # client + transform (fixture engine)
python3 drivers/pi/tests/test_mem_contract.py        # mem/1 envelope + journal custody
bash drivers/pi/tests/e2e_spy.sh                     # planted-secret gate (needs pi-bolt + a model)
```

`e2e_spy.sh` installs a generated GitHub-PAT-shaped secret, runs a real
`pi-bolt --print` session that reads it, and asserts:

- the raw secret never appears in any `before_provider_request` payload;
- `{REDACTED}:github_pat` and the `[membrane]` watermark do appear;
- the journal has a `pii_scrubbed` row with fingerprints and no raw value.

### Typecheck

The extension types come from the host pi SDK, which is not an npm
dependency of this repo. For `tsc`, link the installed SDK into the
extension's `node_modules` (gitignored):

```bash
mkdir -p drivers/pi/node_modules/@earendil-works drivers/pi/node_modules/@types
ln -sfn "$(readlink -f ~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent)" \
  drivers/pi/node_modules/@earendil-works/pi-coding-agent
ln -sfn ~/.pi/agent/npm/node_modules/@types/node drivers/pi/node_modules/@types/node
bun x tsc --noEmit -p drivers/pi/tsconfig.json
```

If `~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent` is missing,
the nix `pi-sdk-peer` link was dropped (a `pi update --extensions` can do
that). Re-run `home-switch` in `~/code/nix-config` to recreate it. This is
also why `pi-diff` logs an SDK load error.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `membrane: off (no engine found)` | Build the engine (step 1) or set `MEMBRANE_ENGINE`. |
| `membrane: degraded` | Engine died or exceeded `MEMBRANE_TIMEOUT_MS`. Check `/membrane status`; the next call respawns it. |
| No footer in `--print` mode | `ctx.hasUI` is false in print/JSON mode; hooks still run. |
| `pi-bolt compile` skips the driver | Install the absolute path first: `pi-bolt install "$PWD/drivers/pi"`. |
| `pi-bolt compile` says "not in an installation" | Nix-managed pi-bolt cannot write into its store; stay file-loaded or use `--out DIR`. |
| Journal perms wrong on old files | Reopen with any engine op; the file is tightened to `0600` on open. |
| `pi-diff` SDK error at startup | Missing `pi-sdk-peer` symlink; `home-switch`. |

## Uninstall

```bash
pi-bolt remove ./drivers/pi
rm -rf ~/.local/state/curam/journal.db*   # optional: drop the journal
```
