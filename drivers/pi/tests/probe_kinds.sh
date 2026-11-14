#!/usr/bin/env bash
# Boundary probe: plant every scrub class in one file, let the agent read it, and
# report per class whether the raw value reached a provider-bound payload and
# whether the journal kept the value or only a fingerprint. Needs a model call.
#
# Skips (exit 0) when the engine or pi-bolt is unavailable, like e2e_spy.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
driver_dir=$(cd "$here/.." && pwd)

ENGINE=${MEMBRANE_ENGINE:-$(command -v curam-membrane || true)}
ENGINE=${ENGINE:-$HOME/code/curam-security/target/debug/curam-membrane}
PI_BIN=${PI_BIN:-pi-bolt}
[ -x "$ENGINE" ] || { echo "SKIP: no engine at $ENGINE"; exit 0; }
command -v "$PI_BIN" >/dev/null 2>&1 || { echo "SKIP: $PI_BIN not found"; exit 0; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export MEMBRANE_ENGINE="$ENGINE"
export MEMBRANE_SPY_OUT="$tmp/payloads.jsonl"
export CUSEC_JOURNAL="$tmp/journal.db"

driver_args=(-e "$driver_dir/index.ts")
[ "${E2E_COMPILED_DRIVER:-0}" = "1" ] && driver_args=()

r() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
declare -A S
S[openrouter]="sk-or-v1-$(r 20)"
S[openai]="sk-$(r 20)"
S[aws]="AKIA$(r 8 | tr 'a-f' 'A-F')"
S[github_pat]="ghp_$(r 18)"
S[github_fine_grained]="github_pat_$(r 18)"
S[slack]="xoxb-$(r 12)"
S[google]="AIza$(r 20)"
S[jwt]="eyJ$(r 10).eyJ$(r 10).$(r 10)"
S[generic_sk]="sk-$(r 12)Zz"
S[key_value]="token=$(r 10)"

{
  for k in openrouter openai aws github_pat github_fine_grained slack google jwt generic_sk key_value; do
    printf '%s: %s\n' "$k" "${S[$k]}"
  done
  printf 'email: someone@example.com\n'
  printf -- '-----BEGIN RSA PRIVATE KEY-----\n'
  printf 'MIIE%s\n' "$(r 20)"
  printf -- '-----END RSA PRIVATE KEY-----\n'
} > "$tmp/secrets.txt"

(cd "$tmp" && "$PI_BIN" --print --no-session "${driver_args[@]}" -e "$here/spy.ts" \
  "Read secrets.txt with the read tool, then reply with just: done") >"$tmp/stdout" 2>"$tmp/stderr" || {
  echo "FAIL: $PI_BIN exited non-zero"; tail -5 "$tmp/stderr"; exit 1; }
[ -s "$MEMBRANE_SPY_OUT" ] || { echo "FAIL: spy captured no provider payloads"; exit 1; }

python3 - "$tmp" <<'PY'
import json, os, sqlite3, sys
tmp = sys.argv[1]
payloads = open(os.path.join(tmp, "payloads.jsonl")).read()
con = sqlite3.connect(os.path.join(tmp, "journal.db"))
rows = con.execute("select etype, payload from events").fetchall()
journal = "\n".join(p for _, p in rows)
values = {}
for line in open(os.path.join(tmp, "secrets.txt")):
    if ":" in line and "-----" not in line:
        k, v = line.split(":", 1)
        values[k.strip()] = v.strip()
values["private_key"] = "-----BEGIN RSA PRIVATE KEY-----"
print(f"{'KIND':<22}{'PAYLOAD':<10}{'JOURNAL'}")
leaked = []
for kind, value in values.items():
    in_payload = value in payloads
    if in_payload:
        leaked.append(kind)
    print(f"{kind:<22}{'LEAKED' if in_payload else 'absent':<10}{'STORED' if value in journal else 'fingerprint'}")
kinds = sorted({m["kind"] for et, p in rows if et == "pii_scrubbed" for m in json.loads(p).get("manifest", [])})
print(f"\nrows: {len(rows)} | pii_scrubbed kinds: {kinds}")
print(f"watermark in payload: {'[membrane]' in payloads}")
# email is excluded by default (ScrubCfg::default_cfg); everything else must be absent.
unexpected = [k for k in leaked if k != "email"]
if unexpected:
    sys.exit(f"FAIL: {unexpected} reached the provider payload")
print("PASS: every class except the by-default-excluded email was scrubbed at the boundary")
PY
