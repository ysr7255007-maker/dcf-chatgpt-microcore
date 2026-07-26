# G4 Adapter + Surface v0 — 核心生命循环 UI + 适配器会话显式绑定

> 范围：仅 `seed/surface/`、`seed/adapters/chrome/`、`seed/tests/`、`seed/docs/`。
> 基线：G4 companion 契约（`seed/docs/g4-companion-v0.md`，#20 已落盘）。
> 零 npm 依赖；不修改 `seed/companion/`。

## 1. 交付物清单

| # | 路径 | 行数 | 说明 |
|---|---|---|---|
| 1 | `seed/surface/g4-lifecycle-core.js` | 378 | UMD 可测核心：ULID 生成/校验、rpc 封装、fetchRecommendations/Tasks/Sessions/Materials/Provenance、buildAcceptPayload（强制显式绑定）、buildDismissPayload、buildTaskProgressionPayload、buildCheckpointPayload、buildMaterialFeedbackBundle、buildManualRecommendationPayload、buildRecommendationProposedEvent（走 /rpc/events/ingest） |
| 2 | `seed/surface/g4-lifecycle.html` | 645 | 零依赖单文件 Surface：四类分离（卡片/火花/推荐/任务）、接住→显式绑定弹窗（会话单选或手动粘贴 URL，无默认无推测，确认按钮需已选会话+execution_agent）、dismiss 必填理由、任务五态队列+检查点+倒退 rejection 展示、回灌三入口+attribution 转移链回显、手动创建推荐表单（source_reasoning + source_material_refs 必填） |
| 3 | `seed/surface/g2-dashboard.html` | +1 | 加 G4 导航链接 |
| 4 | `seed/surface/g3-materials.html` | +1 | 加 G4 导航链接 |
| 5 | `seed/adapters/chrome/content.js` | +9 | `extractConversationId(pathname)` 从 `/c/{id}` 提取 conversation_id 入事件 payload；提不到如实置 null；**绝不加入焦点推测逻辑** |
| 6 | `seed/tests/g4-lifecycle-flow.test.js` | 396 | HTTP 级全循环单测（端口 18476 + /tmp DB）：创建推荐→接住（显式绑定）→任务推进→检查点→完成回灌→attribution 转移链断言→倒退拒绝断言→ingest 通路回灌→dismiss→~/.dcf 未触碰 |
| 7 | `seed/tests/g4-surface.acceptance.mjs` | 381 | CDP 无头 Chrome 真实行为验收：file:// 打开页面，实际点击走通「接住→绑定→推进→检查点→回灌→倒退拒绝」，UI 断言与 DB 事实交叉校验，7 张截图存 `seed/docs/evidence/g4/` |
| 8 | `seed/docs/g4-adapter-surface-v0.md` | 本文件 | 证据文档 |

## 2. 契约摘要（实读 index.js / types.js / events.js / g4-reducers.js 逐字段核实）

### 2.1 与任务简报的偏差（以真实代码为准）

- `/rpc/recommendation/query` 实际是 **POST**（简报写 GET）；`{source_id?, source_type?, status?}`，source_id 或 status 至少一个。
- `/rpc/task/query` 是 GET，但 **task_id 或 status 至少一个**（无参 → 400）。`fetchTasks(null)` 逐态并发查询五态后合并。
- 手动创建推荐 **无专用 RPC 端点**：经 `POST /rpc/events/ingest` 提交 `recommendation.proposed` 事件，`source_id = recommendation_id`（使 provenance 可回查）。
- `recommendations_projection` 表 **没有 source_reasoning 列**——source_reasoning 只存在于 `recommendation.proposed` 事件 payload。Surface 通过 `GET /rpc/events/query?source_id={rec_id}` 回查 proposed 事件 payload 获取并缓存（`fetchRecommendationProvenance`）。
- `/rpc/recommendation/accept` 的 `binding_context.conversation_id` 仅当合法 ULID 才写入 `bound_conversation_id`；`conversation_url` 需 string。sessions 列表的 `conversation_id` = `row.source_id`（适配器 outbox `ensureSource` 生成的 ULID），所以选会话路径绑定 id 生效；手动粘贴 URL 路径则 `bound_conversation_url` 生效而 id 为空（UI 如实呈现）。
- 倒退 400 响应 `error.data.{rejected:true, rejection_event_id}`（index.js rpcError 已在 #17 修复 data 透传）。
- `task.completed/failed` 未提供证据引用时，RPC 以状态事件自身 event_id 自指；Surface 回灌通路（result_recorded/failure_recorded）亦采用自指（诚实可追溯）。

### 2.2 回灌机制

- `task.completed` / `task.result_recorded` + `feedback_to_materials:[{entity_id}]` → `propagateMaterialFeedback` 生成 `material.attribution.transitioned` 链（`to_state=reality_verified`）。
- `task.failed` / `task.failure_recorded` / `task.insight_changed` → `to_state=user_tentative`。
- 链事件 `evidence_ref` = 源任务 event_id；payload 内嵌 `provenance={originating_task_event_id, originating_event_type, feedback_index}`。
- 空转（from===to）与倒退链被诚实跳过（不伪造归因升级），四态机 forward-only 约束在链上同样生效。

### 2.3 适配器显式绑定采集

content.js 从 `location.pathname` 用 `/^\/c\/([^\/?#]+)/` 提取 conversation_id，加入 `conversation.message.*` 事件 payload。提取失败如实置 null（首页、新对话），**绝不焦点推测**。companion `/rpc/adapter/sessions` 从 `conversation.*` 事件日志聚合会话列表（`conversation_id = row.source_id`）。

