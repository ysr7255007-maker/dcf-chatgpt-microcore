# Phase 2: Fact Import Layer - 事实导入层

**输入数据**:
```bash
/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/conversations.json (156MB)
/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/conversations_final.md (22MB)
/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000/conversations_final_zh.md (20MB)
```

**核心纪律**: 
- 材料守恒第一优先级
- 禁止静默丢弃未知块
- `content[]` 优先于 `message.text`

---

## Task 2.1: Raw Artifact Store

### A. Schema Design

```sql
CREATE TABLE raw_artifacts (
    artifact_id TEXT PRIMARY KEY,           -- SHA256 前 16 字符
    sha256 TEXT NOT NULL UNIQUE,            -- 完整 64 字符
    original_filename TEXT NOT NULL,        -- 原始文件名
    byte_length INTEGER NOT NULL,           -- 文件大小
    media_type TEXT,                        -- application/json / text/markdown
    source_platform TEXT DEFAULT 'local',   -- 数据来源标识
    imported_at TEXT NOT NULL,              -- ISO8601 时间戳
    file_path TEXT UNIQUE NOT NULL          -- 本地路径
);

CREATE INDEX idx_raw_artifacts_sha256 ON raw_artifacts(sha256);
```

### B. Registration Data

| File | Size | Expected Hash | Type |
|------|------|---------------|------|
| conversations.json | 156MB | TODO compute | Raw JSON Export |
| conversations_final.md | 22MB | TODO compute | Cleaned English |
| conversations_final_zh.md | 20MB | TODO compute | Translated Chinese |

### C. Deliverables