#!/usr/bin/env python3
"""mem/1 contract + custody test (stdlib only).

Spawns the engine with a throwaway journal and asserts:
  - envelope errors return ok:false
  - mask scrubs a planted secret and returns a manifest + fingerprint
  - log writes a receipt whose journal row never contains the raw secret
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ENGINE = Path(
    os.environ.get(
        "MEMBRANE_ENGINE",
        Path.home() / "code/curam-security/target/debug/curam-membrane",
    )
)
SECRET = "ghp_0123456789abcdefghijklmnopqrstuvwxyz"


def call(proc, request):
    proc.stdin.write(json.dumps(request) + "\n")
    proc.stdin.flush()
    return json.loads(proc.stdout.readline())


def main():
    if not ENGINE.is_file():
        print(f"SKIP: engine not built at {ENGINE}")
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        journal = Path(tmp) / "journal.db"
        env = dict(os.environ, CUSEC_JOURNAL=str(journal))
        proc = subprocess.Popen(
            [str(ENGINE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        try:
            bad = call(proc, {"id": 1, "v": "nope", "op": "status"})
            assert bad["ok"] is False, bad

            masked = call(
                proc, {"id": 2, "v": "mem/1", "op": "mask", "payload": {"text": f"k={SECRET}"}}
            )
            assert masked["ok"] is True, masked
            assert SECRET not in masked["scrubbed"], masked
            assert "{REDACTED}:github_pat" in masked["scrubbed"], masked
            assert masked["hits"][0]["fingerprint"], masked
            assert masked["manifest"][0]["kind"] == "github_pat", masked

            logged = call(
                proc,
                {
                    "id": 3,
                    "v": "mem/1",
                    "op": "log",
                    "payload": {
                        "session_id": "contract",
                        "harness": "test",
                        "etype": "pii_scrubbed",
                        "payload": {
                            "manifest": masked["manifest"],
                            "fingerprints": masked["hits"],
                            "rules_hash": masked["rules_hash"],
                        },
                    },
                },
            )
            assert logged["ok"] is True, logged
        finally:
            proc.stdin.close()
            proc.wait(timeout=5)

        con = sqlite3.connect(journal)
        raw = "\n".join(p for (p,) in con.execute("SELECT payload FROM events"))
        assert SECRET not in raw, "raw secret stored in the journal"
        assert "github_pat" in raw, raw

    print("PASS: mem/1 envelope, mask manifest, journal custody")
    return 0


if __name__ == "__main__":
    sys.exit(main())
