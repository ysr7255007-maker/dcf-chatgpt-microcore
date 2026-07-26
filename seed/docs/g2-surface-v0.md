# G2 Surface v0 — 实现与验收证据

日期：2026-07-26
任务：#7 G2 Surface 实现（蓝图 G2 架构，基于 Gina 技术侦察：file:// 本地页面 + companion HTTP JSON-RPC）

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `seed/surface/g2-dashboard.html` | G2 显性界面（零依赖纯 HTML/CSS/JS，file:// 直开） |
| `seed/companion/index.js` | 新增 `q` 全文检索参数 + `POST /rpc/boundary/update` 端点 |
| `seed/companion/db.js` | 修复 FTS5 索引从未被填充的缺陷；新增 LIKE 回退搜索 |
| `seed/companion/events.js` | `searchEvents` 支持 limit 参数透传 |
| `seed/tests/g2-reconnect.acceptance.mjs` | CDP 驱动的真实浏览器断连/重连验收脚本 |
| `seed/docs/evidence/g2/*.png` | 截图证据（5 张） |

## 2. 功能实现对照蓝图

### 2.1 布局
- 全屏侧边栏式：viewport 宽度，`max-width: 1200px`（从 review.html 的 960px 扩展）。
- 左侧导航栏：搜索框、统计、缺口条、结果列表、卡片架、边界状态条。
- 右侧详情区：事件元数据头 + payload_json 解析渲染。

### 2.2 FTS5 全域搜索
- `GET /rpc/events/query?q={keyword}` 走 companion FTS5（`raw_events_fts MATCH`）。
- **修复的真实缺陷**：原 `insertEvent` 注释称"trigger 自动更新 FTS"，但 schema 明确未建触发器 → FTS 索引恒空。现在插入事件时手动同步写入 `raw_events_fts`。
- 三层回退：FTS5 命中 → FTS 空结果或语法错误时 LIKE `'%q%'` 扫描（蓝图规格 SQL）→ companion 不支持 q 时前端 fetch-all + 过滤。
- 缺口标记：按 `sequence_number` 检测中断，红色缺口条显示"缺口：3 – 5（缺失 3 条）"，如实展示不推测补齐。
- 来路回跳：每条结果带 source_id 来路；支持 deep-link `?q=keyword&event_id=X` 直达并自动选中原始现场。

### 2.3 卡片架
- 识别 `event_type='material.card'` 或 payload 含 `type:'card'`。
- 发射按钮 → 生成 ChatGPT message 格式适配（`{role:'user', content:[{type:'text', text}]}`）→ modal 确认 → `navigator.clipboard.writeText`。
- **不直接操作 chatgpt.com DOM**（避免浏览器上下文强耦合，符合网页端仅 UI/观察层原则）。

### 2.4 三态边界显示与切换
- 顶部边界条显示 active source 的 boundary_state，三态着色（红/黄/绿）。
- 切换：下拉菜单 → `POST /rpc/boundary/update`（更新 `boundary_relations` 表）+ 写入 `system.boundary.updated` 事件（事件流保持审计事实源）双写闭环。
- NOT_OBSERVE 时：结果列表与详情区均隐藏正文，仅显示 event_type / seq / 时间 / source_id 元数据（见截图 g2-not-observe.png）。
- 边界推导：搜索结果不含边界事件时，自动按 source_id 二次查询完整事件流推导（companion 是唯一事实源）。

### 2.5 自动重连
- 采用 fetch 轮询（每 2s poll `/rpc/health`），未用 WebSocket/SSE（file:// 下 WebSocket 行为未实测，companion 亦未实现 SSE — 遗留 unknown）。
- 断连 → 顶部红色"Companion 当前离线 · 自动重连中…"横幅；恢复 → 横幅消失并自动重新执行当前搜索刷新数据。

### 2.6 零依赖
- 纯原生 fetch / DOM API，无 bundler，file:// 直开可用（CORS 由 companion `Access-Control-Allow-Origin: *` 放行）。

## 3. Companion 层变更明细

1. `GET /rpc/events/query` 新增 `q` 参数：FTS5 全文检索（跨 source），与 `source_id` 查询互斥可选，二者缺一即 400。返回体新增 `search_query` 字段。
2. `POST /rpc/boundary/update`：`{source_id, boundary_state, scope?}` → 校验 ULID 与三态枚举 → 写 `boundary_relations` → 返回 `{success:true,...}`。非法状态返回 -32602。
3. `db.insertEvent`：插入后同步写 FTS 索引（失败仅告警不阻塞持久化）。
4. `db.searchEvents`：返回列补充 `sequence_number`（缺口检测必需）；FTS 空/异常时回退 `searchEventsLike`。

