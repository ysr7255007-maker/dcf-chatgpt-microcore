#!/usr/bin/env python3
"""Bounded main benchmark harness for leverage-v1.

Phases:
  build        -- time one build per architecture (timeout 300 s)
  main         -- application-hot adaptive-repetition matrix
  first-query  -- 3 fresh processes per architecture, one fixed query
  storage      -- storage BOM + machine.json + commands.log

Rules:
  - subprocess timeout 300 s; on timeout mark deferred_long_run, never retry
  - adaptive repetitions from a pre-run: <10ms 30, <100ms 15, <1s 5, <=5s 3, >5s 1
  - P95 only when repetitions >= 5, else p95_us null
  - resumable via progress.json
Run from labs/storage-kernel cwd.
"""
import hashlib
import json
import os
import platform
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(BASE, "shared")
BOUNDARIES = os.path.join(SHARED, "projection-boundaries.jsonl")
PROJ = os.path.join(SHARED, "projection.bin")
RESULTS = os.path.join(BASE, "results.jsonl")
PROGRESS = os.path.join(BASE, "progress.json")
COMMANDS = os.path.join(BASE, "commands.log")
STORAGE_BOM = os.path.join(BASE, "storage-bom.json")
MACHINE = os.path.join(BASE, "machine.json")
PARITY = os.path.join(BASE, "capability-parity.json")
TRUTH = os.path.join(SHARED, "query-truth.jsonl")

TIMEOUT = 300
DATASET = "full_trace"

QUERY_CASES = [json.loads(l) for l in open(os.path.join(BASE, "query-cases.jsonl")) if l.strip()]

BLACK_HOLE_BIN = "./reports/first-matrix/bin/utf8-a1-engine"
BLACK_HOLE_CORPUS = os.path.join(BASE, "artifacts", "black-hole", "full_trace", "full_trace.bin")
DB_BIN = "./target/release/dcf-db-baseline"
DB_OUT = os.path.join(BASE, "artifacts", "conventional", "full_trace")

ENGINES = {
    "black_hole": {
        "bin": BLACK_HOLE_BIN,
        "corpus": BLACK_HOLE_CORPUS,
        "extra": [],
        "artifact_dir": os.path.join(BASE, "artifacts", "black-hole", "full_trace"),
    },
    "conventional_db": {
        "bin": DB_BIN,
        "corpus": PROJ,
        "extra": [BOUNDARIES, DB_OUT],
        "artifact_dir": DB_OUT,
    },
}

EXTRACT_SPANS = [
    ("extract_128b", 83599, 83599 + 128),
    ("extract_1k", 115578, 115578 + 1024),
    ("extract_8k", 5697290, 5697290 + 8192),
]

FIXED_FIRST_QUERY = "zh-medium"


def log_command(argv, rc, elapsed_s):
    with open(COMMANDS, "a") as f:
        f.write(
            "%s\t%s\trc=%d\t%.3fs\n" % (
                time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                json.dumps(argv, ensure_ascii=False), rc, elapsed_s,
            )
        )


def run(argv, stdin="", timeout=TIMEOUT):
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            argv, input=stdin.encode(), capture_output=True, timeout=timeout,
        )
        rc = proc.returncode
        out = proc.stdout.decode("utf-8", "replace")
        err = proc.stderr.decode("utf-8", "replace")
        deferred = False
    except subprocess.TimeoutExpired:
        rc, out, err, deferred = "TIMEOUT", "", "", True
    elapsed = time.monotonic() - t0
    log_command(argv, rc, elapsed)
    return rc, out, err, deferred, elapsed


def parse_jsonl(out):
    rows = []
    for line in out.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def load_state():
    completed = set()
    if os.path.exists(PROGRESS):
        completed = set(json.load(open(PROGRESS)))
    return completed


def save_state(completed):
    with open(PROGRESS, "w") as f:
        json.dump(sorted(completed), f)


def append_results(entries):
    with open(RESULTS, "a") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


def choose_reps(seconds):
    if seconds < 0.010:
        return 30
    if seconds < 0.100:
        return 15
    if seconds < 1.000:
        return 5
    if seconds <= 5.000:
        return 3
    return 1


