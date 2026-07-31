#!/usr/bin/env python3
"""One bounded full recovery per architecture on the ~4 MiB micro corpus.

Never reruns full main-corpus recover. Each architecture runs exactly once;
timeout is 300 s and a timeout is recorded as deferred_long_run, never retried.

Black hole semantics: canonical_byte_equivalent (NUL->0x01, trailing sentinel).
Conventional semantics: byte_exact.
Run from labs/storage-kernel cwd.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
MICRO_BIN = os.path.join(BASE, "corpus", "full_trace_recovery_micro.bin")
MICRO_BOUNDARIES = os.path.join(BASE, "corpus", "full_trace_recovery_micro.boundaries.jsonl")
OUT = os.path.join(BASE, "recovery-micro.json")

BH_MICRO_DIR = os.path.join(BASE, "artifacts", "black-hole", "micro")
DB_MICRO_DIR = os.path.join(BASE, "artifacts", "conventional", "micro")
DB_BIN = "./target/release/dcf-db-baseline"
BH_BIN = "./reports/first-matrix/bin/utf8-a1-engine"
TIMEOUT = 300
COMMANDS_LOG = os.path.join(BASE, "commands.log")


def log_command(argv, rc, elapsed_s):
    with open(COMMANDS_LOG, "a") as f:
        f.write(
            "%s\t%s\trc=%s\t%.3fs\n" % (
                time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                json.dumps(argv, ensure_ascii=False), rc, elapsed_s,
            )
        )


def sha256b(data):
    return hashlib.sha256(data).hexdigest()


def run(argv, stdin=""):
    t0 = time.monotonic()
    try:
        proc = subprocess.run(argv, input=stdin.encode(), capture_output=True, timeout=TIMEOUT)
        rc, out, err = proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")
        deferred = False
    except subprocess.TimeoutExpired:
        rc, out, err, deferred = "TIMEOUT", "", "", True
    elapsed = time.monotonic() - t0
    log_command(argv, rc, elapsed)
    return rc, out, err, deferred, elapsed


def main():
    micro = open(MICRO_BIN, "rb").read()
    canonical = bytes(0x01 if b == 0 else b for b in micro)
    expected_bh = sha256b(canonical)
    expected_db = sha256b(micro)
    rows = []

    # ---- black hole: build segment + one recover ----
    shutil.rmtree(BH_MICRO_DIR, ignore_errors=True)
    os.makedirs(BH_MICRO_DIR)
    bh_corpus = os.path.join(BH_MICRO_DIR, "full_trace_recovery_micro.bin")
    with open(bh_corpus, "wb") as f:
        f.write(micro)
    rc, out, err, deferred, elapsed = run([BH_BIN, bh_corpus, "build"])
    if rc != 0 and not deferred:
        print("black hole micro build failed: %s" % err[-400:], file=sys.stderr)
        sys.exit(1)
    t0 = time.monotonic()
    rc, out, err, deferred, elapsed = run([BH_BIN, bh_corpus, "calibrate"],
                                          stdin='{"op":"recover"}\n')
    if deferred:
        rows.append({
            "dataset_id": "full_trace_recovery_micro", "architecture_id": "black_hole",
            "status": "deferred_long_run", "timeout_seconds": TIMEOUT,
            "input_bytes": len(micro),
        })
    else:
        r = json.loads(out.splitlines()[0])
        recovered_sha = r["recovered_sha256"]
        recovered_bytes = r["bytes"]
        # independent check: drop documented trailing sentinel if present
        trimmed_ok = recovered_sha == expected_bh
        size_ok = recovered_bytes in (len(micro), len(micro) + 1)
        rows.append({
            "dataset_id": "full_trace_recovery_micro", "architecture_id": "black_hole",
            "input_bytes": len(micro),
            "elapsed_ms": round(elapsed * 1e3, 1),
            "recovered_bytes": recovered_bytes,
            "recovered_sha256": recovered_sha,
            "expected_sha256": expected_bh,
            "sha256_match": trimmed_ok,
            "size_contract_ok": size_ok,
            "recovery_semantics": "canonical_byte_equivalent",
            "structures_read": ["CSA self-index"],
            "steps": ["load CSA", "extract every byte via CSA extract", "trim documented sentinel", "sha256 compare"],
            "engine_reported_match": r.get("sha256_match"),
        })
        print("black_hole micro recover: %.1fs match=%s" % (elapsed, trimmed_ok), file=sys.stderr)

    # ---- conventional: build db + one recover ----
    shutil.rmtree(DB_MICRO_DIR, ignore_errors=True)
    os.makedirs(DB_MICRO_DIR)
    rc, out, err, deferred, elapsed = run([
        DB_BIN, MICRO_BIN, MICRO_BOUNDARIES, DB_MICRO_DIR, "build"])
    if rc != 0 and not deferred:
        print("conventional micro build failed: %s" % err[-400:], file=sys.stderr)
        sys.exit(1)
    rc, out, err, deferred, elapsed = run([DB_BIN, MICRO_BIN, MICRO_BOUNDARIES, DB_MICRO_DIR, "recover"])
    if deferred:
        rows.append({
            "dataset_id": "full_trace_recovery_micro", "architecture_id": "conventional_db",
            "status": "deferred_long_run", "timeout_seconds": TIMEOUT,
            "input_bytes": len(micro),
        })
    else:
        r = json.loads(out.splitlines()[0])
        ok = r.get("recovered_sha256") == expected_db and r.get("bytes") == len(micro)
        rows.append({
            "dataset_id": "full_trace_recovery_micro", "architecture_id": "conventional_db",
            "input_bytes": len(micro),
            "elapsed_ms": r.get("elapsed_ms"),
            "recovered_bytes": r.get("bytes"),
            "recovered_sha256": r.get("recovered_sha256"),
            "expected_sha256": expected_db,
            "sha256_match": ok,
            "size_contract_ok": r.get("bytes") == len(micro),
            "recovery_semantics": "byte_exact",
            "structures_read": ["text_blocks directory", "text.zstpack"],
            "steps": ["load block directory", "decompress frames in order", "concatenate", "sha256 compare"],
        })
        print("conventional micro recover: %.1fs match=%s" % (elapsed, ok), file=sys.stderr)

    with open(OUT, "w") as f:
        json.dump({"dataset_id": "full_trace_recovery_micro",
                   "input_bytes": len(micro),
                   "input_sha256": sha256b(micro),
                   "recoveries": rows,
                   "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")},
                  f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("WROTE", OUT, file=sys.stderr)


if __name__ == "__main__":
    main()
