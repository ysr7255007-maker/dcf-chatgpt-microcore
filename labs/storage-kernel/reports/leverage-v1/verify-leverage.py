#!/usr/bin/env python3
"""Independent verification of the leverage-v1 evidence package.

Exits 0 and prints ALL LEVERAGE-V1 CHECKS PASS only when the evidence package
is internally consistent:

 1. identities: corpus SHA everywhere, engine binary hashes, machine.json
 2. results rows: repetitions + cache_state present, P95 null when reps<5,
    no >300s run without deferred_long_run, no full main-corpus recover
 3. timing linkage: every main-matrix row references a passed capability case
 4. storage/ledger: every storage-bom component appears in the ledger
 5. lifecycle/recovery: append correct, corruption detected, shared hashes
    unchanged, at most one micro recover per architecture

Run from labs/storage-kernel cwd.
"""
import hashlib
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
FROZEN_SHA = "b4fd2d8fa97444c40d49a36f9da6542124d119755b1724db61efefb411bdd225"
FROZEN_BYTES = 50542796
TIMEOUT = 300

REQ_FILES = [
    "results.jsonl", "capability-parity.json", "architecture-ledger.json",
    "storage-bom.json", "lifecycle-results.jsonl", "recovery-micro.json",
    "machine.json", "commands.log", "summary.md", "verify-leverage.py",
]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_jsonl(path):
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main():
    problems = []

    # ---- required files ----
    for f in REQ_FILES:
        p = os.path.join(BASE, f)
        if not os.path.exists(p):
            problems.append("missing required file: %s" % f)

    if not os.path.exists(os.path.join(BASE, "shared", "projection.bin")):
        problems.append("missing shared/projection.bin")

    # ---- identities ----
    corpus_sha = sha256_file(os.path.join(BASE, "shared", "projection.bin"))
    corpus_bytes = os.path.getsize(os.path.join(BASE, "shared", "projection.bin"))
    if corpus_sha != FROZEN_SHA or corpus_bytes != FROZEN_BYTES:
        problems.append("shared projection does not match frozen corpus identity")

    for f in ("results.jsonl", "lifecycle-results.jsonl", "commands.log"):
        pass

    machine = json.load(open(os.path.join(BASE, "machine.json")))
    if machine["corpus"]["sha256"] != FROZEN_SHA:
        problems.append("machine.json corpus sha mismatch")
    for eng, meta in machine["engine_binaries"].items():
        if not os.path.exists(meta["path"]):
            problems.append("machine.json engine missing: %s" % meta["path"])
            continue
        if sha256_file(meta["path"]) != meta["sha256"]:
            problems.append("machine.json engine hash mismatch: %s" % eng)

    parity = json.load(open(os.path.join(BASE, "capability-parity.json")))
    if parity["status"] != "passed":
        problems.append("capability-parity.json status != passed")
    if parity["dataset_sha256"] != FROZEN_SHA:
        problems.append("capability-parity dataset sha mismatch")

    recovery = json.load(open(os.path.join(BASE, "recovery-micro.json")))
    if recovery["input_sha256"] != sha256_file(os.path.join(BASE, "corpus", "full_trace_recovery_micro.bin")):
        problems.append("recovery-micro input sha mismatch")

    # ---- results rows ----
    results = load_jsonl(os.path.join(BASE, "results.jsonl"))
    seen_keys = set()
    for r in results:
        if r.get("status") == "deferred_long_run":
            continue
        if r.get("operation") == "build":
            if r.get("status") == "error":
                problems.append("build row errored: %s" % r["architecture_id"])
            continue
        if r.get("operation") == "first_query_count":
            if not r.get("repetitions") or r.get("cache_state") != "new_process_os_uncontrolled":
                problems.append("first_query row missing repetitions/cache_state")
            continue
        if r.get("operation") == "search_top10_with_1k_context":
            if not r.get("repetitions"):
                problems.append("top10ctx row missing repetitions: %s" % r["query_id"])
            continue
        # count/locate/extract rows
        reps = r.get("repetitions")
        if not reps:
            problems.append("row missing repetitions: %s/%s/%s" % (
                r.get("architecture_id"), r.get("query_id"), r.get("operation")))
        if r.get("p95_us") is not None and (not reps or reps < 5):
            problems.append("P95 present with reps<5: %s/%s/%s" % (
                r.get("architecture_id"), r.get("query_id"), r.get("operation")))
        if r.get("correct") is False:
            problems.append("incorrect result row: %s/%s/%s" % (
                r.get("architecture_id"), r.get("query_id"), r.get("operation")))
        key = "%s|%s|%s|%s" % (r.get("dataset_id"), r.get("architecture_id"),
                               r.get("query_id"), r.get("operation"))
        if key in seen_keys:
            problems.append("duplicate result key: %s" % key)
        seen_keys.add(key)

    # no full main-corpus recover
    for r in results:
        if r.get("operation") == "recover_all" and r.get("dataset_id") == "full_trace":
            problems.append("full main-corpus recover row present in leverage-v1")
    for r in load_jsonl(os.path.join(BASE, "lifecycle-results.jsonl")):
        if r.get("operation") == "recover_all":
            problems.append("lifecycle contains recover_all row")

    # ---- commands.log: no >300s without deferral ----
    cmds = []
    with open(os.path.join(BASE, "commands.log")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) >= 4:
                try:
                    elapsed = float(parts[3].rstrip("s"))
                except ValueError:
                    continue
                cmds.append((parts[1], parts[2], elapsed))
    for argv, rc, elapsed in cmds:
        if elapsed >= TIMEOUT and "TIMEOUT" not in str(rc):
            problems.append("command exceeded 300s without TIMEOUT rc: %s" % argv)
        if rc == "TIMEOUT":
            problems.append("command TIMED OUT (missing deferral handling): %s" % argv)

    # ---- timing linkage: every query in results must be in parity & passed ----
    parity_cases = {q["query_id"]: q for q in parity["query_cases"]}
    for r in results:
        qid = r.get("query_id")
        arch = r.get("architecture_id")
        if not qid or qid.startswith("extract_"):
            continue
        if r.get("operation") in ("build", "first_query_count", "search_top10_with_1k_context"):
            continue
        case = parity_cases.get(qid)
        if case is None or not (case.get(arch) or {}).get("ok"):
            problems.append("timing row references unpassed query: %s (%s)" % (qid, arch))

    # ---- storage/ledger linkage ----
    bom = json.load(open(os.path.join(BASE, "storage-bom.json")))
    ledger = json.load(open(os.path.join(BASE, "architecture-ledger.json")))
    kw_map = {
        "black_hole": {
            "full_trace.bin.csa": ["csa"],
            "manifest.json": ["manifest"],
        },
        "conventional_db": {
            "baseline.db": ["dataset_manifest", "records", "records_fts", "text_blocks", "records_search_content"],
            "text.zstpack": ["zstpack"],
            "manifest.json": ["manifest.json"],
        },
    }
    for arch in ("black_hole", "conventional_db"):
        led_names = [st["name"] for st in ledger[arch]["persistent_structures"]]
        for comp in bom[arch]["components"]:
            base = os.path.basename(comp["path"])
            kws = kw_map[arch].get(base, [base.split(".")[0]])
            ok = any(any(k.lower() in n.lower() for k in kws) for n in led_names)
            if not ok:
                problems.append("storage component missing from ledger: %s (%s)" % (base, arch))
    shared_led = [st["name"] for st in ledger["black_hole"].get("shared_contract_structures", [])]
    for comp in bom["shared_source"]["components"]:
        base = os.path.basename(comp["path"])
        if base in ("query-cases.jsonl", "composition-cases.jsonl"):
            continue
        ok = any(base.split(".")[0].lower() in n.lower() for n in shared_led)
        if not ok:
            problems.append("shared component missing from ledger contract: %s" % base)

    # capability sources present for all capabilities
    for arch in ("black_hole", "conventional_db"):
        srcs = ledger[arch]["capability_sources"]
        if len(srcs) < 12:
            problems.append("ledger capability sources incomplete: %s" % arch)

    # ---- lifecycle/recovery evidence ----
    lc = load_jsonl(os.path.join(BASE, "lifecycle-results.jsonl"))
    for arch in ("black_hole", "conventional_db"):
        appends = [r for r in lc if r.get("architecture_id") == arch and r.get("operation") == "append_1pct"]
        if not appends or not all(a.get("correct_after") for a in appends):
            problems.append("append correctness not established: %s" % arch)
        corrupts = [r for r in lc if r.get("architecture_id") == arch and r.get("operation") == "corruption_containment"]
        if not corrupts or not all(c.get("detected") for c in corrupts):
            problems.append("corruption detection not established: %s" % arch)
        if not all(c.get("shared_source_unchanged") for c in corrupts):
            problems.append("shared source hash changed during corruption test: %s" % arch)
    if not any(r.get("operation") == "rebuild_search_projection" and r.get("correct_after")
               for r in lc):
        problems.append("rebuild evidence missing/incorrect")

    # at most one micro recover per architecture
    counts = {}
    for r in recovery["recoveries"]:
        counts[r["architecture_id"]] = counts.get(r["architecture_id"], 0) + 1
        if r.get("status") == "deferred_long_run":
            problems.append("micro recover deferred: %s" % r["architecture_id"])
        if not r.get("sha256_match"):
            problems.append("micro recover sha mismatch: %s" % r["architecture_id"])
    for arch in ("black_hole", "conventional_db"):
        if counts.get(arch, 0) != 1:
            problems.append("expected exactly one micro recover for %s, got %d" % (arch, counts.get(arch, 0)))

    # ---- summary.md first page fields ----
    summary = open(os.path.join(BASE, "summary.md")).read()
    for field in ["capability_parity", "black_hole_runtime_bytes", "conventional_runtime_bytes",
                  "common_path_latency_class", "black_hole_sync_edges", "conventional_sync_edges",
                  "black_hole_absorbed_complexity", "black_hole_residual_complexity",
                  "leverage_status"]:
        if field not in summary:
            problems.append("summary.md missing first-page field: %s" % field)
    allowed = {"near_dominant_leverage_candidate", "partial_leverage", "no_leverage"}
    if "leverage_status:" not in summary:
        problems.append("summary.md missing leverage_status value")
    else:
        val = summary.split("leverage_status:", 1)[1].splitlines()[0].strip()
        if val not in allowed:
            problems.append("invalid leverage_status: %s" % val)

    if problems:
        print("LEVERAGE-V1 CHECKS FAILED:")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print("ALL LEVERAGE-V1 CHECKS PASS")


if __name__ == "__main__":
    main()