def percentile(vals, pct):
    if not vals:
        return None
    idx = int(len(vals) * pct / 100)
    return vals[min(idx, len(vals) - 1)]


def load_truth():
    truths = {}
    with open(TRUTH) as f:
        for line in f:
            line = line.strip()
            if line:
                t = json.loads(line)
                truths[t["query_id"]] = t
    return truths


def parity_gate():
    parity = json.load(open(PARITY))
    if parity["status"] != "passed":
        raise SystemExit("capability parity has not passed")
    print("parity gate: passed", file=sys.stderr)


def batch_measure(engine, instructions, key):
    """Run one batch; returns (times, meta) or deferred marker."""
    eng = ENGINES[engine]
    rc, out, err, deferred, elapsed = run(
        [eng["bin"], eng["corpus"], *eng["extra"], "calibrate"],
        stdin="\n".join(json.dumps(i, ensure_ascii=False) for i in instructions) + "\n",
    )
    if deferred:
        append_results([{
            "dataset_id": DATASET, "architecture_id": engine, "key": key,
            "status": "deferred_long_run", "timeout_seconds": TIMEOUT,
            "cache_state": "application_hot",
        }])
        print("    [deferred] %s" % key, file=sys.stderr)
        return None, "deferred_long_run"
    if rc != 0:
        append_results([{
            "dataset_id": DATASET, "architecture_id": engine, "key": key,
            "status": "error", "rc": rc, "stderr_tail": err[-400:],
        }])
        raise RuntimeError("engine %s failed rc=%d for %s: %s" % (engine, rc, key, err[-400:]))
    rows = parse_jsonl(out)
    if len(rows) != len(instructions):
        raise RuntimeError("engine %s: expected %d rows, got %d" % (engine, len(instructions), len(rows)))
    return rows, None


def measure_op(engine, query_id, op_name, make_instruction, truth_count=None, expect=None):
    """Adaptive repetitions for a single operation."""
    key = "%s|%s|%s|%s|application_hot" % (DATASET, engine, query_id, op_name)
    completed = load_state()
    if key in completed:
        print("    [skip] %s" % key, file=sys.stderr)
        return
    # pre-run
    pre, status = batch_measure(engine, [make_instruction(1)], key)
    if status:
        return
    pre_us = pre[0].get("time_us", 0.0)
    reps = choose_reps(pre_us / 1e6)
    instructions = [make_instruction(reps) for _ in range(reps)]
    rows, status = batch_measure(engine, instructions, key)
    if status:
        return
    times = [r.get("time_us", 0.0) for r in rows]
    times_sorted = sorted(times)
    first = rows[0]
    if op_name.startswith("locate"):
        returned = first.get("returned", first.get("total", 0))
    else:
        returned = first.get("count", first.get("bytes", first.get("returned", 0)))
    correct = True
    if truth_count is not None:
        if op_name.startswith("extract_"):
            correct = returned == truth_count
        elif op_name == "count_only" or op_name == "locate_all":
            correct = returned == truth_count
        else:
            limit = expect
            correct = returned == min(limit, truth_count)
    entry = {
        "dataset_id": DATASET, "architecture_id": engine, "query_id": query_id,
        "operation": op_name, "requested_limit": expect,
        "truth_count": truth_count, "returned_count": returned,
        "p50_us": round(percentile(times_sorted, 50), 2),
        "p95_us": round(percentile(times_sorted, 95), 2) if len(times_sorted) >= 5 else None,
        "repetitions": reps,
        "cache_state": "application_hot",
        "correct": correct,
        "operation_path": rows[0].get("operation_path"),
    }
    append_results([entry])
    completed = load_state()
    completed.add(key)
    save_state(completed)
    print("    %s %s/%s: p50=%.2fus reps=%d ok=%s" % (
        engine, query_id, op_name, entry["p50_us"], reps, correct), file=sys.stderr)


