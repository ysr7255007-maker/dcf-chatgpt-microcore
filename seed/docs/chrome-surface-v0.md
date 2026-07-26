# G1 Chrome 适配器 + DCF Surface 回看页 v0 — 交付与取证

> 任务 #4 产物。蓝图 G1「最小活闭环」：授权 → Chrome 采集 ChatGPT 对话 →
> durable outbox → companion 持久保存 → Surface 回看（含显性缺口）。
> 三条红线：内容零残留（NOT_OBSERVE）、缺口如实性（不假装成功）、
> outbox 非权威性（companion 是唯一事实写入者）。

## 1. 文件树

```
seed/
├── adapters/chrome/          # Chrome MV3 目标适配器（零 npm 依赖）
│   ├── manifest.json         # MV3 清单：storage/alarms/tabs + chatgpt.com + 127.0.0.1:8472
│   ├── background.js         # classic SW：importScripts 胶水 + alarms 调度 + 消息路由
│   ├── outbox-core.js        # 核心逻辑（UMD）：有界 outbox / 墓碑 / 序列号 / flush / 边界同步
│   ├── ulid.js               # ULID + stableIdFromString（SHA-256 → 确定性 26 字符 ID）
│   └── content.js            # chatgpt.com 静默观察（DORC：只观察，不操作页面）
├── surface/
│   └── review.html           # 极简回看页（单文件、原生 fetch/DOM、零依赖）
├── docs/
│   ├── chrome-surface-v0.md  # 本文档
│   └── evidence/             # 截图取证（见 §6）
└── tests/
    └── companion-v0.unit.test.js  # 任务 #3 单测（本任务修复至 6/6 全绿）

tests/
├── chrome-outbox-bounded.test.js  # outbox 有界行为（32 断言）
└── chrome-alarms-flush.test.js    # alarms 调度 + SW 胶水（17 断言）
```

## 2. 架构与红线落点

### 采集（content.js，chatgpt.com）
- 每 3s 扫描 `[data-message-author-role]`，以 `data-message-id` 为稳定观察键；
  MutationObserver 防抖 800ms 提前触发。
- 文本连续两次扫描不变判定 final：user → `conversation.message.sent`，
  assistant → `conversation.message.received`，final 后再变 → `conversation.message.updated`。
- **DORC**：只读 DOM，不写页面状态；观察结果只是「观察」，权威事实由 companion 落库后才成立。
- **零残留红线**：boundaryState === `NOT_OBSERVE` 时 scan 直接返回——消息文本
  根本不被读取，更不会进入任何存储（outbox 测试 4 用 `SECRET-CONTENT` 全量
  storage 序列化验证零残留）。

### durable outbox（outbox-core.js + background.js）
- `chrome.storage.local` 键：`events_outbox`（容量 8）、`outbox_tombstones`（上限 200）、
  `sequence_numbers`、`delivery_failures`（上限 50）、`source_registry`、
  `boundary_states`、`seen_observation_keys`（每源 300）。
- 有界策略：outbox 满则 oldest-first 逐出，逐出事件记入墓碑
  （`reason: evicted_capacity` + 原 sequence_number）——缺口在下游回看页显形，不静默丢失。
- `chrome.alarms.create('dcf-outbox-flush', { periodInMinutes: 0.5 })`，
  onInstalled/onStartup/顶层三处兜底注册；alarm 存活于 SW 终止。
- flush 非阻塞：POST `/rpc/events/batch`；网络失败 → 事件留在 outbox，
  `delivery_failures` 记录 `failure_event_id` + 错误原因（不假装成功）；
  批量 4xx → 逐条兜底投递，被 companion 拒绝的毒丸事件墓碑化（`reason: rejected_by_companion`），
  不阻塞后续队列。

### 幂等与顺序
- `source_id = stableIdFromString('dcf.source:' + host + pathname)`（SHA-256 → 26 字符
  Crockford Base32，同会话恒同 ID）。