## 4. 验收记录

### 4.1 端到端 curl 验证（companion 运行于 --db=/tmp/g2-test-dcf.db）
```
=== q 全文搜索 outbox ===
count: 4 search_query: outbox
 seq 1 conversation.message
 seq 2 conversation.message
 seq 6 material.card
 seq 7 conversation.message
=== 中文搜索 幂等 ===
count: 1
=== boundary/update NOT_OBSERVE ===
{"result":{"success":true,"source_id":"01JGXX0000TESTG2S0VRCE0001","boundary_state":"NOT_OBSERVE",...}}
=== 回切 OBSERVE_AND_ARCHIVE ===
{"result":{"success":true,...,"boundary_state":"OBSERVE_AND_ARCHIVE"}}
=== 非法状态被拒 ===
{"error":{"code":-32602,"message":"Invalid or missing boundary_state"}}
=== health ===
{"result":{"status":"healthy","database":"real","event_count":4,...}}
```

### 4.2 截图证据（headless Chrome, file:// 直开）
| 截图 | 验证点 |
|---|---|
| `evidence/g2/g2-dashboard-initial.png` | file:// 加载成功，双栏布局 |
| `evidence/g2/g2-search-outbox.png` | 搜索"outbox"→ 4 命中 + 红色缺口条"缺口：3 – 5（缺失 3 条）" |
| `evidence/g2/g2-card-rack.png` | material.card 识别为卡片，带"详情/发射"按钮 |
| `evidence/g2/g2-detail-view.png` | deep-link 自动选中结果，右侧显示解析后 payload |
| `evidence/g2/g2-not-observe.png` | 边界"不读取"（红色徽标），正文隐藏仅剩元数据 |
| `evidence/g2/g2-offline-banner.png` | companion 停止后红色离线横幅 |

### 4.3 断连/重连自动化验收（CDP 真实浏览器会话）
`node seed/tests/g2-reconnect.acceptance.mjs`：
```
✅ PASS: online: offline banner hidden
✅ PASS: online: search results rendered (2)
✅ PASS: offline: banner visible after companion stops
✅ PASS: reconnect: banner cleared after companion returns
✅ PASS: reconnect: results refreshed (2)
Summary: 5 passed, 0 failed
```

### 4.4 旧测试线回归
- `npm run test:chrome`：49 PASS，0 fail。
- `npm run test:legacy`：exit=0 全绿（&& 链式，任一失败即中断）。
- `node seed/tests/companion-v0.unit.test.js`：6 passed, 0 failed。
- `node seed/tests/g1-redline.test.js`：34 passed, 0 failed。

## 5. 运行步骤

```bash
# 1. 启动 companion（默认库 ~/.dcf/dcf.db）
node seed/companion/index.js --port=8472

# 2. 浏览器直开（无需任何服务器）
open seed/surface/g2-dashboard.html
# 或 deep-link：g2-dashboard.html?q=关键词&event_id=事件ID

# 3. 断连/重连自动化验收（需 8472 空闲 + Chrome）
node seed/tests/g2-reconnect.acceptance.mjs
```

## 6. 遗留 unknown

1. **file:// 下 WebSocket 可用性未实测**：本轮按 Gina 报告优先采用 fetch 轮询，SSE/WS 推送留待 companion 支持后实测。
2. **FTS5 中文分词**：SQLite FTS5 默认 unicode61 tokenizer 对中文按连续 CJK 串整体成词，子串检索（如"幂等"命中"幂等写入"）当前实际由 LIKE 回退层承担；如需真正的中文 FTS 需引入 ICU/trigram tokenizer——零依赖约束下暂不引入。
3. **存量数据的 FTS 索引**：FTS 同步修复只覆盖修复后新插入的事件；修复前入库的存量事件不在 FTS 索引中（由 LIKE 回退层兜底，行为正确但大库时性能较差）。可选后续：一次性 rebuild（`INSERT INTO raw_events_fts(raw_events_fts) VALUES('rebuild')`）。
4. **剪贴板权限**：headless/未聚焦页面下 `navigator.clipboard.writeText` 会被拒（已知 pitfall：后台环境剪贴板 API 因页面未聚焦被拒）；发射流程采用 modal 内用户手势触发以最大化成功率，失败时有显式报错，未做静默降级到 execCommand。
5. **发射格式适配为最小实现**：当前仅 text field JSON 结构，attachments 引用字段留空位未实装（蓝图标注 optional）。