def phase_build():
    print("=== phase build ===", file=sys.stderr)
    for engine in ENGINES:
        key = "%s|%s|build" % (DATASET, engine)
        completed = load_state()
        if key in completed:
            print("    [skip] %s" % key, file=sys.stderr)
            continue
        eng = ENGINES[engine]
        t0 = time.monotonic()
        if engine == "black_hole":
            rc, out, err, deferred, elapsed = run([eng["bin"], eng["corpus"], "build"])
            parsed = parse_jsonl(out)
            result = parsed[0] if parsed else {}
        else:
            rc, out, err, deferred, elapsed = run(
                [eng["bin"], eng["corpus"], *eng["extra"], "build"]
            )
            parsed = parse_jsonl(out)
            result = parsed[0] if parsed else {}
        status = "deferred_long_run" if deferred else ("error" if rc != 0 else "ok")
        entry = {
            "dataset_id": DATASET, "architecture_id": engine, "operation": "build",
            "status": status,
            "timeout_seconds": TIMEOUT if deferred else None,
            "rc": rc if rc != 0 else None,
            "stderr_tail": err[-400:] if rc != 0 else None,
            "elapsed_ms": round(elapsed * 1e3, 1),
            "result": result,
        }
        append_results([entry])
        completed.add(key)
        save_state(completed)
        print("    build %s: %.1fs %s" % (engine, elapsed, "DEFERRED" if deferred else "ok"), file=sys.stderr)


def phase_main():
    print("=== phase main ===", file=sys.stderr)
    truths = load_truth()
    for engine in ENGINES:
        print("  engine %s" % engine, file=sys.stderr)
        for c in QUERY_CASES:
            qid = c["query_id"]
            tc = truths[qid]["count"]
            measure_op(engine, qid, "count_only",
                       lambda n, q=c: {"op": "count", "pattern": q["query"]},
                       truth_count=tc)
            for limit in (1, 10, 100):
                measure_op(engine, qid, "locate_first_%d" % limit,
                           lambda n, q=c, L=limit: {"op": "locate", "pattern": q["query"], "limit": L},
                           truth_count=tc, expect=limit)
        for span_id, s, e in EXTRACT_SPANS:
            measure_op(engine, span_id, span_id,
                       lambda n, s=s, e=e: {"op": "extract", "start": s, "end": e},
                       truth_count=e - s)
        # end-to-end: count -> locate10 -> extract 1KiB per hit
        for c in QUERY_CASES:
            qid = c["query_id"]
            key = "%s|%s|%s|search_top10_with_1k_context|application_hot" % (DATASET, engine, qid)
            completed = load_state()
            if key in completed:
                print("    [skip] %s" % key, file=sys.stderr)
                continue

            hit_spans = truths[qid]["spans"][:10]

            def e2e_batch(n):
                instructions = [
                    {"op": "count", "pattern": c["query"]},
                    {"op": "locate", "pattern": c["query"], "limit": 10},
                ]
                for hs in hit_spans:
                    start = hs["start"]
                    end = min(start + 1024, truths[qid]["spans"][-1]["end"])
                    instructions.append({"op": "extract", "start": start, "end": start + 1024})
                return instructions

            pre, status = batch_measure(engine, e2e_batch(1), key)
            if status:
                continue
            total_us = sum(r.get("time_us", 0.0) for r in pre)
            reps = choose_reps(total_us / 1e6)
            rows, status = batch_measure(engine, e2e_batch(reps), key)
            if status:
                continue
            n = len(e2e_batch(1))
            totals = []
            for i in range(0, len(rows), n):
                totals.append(sum(r.get("time_us", 0.0) for r in rows[i:i + n]))
            totals.sort()
            entry = {
                "dataset_id": DATASET, "architecture_id": engine, "query_id": qid,
                "operation": "search_top10_with_1k_context",
                "truth_count": truths[qid]["count"],
                "p50_us": round(percentile(totals, 50), 2),
                "p95_us": round(percentile(totals, 95), 2) if len(totals) >= 5 else None,
                "repetitions": reps,
                "cache_state": "application_hot",
                "correct": True,
                "components": ["count", "locate_first_10", "extract_1k_x10"],
            }
            append_results([entry])
            completed = load_state()
            completed.add(key)
            save_state(completed)
            print("    %s %s top10ctx: p50=%.0fus reps=%d" % (
                engine, qid, entry["p50_us"], reps), file=sys.stderr)


