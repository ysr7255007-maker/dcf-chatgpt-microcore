# G4 Companion v0 — 核心生命循环（材料 → 卡片 → 火花 → 推荐 → 任务 → 回灌）

> 范围：仅 `seed/companion/`、`seed/tests/`、`seed/docs/`。零 npm 依赖（node:sqlite + 原生 http/crypto/fs）。
> 基线：G3 材料代谢核心（四态归因、三向合并同步、导出）之上的增量扩展。

## 1. 设计决定

### 1.1 事件溯源不变式延续（recompute === incremental）

G4 的全部投影（tasks / cards / sparks / recommendations）沿用 G3 材料投影的架构约束：

- `raw_events` 是唯一事实源（append-only，ULID event_id 幂等）。
- 每类投影由**同一个纯 reducer** 驱动增量更新与全量重算：
  `applyTaskEvent` / `applyRecommendationEvent` / `applyCardEvent` / `applySparkEvent`
  （`seed/companion/reducers/g4-reducers.js`），入库路径通过
  `apply*EventToDb` 复用同一函数。
- 被拒绝的请求（状态倒退）**也是事件**：`task.transition_rejected`
  入日志，形成诚实完整链（对齐 G3 的 `material.attribution.transition_rejected` 先例）。

### 1.2 任务五态机（forward-only，允许跳级）

```
proposed → accepted → in_progress → completed (终态)
                              ↘  → failed    (终态)
```

- 允许跳级前进（如 proposed → completed）。
- 倒退一律拒绝：HTTP 返回 400，`error.data.rejected = true`，
  且拒绝本身作为 `task.transition_rejected` 事件入库，其 event_id
  以 `error.data.rejection_event_id` 返回。
- 双重防线：RPC 层先验 `from_state → to_state` 声明合法性；ingest 层再以
  **持久化投影的真实状态**为准做二次校验（声明合法但落后于 DB 状态同样被拒）。

### 1.3 回灌机制（back-propagation）

任务生命周期事件携带 `feedback_to_materials: [{entity_id}]` 时，
`EventProcessor.propagateMaterialFeedback` 并行生成
`material.attribution.transitioned` 事件链：

- 成功验收（`task.completed` / `task.result_recorded`）→ 目标材料归因升为 `reality_verified`。
- 失败/洞察路径（`task.failed` / `task.failure_recorded` / `task.insight_changed`）→ `user_tentative`（现实未确认）。
- 每条链事件的 `evidence_ref` 指向源任务 event_id，payload 内嵌
  `provenance = { originating_task_event_id, originating_event_type, feedback_index }`。
- `from_state` 取自材料投影当前状态；空转（from === to）与倒退链
  被诚实跳过（不伪造归因升级），四态机 forward-only 约束在链上同样生效。

### 1.4 推荐 → 任务的显式绑定

`POST /rpc/recommendation/accept` 是任务的诞生通道之一：接受推荐即物化一个
`task.created` 事件，`source_ref` 保留推荐溯源，`binding_context`
中的 `conversation_id / conversation_url / execution_agent / boundary_inherited_from`
写入任务投影（会话显式绑定，边界继承）。

### 1.5 事件 payload 契约在类型层收敛

`types.js` 是事件 payload 必填校验的唯一出处（`validateTaskEventPayload` /
`validateRecommendationEventPayload`），`events.js` 只做编排；
必填字段按事件类型区分（如 `recommendation.proposed` 需全描述字段，
`recommendation.accepted` 只校验 `binding_context`）。

## 2. Schema 扩展摘要（schema.sql）

| 表 | 关键列 | 约束 |
|---|---|---|
| `task_checkpoints` | checkpoint_id PK, task_id, checkpoint_type, snapshot_json, created_at | 非空 CHECK；idx: task_id, created_at |
| `tasks_projection` | task_id PK, source_ref, objective, boundary_inherited_from, bound_conversation_id/_url, bound_execution_agent, current_status, progress_json, checkpoint/result/failure_path_event_id | current_status CHECK IN 五态；idx: current_status, source_ref, bound_conversation_id |
| `cards_projection` | card_id PK, title, body_text, materiality_score, priority_level, status, source_event_id | score 0-1、priority 1-9、status 四态 CHECK；idx: materiality_score, priority_level, status |
| `sparks_projection` | spark_id PK, insight_summary, confidence_score, category, related_card_ids, status | confidence 0-1、status 四态 CHECK；idx: confidence_score, status, category |
| `recommendations_projection` | recommendation_id PK, source_entity_type/_id, recommendation_text, suggested_action, target_material_ids, materiality_score, priority_level, status, binding_context_json | source/text 非空、score/priority/status CHECK；idx: (source_entity_type, source_entity_id), status, materiality_score, priority_level |

