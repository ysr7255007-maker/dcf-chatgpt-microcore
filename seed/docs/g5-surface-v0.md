# G5 Surface v0 — 跨执行者视图与 binding_history 呈现

> 范围：仅 `seed/surface/`、`seed/tests/`、`seed/docs/`。零 npm 依赖。
> 基线：G4 核心生命循环（五态机、推荐→任务物化、回灌链）+ G5 companion 契约（`seed/docs/g5-companion-v0.md`，#24 已落盘）。
> 不修改 `seed/companion/`（边界约束，发现缺陷只记录汇报）。

## 1. 交付物清单

| # | 路径 | 说明 |
|---|---|---|
| 1 | `seed/surface/g4-lifecycle-core.js` (+127 行) | G5 扩展：`fetchTasksWithFilter`（execution_agent 过滤）、`fetchBindingHistory`（include_binding_history=true）、`fetchTaskAuditEvents`（三类审计事件查回）、`buildRebindPayload`（POST /rpc/task/rebind 封包）、`buildExpansionDecisionEvent`（用户 approve/deny 决策事件封包） |
| 2 | `seed/surface/g4-lifecycle.html` (+240 行) | G5 UI 扩展（不另建页面）：执行者过滤器下拉、任务项内审计事件横幅（overreach 红色+暂停建议 / expansion 黄色+approve/deny 按钮 / divergence 蓝色信息）、可折叠执行者历史面板（lazy 加载 binding_history）、重绑执行者 modal |
| 3 | `seed/tests/g5-lifecycle-flow.test.js` (436 行) | HTTP 级流程单测（端口 18477 + /tmp DB）：rebind 成功/终态拒绝/不存在拒绝/缺字段拒绝、binding_history 呈现与排序、execution_agent 过滤、overreach/expansion/divergence 审计事件入库与查回、expansion pending→approved 决策推进、无效 payload 拒绝、~/.dcf 未触碰 |
| 4 | `seed/tests/g5-surface.acceptance.mjs` (444 行) | CDP 无头 Chrome 真实行为验收：file:// 打开页面，实际点击走通「G5 控件呈现→审计事件横幅→重绑 modal→执行者历史展开→expansion 批准→agent 过滤」，UI 断言与 DB 事实交叉校验，8 张截图存 `seed/docs/evidence/g5/` |
| 5 | `seed/docs/g5-surface-v0.md` | 本证据文档 |
| 6 | `seed/docs/ide-adapter-contract.md` | IDE Adapter 最小契约文档（proposeTask→acceptRecommendation→progressTask→saveCheckpoint→completeTask） |

## 2. 契约摘要（实读 seed/docs/g5-companion-v0.md 与 index.js 逐字段核实）

### 2.1 POST /rpc/task/rebind

```
请求: { task_id: ULID, new_binding: {
    execution_agent: string (必填),
    conversation_id: ULID | null (可选),
    conversation_url: string | null (可选),
    user_confirmed_at: string (必填),
    reason: string (可选)
}}
响应 200: { event_id, new_binding, previous_agent }
响应 400: 终态任务 (completed/failed) / 不存在 / 缺必填字段
```

行为：append-only `task.rebind` 事件入库，投影 "最近 agent 胜"（`bound_execution_agent` / `bound_conversation_url` 被覆盖）。

### 2.2 GET /rpc/task/query 扩展

- `include_binding_history=true`：从 raw_events 聚合 `task.rebind` 事件（按 created_at ASC），每条含 `event_id / created_at / new_binding / previous_agent / rebind_timestamp`
- `execution_agent=<name>`：WHERE `bound_execution_agent = ?`（"最近 agent 胜"语义下的当前归属过滤）
- 三参数（task_id / status / execution_agent）可组合，至少提供一个

### 2.3 三类审计事件

| 事件类型 | 语义 | severity / category 枚举 |
|---|---|---|
| `task.overreach_detected` | 执行者超出任务边界 | severity: `critical` \| `warning` |
| `task.privilege_expansion_requested` | 执行者请求扩权 | user_decision: `pending` \| `approved` \| `denied` |
| `task.value_divergence_reported` | 执行方向与目标偏离 | category: `scope` \| `priority` \| `method` \| `other` |

三事件只入 raw_events，不改 tasks_projection 状态。通过 `GET /rpc/events/query?source_id=<task_id>` 查回。

### 2.4 与任务简报的偏差（以真实代码为准）

- **expansion 决策推进无独立 RPC 端点**：companion 未提供 `POST /rpc/task/expansion/decide` 之类的端点。Surface 通过 `POST /rpc/events/ingest` 提交一个新的 `task.privilege_expansion_requested` 事件（`user_decision=approved/denied`，保留原始 `current_boundary` / `requested_boundary` / `justification` / `requested_by`），实现 "最新事件胜" 语义。这与 g5-companion-v0.md §6 已知边界一致。
- **agent 列表来源**：简报提到"从 /rpc/adapter/sessions 或 binding_history 聚合唯一 agent 列表"，但 adapter sessions 返回的是 conversation 级数据（不含 execution_agent）。Surface 实际从当前任务队列的 `bound_execution_agent` 字段聚合唯一 agent 列表（"最近 agent 胜"投影），这是最准确的当前归属来源。
- **审计事件渲染策略**：每类审计事件只展示最近一条（按 created_at DESC），避免历史堆积导致 UI 混乱。expansion 特别处理：只展示最新决策状态（pending 显示按钮，approved/denied 显示已决策）。

