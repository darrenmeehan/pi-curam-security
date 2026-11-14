#!/usr/bin/env bash
# Gap probe: confirms the v1 holes instead of assuming them. A secret in the
# prompt, and a secret as a tool-CALL argument (the agent's own bash command),
# are expected to reach the provider payload — if either stops leaking, the docs
# understate coverage and must be updated. Needs a model call.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
driver_dir=$(cd "$here/.." && pwd)

ENGINE=${MEMBRANE_ENGINE:-$(command -v curam-membrane || true)}
ENGINE=${ENGINE:-$HOME/code/curam-security/target/debug/curam-membrane}
PI_BIN=${PI_BIN:-pi-bolt}
[ -x "$ENGINE" ] || { echo "SKIP: no engine at $ENGINE"; exit 0; }
command -v "$PI_BIN" >/dev/null 2>&1 || { echo "SKIP: $PI_BIN not found"; exit 0; }
export MEMBRANE_ENGINE="$ENGINE"

driver_args=(-e "$driver_dir/index.ts")
[ "${E2E_COMPILED_DRIVER:-0}" = "1" ] && driver_args=()

r() { head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
fail=0

run() { # $1 label, $2 prompt, $3 secret, $4 expected: leaked|absent
  local tmp; tmp=$(mktemp -d)
  ( cd "$tmp" && MEMBRANE_SPY_OUT="$tmp/p.jsonl" CUSEC_JOURNAL="$tmp/j.db" \
      "$PI_BIN" --print --no-session "${driver_args[@]}" -e "$here/spy.ts" "$2" ) \
      >"$tmp/out" 2>"$tmp/err" || { echo "FAIL: $1 — $PI_BIN exited non-zero"; tail -3 "$tmp/err"; fail=1; rm -rf "$tmp"; return; }
  local got="absent"
  grep -qF "$3" "$tmp/p.jsonl" 2>/dev/null && got="leaked"
  local verdict="ok"
  [ "$got" = "$4" ] || { verdict="UNEXPECTED"; fail=1; }
  printf '%-28s expected %-7s got %-7s  %s\n' "$1" "$4" "$got" "$verdict"
  rm -rf "$tmp"
}

p_secret="ghp_$(r)"
run "secret in the prompt" \
    "Remember this token for later: $p_secret. Reply with one word: ok" "$p_secret" leaked

c_secret="ghp_$(r)"
run "secret as tool-call arg" \
    "Run this exact command with the bash tool: echo $c_secret   Then reply: done" "$c_secret" leaked

exit "$fail"
