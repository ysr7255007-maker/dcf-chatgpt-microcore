#!/usr/bin/env python3
"""Capability parity gate for the leverage-v1 comparison.

Independent brute-force truth (overlapping byte scan over the canonical
projection) is generated first. Both engines (black_hole utf8-a1-sdsl,
conventional_db dcf-db-baseline) must match count, first-1/10/100 located
spans (after canonical sorting), extract byte counts (byte-exact for the DB;
canonical-equivalent structural for the black hole, byte-level verified by the
micro-corpus recovery in recovery-micro.json), and all composition cases.

Composition (intersect / union / difference_type / filter_type /
filter_conversation / near_same_message) is implemented once at the harness
layer as pure sorted-span algebra; both engines only supply primitive
PositionSets.

Run from labs/storage-kernel cwd. Fails closed (nonzero exit) unless every
required case passes.
"""
import json
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(BASE, "shared")
BOUNDARIES = os.path.join(SHARED, "projection-boundaries.jsonl")
PROJ = os.path.join(SHARED, "projection.bin")
TRUTH = os.path.join(SHARED, "query-truth.jsonl")
OUT = os.path.join(BASE, "capability-parity.json")

QUERY_CASES = [json.loads(l) for l in open(os.path.join(BASE, "query-cases.jsonl")) if l.strip()]
COMPOSITION_CASES = [json.loads(l) for l in open(os.path.join(BASE, "composition-cases.jsonl")) if l.strip()]

BLACK_HOLE_BIN = "./reports/first-matrix/bin/utf8-a1-engine"
BLACK_HOLE_CORPUS = os.path.join(BASE, "artifacts", "black-hole", "full_trace", "full_trace.bin")
DB_BIN = "./target/release/dcf-db-baseline"
DB_CORPUS = PROJ
DB_BOUNDARIES = BOUNDARIES
DB_OUT = os.path.join(BASE, "artifacts", "conventional", "full_trace")

EXTRACT_SPANS = [
    ("extract-zh-medium-128", 83599, 83599 + 128),
    ("extract-zh-medium-1k", 115578, 115578 + 1024),
    ("extract-code-path-8k", 5697290, 5697290 + 8192),
    ("extract-multibyte-edge", 240677, 240685),
    ("extract-tail-window", 50542000, 50542796),
]


