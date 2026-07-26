# G5 Companion v0 — 跨执行者协作（任务重绑定 + 越权/扩权/价值偏离审计）

> 范围：仅 `seed/companion/`、`seed/tests/`、`seed/docs/`。零 npm 依赖。
> 基线：G4 核心生命循环（五态机、推荐→任务物化、回灌链）之上的增量扩展。

## 1. 设计决定

### 1.1 Rebind append-only + "最近 agent 胜" 投影

任务重绑定（rebind）是一条 append-only 的 `task.rebind` 事件，而非对历史的改写：

- **raw_events 是唯一事实源**：每次 rebind 生成一个 `task.rebind` 事件，
  payload 含 `new_binding`（新绑定信息）、`previous_agent`（重绑前 agent）和
  `rebind_timestamp`。事件链即审计链，全量可回放。
- **"最近 agent 胜"投影**：`tasks_projection` 的 `bound_execution_agent` /
  `bound_conversation_id` / `bound_conversation_url` / `updated_at`
  被最新 rebind 事件覆盖。投影是"当前快照"，事件链是"完整历史"。
- **终态锁定**：`completed` / `failed` 状态的任务不允许 rebind（终态任务
  上下文已冻结，变更需新任务）。

### 1.2 三类审计事件：纯事件日志，不改状态机

G5 新增三个 `task.*` 事件类型，它们**只入 raw_events，不改 tasks_projection 状态**：

| 事件类型 | 语义 | severity / category 枚举 |
|---|---|---|
| `task.overreach_detected` | 执行者超出任务边界的行为被检测到 | severity: `critical` \| `warning` |
| `task.privilege_expansion_requested` | 执行者请求扩大权限边界 | user_decision: `pending` \| `approved` \| `denied` |
| `task.value_divergence_reported` | 执行方向与任务目标发生价值偏离 | category: `scope` \| `priority` \| `method` \| `other` |

这三个事件在 `validateTaskEvent` 中不做状态机校验（不在
`TARGET_STATE_BY_EVENT` 映射中），在 `applyTaskEvent` reducer 中落入
default 分支（投影不变）。它们通过 `/rpc/events/ingest` 入库，
通过 `/rpc/events/query?source_id=<task_id>` 查回。

### 1.3 查询扩展：binding_history + execution_agent 过滤

- `GET /rpc/task/query?task_id=X&include_binding_history=true`：
  从 raw_events 聚合该 task 的所有 `task.rebind` 事件，返回
  `binding_history` 数组（按 `created_at` 升序），每条含
  `event_id / created_at / new_binding / previous_agent / rebind_timestamp`。
- `GET /rpc/task/query?execution_agent=<name>`：仅返回
  `bound_execution_agent` 匹配的任务投影（"最近 agent 胜"语义下的当前归属）。

## 2. 事件契约摘要（types.js + events.js）

### 2.1 task.rebind（增强校验）

```
payload = {
  task_id: ULID (必填),
  new_binding: {
    execution_agent: string (必填),
    conversation_id: ULID | null (可选),
    conversation_url: string | null (可选),
    user_confirmed_at: string (必填),
    reason: string (可选)
  },
  previous_agent: string | null,
  rebind_timestamp: string
}
```

校验（`validateTaskEventPayload`）：
- `new_binding` 必须为对象
- `new_binding.execution_agent` 必填（string）
- `new_binding.conversation_id` 若给则必须为 ULID 或 null
- `new_binding.conversation_url` 若给则必须为 string 或 null
- `new_binding.user_confirmed_at` 必填（string）
- `new_binding.reason` 若给则必须为 string

### 2.2 task.overreach_detected

```
payload = {
  task_id: ULID (必填),
  objective: string (必填),
  executed_action: string (必填),
  detection_evidence: any (必填),
  detected_at: string (必填),
  detected_by: string (必填),
  severity: 'critical' | 'warning' (必填)
}
```

### 2.3 task.privilege_expansion_requested

```
payload = {
  task_id: ULID (必填),
  current_boundary: string (必填),
  requested_boundary: string (必填),
  justification: string (必填),
  requested_by: string (必填),
  user_decision: 'pending' | 'approved' | 'denied' (必填)
}
```

### 2.4 task.value_divergence_reported

```
payload = {
  task_id: ULID (必填),
  objective: string (必填),
  execution_divergence: string (必填),
  execution_rationale: string (必填),
  reported_by: string (必填),
  category: 'scope' | 'priority' | 'method' | 'other' (必填)
}
```

### 2.5 新增常量

- `OVERREACH_SEVERITIES = ['critical', 'warning']`
- `PRIVILEGE_USER_DECISIONS = ['pending', 'approved', 'denied']`
- `DIVERGENCE_CATEGORIES = ['scope', 'priority', 'method', 'other']`