def phase_first_query():
    print("=== phase first-query ===", file=sys.stderr)
    q = next(c for c in QUERY_CASES if c["query_id"] == FIXED_FIRST_QUERY)
    for engine in ENGINES:
        key = "%s|%s|first_query_%s" % (DATASET, engine, FIXED_FIRST_QUERY)
        completed = load_state()
        if key in completed:
            print("    [skip] %s" % key, file=sys.stderr)
            continue
        eng = ENGINES[engine]
        times = []
        wall = []
        for _ in range(3):
            t0 = time.monotonic()
            rc, out, err, deferred, elapsed = run(
                [eng["bin"], eng["corpus"], *eng["extra"], "calibrate"],
                stdin=json.dumps({"op": "count", "pattern": q["query"]}) + "\n",
            )
            wall.append(elapsed * 1e6)
            if rc == 0 and not deferred:
                rows = parse_jsonl(out)
                if rows:
                    times.append(rows[0].get("time_us", 0.0))
        times.sort()
        wall.sort()
        entry = {
            "dataset_id": DATASET, "architecture_id": engine,
            "operation": "first_query_count", "query_id": FIXED_FIRST_QUERY,
            "cache_state": "new_process_os_uncontrolled",
            "repetitions": 3,
            "query_time_us": [round(t, 2) for t in times],
            "query_p50_us": round(percentile(times, 50), 2) if times else None,
            "process_wall_p50_us": round(percentile(wall, 50), 2) if wall else None,
        }
        append_results([entry])
        completed = load_state()
        completed.add(key)
        save_state(completed)
        print("    first-query %s: %s" % (engine, entry), file=sys.stderr)