## 3. 事件契约摘要（types.js + events.js）

新增事件类型（payload 必填项）：

- `card.created`（card_id）、`spark.emerged`（spark_id）
- `recommendation.proposed`（recommendation_id, source_entity_type, source_entity_id, recommendation_text）
  / `.accepted`（binding_context 若给必须为 JSON string）/ `.dismissed` / `.expired`
- `task.created`（task_id, objective）/ `.accepted` / `.progressed`
  / `.checkpoint_saved`（checkpoint_id, snapshot_json）
  / `.completed` & `.result_recorded`（result_event_id；可选 feedback_to_materials 数组）
  / `.failed` & `.failure_recorded`（failure_path_event_id；可选 feedback_to_materials 数组）
  / `.insight_changed`（可选 feedback_to_materials）/ `.rebind`（new_binding 对象）
  / `.transition_rejected`（倒退拒绝记录，由 RPC 层生成）

归因四态机不可倒退（沿用 G3）：
`ai_proposed → user_tentative → user_confirmed → reality_verified`，
允许跳级前进；倒退请求拒绝并记录 rejection 事件。

## 4. RPC 契约摘要（index.js，JSON-RPC 2.0 over HTTP :8472）

| 端点 | 方法 | 契约 |
|---|---|---|
| `/rpc/task/query` | GET | `?task_id=&status=&limit=` → `{tasks, count}` |
| `/rpc/task/status` | POST | `{task_id, from_state, to_state[, result_event_id, failure_path_event_id, feedback_to_materials]}` → `{event_id, from_state, to_state}`；倒退 → 400 + `error.data.{rejected, rejection_event_id}` |
| `/rpc/task/checkpoint` | POST | `{task_id, checkpoint_id, checkpoint_type, snapshot_json}` → `{checkpoint_id, event_id}`；写 `task_checkpoints` 行 + 投影指针 |
| `/rpc/recommendation/query` | POST | `{source_id?, source_type?, status?}` → `{recommendations, count}` |
| `/rpc/recommendation/accept` | POST | `{recommendation_id, binding_context}` → `{task_id, binding_context, event_id, task_event_id}`（物化任务） |
| `/rpc/recommendation/dismiss` | POST | `{recommendation_id, reason}` → `{recommendation_id, event_id, reason}` |
| `/rpc/adapter/sessions` | GET | → `{sessions: [{conversation_id, session_id, conversation_url, adapter, last_seen, event_count}], count}`（由 conversation.* 事件日志聚合） |

设计说明：`task.completed/failed` 状态事件必须携带证据引用；RPC 未提供时，
状态事件自身的 event_id 即为证据（自指，诚实可追溯）。

## 5. 验证摘录

单测：`node seed/tests/g4-companion.unit.test.js` → **31/31 通过**，覆盖：

- Schema 迁移（G4 表存在性）
- 任务五态机前进/倒退校验、payload 必填校验（task + recommendation）
- 纯 reducer 行为与 recompute === incremental 等价性
- 回灌链生成（成功→reality_verified、失败→user_tentative、沿用既有归因状态、evidence_ref/provenance 指向）
- ingest 端到端（投影持久化 + 倒退拒绝）
- 真实 HTTP 往返 RPC 断言（临时端口 + `:memory:` 库）：
  - 倒退 → `400` 且 `error.data.rejected === true`、`rejection_event_id` 为合法 ULID 且在 `raw_events` 中可查到 `task.transition_rejected` 行
  - 声明合法但落后于 DB 状态的倒退同样 400 拒绝
  - accept 物化任务并回查 `source_ref` / `bound_conversation_id`
  - RPC 完成任务 + feedback_to_materials → 日志中出现 `material.attribution.transitioned`（to_state=reality_verified，evidence_ref=任务事件）

回归：`seed/tests/g3-material`（26 过）、`g3-sync`（26 过）、`g3-export`（27 过）、
`g3-adapter-flow`（36 过）、`companion-v0`、`companion-doctor`、`g1-redline` 全通过；
`npm run test:chrome`、`npm run test:legacy` 全通过。

## 6. 已知边界（遗留 unknown）

- 卡片 triage/spark 状态推进事件（`card.triaged` 等）尚无生产者，reducer 预留了 default 分支；推荐 `recommendation.expired` 尚无定时触发器。
- `/rpc/adapter/sessions` 的 `session_id` 依赖适配器在 conversation.* payload 中携带该字段（Chrome 适配器另案负责）。
- mock 模式（node:sqlite 不可用）下 `/rpc/task/query` 等 SQL 查询端点不可用，仅 ingest/投影路径有 mock 分支；正式运行时由打包自带运行时保证 node:sqlite 可用（G2 出口条件）。
