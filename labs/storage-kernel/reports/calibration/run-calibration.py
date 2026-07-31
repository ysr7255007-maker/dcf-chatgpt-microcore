#!/usr/bin/env python3
"""Calibration experiment: separated operations for SDSL and zstd-full-scan.

Phases:
- main:    count_only / locate_first_1/10/100 / locate_all / extract_128b|1k|8k
           (30 reps each, P50/P95) plus storage / build_time / open_time.
- recover: recover_all runs ONCE per (dataset x engine) after the main matrix;
           verifies recovered SHA-256 against the corpus, records total time,
           peak RSS and success. Never blocks the main matrix.

Outputs:
- reports/calibration/results.jsonl  (appended incrementally, resumable)
- reports/calibration/summary.md     (tables + statuses + retraction statements)
- reports/calibration/machine.json
"""
import argparse
import json
import os
import resource
import subprocess
import sys

REPS = 30
OPEN_REPS = 10
RESULTS_PATH = "reports/calibration/results.jsonl"
PROGRESS_PATH = "reports/calibration/progress.json"
RAW_TIMES_PATH = "reports/calibration/raw-times.json"

DATASETS = [
    ("legacy_message_text", "reports/first-matrix/corpus/legacy_message_text.bin",
     "reports/first-matrix/truth/truth-sets.jsonl"),
    ("full_trace", "reports/second-matrix/corpus/full_trace.bin",
     "reports/second-matrix/truth/truth-sets.jsonl"),
]

ENGINES = [
    ("utf8-a1-sdsl", "./reports/first-matrix/bin/utf8-a1-engine-v2"),
    ("zstd-full-scan", "./target/release/zstd-locate-engine"),
]

SEARCH_OPS = [
    ("count_only", "count", 0),
    ("locate_first_1", "locate", 1),
    ("locate_first_10", "locate", 10),
    ("locate_first_100", "locate", 100),
    ("locate_all", "locate", 0),
]

EXTRACT_OPS = [
    ("extract_128b", 128),
    ("extract_1k", 1024),
    ("extract_8k", 8192),
]

os.makedirs("reports/calibration", exist_ok=True)


def load_state():
    completed = set()
    if os.path.exists(PROGRESS_PATH):
        with open(PROGRESS_PATH) as f:
            completed = set(json.load(f))
    raw_times = {}
    if os.path.exists(RAW_TIMES_PATH):
        with open(RAW_TIMES_PATH) as f:
            raw_times = {k: list(v) for k, v in json.load(f).items()}
    return completed, raw_times


def save_state(completed, raw_times):
    with open(PROGRESS_PATH, "w") as f:
        json.dump(sorted(completed), f)
    with open(RAW_TIMES_PATH, "w") as f:
        json.dump({k: v for k, v in sorted(raw_times.items())}, f)


def load_results():
    rows = []
    if os.path.exists(RESULTS_PATH):
        with open(RESULTS_PATH) as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    return rows


def append_results(entries):
    with open(RESULTS_PATH, "a") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


def run_engine(binary, corpus, instructions, timeout=7200):
    """Send JSON-lines instructions to an engine in calibrate mode."""
    input_str = "\n".join(json.dumps(i, ensure_ascii=False) for i in instructions) + "\n"
    proc = subprocess.run(
        [binary, corpus, "calibrate"],
        input=input_str,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "engine %s failed rc=%d: %s" % (binary, proc.returncode, proc.stderr[-800:])
        )
    results = []
    for line in proc.stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        results.append(json.loads(line))
    if len(results) != len(instructions):
        raise RuntimeError(
            "engine %s: expected %d results, got %d" % (binary, len(instructions), len(results))
        )
    return results


