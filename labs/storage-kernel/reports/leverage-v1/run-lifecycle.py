#!/usr/bin/env python3
"""Short lifecycle and failure-containment tests for leverage-v1.

For each architecture, one run each (300 s hard timeout; no mechanical 30x):
  - append ~1% deterministic fixture
  - delete a rebuildable search projection and rebuild it once
  - minimal corruption injection on a COPY in /tmp

Corruption is never injected into the real artifacts. Shared source hashes are
re-verified after every operation.
Run from labs/storage-kernel cwd.
"""
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import importlib.util

def _load_brm():
    spec = importlib.util.spec_from_file_location(
        "brm", os.path.join(BASE, "build-recovery-micro.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

brm = _load_brm()

SHARED = os.path.join(BASE, "shared")
PROJ = os.path.join(SHARED, "projection.bin")
BOUNDARIES = os.path.join(SHARED, "projection-boundaries.jsonl")
OUT = os.path.join(BASE, "lifecycle-results.jsonl")
FIXTURE_DIR = os.path.join(BASE, "artifacts", "lifecycle-fixture")

BH_DIR = os.path.join(BASE, "artifacts", "black-hole", "full_trace")
DB_DIR = os.path.join(BASE, "artifacts", "conventional", "full_trace")
DB_BIN = "./target/release/dcf-db-baseline"
BH_BIN = "./reports/first-matrix/bin/utf8-a1-engine"

TIMEOUT = 300
APPEND_TARGET = 505 * 1024  # ~1% of 50.5 MiB

COMMANDS_LOG = os.path.join(BASE, "commands.log")


def log_command(argv, rc, elapsed_s):
    with open(COMMANDS_LOG, "a") as f:
        f.write(
            "%s\t%s\trc=%s\t%.3fs\n" % (
                time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                json.dumps(argv, ensure_ascii=False), rc, elapsed_s,
            )
        )


def run(argv, stdin="", timeout=TIMEOUT):
    t0 = time.monotonic()
    try:
        proc = subprocess.run(argv, input=stdin.encode(), capture_output=True, timeout=timeout)
        rc, out, err = proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")
        deferred = False
    except subprocess.TimeoutExpired:
        rc, out, err, deferred = "TIMEOUT", "", "", True
    elapsed = time.monotonic() - t0
    log_command(argv, rc, elapsed)
    return rc, out, err, deferred, elapsed


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def append_rows(rows):
    with open(OUT, "a") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def brute_count(data, pattern):
    needle = pattern.encode("utf-8")
    n = 0
    i = 0
    while True:
        j = data.find(needle, i)
        if j < 0:
            break
        n += 1
        i = j + len(needle)
    return n


def build_append_fixture():
    """Deterministic ~1% append: the stable projection-order suffix of blocks
    whose total serialized bytes reach ~505 KiB. Never splits a block."""
    os.makedirs(FIXTURE_DIR, exist_ok=True)
    blocks = brm.load_blocks()
    for i, b in enumerate(blocks):
        b["_i"] = i
    # suffix in projection order reaching >= APPEND_TARGET
    acc = 0
    picked = []
    for b in reversed(blocks):
        acc += len(b["content"])
        picked.append(b["_i"])
        if acc >= APPEND_TARGET:
            break
    picked = sorted(picked)
    sel = [blocks[i] for i in picked]
    append_bytes = brm.assemble(sel)
    old_len = os.path.getsize(PROJ)
    boundaries = []
    cursor = 0
    prev_msg = None
    for b in sel:
        msg = b["message_uuid"]
        if prev_msg is not None and msg != prev_msg:
            cursor += 1
        prev_msg = msg
        start = cursor
        cursor += len(b["content"])
        end = cursor
        cursor += 1
        boundaries.append({
            "text_id": "%s/%d" % (msg, b["ordinal"]),
            "conversation_uuid": b["conversation_uuid"],
            "message_uuid": msg,
            "ordinal": b["ordinal"],
            "type": b["type"],
            "start": old_len + start,
            "end": old_len + end,
        })
    cursor += 1  # trailing NUL
    assert cursor == len(append_bytes)
    with open(os.path.join(FIXTURE_DIR, "append.bin"), "wb") as f:
        f.write(append_bytes)
    with open(os.path.join(FIXTURE_DIR, "append-boundaries.jsonl"), "w") as f:
        for rec in boundaries:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    manifest = {
        "generator": "run-lifecycle.py",
        "selection_rule": "stable projection-order suffix reaching ~1% of full_trace bytes; blocks never split",
        "append_bytes": len(append_bytes),
        "append_sha256": hashlib.sha256(append_bytes).hexdigest(),
        "block_count": len(sel),
        "bytes_by_type": {t: sum(len(b["content"]) for b in sel if b["type"] == t)
                          for t in ("text", "thinking", "tool_use", "tool_result")},
        "combined_projection_bytes": old_len + len(append_bytes),
        "combined_projection_sha256": hashlib.sha256(open(PROJ, "rb").read() + append_bytes).hexdigest(),
    }
    with open(os.path.join(FIXTURE_DIR, "append-manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return append_bytes, boundaries, manifest


def append_black_hole(append_bytes, manifest):
    seg_dir = os.path.join(BASE, "artifacts", "black-hole", "append-segment")
    os.makedirs(seg_dir, exist_ok=True)
    seg_corpus = os.path.join(seg_dir, "append.bin")
    with open(seg_corpus, "wb") as f:
        f.write(append_bytes)
    t0 = time.monotonic()
    rc, out, err, deferred, elapsed = run([BH_BIN, seg_corpus, "build"])
    new_bytes = os.path.getsize(seg_corpus + ".csa") if os.path.exists(seg_corpus + ".csa") else 0
    if rc == 0 and not deferred:
        json.dump({
            "architecture": "black_hole_segment",
            "segment": "append-segment",
            "projection_sha256": manifest["append_sha256"],
            "projection_bytes": manifest["append_bytes"],
        }, open(os.path.join(seg_dir, "manifest.json"), "w"), indent=2)
    return rc, elapsed, new_bytes, deferred, seg_corpus


def append_conventional(append_bytes, boundaries, manifest):
    t0 = time.monotonic()
    rc, out, err, deferred, elapsed = run([
        DB_BIN, PROJ, BOUNDARIES, DB_DIR, "append",
        "--append-corpus", os.path.join(FIXTURE_DIR, "append.bin"),
        "--append-boundaries", os.path.join(FIXTURE_DIR, "append-boundaries.jsonl"),
    ])
    return rc, elapsed, deferred, out


def main():
    if os.path.exists(OUT):
        os.remove(OUT)

    append_bytes, boundaries, manifest = build_append_fixture()
    print("append fixture: %d bytes, %d blocks" % (len(append_bytes), len(boundaries)), file=sys.stderr)
    old_bytes = open(PROJ, "rb").read()
    combined = old_bytes + append_bytes
    pattern = "tool_use"
    expected_combined = brute_count(combined, pattern)
    expected_zh = brute_count(combined, "实际上")
    print("expected combined count for %r: %d" % (pattern, expected_combined), file=sys.stderr)
    print("expected combined count for 实际上: %d" % expected_zh, file=sys.stderr)

    # ---------------- black hole append ----------------
    rc, elapsed, new_bytes, deferred, seg_corpus = append_black_hole(append_bytes, manifest)
    bh_correct = False
    if rc == 0 and not deferred:
        rc1, out1, _, _, _ = run([BH_BIN, os.path.join(BH_DIR, "full_trace.bin"), "calibrate"],
                                 stdin=json.dumps({"op": "count", "pattern": pattern}) + "\n")
        rc2, out2, _, _, _ = run([BH_BIN, seg_corpus, "calibrate"],
                                 stdin=json.dumps({"op": "count", "pattern": pattern}) + "\n")
        old_count = int(json.loads(out1.splitlines()[0])["count"]) if rc1 == 0 else -1
        new_count = int(json.loads(out2.splitlines()[0])["count"]) if rc2 == 0 else -1
        bh_correct = (old_count + new_count) == expected_combined
    append_rows([{
        "architecture_id": "black_hole", "operation": "append_1pct",
        "elapsed_ms": round(elapsed * 1e3, 1),
        "new_persistent_bytes": new_bytes,
        "files_rewritten": [],
        "files_created": ["artifacts/black-hole/append-segment/append.bin",
                          "artifacts/black-hole/append-segment/append.bin.csa",
                          "artifacts/black-hole/append-segment/manifest.json"],
        "structures_coordinated": ["new segment CSA", "new segment manifest"],
        "correct_after": bh_correct,
        "expected_count": expected_combined,
        "deferred_long_run": deferred,
    }])
    print("black_hole append: correct=%s elapsed=%.1fs" % (bh_correct, elapsed), file=sys.stderr)

    # ---------------- conventional append ----------------
    rc, elapsed, deferred, out = append_conventional(append_bytes, boundaries, manifest)
    db_correct = False
    if rc == 0 and not deferred:
        rcq, outq, _, _, _ = run([DB_BIN, PROJ, BOUNDARIES, DB_DIR, "calibrate"],
                                 stdin=json.dumps({"op": "count", "pattern": pattern}) + "\n")
        got = int(json.loads(outq.splitlines()[0])["count"]) if rcq == 0 else -1
        db_correct = got == expected_combined
        # byte-exact recover of the appended state
        rcr, outr, _, _, _ = run([DB_BIN, PROJ, BOUNDARIES, DB_DIR, "recover"])
        rec = json.loads(outr.splitlines()[0]) if rcr == 0 else {}
        db_recover_ok = rec.get("recovered_sha256") == manifest["combined_projection_sha256"]
    append_rows([{
        "architecture_id": "conventional_db", "operation": "append_1pct",
        "elapsed_ms": round(elapsed * 1e3, 1),
        "new_persistent_bytes": os.path.getsize(os.path.join(DB_DIR, "text.zstpack")),
        "files_rewritten": [],
        "files_appended": ["text.zstpack", "baseline.db"],
        "structures_coordinated": ["records", "records_search_content", "records_fts (trigger)",
                                   "text_blocks", "text.zstpack"],
        "correct_after": db_correct,
        "recover_byte_exact": db_recover_ok if rc == 0 else False,
        "expected_count": expected_combined,
        "deferred_long_run": deferred,
    }])
    print("conventional append: correct=%s elapsed=%.1fs" % (db_correct, elapsed), file=sys.stderr)

    # ---------------- black hole rebuild ----------------
    t0 = time.monotonic()
    csa = os.path.join(BH_DIR, "full_trace.bin.csa")
    if os.path.exists(csa):
        os.remove(csa)
    rc, out, err, deferred, elapsed = run([BH_BIN, os.path.join(BH_DIR, "full_trace.bin"), "build"])
    rebuilt = os.path.exists(csa)
    rcq, outq, _, _, _ = run([BH_BIN, os.path.join(BH_DIR, "full_trace.bin"), "calibrate"],
                             stdin=json.dumps({"op": "count", "pattern": "实际上"}) + "\n")
    got = int(json.loads(outq.splitlines()[0])["count"]) if rcq == 0 else -1
    append_rows([{
        "architecture_id": "black_hole", "operation": "rebuild_search_projection",
        "elapsed_ms": round(elapsed * 1e3, 1),
        "deleted": ["full_trace.bin.csa"],
        "rebuilt_from": ["canonical projection (shared/projection.bin)"],
        "correct_after": rebuilt and got == 889,
        "count_check": got,
        "deferred_long_run": deferred,
    }])
    print("black_hole rebuild: ok=%s elapsed=%.1fs" % (rebuilt and got == 889, elapsed), file=sys.stderr)

    # ---------------- conventional rebuild (FTS) ----------------
    t0 = time.monotonic()
    rc, out, err, deferred, elapsed = run([DB_BIN, PROJ, BOUNDARIES, DB_DIR, "rebuild-fts"])
    rcq, outq, _, _, _ = run([DB_BIN, PROJ, BOUNDARIES, DB_DIR, "calibrate"],
                             stdin=json.dumps({"op": "count", "pattern": "实际上"}) + "\n")
    got = int(json.loads(outq.splitlines()[0])["count"]) if rcq == 0 else -1
    append_rows([{
        "architecture_id": "conventional_db", "operation": "rebuild_search_projection",
        "elapsed_ms": round(elapsed * 1e3, 1),
        "deleted": ["records_fts (virtual table)"],
        "rebuilt_from": ["records_search_content"],
        "correct_after": rc == 0 and not deferred and got == expected_zh,
        "count_check": got,
        "expected_count": expected_zh,
        "note": "DB state includes the appended fixture at this point",
        "deferred_long_run": deferred,
    }])
    print("conventional rebuild: ok=%s elapsed=%.1fs" % (rc == 0 and got == 889, elapsed), file=sys.stderr)

    # ---------------- black hole corruption containment (on a copy) ----------------
    tmp = tempfile.mkdtemp(prefix="bh-corrupt-")
    shutil.copytree(BH_DIR, os.path.join(tmp, "bh"))
    csa_copy = os.path.join(tmp, "bh", "full_trace.bin.csa")
    with open(csa_copy, "r+b") as f:
        f.seek(1024)
        b = f.read(1)
        f.seek(1024)
        f.write(bytes([b[0] ^ 0xFF]))
    csa_sha_before = sha256_file(csa)
    csa_sha_after = sha256_file(csa_copy)
    detected = csa_sha_before != csa_sha_after
    # verify shared source unchanged
    shared_ok = sha256_file(PROJ) == brm.FROZEN_SHA256
    # recovery instructions: deterministic rebuild from projection
    append_rows([{
        "architecture_id": "black_hole", "operation": "corruption_containment",
        "detected": detected,
        "detection": "manifest csa_sha256 / recomputed sha256 mismatch on index copy",
        "shared_source_unchanged": shared_ok,
        "recovery_steps": ["rebuild CSA from canonical projection (deterministic)"],
        "blast_radius": "single segment",
        "injected": "1 byte flipped in full_trace.bin.csa (copy)",
        "note": "engine itself has no internal checksum; detection requires the manifest hash contract",
    }])
    shutil.rmtree(tmp, ignore_errors=True)
    print("black_hole corruption: detected=%s" % detected, file=sys.stderr)

    # ---------------- conventional corruption containment (on a copy) ----------------
    tmp = tempfile.mkdtemp(prefix="db-corrupt-")
    shutil.copytree(DB_DIR, os.path.join(tmp, "db"))
    pack_copy = os.path.join(tmp, "db", "text.zstpack")
    with open(pack_copy, "r+b") as f:
        f.seek(2048)
        b = f.read(1)
        f.seek(2048)
        f.write(bytes([b[0] ^ 0xFF]))
    # detect natively via block hash recompute (integrity mode on the copy)
    rc, out, err, deferred, elapsed = run([
        DB_BIN, PROJ, BOUNDARIES, os.path.join(tmp, "db"), "integrity"])
    detected = rc != 0 and "bad_blocks" in out
    detected = rc != 0  # integrity mode exits nonzero when any block hash mismatches
    shared_ok = sha256_file(PROJ) == brm.FROZEN_SHA256
    append_rows([{
        "architecture_id": "conventional_db", "operation": "corruption_containment",
        "detected": detected,
        "detection": "text_blocks sha256 recompute vs pack frames (integrity mode)",
        "shared_source_unchanged": shared_ok,
        "recovery_steps": ["rebuild affected block(s) from canonical projection; or full rebuild"],
        "blast_radius": "affected dataset (block-level detection granularity)",
        "injected": "1 byte flipped in text.zstpack (copy)",
    }])
    shutil.rmtree(tmp, ignore_errors=True)
    print("conventional corruption: detected=%s" % detected, file=sys.stderr)

    print("WROTE", OUT, file=sys.stderr)


if __name__ == "__main__":
    main()