## 3. 设计决定

1. **四类分离展示**：卡片/火花/推荐/任务各占独立面板，不混淆。卡片/火花在 G4 初期无生产者且 companion 无查询端点，Surface 如实显示诚实空态（不伪造数据）。
2. **显式绑定无默认无推测**：接住弹窗打开时会话列表无默认选中（radio 全未选），确认按钮初始 disabled；必须人工单选会话或手动粘贴 URL + 填 execution_agent 才启用。会话选择与手动 URL 互斥（选会话清 URL，填 URL 清会话选择）。
3. **source_reasoning 从事件日志回查**：投影表无此列，Surface 不伪造；通过 `/rpc/events/query?source_id={rec_id}` 回查 `recommendation.proposed` 事件 payload，按 rec_id 缓存。
4. **手动创建推荐走 events/ingest**：无专用 RPC；`buildRecommendationProposedEvent` 生成完整 ingest 封包（event_id + source_id=recommendation_id + recommendation.proposed），source_reasoning 与 target_material_ids 留在 payload。
5. **回灌三入口**：result_recorded（→reality_verified）/ failure_recorded（→user_tentative）/ insight_changed（→user_tentative），目标态由服务端按事件类型派生（Surface 只显示派生结果）。提交后从 `/rpc/events/query?source_id={material_id}` 回查 `material.attribution.transitioned` 链事件并展示。
6. **倒退如实展示**：任务推进遇 400 时，Surface 从 `error.data` 取 `rejected` + `rejection_event_id`，如实显示「倒退被拒绝 + 拒绝已作为 task.transition_rejected 入库」。

## 4. 验证输出

### 4.1 单测 `g4-lifecycle-flow.test.js`（50/50 通过）

```
✅ Passed: 50  ❌ Failed: 0
```

覆盖：core builder 强制约束（accept 缺 binding/execution_agent/user_confirmed_at 拒绝；recommendation 缺 source_reasoning 拒绝）、adapter 会话采集、material 播种、手动推荐 ingest、pending 查询、source_reasoning 事件日志回查、接住（显式绑定）、物化任务（source_ref/bound_conversation_id/bound_execution_agent 断言）、双重 accept 拒绝、五态推进（proposed→accepted→in_progress）、检查点持久化+投影指针、完成回灌→attribution 转移链（ai_proposed→reality_verified，provenance 指向）、倒退 400+rejected+rejection_event_id+transition_rejected 入库、stale from_state 二次防线、ingest 通路回灌（failure_recorded→user_tentative）、regressive 链诚实跳过、dismiss 理由逐字记录、~/.dcf 未触碰。

### 4.2 真实行为验收 `g4-surface.acceptance.mjs`（24/24 通过）

```
Summary: 24 passed, 0 failed
```

截图存于 `seed/docs/evidence/g4/`：

| 截图 | 场景 |
|---|---|
| 01-four-categories-separated.png | 四类分离展示（推荐卡含 source_reasoning + P2 优先度；卡片/火花诚实空态） |
| 02-accept-binding-modal.png | 接住弹窗：会话列表单选，确认按钮初始 disabled |
| 03-accept-task-materialized.png | 接住成功，task_id 物化，DB 断言 source_ref/bound_conversation_id/execution_agent |
| 04-task-progressed.png | 任务推进 proposed→accepted→in_progress |
| 05-checkpoint-saved.png | 检查点保存，DB checkpoint_event_id 指针 |
| 06-backprop-chain.png | 回灌 attribution 转移链（ai_proposed→reality_verified），DB 材料归因升态 |
| 07-regression-rejected.png | 倒退被拒（rejected=true + rejection_event_id），DB 任务状态不变 |

UI 断言与 companion DB 事实交叉校验（每步通过 HTTP 回查 `/rpc/task/query`、`/rpc/material/query` 确认投影状态）。

## 5. 遗留 unknown

1. **卡片/火花无查询端点**：`cards_projection` / `sparks_projection` 表存在但 companion 未暴露查询 RPC；G4 初期也无 card.created/spark.emerged 生产者。Surface 如实显示空态。后续需补 RPC 端点或事件生产者。
2. **`/rpc/adapter/sessions` 的 `conversation_url` 依赖适配器上报**：当前 content.js 不发 conversation_url（只发 conversation_id + conversation_path）；sessions 列表 `conversation_url` 取 `payload.url || payload.conversation_url`，当前为 null。UI 如实呈现「（适配器未上报 url）」。后续可让适配器补发 `url: location.href`。
3. **`recommendation.expired` 无定时触发器**：companion 侧预留但无生产者（g4-companion-v0.md 已记录）。
4. **`task.rebind` 事件无 UI 入口**：契约支持（new_binding 对象），但 Surface 未提供重绑定 UI（G4 初期不在范围）。
5. **Chrome headless 沙箱环境敏感**：验收脚本在某些沙箱状态下 Chrome 启动会因 ProcessSingleton/socket 创建被拒而失败（`nice(5) failed: operation not permitted`）；已在脚本中加 `--no-sandbox --disable-dev-shm-usage`，但若沙箱严格限制仍需在沙箱外运行。g3 验收脚本同此环境敏感性。
6. **mock 模式下 G4 查询端点不可用**：node:sqlite 不可用时 task/recommendation/sessions 查询端点无 mock 分支（g4-companion-v0.md 已记录）；正式运行时由打包自带运行时保证。
