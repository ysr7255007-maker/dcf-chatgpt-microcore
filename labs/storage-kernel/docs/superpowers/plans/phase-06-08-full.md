# Phase 6-8: Experiments, Claims & Final Deliverables

## 🔲 Phase 6: Conclusion-Driven Experiment Packs - 结论驱动实验包

**目标**: 所有实验先跑正确性，再跑性能；每组报告包含 P50、P95、样本数和原始样本文件

### Pack A: Legacy Reproduction
- 在 `legacy_message_text` 上复跑旧 UTF-8 A1 基线
- 确认新框架与旧沙盒的差异来源

### Pack B: Unicode vs UTF-8
对所有正式投影重测:
- full storage bill (build time, peak RSS, open time)
- count / locate / extract (128B / 1KiB / 8KiB)
- full recovery
- bytes/input-byte ratio

**禁止**: 只用 13 层对 8 层解释性能，需记录相同 canonical Span 下的总 rank/access 工作量

### Pack C: Locate-only + zstd
比较:
- UTF-8 locate-only + zstd
- Unicode locate-only + zstd
- self-index
- self-index + independent original body
- raw artifact + projection index

**缓存状态**: application-hot / application-cold / OS-hot / process-cold / storage-cold

### Pack D: SA/ISA Sampling Frontier
扫描:
- SA = 32, 64, 128, 256, 512, 1024, 2048
- ISA = disabled, sparse, normal

记录平均与 P95 LF 步数，不允许一个任意配置代表整条路线

### Pack E: Grammar Reopening
至少在以下语料上测试：
- full_trace
- raw_json_exact
- component_thinking
- component_tool_use
- component_tool_result

**完整统计**: rule table / top-level sequence / codebook / random extract / full recovery / build time / peak RSS

只有在完整结构化语料上仍显著输给 zstd，才能正式关闭 Grammar 路线

### Pack F: Redundancy, r-index & Deduplication
分别测:
- BWT runs r
- n/r ratio
- LZ phrase count
- exact message/block dedup
- stable-hash dedup
- CDC (Content-