def run_mode(binary, corpus, mode, timeout=7200):
    proc = subprocess.run([binary, corpus, mode], capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(
            "engine %s mode %s failed rc=%d: %s"
            % (binary, mode, proc.returncode, proc.stderr[-800:])
        )
    return json.loads(proc.stdout.strip().split("\n")[-1])


def peak_rss_bytes():
    """Max RSS of all child processes so far (darwin: bytes)."""
    ru = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return ru if sys.platform == "darwin" else ru * 1024


def percentile(sorted_values, pct):
    if not sorted_values:
        return 0.0
    idx = int(len(sorted_values) * pct / 100)
    return sorted_values[min(idx, len(sorted_values) - 1)]


def fmt_pair(v):
    return "%.1f/%.1f" % (v[0], v[1])


def mark_done(completed, raw_times, all_results, key, entries, times_key=None, times=None):
    completed.add(key)
    if times_key is not None:
        raw_times.setdefault(times_key, []).extend(times)
    append_results(entries)
    all_results.extend(entries)
    save_state(completed, raw_times)
    print("    [saved] %s (%d entries)" % (key, len(entries)), file=sys.stderr)


def run_main(datasets, engines, completed, raw_times, all_results):
    for dataset_id, corpus_path, truth_path in datasets:
        print("\n=== Dataset: %s (main matrix) ===" % dataset_id, file=sys.stderr)
        truths = []
        with open(truth_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    truths.append(json.loads(line))

        extract_spans = []
        for t in truths:
            if t.get("expected_spans"):
                extract_spans.append((t["query_id"], t["expected_spans"][0]["start"]))
            if len(extract_spans) == 3:
                break
        print("  extract spans: %s" % extract_spans, file=sys.stderr)

        for engine_id, engine_bin in engines:
            print("  Engine: %s" % engine_id, file=sys.stderr)

            for t in truths:
                qid = t["query_id"]
                qstr = t["query_str"]
                truth_count = t["expected_count"]

                for op_name, op_type, limit in SEARCH_OPS:
                    key = "%s|%s|search|%s|%s" % (dataset_id, engine_id, qid, op_name)
                    if key in completed:
                        continue
                    instructions = []
                    for _ in range(REPS):
                        ins = {"op": op_type, "pattern": qstr}
                        if op_type == "locate":
                            ins["limit"] = limit
                        instructions.append(ins)

                    batch = run_engine(engine_bin, corpus_path, instructions, timeout=900)
                    times = [r["time_us"] for r in batch]
                    returned = batch[0].get("returned", batch[0].get("count", 0))
                    if op_type == "count" or op_name == "locate_all":
                        correct = returned == truth_count
                    else:
                        correct = returned == min(limit, truth_count)
                    times.sort()
                    entry = {
                        "dataset_id": dataset_id, "engine_id": engine_id,
                        "query_id": qid, "truth_count": truth_count,
                        "operation": op_name, "requested_limit": limit,
                        "returned_count": returned,
                        "p50_us": round(percentile(times, 50), 1),
                        "p95_us": round(percentile(times, 95), 1),
                        "repetitions": REPS, "correct": correct,
                    }
                    mark_done(completed, raw_times, all_results, key, [entry],
                              times_key="%s|%s|%s|%s" % (dataset_id, engine_id, op_name, qid),
                              times=times)
                    print("    %s %s: p50=%.0fus ok=%s"
                          % (qid, op_name, entry["p50_us"], correct), file=sys.stderr)

            for span_qid, base_span in extract_spans:
                for ext_name, ext_size in EXTRACT_OPS:
                    key = "%s|%s|extract|%s|%s" % (dataset_id, engine_id, span_qid, ext_name)
                    if key in completed:
                        continue
                    instructions = [
                        {"op": "extract", "start": base_span, "end": base_span + ext_size}
                        for _ in range(REPS)
                    ]
                    batch = run_engine(engine_bin, corpus_path, instructions, timeout=900)
                    times = [r["time_us"] for r in batch]
                    times.sort()
                    entry = {
                        "dataset_id": dataset_id, "engine_id": engine_id,
                        "query_id": span_qid, "truth_count": 0,
                        "operation": ext_name, "requested_limit": ext_size,
                        "returned_count": ext_size,
                        "p50_us": round(percentile(times, 50), 1),
                        "p95_us": round(percentile(times, 95), 1),
                        "repetitions": REPS, "correct": True,
                    }
                    mark_done(completed, raw_times, all_results, key, [entry],
                              times_key="%s|%s|%s" % (dataset_id, engine_id, ext_name),
                              times=times)
                    print("    %s %s: p50=%.1fus" % (span_qid, ext_name, entry["p50_us"]),
                          file=sys.stderr)

            # storage (index/store bytes) + build_time (1 rep) + open_time (10 reps)
            key_storage = "%s|%s|storage" % (dataset_id, engine_id)
            if key_storage not in completed:
                if engine_id == "utf8-a1-sdsl":
                    index_bytes = os.path.getsize(corpus_path + ".csa")
                else:
                    index_bytes = os.path.getsize(corpus_path + ".zstd")
                input_bytes = os.path.getsize(corpus_path)
                entry = {
                    "dataset_id": dataset_id, "engine_id": engine_id,
                    "query_id": "storage", "truth_count": 0,
                    "operation": "storage", "requested_limit": 0,
                    "returned_count": index_bytes,
                    "index_bytes": index_bytes, "input_bytes": input_bytes,
                    "bytes_per_input": round(index_bytes / input_bytes, 4),
                    "p50_us": 0.0, "p95_us": 0.0, "repetitions": 1, "correct": True,
                }
                mark_done(completed, raw_times, all_results, key_storage, [entry])
                print("    storage: index=%d input=%d ratio=%.4f"
                      % (index_bytes, input_bytes, entry["bytes_per_input"]), file=sys.stderr)

            key_build = "%s|%s|build" % (dataset_id, engine_id)
            if key_build not in completed:
                r = run_mode(engine_bin, corpus_path, "build", timeout=1800)
                entry = {
                    "dataset_id": dataset_id, "engine_id": engine_id,
                    "query_id": "build", "truth_count": 0,
                    "operation": "build", "requested_limit": 0,
                    "returned_count": r.get("index_bytes", 0),
                    "index_bytes": r.get("index_bytes", 0),
                    "input_bytes": r.get("input_bytes", 0),
                    "p50_ms": round(r["build_time_ms"], 1),
                    "p95_ms": round(r["build_time_ms"], 1),
                    "repetitions": 1, "correct": True,
                }
                mark_done(completed, raw_times, all_results, key_build, [entry],
                          times_key="%s|%s|build" % (dataset_id, engine_id),
                          times=[r["build_time_ms"] * 1000.0])
                print("    build: %.1f ms" % entry["p50_ms"], file=sys.stderr)

            key_open = "%s|%s|open" % (dataset_id, engine_id)
            if key_open not in completed:
                times = []
                for _ in range(OPEN_REPS):
                    r = run_mode(engine_bin, corpus_path, "open", timeout=600)
                    times.append(r["open_time_ms"] * 1000.0)
                times.sort()
                entry = {
                    "dataset_id": dataset_id, "engine_id": engine_id,
                    "query_id": "open", "truth_count": 0,
                    "operation": "open", "requested_limit": 0,
                    "returned_count": 0,
                    "p50_us": round(percentile(times, 50), 1),
                    "p95_us": round(percentile(times, 95), 1),
                    "repetitions": OPEN_REPS, "correct": True,
                }
                mark_done(completed, raw_times, all_results, key_open, [entry],
                          times_key="%s|%s|open" % (dataset_id, engine_id), times=times)
                print("    open: p50=%.1fus p95=%.1fus" % (entry["p50_us"], entry["p95_us"]),
                      file=sys.stderr)


def run_recover(datasets, engines, completed, raw_times, all_results):
    print("\n=== recover_all (once per dataset x engine) ===", file=sys.stderr)
    for dataset_id, corpus_path, truth_path in datasets:
        for engine_id, engine_bin in ENGINES:
            key = "%s|%s|recover|rep0" % (dataset_id, engine_id)
            if key in completed:
                print("    [skip] %s" % key, file=sys.stderr)
                continue
            print("    running %s / %s recover_all..." % (dataset_id, engine_id), file=sys.stderr)
            sys.stderr.flush()
            batch = run_engine(engine_bin, corpus_path, [{"op": "recover"}], timeout=14400)
            r = batch[0]
            entry = {
                "dataset_id": dataset_id, "engine_id": engine_id,
                "query_id": "recover_all", "truth_count": 0,
                "operation": "recover_all", "requested_limit": 0,
                "returned_count": r.get("bytes", 0),
                "corpus_bytes": r.get("corpus_bytes", 0),
                "p50_us": round(r["time_us"], 1),
                "p95_us": round(r["time_us"], 1),
                "repetitions": 1, "correct": True,
                "recovered_sha256": r.get("recovered_sha256", ""),
                "expected_sha256": r.get("expected_sha256", ""),
                "sha256_match": bool(r.get("sha256_match", False)),
                "peak_rss_bytes": peak_rss_bytes(),
                "success": True,
            }
            mark_done(completed, raw_times, all_results, key, [entry],
                      times_key="%s|%s|recover_all" % (dataset_id, engine_id),
                      times=[r["time_us"]])
            print("    recover_all %s/%s: %.1fs sha256_match=%s peak_rss=%d bytes"
                  % (dataset_id, engine_id, entry["p50_us"] / 1e6,
                     entry["sha256_match"], entry["peak_rss_bytes"]), file=sys.stderr)


def main_matrix_complete(completed, datasets, engines):
    for dataset_id, _, _ in datasets:
        for engine_id, _ in engines:
            for t in ["count_only", "locate_first_1", "locate_first_10",
                      "locate_first_100", "locate_all"]:
                # per-query keys checked loosely by prefix below
                pass
    # check all search/extract/storage/build/open keys exist
    required = []
    for dataset_id, _, truth_path in datasets:
        with open(truth_path) as f:
            truths = [json.loads(l) for l in f if l.strip()]
        spans = [t for t in truths if t.get("expected_spans")][:3]
        for engine_id, _ in engines:
            for t in truths:
                for op_name, _, _ in SEARCH_OPS:
                    required.append("%s|%s|search|%s|%s" % (dataset_id, engine_id, t["query_id"], op_name))
            for t in spans:
                for ext_name, _ in EXTRACT_OPS:
                    required.append("%s|%s|extract|%s|%s" % (dataset_id, engine_id, t["query_id"], ext_name))
            required.append("%s|%s|storage" % (dataset_id, engine_id))
            required.append("%s|%s|build" % (dataset_id, engine_id))
            required.append("%s|%s|open" % (dataset_id, engine_id))
    missing = [k for k in required if k not in completed]
    return (not missing), missing


def recover_complete(completed, datasets, engines):
    missing = ["%s|%s|recover|rep0" % (ds, eng)
               for ds, _, _ in datasets for eng, _ in engines
               if "%s|%s|recover|rep0" % (ds, eng) not in completed]
    return (not missing), missing


def write_summary(all_results, raw_times, completed, datasets, engines):
    main_done, main_missing = main_matrix_complete(completed, datasets, engines)
    rec_done, rec_missing = recover_complete(completed, datasets, engines)

    lines = []
    lines.append("# Storage Kernel 操作语义校准 - 结果")
    lines.append("")
    lines.append("Date: 2026-08-01")
    lines.append("Protocol: engine `calibrate` mode (count / locate / extract / recover 分离操作)")
    lines.append("Repetitions: Count/Locate/Extract 30 次; Open 10 次; Build/Storage 1 次; RecoverAll 每个数据集×引擎 1 次")
    lines.append("Cache state: application-hot")
    lines.append("")
    lines.append("## 撤回声明")
    lines.append("")
    lines.append('- "zstd在高频搜索上快10-18倍" -> 撤回（测的是枚举全部命中，不是用户搜索）')
    lines.append('- "交叉点在700-900个结果" -> 撤回')
    lines.append('- "Locate-only+zstd空间比为0.29-0.33" -> 撤回（当前是zstd-full-scan，不是Locate-only）')
    lines.append('- "Spec全部实现" -> 撤回')
    lines.append("")
    lines.append("保留的窄结论：")
    lines.append("- Full Trace比Legacy表现出更强的zstd可压缩性")
    lines.append("- 枚举全部高频命中时，当前SDSL Locate成本很高")
    lines.append("- 全文扫描延迟近似随语料字节规模增长")
    lines.append("")

    lines.append("## 状态")
    lines.append("")
    lines.append("search_matrix_status: %s" % ("complete" if main_done else "pending"))
    if main_missing:
        lines.append("- 未完成: %d 项" % len(main_missing))
    lines.append("full_recovery_status: %s" % ("complete" if rec_done else "pending"))
    if rec_missing:
        lines.append("- 未完成: %s" % ", ".join(rec_missing))
    lines.append("")

    lines.append("## 表 1 - 搜索操作延迟 (P50/P95, us)")
    lines.append("")
    lines.append("| Dataset | Engine | Query | Truth Count | Count | Locate1 | Locate10 | Locate100 | LocateAll |")
    lines.append("|---------|--------|-------|------------:|------:|--------:|---------:|----------:|----------:|")
    search_rows = {}
    for r in all_results:
        if r["operation"] in ("count_only", "locate_first_1", "locate_first_10",
                              "locate_first_100", "locate_all"):
            key = (r["dataset_id"], r["engine_id"], r["query_id"])
            search_rows.setdefault(key, {})[r["operation"]] = (r["p50_us"], r["p95_us"])
            search_rows[key]["_truth"] = r["truth_count"]
    for (ds, eng, qid), ops in sorted(search_rows.items()):
        lines.append("| %s | %s | %s | %d | %s | %s | %s | %s | %s |"
                     % (ds, eng, qid, ops["_truth"],
                        fmt_pair(ops.get("count_only", (0, 0))),
                        fmt_pair(ops.get("locate_first_1", (0, 0))),
                        fmt_pair(ops.get("locate_first_10", (0, 0))),
                        fmt_pair(ops.get("locate_first_100", (0, 0))),
                        fmt_pair(ops.get("locate_all", (0, 0)))))
    lines.append("")

    lines.append("## 表 2 - 正文提取与完整恢复")
    lines.append("")
    lines.append("| Dataset | Engine | Extract128B P50/P95 (us) | Extract1KiB P50/P95 (us) | Extract8KiB P50/P95 (us) | RecoverAll 总耗时 (s) | SHA-256 |")
    lines.append("|---------|--------|--------------------------:|-------------------------:|-------------------------:|----------------------:|---------|")
    for (ds, eng) in sorted({(r["dataset_id"], r["engine_id"]) for r in all_results}):
        def cell(op):
            vals = sorted(raw_times.get("%s|%s|%s" % (ds, eng, op), []))
            return fmt_pair((percentile(vals, 50), percentile(vals, 95))) if vals else "n/a"
        rec_rows = [r for r in all_results
                    if r["dataset_id"] == ds and r["engine_id"] == eng
                    and r["operation"] == "recover_all"]
        if rec_rows:
            r = rec_rows[0]
            rec_cell = "%.1f" % (r["p50_us"] / 1e6)
            hash_cell = "match" if r.get("sha256_match") else "MISMATCH"
            rss_cell = ""
        else:
            rec_cell = "pending"
            hash_cell = "n/a"
        lines.append("| %s | %s | %s | %s | %s | %s | %s |"
                     % (ds, eng, cell("extract_128b"), cell("extract_1k"),
                        cell("extract_8k"), rec_cell, hash_cell))
    lines.append("")

    lines.append("## 表 3 - 存储 / 构建 / 打开")
    lines.append("")
    lines.append("| Dataset | Engine | Index/Store bytes | bytes/input | Build (ms) | Open P50/P95 (ms) |")
    lines.append("|---------|--------|------------------:|------------:|-----------:|------------------:|")
    for (ds, eng) in sorted({(r["dataset_id"], r["engine_id"]) for r in all_results}):
        st = [r for r in all_results if r["dataset_id"] == ds and r["engine_id"] == eng
              and r["operation"] == "storage"]
        bd = [r for r in all_results if r["dataset_id"] == ds and r["engine_id"] == eng
              and r["operation"] == "build"]
        op = [r for r in all_results if r["dataset_id"] == ds and r["engine_id"] == eng
              and r["operation"] == "open"]
        st_c = "n/a" if not st else "%d" % st[0]["returned_count"]
        ratio_c = "n/a" if not st else "%.4f" % st[0]["bytes_per_input"]
        bd_c = "n/a" if not bd else "%.1f" % bd[0]["p50_ms"]
        op_c = "n/a" if not op else fmt_pair((op[0]["p50_us"] / 1e3, op[0]["p95_us"] / 1e3))
        lines.append("| %s | %s | %s | %s | %s | %s |" % (ds, eng, st_c, ratio_c, bd_c, op_c))
    lines.append("")

    lines.append("## 正确性")
    lines.append("")
    search_entries = [r for r in all_results if r["operation"].startswith(("count", "locate"))]
    n_ok = sum(1 for r in search_entries if r["correct"])
    lines.append("搜索操作（全部 truth set 查询，不允许 14/15）：%d/%d correct" % (n_ok, len(search_entries)))
    lines.append("")
    for ds, _, _ in datasets:
        for eng, _ in engines:
            rows = [r for r in search_entries if r["dataset_id"] == ds and r["engine_id"] == eng]
            bad = [r for r in rows if not r["correct"]]
            lines.append("- %s / %s: %d/%d correct%s"
                         % (ds, eng, len(rows) - len(bad), len(rows),
                            "" if not bad else " FAIL: %s"
                            % [r["query_id"] + "/" + r["operation"] for r in bad]))
    lines.append("")

    recover_rows = [r for r in all_results if r["operation"] == "recover_all"]
    for r in recover_rows:
        lines.append("- recover_all %s / %s: %s, %.1f s, sha256 %s, peak_rss %d bytes"
                     % (r["dataset_id"], r["engine_id"],
                        "success" if r.get("success") else "failure",
                        r["p50_us"] / 1e6,
                        "match" if r.get("sha256_match") else "MISMATCH",
                        r.get("peak_rss_bytes", 0)))
    lines.append("")
    lines.append("注：SDSL recover_all 原始字节数比语料多 1 字节（CSA 哨兵字符，逐字节 extract 的既有行为）；"
                 "构建时 NUL 字节规范化为 0x01（sdsl 字节字母表哨兵限制），"
                 "SHA-256 校验在丢弃尾部哨兵后、按规范化字节比对。")
    lines.append("")
    with open("reports/calibration/summary.md", "w") as f:
        f.write("\n".join(lines))


def write_machine():
    base = {}
    try:
        with open("reports/first-matrix/machine.json") as f:
            base = json.load(f)
    except OSError:
        pass

    def sha256(path):
        import hashlib
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    machine = {
        "machine_id": base.get("machine_id", "looydeMacBook-Pro"),
        "platform": base.get("platform", ""),
        "arch": base.get("arch", ""),
        "cpu": base.get("cpu", ""),
        "compilers": base.get("compilers", {}),
        "sdsl_config": base.get("sdsl_config", ""),
        "zstd_config": base.get("zstd_config", ""),
        "engine_binaries": {
            "utf8-a1-sdsl": {
                "path": "./reports/first-matrix/bin/utf8-a1-engine-v2",
                "sha256": sha256("reports/first-matrix/bin/utf8-a1-engine-v2"),
            },
            "zstd-full-scan": {
                "path": "./target/release/zstd-locate-engine",
                "sha256": sha256("target/release/zstd-locate-engine"),
            },
        },
        "calibration": {
            "repetitions": REPS,
            "open_repetitions": OPEN_REPS,
            "recover_repetitions_per_engine": 1,
            "cache_state": "application-hot",
            "operations": [op for op, _, _ in SEARCH_OPS] + [op for op, _ in EXTRACT_OPS]
                          + ["storage", "build", "open", "recover_all"],
        },
        "generated_at": "2026-08-01",
    }
    with open("reports/calibration/machine.json", "w") as f:
        json.dump(machine, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["main", "recover", "all"], default="all")
    ap.add_argument("--dataset", default=None, help="dataset id filter")
    ap.add_argument("--engine", default=None, help="engine id filter")
    args = ap.parse_args()

    datasets = [d for d in DATASETS if not args.dataset or d[0] == args.dataset]
    engines = [e for e in ENGINES if not args.engine or e[0] == args.engine]

    completed, raw_times = load_state()
    all_results = load_results()

    if args.phase in ("main", "all"):
        run_main(datasets, engines, completed, raw_times, all_results)
    if args.phase in ("recover", "all"):
        run_recover(datasets, engines, completed, raw_times, all_results)

    write_summary(all_results, raw_times, completed, DATASETS, ENGINES)
    write_machine()

    n_search = sum(1 for r in all_results if r["operation"].startswith(("count", "locate")))
    n_ok = sum(1 for r in all_results if r["operation"].startswith(("count", "locate")) and r["correct"])
    print("\nTotal: %d results; search correctness %d/%d"
          % (len(all_results), n_ok, n_search), file=sys.stderr)


if __name__ == "__main__":
    main()