## 3. 设计决定

1. **不另建页面，扩展 g4-lifecycle.html**：G5 是 G4 的增量扩展，在同一页面内增加跨执行者协作功能，避免页面碎片化。所有 G5 UI 元素以 `<!-- G5: -->` 注释标记。
2. **审计事件异步水合（hydrate）**：任务列表渲染后，对每个任务异步调 `fetchTaskAuditEvents` 填充审计横幅。不阻塞主渲染流程，不影响 G4 已有功能。
3. **执行者历史懒加载**：点击折叠标题时才调 `fetchBindingHistory`（include_binding_history=true），避免页面加载时对每个任务发起额外请求。
4. **expansion approve/deny 走 events/ingest**：companion 无独立决策端点，Surface 通过 `buildExpansionDecisionEvent` 构建新事件提交，保持 append-only 审计链完整性。决策后自动刷新审计横幅。
5. **overreach(critical) 显示暂停建议但不强制中断**：与任务简报"POST /rpc/task/status 新增 pause 语义（仅记录不强制中断）"一致——Surface 只在 UI 层给出"建议暂停"提示，不自动修改任务状态。
6. **agent 过滤器从任务投影聚合**：不依赖 adapter sessions（其数据结构不含 execution_agent），直接从当前任务队列的 `bound_execution_agent` 聚合唯一值，反映"当前谁在执行什么"的真实视图。

## 4. 验证输出

### 4.1 HTTP 级流程单测 `g5-lifecycle-flow.test.js`（51/51 通过）

```
✅ Passed: 51  ❌ Failed: 0
```

覆盖：
- **buildRebindPayload 强制约束**：缺 new_binding / execution_agent / user_confirmed_at 拒绝；合法 payload 保留可选 reason
- **rebind 成功**：200 + event_id(ULID) + previous_agent + new_binding.execution_agent；投影 bound_execution_agent / bound_conversation_url 更新
- **rebind 链**：第二次 rebind 后 binding_history 有 2 条，按 created_at ASC 排序；每条含 event_id / new_binding / previous_agent / rebind_timestamp
- **binding_history 空态**：无 rebind 的任务返回空数组
- **终态拒绝**：completed 任务 rebind → 400（含 "terminal" / "completed" 关键字）
- **不存在拒绝**：rebind 不存在的 task_id → 400（含 "not found"）
- **缺字段拒绝**：缺 execution_agent / user_confirmed_at / new_binding → 400
- **execution_agent 过滤**：agent-A 过滤只返回 agent-A 任务；rebind 后原任务不在 agent-A 结果中
- **overreach 审计事件**：ingest → 200；events/query 查回；payload severity=critical 保留；不改任务状态
- **expansion 审计事件**：pending 入库 → approve 决策事件入库 → 查回 2 条，最新一条 user_decision=approved
- **divergence 审计事件**：ingest → 200；events/query 查回；category=scope 保留
- **无效 payload 拒绝**：severity=invalid_severity → 400
- **~/.dcf 未触碰**：temp --dcf-dir 隔离

### 4.2 真实行为验收 `g5-surface.acceptance.mjs`（27/27 通过）

```
Summary: 27 passed, 0 failed
```

截图存于 `seed/docs/evidence/g5/`：

| 截图 | 场景 |
|---|---|
| 01-g5-controls-present.png | G5 控件呈现：rebind 按钮、执行者历史折叠、审计事件容器、agent 过滤器下拉 |
| 02-audit-events-rendered.png | 三类审计横幅：overreach 红色（含暂停建议）、expansion 黄色（含 approve/deny 按钮）、divergence 蓝色 |
| 03-rebind-modal-open.png | 重绑 modal 打开：显示当前 agent-A，确认按钮初始 disabled |
| 04-rebind-success.png | 重绑成功：结果区显示 previous_agent=agent-A → agent-B，DB 断言投影更新 |
| 05-executor-history-expanded.png | 执行者历史展开：binding_history 显示 from agent-A → to agent-B + reason |
| 06-expansion-approved.png | expansion 批准后：DB 最新事件 user_decision=approved |
| 07-agent-filter.png | agent 过滤器：选择 agent-B 后任务列表只显示该 agent 的任务 |
| 08-final-state.png | 最终状态总览 |

UI 断言与 companion DB 事实交叉校验（每步通过 HTTP 回查 `/rpc/task/query`、`/rpc/events/query` 确认投影与事件状态）。

## 5. 遗留 unknown

1. **expansion 决策无独立 RPC 端点**：当前通过 events/ingest 提交新事件实现"最新事件胜"。后续可补 `POST /rpc/task/expansion/decide` 端点，服务端负责查找原始 pending 事件并标记决策（而非客户端重建 payload）。
2. **agent 列表来源限于当前任务投影**：未包含历史 rebind 过的 agent（已被覆盖）。若需查看所有曾经绑定过的 agent，需展开执行者历史面板查看 binding_history。
3. **审计事件只展示最近一条**：历史 overreach/divergence 事件不累积展示。后续可增加"查看全部审计事件"展开视图。
4. **overreach critical 暂停建议非强制**：UI 给出"建议暂停"提示但不自动修改任务状态。任务简报提到的"POST /rpc/task/status 新增 pause 语义"在 companion 侧尚未实现（G5 companion v0 范围内未包含 pause 状态）。
5. **Chrome headless 沙箱环境敏感**：与 G4 验收脚本同此环境敏感性（`--no-sandbox --disable-dev-shm-usage` 已加）。