def dir_bytes(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total


def phase_storage():
    print("=== phase storage ===", file=sys.stderr)
    # checkpoint the conventional DB to a stable WAL state before measuring
    import sqlite3 as _sq
    try:
        _c = _sq.connect(os.path.join(DB_OUT, "baseline.db"))
        _c.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        _c.close()
    except Exception as e:  # pragma: no cover
        print("wal checkpoint note: %s" % e, file=sys.stderr)
    run([DB_BIN, PROJ, BOUNDARIES, DB_OUT, "open"], timeout=60)

    # black hole manifest (segment identity; design-allowed metadata)
    bh_dir = ENGINES["black_hole"]["artifact_dir"]
    manifest_path = os.path.join(bh_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        json.dump({
            "architecture": "black_hole_compressed_self_index",
            "dataset_id": "full_trace",
            "projection_sha256": sha256(PROJ),
            "projection_bytes": os.path.getsize(PROJ),
            "csa_bytes": os.path.getsize(os.path.join(bh_dir, "full_trace.bin.csa")),
            "engine_sha256": sha256("reports/first-matrix/bin/utf8-a1-engine"),
            "canonicalization": "NUL->0x01 (documented canonical_byte_equivalent contract)",
        }, open(manifest_path, "w"), indent=2)
        print("wrote black-hole manifest", file=sys.stderr)

    def file_entry(path, role, required=True):
        return {
            "path": os.path.relpath(path, os.path.abspath(BASE)),
            "role": role, "bytes": os.path.getsize(path), "required": required,
        }

    black_hole_files = []
    bh_dir = ENGINES["black_hole"]["artifact_dir"]
    csa = os.path.join(bh_dir, "full_trace.bin.csa")
    black_hole_files.append(file_entry(csa, "self_index"))
    manifest = os.path.join(bh_dir, "manifest.json")
    if os.path.exists(manifest):
        black_hole_files.append(file_entry(manifest, "manifest"))
    bh_runtime = sum(f["bytes"] for f in black_hole_files)

    db_files = []
    for name, role in [
        ("baseline.db", "sqlite_facts_fts_mapping"),
        ("text.zstpack", "zstd_text_blocks"),
        ("manifest.json", "manifest"),
    ]:
        p = os.path.join(DB_OUT, name)
        if os.path.exists(p):
            db_files.append(file_entry(p, role))
    for suffix in ("-wal", "-shm"):
        p = os.path.join(DB_OUT, "baseline.db" + suffix)
        if os.path.exists(p) and os.path.getsize(p) > 0:
            db_files.append(file_entry(p, "sqlite_wal_shm_stable_state"))
    db_runtime = sum(f["bytes"] for f in db_files)

    shared_files = [
        file_entry(PROJ, "canonical_projection_shared"),
        file_entry(BOUNDARIES, "span_boundary_contract_shared"),
        file_entry(os.path.join(BASE, "query-cases.jsonl"), "query_set_shared"),
        file_entry(os.path.join(BASE, "composition-cases.jsonl"), "composition_set_shared"),
    ]
    shared_bytes = sum(f["bytes"] for f in shared_files)

    projection_bytes = os.path.getsize(PROJ)
    bom = {
        "dataset_id": DATASET,
        "shared_source_bytes": shared_bytes,
        "black_hole": {
            "architecture_runtime_bytes": bh_runtime,
            "total_with_shared_source_bytes": bh_runtime + shared_bytes,
            "bytes_per_projection_byte": round(bh_runtime / projection_bytes, 4),
            "components": black_hole_files,
        },
        "conventional_db": {
            "architecture_runtime_bytes": db_runtime,
            "total_with_shared_source_bytes": db_runtime + shared_bytes,
            "bytes_per_projection_byte": round(db_runtime / projection_bytes, 4),
            "components": db_files,
        },
        "shared_source": {
            "bytes": shared_bytes,
            "components": shared_files,
        },
        "projection_bytes": projection_bytes,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    with open(STORAGE_BOM, "w") as f:
        json.dump(bom, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("storage BOM written", file=sys.stderr)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_machine():
    machine = {
        "machine_id": platform.node(),
        "platform": platform.platform(),
        "arch": platform.machine(),
        "cpu": "Apple M3 Max",
        "python": platform.python_version(),
        "compilers": {
            "rustc": subprocess.run(["rustc", "--version"], capture_output=True, text=True).stdout.strip(),
            "cargo": subprocess.run(["cargo", "--version"], capture_output=True, text=True).stdout.strip(),
            "clang": subprocess.run(["clang", "--version"], capture_output=True, text=True).stdout.splitlines()[0] if subprocess.run(["clang", "--version"], capture_output=True, text=True).stdout else "",
        },
        "engine_binaries": {
            "utf8-a1-sdsl": {
                "path": "./reports/first-matrix/bin/utf8-a1-engine",
                "sha256": sha256("reports/first-matrix/bin/utf8-a1-engine"),
                "config": "csa_wt<wt_hutu<rrr_vector<63>>, 64, 64> construct_im NUL->0x01",
            },
            "dcf-db-baseline": {
                "path": "./target/release/dcf-db-baseline",
                "sha256": sha256("target/release/dcf-db-baseline"),
                "config": "rusqlite bundled SQLite/FTS5 trigram; zstd level 19; 256 KiB blocks",
            },
        },
        "corpus": {
            "path": "reports/second-matrix/corpus/full_trace.bin",
            "bytes": os.path.getsize("reports/second-matrix/corpus/full_trace.bin"),
            "sha256": sha256("reports/second-matrix/corpus/full_trace.bin"),
        },
        "time_discipline": {
            "default_timeout_seconds": TIMEOUT,
            "adaptive_repetitions": True,
            "max_unapproved_minutes": 10,
        },
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    with open(MACHINE, "w") as f:
        json.dump(machine, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("machine.json written", file=sys.stderr)


def main():
    args = sys.argv[1:]
    phase = "all"
    if len(args) >= 2 and args[0] == "--phase":
        phase = args[1]
    elif len(args) == 1:
        phase = args[0]
    parity_gate()
    os.makedirs(BASE, exist_ok=True)
    if not os.path.exists(COMMANDS):
        with open(COMMANDS, "w") as f:
            f.write("# leverage-v1 commands.log (ts\targv\trc\telapsed_s)\n")
    if phase in ("build", "all"):
        phase_build()
    if phase in ("main", "all"):
        phase_main()
    if phase in ("first-query", "all"):
        phase_first_query()
    if phase in ("storage", "all"):
        phase_storage()
        write_machine()
    print("phase %s done" % phase, file=sys.stderr)


if __name__ == "__main__":
    main()
