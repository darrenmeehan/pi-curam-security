#!/usr/bin/env python3
"""Latency and edge-shape probe for the mem/1 mask op. No harness, no model.

The number that matters is the driver's per-request timeout (3000 ms): a mask that
approaches it silently degrades the layer to pass-through. Also asserts the shapes
v1 does not detect (split, base64, spaced, too-short) so the documented gaps stay
measured rather than assumed.
"""
import base64
import json
import os
import shutil
import statistics
import subprocess
import sys
import time

ENGINE = os.environ.get("MEMBRANE_ENGINE") or shutil.which("curam-membrane")
if not ENGINE or not os.access(ENGINE, os.X_OK):
    print("SKIP: no engine (set MEMBRANE_ENGINE or put curam-membrane on PATH)")
    sys.exit(0)

os.environ["CUSEC_JOURNAL"] = os.path.join(os.environ.get("TMPDIR", "/tmp"), "probe-latency.db")
TIMEOUT_MS = 3000


def mask(texts):
    proc = subprocess.Popen([ENGINE], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    times, last = [], ""
    for text in texts:
        envelope = {"v": "mem/1", "id": 1, "op": "mask", "payload": {"text": text}}
        start = time.perf_counter()
        proc.stdin.write(json.dumps(envelope) + "\n")
        proc.stdin.flush()
        last = proc.stdout.readline()
        times.append((time.perf_counter() - start) * 1000)
    proc.stdin.close()
    proc.wait()
    return times, last


TOKEN = "ghp_" + "a" * 36
print(f"engine: {ENGINE}\ntimeout: {TIMEOUT_MS} ms\n")
print(f"{'payload':>18}  {'p50':>8}  {'p95':>8}  {'max':>8}  hits")
worst = 0.0
for label, text in [
    ("1 KB, 20 hits", ("token " + TOKEN + " ") * 20),
    ("100 KB, 200 hits", ("token " + TOKEN + " ") * 200),
    ("1 MB, no hits", "z" * 1_048_576),
    ("1 MB, 200 hits", ("token " + TOKEN + " ") * 200 + "z" * 1_048_576),
]:
    times, last = mask([text] * 6)
    times = times[1:]  # the first call pays process warm-up
    worst = max(worst, max(times))
    hits = len(json.loads(last).get("hits") or [])
    print(f"{label:>18}  {statistics.median(times):>6.1f}ms  {max(times):>6.1f}ms  {max(times):>6.1f}ms  {hits}")

print("\nshapes v1 does not detect (expected: not masked)")
failures = []
for label, text in {
    "split across lines": "ghp_aaaaaaaaaaaaaaa\nbbbbbbbbbbbbbbbbbbbb",
    "base64 of a key": base64.b64encode(b"ghp_" + b"a" * 36).decode(),
    "spaces inside the key": "ghp_ aaa aaa aaa",
    "key under the length floor": "token=abcdefghijk",
}.items():
    _, line = mask([text])
    masked = json.loads(line).get("scrubbed") != text
    print(f"  {label:<26} {'MASKED (docs say it should not be)' if masked else 'not masked'}")
    if masked:
        failures.append(label)

if worst >= TIMEOUT_MS:
    sys.exit(f"FAIL: slowest mask {worst:.0f} ms is at or over the {TIMEOUT_MS} ms timeout")
if failures:
    sys.exit(f"FAIL: {failures} masked unexpectedly — update the documented v1 gaps")
print(f"\nPASS: slowest mask {worst:.0f} ms ({TIMEOUT_MS / worst:.0f}x headroom), documented gaps unchanged")