- `event_id = stableIdFromString('dcf.event:' + source_id + ':' + observation_key)` ——
  客户端生成稳定 ID；页面重载后的重复投递被 companion 的 event_id 去重吸收
  （`duplicated: true`），本地 `seen_observation_keys` 是第一层去重。
- `sequence_number` 扩展侧每源持久化递增，入队前先落 storage。

### 三态边界回路
- companion 是唯一事实写入者：Surface 切换边界 = 写入
  `system.boundary.updated` 事件（POST /rpc/events/ingest）。
- 扩展 SW 在每个 alarm 周期 `syncBoundariesFromCompanion()`（查询各源最近 50
  事件取最新边界事件）→ content script 每 15s `dcf.get_boundary` 刷新并强制执行。
- 未设置时默认 `OBSERVE_CURRENT_ONLY`。

## 3. 运行步骤

```bash
# 1. 启动 companion（真实 SQLite；--db= 可指定库路径）
node seed/companion/index.js --port=8472 --db=/tmp/dcf-g1.db

# 2. 加载扩展：chrome://extensions → 开发者模式 → 加载已解压的扩展程序
#    → 选择 seed/adapters/chrome/

# 3. 访问 https://chatgpt.com 进行对话；SW 控制台可见：
#    [DCF bg] observation enqueued seq=1 / flush report {"delivered":1,...}
#    扩展侧查看 outbox：chrome.storage.local.get('events_outbox')

# 4. 打开回看页（source_id 可从 SW 控制台或 dcf.get_boundary 响应获取）
open "seed/surface/review.html?source_id=<26位ULID>"

# 5. 缺口演练：停掉 companion → 继续对话超过 outbox 容量（8 条）→
#    重启 companion → 下个 alarm 周期送达 → 回看页显示被逐出序列的缺口区间
```

## 4. 接口调用示例（curl，实测输出）

```bash
# 健康检查
curl -s http://127.0.0.1:8472/rpc/health
# → {"jsonrpc":"2.0","result":{"status":"healthy","database":"real","event_count":3,...},"id":null}

# 单事件入库（payload_json 必须是对象；ID 必须 26 字符 Crockford Base32）
curl -s -X POST http://127.0.0.1:8472/rpc/events/ingest \
  -H 'Content-Type: application/json' \
  -d '{"event":{"event_id":"GBESE1DS1C0M9BV5QAMXCGT4BQ","source_id":"XTH84RQQEK942Z2KQB8MSBW0M9","event_type":"conversation.message.sent","payload_json":{"role":"user","text":"hello"},"sequence_number":1},"id":1}'
# → {"jsonrpc":"2.0","result":{"event_id":"GBESE1DS1C0M9BV5QAMXCGT4BQ","duplicated":false},"id":1}
# 重放同一 event_id → {"result":{...,"duplicated":true}}   ← 幂等验证

# 批量入库（体为 {events:[...]}，非裸数组）
curl -s -X POST http://127.0.0.1:8472/rpc/events/batch \
  -H 'Content-Type: application/json' \
  -d '{"events":[{...seq 2...},{...seq 4...}],"id":3}'
# → {"jsonrpc":"2.0","result":{"inserted":2,"total":2,"duplicated":0},"id":3}

# 查询（seq 3 故意缺失 → 回看页显示缺口区间 3–3）
curl -s "http://127.0.0.1:8472/rpc/events/query?source_id=XTH84RQQEK942Z2KQB8MSBW0M9&orderBy=ASC"
# → {"result":{"events":[{seq 1},{seq 2},{seq 4}],"count":3,...}}

# 统计
curl -s http://127.0.0.1:8472/rpc/stats
# → {"result":{"event_count":3,"boundary_count":1,"db_path":"/tmp/dcf-g1-e2e.db","mock_mode":false}}
```

## 5. 测试结果摘要（2026-07-26 实测）