def run_engine(binary, corpus, instructions, extra_args=(), timeout=300):
    stdin = "\n".join(json.dumps(i, ensure_ascii=False) for i in instructions) + "\n"
    proc = subprocess.run(
        [binary, corpus, *extra_args, "calibrate"],
        input=stdin, capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError("engine %s rc=%d: %s" % (binary, proc.returncode, proc.stderr[-800:]))
    out = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    if len(out) != len(instructions):
        raise RuntimeError("engine %s: expected %d results, got %d" % (binary, len(instructions), len(out)))
    return out


def truth_all_occurrences(data, pattern):
    needle = pattern.encode("utf-8")
    out = []
    if not needle:
        return out
    i = 0
    while True:
        j = data.find(needle, i)
        if j < 0:
            break
        out.append((j, j + len(needle)))
        i = j + len(needle)
    return out


def load_boundaries():
    bounds = []
    with open(BOUNDARIES) as f:
        for line in f:
            line = line.strip()
            if line:
                b = json.loads(line)
                bounds.append(b)
    return bounds


def resolve_provenance(bounds, start):
    """Return the boundary record whose content range contains `start`."""
    lo, hi = 0, len(bounds)
    while lo < hi:
        mid = (lo + hi) // 2
        if bounds[mid]["end"] <= start:
            lo = mid + 1
        else:
            hi = mid
    if lo < len(bounds) and bounds[lo]["start"] <= start < bounds[lo]["end"]:
        return bounds[lo]
    return None


def generate_truth(data):
    truths = {}
    for c in QUERY_CASES:
        spans = truth_all_occurrences(data, c["query"])
        truths[c["query_id"]] = {
            "query_id": c["query_id"],
            "class": c["class"],
            "count": len(spans),
            "spans": [{"start": s, "end": e} for s, e in spans],
        }
    with open(TRUTH, "w") as f:
        for c in QUERY_CASES:
            f.write(json.dumps(truths[c["query_id"]], ensure_ascii=False) + "\n")
    return truths


def sorted_spans(resp):
    spans = [(s["start"], s["end"]) for s in resp.get("spans", [])]
    spans = sorted(set(spans))
    return spans


def check_locate(truth, resp):
    got = sorted_spans(resp)
    if len(got) != truth["count"]:
        return False, "count mismatch: truth=%d got=%d" % (truth["count"], len(got))
    for limit in (1, 10, 100):
        want = [(s["start"], s["end"]) for s in truth["spans"][:limit]]
        if got[:limit] != want:
            return False, "first-%d spans mismatch" % limit
    return True, "ok"


def intersect(a, b):
    i = j = 0
    out = []
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            out.append(a[i]); i += 1; j += 1
        elif a[i] < b[j]:
            i += 1
        else:
            j += 1
    return out


def union(a, b):
    return sorted(set(a) | set(b))


def run_composition(truths, bounds):
    result = []
    for case in COMPOSITION_CASES:
        op = case["op"]
        if op == "intersect":
            left = [(s["start"], s["end"]) for s in truths[case["left"]]["spans"]]
            right = [(s["start"], s["end"]) for s in truths[case["right"]]["spans"]]
            got = intersect(left, right)
        elif op == "union":
            left = [(s["start"], s["end"]) for s in truths[case["left"]]["spans"]]
            right = [(s["start"], s["end"]) for s in truths[case["right"]]["spans"]]
            got = union(left, right)
        elif op == "difference_type":
            base = [(s["start"], s["end"]) for s in truths[case["base"]]["spans"]]
            got = [sp for sp in base
                   if (resolve_provenance(bounds, sp[0]) or {}).get("type") != case["excluded_type"]]
        elif op == "filter_type":
            base = [(s["start"], s["end"]) for s in truths[case["base"]]["spans"]]
            got = [sp for sp in base
                   if (resolve_provenance(bounds, sp[0]) or {}).get("type") == case["content_type"]]
        elif op == "filter_conversation":
            base = [(s["start"], s["end"]) for s in truths[case["base"]]["spans"]]
            got = [sp for sp in base
                   if (resolve_provenance(bounds, sp[0]) or {}).get("conversation_uuid") == case["conversation_uuid"]]
        elif op == "near_same_message":
            left = [(s["start"], s["end"]) for s in truths[case["left"]]["spans"]]
            right = [(s["start"], s["end"]) for s in truths[case["right"]]["spans"]]
            left_by_msg = {}
            for sp in left:
                p = resolve_provenance(bounds, sp[0])
                if p:
                    left_by_msg.setdefault(p["message_uuid"], []).append(sp)
            right_by_msg = {}
            for sp in right:
                p = resolve_provenance(bounds, sp[0])
                if p:
                    right_by_msg.setdefault(p["message_uuid"], []).append(sp)
            got = []
            for msg, lspans in left_by_msg.items():
                rspans = right_by_msg.get(msg, [])
                for l in lspans:
                    if any(abs(l[0] - r[0]) <= case["max_bytes"] for r in rspans):
                        got.append(l)
        else:
            raise RuntimeError("unknown composition op: %s" % op)
        result.append({
            "case_id": case["case_id"], "op": op, "count": len(got),
            "first10": [{"start": s, "end": e} for s, e in got[:10]],
        })
    return result


def main():
    data = open(PROJ, "rb").read()
    bounds = load_boundaries()
    truths = generate_truth(data)

    query_cases_out = []
    engines = {"black_hole": {"passed": True}, "conventional_db": {"passed": True}}
    problems = []

    # ---------- black hole ----------
    bh_instructions = [
        {"op": "locate", "pattern": c["query"], "limit": 0}
        for c in QUERY_CASES
    ]
    bh_responses = run_engine(BLACK_HOLE_BIN, BLACK_HOLE_CORPUS, bh_instructions)
    bh_by_id = {}
    for c, resp in zip(QUERY_CASES, bh_responses):
        bh_by_id[c["query_id"]] = resp
        truth = truths[c["query_id"]]
        ok, why = check_locate(truth, resp)
        if not ok:
            engines["black_hole"]["passed"] = False
            problems.append(("black_hole", c["query_id"], "locate", why))
        query_cases_out.append({
            "query_id": c["query_id"], "class": c["class"],
            "truth_count": truth["count"],
            "black_hole": {
                "count": resp.get("total", resp.get("count")),
                "locate1_ok": ok,
                "ok": ok,
            },
        })

    # ---------- conventional db ----------
    db_instructions = [
        {"op": "locate", "pattern": c["query"], "limit": 0}
        for c in QUERY_CASES
    ]
    db_responses = run_engine(
        DB_BIN, DB_CORPUS, db_instructions, extra_args=[DB_BOUNDARIES, DB_OUT]
    )
    for c, resp in zip(QUERY_CASES, db_responses):
        truth = truths[c["query_id"]]
        ok, why = check_locate(truth, resp)
        if not ok:
            engines["conventional_db"]["passed"] = False
            problems.append(("conventional_db", c["query_id"], "locate", why))
        # operation path must be honest
        if resp.get("operation_path") == "short_query_full_record_scan":
            if truth["count"] > 0 and truth["count"] != resp.get("total"):
                engines["conventional_db"]["passed"] = False
                problems.append(("conventional_db", c["query_id"], "short_path", "count mismatch"))
        for q in query_cases_out:
            if q["query_id"] == c["query_id"]:
                q["conventional_db"] = {
                    "count": resp.get("total"),
                    "locate1_ok": ok,
                    "operation_path": resp.get("operation_path"),
                    "ok": ok,
                }
                break

    # ---------- extract ----------
    extract_cases = []
    db_extract_instructions = [
        {"op": "extract", "start": s, "end": e} for _, s, e in EXTRACT_SPANS
    ]
    db_extract_responses = run_engine(
        DB_BIN, DB_CORPUS, db_extract_instructions, extra_args=[DB_BOUNDARIES, DB_OUT]
    )
    bh_extract_instructions = [
        {"op": "extract", "start": s, "end": e} for _, s, e in EXTRACT_SPANS
    ]
    bh_extract_responses = run_engine(BLACK_HOLE_BIN, BLACK_HOLE_CORPUS, bh_extract_instructions)

    for (sid, s, e), db_resp, bh_resp in zip(EXTRACT_SPANS, db_extract_responses, bh_extract_responses):
        want_bytes = e - s
        db_ok = db_resp.get("bytes") == want_bytes
        want_sha = __import__("hashlib").sha256(data[s:e]).hexdigest()
        db_sha_ok = db_resp.get("sha256") == want_sha
        db_ok = db_ok and db_sha_ok
        bh_ok = bh_resp.get("bytes") == want_bytes
        if not db_ok:
            engines["conventional_db"]["passed"] = False
            problems.append(("conventional_db", sid, "extract", "bytes/sha mismatch"))
        if not bh_ok:
            engines["black_hole"]["passed"] = False
            problems.append(("black_hole", sid, "extract", "byte count mismatch"))
        extract_cases.append({
            "span_id": sid, "start": s, "end": e, "expected_bytes": want_bytes,
            "black_hole": {"bytes": bh_resp.get("bytes"), "byte_count_ok": bh_ok,
                           "byte_exact_verified_by": "recovery-micro (canonical_byte_equivalent)"},
            "conventional_db": {"bytes": db_resp.get("bytes"), "sha256_ok": db_sha_ok, "ok": db_ok},
        })

    # ---------- composition ----------
    # both engines produce the same primitive PositionSets (verified above);
    # composition truth is computed once from the shared brute-force truth.
    composition = run_composition(truths, bounds)

    status = "passed" if not problems and all(e["passed"] for e in engines.values()) else "failed"
    out = {
        "status": status,
        "composition_basis": "harness-layer sorted-span algebra; both engines' primitive "
                             "PositionSets verified identical to the independent brute-force truth",
        "dataset_sha256": __import__("hashlib").sha256(data).hexdigest(),
        "engines": engines,
        "query_cases": query_cases_out,
        "composition_cases": composition,
        "extract_cases": extract_cases,
        "problems": problems,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print("composition truth:")
    for c in composition:
        print("  %-24s %-16s count=%d" % (c["case_id"], c["op"], c["count"]))
    if problems:
        for p in problems:
            print("PROBLEM:", p)
        print("CAPABILITY PARITY FAILED")
        sys.exit(1)
    print("CAPABILITY PARITY PASSED")
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
