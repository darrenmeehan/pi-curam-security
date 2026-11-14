#!/usr/bin/env bash
# Planted-secret gate: a secret read by the agent must never appear in a
# provider-bound payload, and the journal must hold only its fingerprint.
#
# Needs: pi-bolt (or PI_BIN), a configured model, the built engine.
# Skips (exit 0) when the engine or pi-bolt is unavailable.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
driver_dir=$(cd "$here/.." && pwd)

# The engine you actually ship, not the workspace build: PATH first, and the
# debug build only as a fallback for a checkout with no install.
ENGINE=${MEMBRANE_ENGINE:-$(command -v curam-membrane || true)}
ENGINE=${ENGINE:-$HOME/code/curam-security/target/debug/curam-membrane}
PI_BIN=${PI_BIN:-pi-bolt}

[ -x "$ENGINE" ] || { echo "SKIP: engine not built at $ENGINE (cargo build -p curam-membrane)"; exit 0; }
command -v "$PI_BIN" >/dev/null 2>&1 || { echo "SKIP: $PI_BIN not found"; exit 0; }

tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

secret="ghp_$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-36)"
printf 'api token: %s\n' "$secret" > "$tmp/secrets.txt"

export MEMBRANE_ENGINE="$ENGINE"
export MEMBRANE_SPY_OUT="$tmp/payloads.jsonl"
export CUSEC_JOURNAL="$tmp/journal.db"

set +e
# AOT builds already carry the driver; set E2E_COMPILED_DRIVER=1 to skip -e.
driver_args=(-e "$driver_dir/index.ts")
if [ "${E2E_COMPILED_DRIVER:-0}" = "1" ]; then driver_args=(); fi

(cd "$tmp" && "$PI_BIN" --print --no-session \
  "${driver_args[@]}" \
  -e "$here/spy.ts" \
  "Use the read tool on secrets.txt, then reply with the single word done.") \
  > "$tmp/stdout" 2> "$tmp/stderr"
run_status=$?
set -e

if [ $run_status -ne 0 ]; then
  echo "FAIL: pi run exited $run_status"
  tail -20 "$tmp/stderr"
  exit 1
fi

[ -s "$MEMBRANE_SPY_OUT" ] || { echo "FAIL: spy captured no provider payloads"; exit 1; }

if grep -qF "$secret" "$MEMBRANE_SPY_OUT"; then
  echo "FAIL: raw secret reached a provider-bound payload"
  exit 1
fi
if ! grep -qF '{REDACTED}:github_pat' "$MEMBRANE_SPY_OUT"; then
  echo "FAIL: scrubbed placeholder missing from provider payloads"
  exit 1
fi
if ! grep -qF '[membrane]' "$MEMBRANE_SPY_OUT"; then
  echo "FAIL: watermark line missing from provider payloads"
  exit 1
fi

python3 - "$CUSEC_JOURNAL" "$secret" <<'PYJSON'
import json
import sqlite3
import sys

db, secret = sys.argv[1], sys.argv[2]
con = sqlite3.connect(db)
rows = con.execute("SELECT etype, payload FROM events").fetchall()
assert rows, "journal has no events"
raw = "\n".join(payload for _, payload in rows)
assert secret not in raw, "raw secret stored in the journal"
hits = [json.loads(p) for etype, p in rows if etype == "pii_scrubbed"]
assert hits, "no pii_scrubbed row"
manifest = hits[-1].get("manifest", [])
assert any(entry.get("kind") == "github_pat" for entry in manifest), manifest
assert hits[-1].get("fingerprints"), "no fingerprints"
print(f"journal: {len(rows)} row(s), pii_scrubbed with fingerprints")
PYJSON

echo "PASS: secret scrubbed at the provider boundary, journal holds fingerprints only"
