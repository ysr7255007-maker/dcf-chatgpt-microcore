# Second Performance Matrix - Full Trace Results

Date: 2026-08-01
Dataset: full_trace (text + thinking + tool_use + tool_result)
Repetitions: 30 per query
Cache state: application-hot

---

## Summary Table

| Dataset | Engine | Input | Total storage | Build | bytes/input | Correct |
|---------|--------|------:|--------------:|------:|------------:|---------|
| full_trace | utf8-a1-sdsl | 50.5 MB | 21.6 MB | 8,446 ms | 0.428 | 14/14 |
| full_trace | utf8-locate-zstd | 50.5 MB | 14.6 MB | 9,929 ms | 0.289 | 14/14 |

---

## Per-Query Latency (P50, microseconds)

| Query ID | Expected | SDSL P50 | SDSL P95 | zstd P50 | zstd P95 |
|----------|----------:|----------:|----------:|----------:|----------:|
| zh-high-freq-1 (需要) | 17,545 | 1,545,980 | 1,743,600 | 132,756 | 152,594 |
| zh-high-freq-2 (可以) | 12,380 | 1,074,230 | 1,250,980 | 131,930 | 143,804 |
| zh-high-freq-3 (建议) | 3,468 | 300,367 | 354,471 | 132,816 | 157,345 |
| zh-medium (实际上) | 889 | 77,070 | 98,993 | 116,192 | 127,632 |
| en-identifier-2 (read_file) | 76 | 5,372 | 6,561 | 115,725 | 123,959 |
| code-path (/Users/) | 227 | 16,653 | 17,923 | 132,486 | 149,628 |
| tool-name (tool_use) | 3,085 | 269,559 | 347,915 | 115,965 | 130,813 |
| tool-result-marker | 2,915 | 194,106 | 261,943 | 116,178 | 134,708 |
| thinking-content (我觉得) | 716 | 62,799 | 70,942 | 115,701 | 123,305 |
| absent-sentinel | 0 | 21 | 36 | 83,804 | 99,157 |
| en-reasoning | 2 | 553 | 744 | 84,228 | 114,764 |
| tool-use-marker | 2,942 | 257,574 | 334,042 | 116,216 | 119,843 |

---

## Cross-Dataset Comparison (legacy vs full_trace)

| Metric | legacy_message_text | full_trace | Ratio |
|--------|--------------------:|-----------:|------:|
| Input bytes | 22.6 MB | 50.5 MB | 2.24x |
| SDSL index | 9.98 MB | 21.6 MB | 2.16x |
| zstd store | 7.49 MB | 14.6 MB | 1.95x |
| SDSL bytes/input | 0.441 | 0.428 | - |
| zstd bytes/input | 0.331 | 0.289 | - |

Key observation: zstd compression ratio IMPROVES on full_trace (0.289 vs 0.331)
because tool_use/tool_result content is highly repetitive JSON.

---

## Key Findings (Full Trace)

1. **Correctness**: Both engines 14/14 PASS. No protocol bugs on this query set.

2. **High-frequency locate**: zstd still 10-12x faster than SDSL.
   - SDSL locate(17,545 results) = 1.5 seconds
   - zstd scan(50.5 MB) = 133 ms

3. **Low-frequency locate**: SDSL 150-4000x faster.
   - SDSL locate(2 results) = 553 us
   - zstd scan = 84 ms

4. **Crossover point**: Around 700-900 results, both engines take similar time (~70-120 ms).

5. **Storage**: zstd 32% smaller than SDSL on full_trace.
   - zstd benefits from repetitive tool JSON (0.289x vs 0.428x)

6. **Scale behavior**: Both engines scale linearly with input size.
   - SDSL: 2.24x input -> 2.16x index (slightly sublinear)
   - zstd: 2.24x input -> 1.95x store (compression improves with more repetitive data)

---

## Full Trace Gate Verification

- [x] 四类块均进入 (text: 14,601 + thinking: 5,619 + tool_use: 2,941 + tool_result: 2,915)
- [x] thinking 不是占位符 (full content extracted)
- [x] 工具输入和结果保留完整序列化内容
- [x] 投影字节数、SHA-256 和块数固定 (deterministic)
- [x] 未知块不得静默丢弃 (97 unknown blocks included)
- [x] 抽样 Span 能追溯到源消息和块 (via content_blocks table)
