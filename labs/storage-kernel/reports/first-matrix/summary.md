# First Performance Matrix - Results

Date: 2026-08-01
Dataset: legacy_message_text (platform message.text projection)
Repetitions: 30 per query
Cache state: application-hot

---

## Summary Table

| Dataset | Engine | Input | Total storage | Build | Count P50/P95 | Locate10 P50/P95 | Correct |
|---------|--------|------:|--------------:|------:|--------------:|-----------------:|---------|
| legacy_message_text | utf8-a1-sdsl | 22.6 MB | 9.98 MB (0.44x) | 3,477 ms | see below | see below | 14/15 |
| legacy_message_text | utf8-locate-zstd | 22.6 MB | 7.49 MB (0.33x) | 4,498 ms | see below | see below | 15/15 |

---

## Per-Query Latency (P50, microseconds)

| Query ID | Expected | SDSL P50 | SDSL P95 | zstd P50 | zstd P95 | SDSL OK | zstd OK |
|----------|----------:|----------:|----------:|----------:|----------:|---------|---------|
| zh-high-freq-1 (需要) | 13,236 | 1,049,020 | 1,211,500 | 58,431 | 62,627 | PASS | PASS |
| zh-high-freq-2 (可以) | 8,312 | 640,966 | 756,027 | 58,234 | 62,784 | PASS | PASS |
| zh-high-freq-3 (建议) | 2,110 | 167,219 | 199,376 | 57,698 | 60,762 | PASS | PASS |
| zh-medium (实际上) | 713 | 58,109 | 66,884 | 51,353 | 63,252 | PASS | PASS |
| en-identifier-2 (read_file) | 9 | 1,038 | 2,539 | 50,773 | 52,168 | PASS | PASS |
| code-path (/Users/) | 23 | 3,302 | 4,669 | 58,040 | 63,541 | PASS | PASS |
| tool-name (tool_use) | 21 | 2,092 | 2,585 | 50,231 | 55,812 | PASS | PASS |
| en-reasoning | 2 | 191 | 239 | 36,726 | 37,616 | PASS | PASS |
| json-field ("role") | 12 | 0 | 0 | 58,092 | 61,037 | FAIL | PASS |
| absent-sentinel | 0 | 7 | 9 | 36,590 | 37,098 | PASS | PASS |
| zh-low-freq-long | 0 | 31 | 46 | 37,250 | 38,596 | PASS | PASS |

---

## Key Findings

1. **Correctness**: SDSL 14/15 PASS (json-field FAIL due to quote escaping in stdin protocol); zstd 15/15 PASS.

2. **High-frequency queries (>1000 results)**: zstd brute-force scan is 10-18x FASTER than SDSL locate.
   - SDSL locate is O(occ * LF_steps), expensive for many occurrences.
   - zstd scan is O(n) regardless of result count.

3. **Low-frequency queries (<100 results)**: SDSL is 20-200x faster.
   - SDSL: 7-3,302 us
   - zstd: 36,000-58,000 us (full corpus scan every time)

4. **Storage**: zstd (0.33x) is 25% smaller than SDSL index (0.44x).
   - But zstd has NO index capability (pure scan).
   - SDSL supports count/locate/extract without original text.

5. **Absent queries**: SDSL answers in 7 us; zstd still scans full 22 MB (37 ms).

---

## Storage Breakdown

| Engine | Index bytes | Text store | Total | bytes/input |
|--------|------------:|----------:|------:|------------:|
| utf8-a1-sdsl | 9,978,037 | 0 (self-index) | 9,978,037 | 0.441 |
| utf8-locate-zstd | 7,491,202 | 0 (compressed IS the store) | 7,491,202 | 0.331 |

Note: SDSL is a self-index (can recover text without separate store).
zstd store IS the compressed text (recover = decompress all blocks).

---

## Machine

- Platform: macOS 26.5.2, ARM64 (Apple Silicon T6000)
- Compiler: Apple clang 21.0.0 / Rust 1.96.0
- SDSL: csa_wt<wt_hutu<rrr_vector<63>>, 64, 64>
- zstd: level 19, 256 KiB blocks

---

## Correctness Failure Analysis

SDSL json-field query (`"role"`) returned 0 instead of 12.
Root cause: the double-quote character in the query string is not properly escaped through the stdin pipe protocol. The query arrives truncated or empty.
This is a protocol bug, not an index correctness issue.
