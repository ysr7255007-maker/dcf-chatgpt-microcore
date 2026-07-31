# Phase 4-8: Truth Sets, Engines, Experiments, Claims & Deliverables

## 🔲 Phase 4: Truth Sets & Query Workloads - 真值与查询负载

**目标**: 建立字节级真值和真实用户动作回放

### Task 4.1: Byte-level Ground Truth
- 对每个投影进行暴力字节扫描
- 生成 exact count + all spans + expected extract bytes
- 支持重叠命中，不允许只验证"无假阳性"

### Task 4.2: Query Classification
- visible Chinese phrases
- English thinking-only phrases  
- tool names / inputs
- file paths / error messages
- code identifiers / JSON field names
- UUIDs / absent queries

### Task 4.3: Real User Action Replay
固定链路：
```text
Search → top 20 → 20×128B snippets → open 1×1KiB context 
→ open full message → prev/next message
```

---

## 🔲 Phase 5: Stable Experiment Framework & External Engines - 实验框架与外部引擎

**目标**: 修复现有 Rust 实验框架 + 接入外部引擎协议

### Task 5.1: Fix & Test Rust Experimental Framework
优先补齐：
- Span 反转和越界处理
- 重叠 Truth Match
- Raw JSON 逐字节准备
- zstd 跨块 Extract
- Engine Binding 不匹配
- Space total consistency
- Unknown content blocks not lost

### Task 5.2: Implement Persistent External Engine
通过 JSON-lines 协议接入：
- `utf8_self_index`
- `unicode_byte_aware_self_index`
- `utf8_locate_only`
- `unicode_byte_aware_locate_only`

**要求**:
- 返回精确 canonical byte Span
- 不允许按平均 bytes/codepoint 修正
- 不允许使用模拟 zstd Extract
- 每个二进制输出包含 build identity、dependency version、config hash

### Task 5.3: Legacy Evidence Reproduction Audit
- README 引用缺失命令
- check_spans vs check_spans_exact 差异
- Missing machine results
- Early top10_ctx only hits word problem

---

## 🔲 Phase 6: Conclusion-Driven