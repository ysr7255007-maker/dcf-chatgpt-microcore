# DCF Storage Kernel Lab - 本地研究完整八阶段实施计划

**仓库**: `ysr7255007-maker/dcf-chatgpt-microcore`  
**工作分支**: `experiment/storage-kernel-local`  
**数据来源**: `/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/`

---

## 核心纪律（必须严格遵守）

1. ✅ **不要修改或强推** `experiment/storage-kernel-outline`（冻结的原始假设）
2. ✅ **不要将"编译通过"或"benchmark 数字"当成研究完成**
3. ✅ **第一优先级是材料守恒**:完整 `content[]`、thinking、tool_use、tool_result、附件和未知块不得被占位符替换或静默丢弃
4. ✅ `message.text` 只能作为旧格式回退和 `legacy_message_text` 复现来源，不能覆盖完整 `content[]`
5. ✅ 在材料守恒报告通过前，**不进行正式性能解释**
6. ✅ Count、Locate、Extract、Recover 任一不等于暴力真值，相关性能数字一律无效
7. ✅ **所有结果必须绑定**数据集哈希、投影版本、引擎配置、二进制身份、机器、缓存状态和原始报告
8. ✅ **不要猜测修复**悬空父节点、缺失工具关联或未知内容；把它们保存为明确异常
9. ✅ 旧沙盒结果保留，但统一降级为 `legacy_message_text` 上的窄范围证据
10. ✅ **发现足以推翻架构的新事实时立即单独汇报**

---

# 第一阶段：建立本地基线 ✅ COMPLETED

**目标**: 记录环境、验证编译、生成差异说明

**已完成**:
- ✅ 环境基线记录 (`reports/environment/machine-local.json`)
- ✅ 编译日志保存 (`reports/baseline/cargo-check.before.log`)
- ✅ 测试编译成功并通过
- ✅ 差异说明文档 (`reports/baseline/outline-diff.md`)

**Commit SHA**: `938e4bdc9690a385fed04194caafa83964babbac`

**结论**: 
- Rust 1.96.0, macOS ARM64 无重大兼容性问题
- 未改变逻辑合同（仅移除未使用导入）

---

# 第二阶段：重建事实导入层

## Task 2.1: Raw Artifact Store（原始档案登记）

**目标**: 对三个关键文件进行身份登记和哈希计算

**输入文件**:
```bash
/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/conversations.json (156MB, 原始 JSON)
/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/conversations_final.md (22MB, 清洗后英文)
/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/conversations_final_zh.md (20MB, 翻译后中文)
```

**执行步骤**:
1. 为每个文件生成 SHA-256 哈希
2. 记录 byte_length、media_type、original_filename
3. 创建 SQLite 表 `raw_artifacts`:
   ```sql
   CREATE TABLE raw_artifacts (
     artifact_id TEXT PRIMARY KEY,
     sha256 TEXT NOT NULL UNIQUE,
     original_filename TEXT NOT NULL,
     byte_length INTEGER NOT NULL,
     media_type TEXT,
     source_platform TEXT DEFAULT 'local-download',
     imported_at TEXT NOT NULL,
     file_path TEXT UNIQUE NOT NULL
   );
   ```
4. 插入三条记录，`artifact_id` = SHA-256 前 16 字符

**交付物**:
- `reports/artifacts/registration.json` (登记清单)
- SQLite 数据库中的 `raw_artifacts` 表

---

## Task 2.2: Deterministic Structured Fact Import（确定性事实导入）

**目标**: 从 conversations.json 解析出完整 fact graph，使用 SQLite 持久化

**Schema 设计** (基于 task-d09):

### A. 基础表结构

```sql
-- 对话表
CREATE TABLE conversations (
    conversation_uuid TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    source_blob_sha256 TEXT NOT NULL REFERENCES raw_artifacts(sha256),
    message_count INTEGER DEFAULT 0
);

-- 消息表
CREATE TABLE messages (
   