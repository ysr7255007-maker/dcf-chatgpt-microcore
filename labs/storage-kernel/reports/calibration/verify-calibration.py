#!/usr/bin/env python3
"""Independent cross-check of calibration results against truth sets.

For every (dataset, engine, query):
  - count_only / locate_all returned_count must equal expected_count
  - locate_first_K returned_count must equal min(K, expected_count)
Prints per-dataset/engine summary; exits non-zero on any mismatch.
"""
import json
import sys

DATASETS = [
    ("legacy_message_text", "reports/first-matrix/truth/truth-sets.jsonl"),
    ("full_trace", "reports/second-matrix/truth/truth-sets.jsonl"),
]

def main():
    results = [json.loads(l) for l in open("reports/calibration/results.jsonl") if l.strip()]
    search = [r for r in results if r["operation"].startswith(("count", "locate"))]

    problems = []
    for ds, truth_path in DATASETS:
        truths = {}
        with open(truth_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    t = json.loads(line)
                    truths[t["query_id"]] = t["expected_count"]

        for engine_id in ("utf8-a1-sdsl", "zstd-full-scan"):
            rows = [r for r in search if r["dataset_id"] == ds and r["engine_id"] == engine_id]
            checked = 0
            for r in rows:
                expected = truths[r["query_id"]]
                op = r["operation"]
                if op == "count_only" or op == "locate_all":
                    ok = r["returned_count"] == expected
                else:
                    limit = r["requested_limit"]
                    ok = r["returned_count"] == min(limit, expected)
                checked += 1
                if not ok:
                    problems.append((ds, engine_id, r["query_id"], op, expected, r["returned_count"]))
            print("%s / %s: %d rows checked" % (ds, engine_id, checked))

    if problems:
        for p in problems:
            print("MISMATCH:", p)
        print("FAIL: %d mismatches" % len(problems))
        sys.exit(1)
    print("ALL PASS: every search operation matches truth counts")


if __name__ == "__main__":
    main()