## 3. RPC 契约摘要（index.js）

| 端点 | 方法 | 契约 |
|---|---|---|
| `/rpc/task/rebind` | POST | `{task_id, new_binding}` → `{event_id, new_binding, previous_agent}`；终态/不存在 → 400 |
| `/rpc/task/query` | GET | 新增可选参数：`include_binding_history=true`（返回 binding_history 数组）、`execution_agent=<name>`（过滤当前绑定 agent） |

### 3.1 POST /rpc/task/rebind 行为

1. 校验 `task_id` 为合法 ULID
2. 校验 `new_binding.execution_agent`（必填 string）和 `new_binding.user_confirmed_at`（必填 string）
3. 查 `tasks_projection` 确认任务存在且非终态（completed/failed）
4. 记录 `previous_agent` = 当前 `bound_execution_agent`
5. 生成 `task.rebind` 事件（payload 含 new_binding + previous_agent + rebind_timestamp）并 ingest
6. 返回 `{event_id, new_binding, previous_agent}`

### 3.2 GET /rpc/task/query 扩展

- `include_binding_history=true`：从 raw_events 聚合 `task.rebind` 事件（按 created_at 升序），每条含 `event_id / created_at / new_binding / previous_agent / rebind_timestamp`
- `execution_agent=<name>`：WHERE `bound_execution_agent = ?`
- 三个过滤参数（task_id / status / execution_agent）可组合使用，至少提供一个

## 4. Reducer 变更（g4-reducers.js）

### 4.1 task.rebind 增强

```
case 'task.rebind':
  proj.bound_execution_agent = new_binding.execution_agent || proj.bound_execution_agent
  if new_binding.conversation_id 非空 → proj.bound_conversation_id = new_binding.conversation_id
  if new_binding.conversation_url 非空 → proj.bound_conversation_url = new_binding.conversation_url
  proj.updated_at = event.created_at
```

之前只更新 `bound_conversation_id` 和 `bound_execution_agent`；
现在补充 `bound_conversation_url`，且 `conversation_id`/`conversation_url`
仅在非 null/非 undefined 时覆盖（支持显式 unbind 但不强制覆盖为 null）。

### 4.2 三个新事件类型

在 `applyTaskEvent` 的 switch 中落入 default 分支（投影不变）。
事件已持久化到 raw_events，可通过 events/query 查回。

## 5. 验证摘录

单测：`node seed/tests/g5-companion.unit.test.js` → **30/30 通过**，覆盖：

- **Payload 校验**：
  - task.rebind new_binding 完整字段校验（execution_agent 必填、conversation_id 可 null、user_confirmed_at 必填）
  - task.overreach_detected severity 枚举校验（critical/warning）+ 必填字段缺失拒绝
  - task.privilege_expansion_requested user_decision 枚举校验（pending/approved/denied）
  - task.value_divergence_reported category 枚举校验（scope/priority/method/other）
- **Reducer**：
  - task.rebind 更新 bound_conversation_url
  - conversation_url 未提供时保留原值（不覆盖为 null）
- **集成**：
  - 三类审计事件 ingest + events/query 查回
  - 审计事件不改 task 状态机（accepted → accepted）
- **RPC（真实 HTTP 往返，临时端口 + :memory: 库）**：
  - rebind 成功 → 200，返回 event_id + new_binding + previous_agent
  - rebind 后投影 bound_execution_agent 已更新
  - rebind 终态任务 → 400（含 "terminal" / "completed" 关键字）
  - rebind 不存在任务 → 400
  - rebind 缺少 execution_agent → 400
  - rebind 缺少 new_binding → 400
  - include_binding_history=true → 返回按时间升序的 binding_history 数组
  - 无 rebind 时 binding_history 为空数组
  - execution_agent 过滤 → 仅返回匹配 agent 的任务
  - 审计事件经 /rpc/events/ingest 入库 → 200 + event_id
  - 无效 payload 审计事件 → 400

回归：G4 31/31 不受影响（`node seed/tests/g4-companion.unit.test.js`）。

## 6. 已知边界

- `binding_history` 聚合从 raw_events 全表扫描（无独立索引表），
  在超大事件量下需后续优化为物化视图或增量缓存。
- 三类审计事件的 `user_decision` 状态推进（pending → approved/denied）
  尚无独立 RPC 端点，当前通过 /rpc/events/ingest 直接发事件实现。
- mock 模式下 `/rpc/task/query` 的 `execution_agent` 过滤与
  `include_binding_history` 均已支持 mock 路径，但 mock 数据需手动准备。