| 测试线 | 结果 |
|---|---|
| `node tests/chrome-outbox-bounded.test.js` | 32 passed / 0 failed |
| `node tests/chrome-alarms-flush.test.js` | 17 passed / 0 failed |
| `npm run test:chrome`（13 个文件，含上两项） | exit 0，零 FAIL |
| `npm run test:legacy`（23 个文件） | exit 0，零 FAIL（旧线保持全绿） |
| `node seed/tests/companion-v0.unit.test.js` | 6 passed / 0 failed（本任务修复，见 §7） |

覆盖点：稳定身份幂等、每源序列号、本地去重、NOT_OBSERVE 零残留（全量 storage
序列化断言）、容量逐出+墓碑（缺口序列可见）、墓碑上限、flush 成功/断连/毒丸/
恢复重试、alarm 注册与触发、外来 alarm 忽略、消息通道（observation/boundary/stats）。

## 6. 取证（真实 Chrome headless 截图，`docs/evidence/`）

| 文件 | 场景 |
|---|---|
| `surface-review-gap.png` | 完整对话回看：3 条事件 + 缺口区间「序列 3–3，缺失 1」红色显形 + 来路（source_id/event_type/event_id/payload） |
| `surface-boundary-archive.png` | 边界事件写入后回看页推导「允许归档」（OBSERVE_AND_ARCHIVE）并高亮激活按钮 |
| `surface-companion-down.png` | companion 停机：如实报错「加载失败：Failed to fetch」，不显示任何臆造数据 |

## 7. 本任务顺带修复的 companion（任务 #3 产物）阻塞缺陷

| 缺陷 | 影响 | 修复 |
|---|---|---|
| db.js schema 注释过滤把含 CREATE TABLE 的语句块整体丢弃 | 真实 SQLite 初始化失败 | 逐行剥离注释后再切分 |
| db.js/events.js 使用 sql.js 风格 API（bind/step/free） | 真实 SQLite 路径全面崩溃，只有 mock 可用 | 改为 node:sqlite 的 get/all/run |
| index.js GET 处理器引用不存在的 `req.query` | /rpc/health、/rpc/events/query、/rpc/stats 全部 500 | 使用已解析的 query 对象 / null |
| index.js `Port > 65535` 拼写错误 | 传 --port 即 ReferenceError | 更正为 PORT |
| index.js 不支持 --db= | 无法用隔离测试库 | 增加 --db= 参数 |
| ulid.js generateULID 产出 20 字符 | 无法通过其自身 26 字符校验 | 重写为标准 48-bit 时间戳 + 80-bit 随机 |
| seed/tests/companion-v0.unit.test.js 未调用 initialize()、payload 传字符串 | 单测从未真正通过 | 补 initialize、payload 对象化，现 6/6 |

## 8. 遗留 unknown

1. **chatgpt.com DOM 选择器未经登录态真实会话验证**：`[data-message-author-role]` /
   `data-message-id` 基于 ChatGPT 已知 DOM 结构，但未在真实登录会话中实拍取证
   （需要用户账号）。选择器失效时扩展静默无事件——建议 G1 验收（任务 #5）在真实
   会话中确认，必要时仅调整 content.js 的选择器常量。
2. **boundary HTTP 端点未路由**：companion printUsage 列出 GET/POST /rpc/boundary
   但未实现路由。当前边界回路完全经由事件流（system.boundary.updated），功能闭环
   成立；专用端点留给后续环。
3. **payload_json 双形态**：companion 落库为 JSON 文本，query 返回字符串形态；
   Surface/扩展两侧均做了对象/字符串双形态解析。schema 收敛（seed/shared/）待后续环统一。
4. **headless Chrome 扩展级 E2E 未做**：alarms/outbox 用 vm 模拟 chrome.* 环境测试
   真实 background.js；未用 `--load-extension` 跑完整扩展生命周期（headless 对
   MV3 SW + content script 注入支持仍不稳定）。
5. **outbox 容量 8 偏小是刻意选择**（侦察报告 5-8 工件上限）：长离线会大量逐出。
   墓碑+缺口显形保证如实性，但恢复率低；若要更高恢复率需在后续环重新评估容量或
   增加 companion 可达性探测节流。
