# DCF Storage Kernel Lab - 完整八阶段研究计划总索引 (FULL)

**实验仓库**: `ysr7255007-maker/dcf-chatgpt-microcore`  
**工作分支**: `experiment/storage-kernel-local`  
**数据来源**: `/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/`

---

## 🎯 核心纪律（十条铁律）

1. ✅ **不要修改或强推** `experiment/storage-kernel-outline`（原始假设冻结）
2. ✅ **不要将"编译通过"或"benchmark 数字"当成研究完成**
3. ✅ **第一优先级是材料守恒**:完整 `content[]`、thinking、tool_use、tool_result、附件和未知块不得被占位符替换或静默丢弃
4. ✅ `message.text` 只能作为旧格式回退，不能覆盖完整 `content[]`
5. ✅ 在材料守恒报告通过前，**不进行正式性能解释**
6. ✅ Count、Locate、Extract、Recover 任一不等于暴力真值，相关性能数字一律无效
7. ✅ **所有结果必须绑定**数据集哈希、投影版本、引擎配置、二进制身份、机器、缓存状态和原始报告
8. ✅ **不要猜测修复**悬空父节点、缺失工具关联或未知内容；保存为明确异常
9. ✅ 旧沙盒结果保留，但降级为 `legacy_message_text` 上的窄范围证据
10. ✅ **发现足以推翻架构的新事实时立即单独汇报**

---

## 📊 阶段概览

### ✅ Phase 1: Environment Baseline - 本地基线建立
**目标**: 记录环境、验证编译、生成差异说明  
**状态**: COMPLETED  
**Commit SHA**: `938e4bdc9690a385fed04194caafa83964babbac`  
**文档**: [`phase-01-environment-baseline.md`](./phase-01-environment-baseline.md)

**产出**:
- ✅ `reports/environment/machine-local.json`
- ✅ `reports/baseline/cargo-check.before.log`
- ✅ `reports/baseline/outline-diff.md`

**结论**: ARM64 + macOS 无重大兼容性问题，未改变逻辑合同

---

### 🔲 Phase 2: Fact Import Layer - 事实导入层重建
**目标**: 建立 Raw Artifact Store + Structured Fact Import + Material Conservation Report  
**状态**: NOT STARTED  
**文档**: [`phase-02-fact-import.md`](./phase-02-fact-import.md)

**子任务**:
- 2.1: Raw Artifact Store (三个大文件的身份登记和 SHA-256 计算)
- 2.2: Deterministic Structured Fact Import (SQLite Schema + 解析器)
- 2.3: Exception Conservation (悬空节点、未匹配工具调用等异常清单)
- 2.4: Material Conservation Report (材料守恒门禁报告)

**关键门禁**: 
- 静默 dropped blocks = 0
- placeholder thinking/tool blocks = 0
- 未知块全部保存 raw_payload

---

### 🔲 Phase 3: Search Projections - 同源搜索投影构建
**目标**: 从同一份事实生成 7 种投影  
**状态**: NOT STARTED  
**文档**: TBD

**投影类型**:
- P0: `legacy_message_text` (精确复现旧沙盒)
- P1: `visible_text` (仅可见文本块)
- P2: `full_trace` (text + thinking + tool_use + tool_result)
- P3: `translated_zh_full` (中文翻译版完整事件)
- P4: `raw_json_exact` (原始 JSON 逐字节)
- P5: `raw_json_compact` (解析后紧凑控制组)
- P6: Component Corpora (按类型拆分)

**交付物**:
- 每个投影的 Manifest (SHA-256 + statistics)
- Source provenance ledger (来源账本)

---

### 🔲 Phase 4: Truth Sets & Query Workloads - 真值与查询负载
**目标**: 建立字节级