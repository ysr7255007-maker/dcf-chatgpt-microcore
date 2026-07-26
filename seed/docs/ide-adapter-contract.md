# IDE Adapter Contract — 最小契约框架

> DCF Companion ↔ IDE 集成的最小适配器接口。
> 参照 Eric 侦察报告 §5 IDEAdapter 伪代码，映射到 companion 已有的 RPC 契约。
> 零 npm 依赖；所有方法返回 Promise，非抛出（返回 `{ok, status, result|failure}`）。

## 1. 设计原则

1. **IDEAdapter 是 companion RPC 的语义封装层**：不引入新端点，只将 companion 的 JSON-RPC 封装为 IDE 侧可直接调用的 TypeScript/JS 接口。
2. **append-only 事件链是唯一事实源**：所有状态变更（推荐、任务物化、推进、检查点、完成）都生成事件入库，投影是"当前快照"。
3. **显式绑定无推测**：任务与执行者的绑定需要用户显式确认（`user_confirmed_at` + `execution_agent`），适配器不做默认填充。
4. **跨执行者协作（G5）**：rebind 是 append-only 事件链，审计事件（overreach / expansion / divergence）只入日志不改状态机。

## 2. 接口定义

```typescript
/**
 * IDEAdapter — IDE 侧调用 companion 的最小契约接口。
 * 
 * 生命周期：proposeTask → acceptRecommendation → progressTask → saveCheckpoint → completeTask
 * 跨执行者：rebindTask / reportOverreach / requestExpansion / reportDivergence
 */
interface IDEAdapter {
    // ── 核心生命循环（G4）──
    
    /** 提出一条推荐（经 events/ingest 提交 recommendation.proposed 事件） */
    proposeTask(input: ProposeTaskInput): Promise<RPCResult<ProposeTaskResult>>;
    
    /** 接住推荐 → 物化任务 + 显式绑定会话（POST /rpc/recommendation/accept） */
    acceptRecommendation(input: AcceptInput): Promise<RPCResult<AcceptResult>>;
    
    /** 推进任务状态（POST /rpc/task/status，五态机 forward-only） */
    progressTask(input: ProgressInput): Promise<RPCResult<ProgressResult>>;
    
    /** 保存检查点（POST /rpc/task/checkpoint） */
    saveCheckpoint(input: CheckpointInput): Promise<RPCResult<CheckpointResult>>;
    
    /** 完成任务 + 回灌材料归因（progressTask 的 completed 特化） */
    completeTask(input: CompleteInput): Promise<RPCResult<ProgressResult>>;
    
    // ── 跨执行者协作（G5）──
    
    /** 重绑执行者（POST /rpc/task/rebind，append-only 事件链） */
    rebindTask(input: RebindInput): Promise<RPCResult<RebindResult>>;
    
    /** 查询执行者历史（GET /rpc/task/query?include_binding_history=true） */
    getBindingHistory(taskId: string): Promise<BindingHistoryEntry[]>;
    
    /** 报告越权检测（events/ingest: task.overreach_detected） */
    reportOverreach(input: OverreachInput): Promise<RPCResult<IngestResult>>;
    
    /** 请求扩权（events/ingest: task.privilege_expansion_requested, user_decision=pending） */
    requestExpansion(input: ExpansionInput): Promise<RPCResult<IngestResult>>;
    
    /** 对 pending 扩权请求做出决策（events/ingest: 新事件 user_decision=approved/denied） */
    decideExpansion(taskId: string, originalPayload: ExpansionPayload, decision: 'approved' | 'denied'): Promise<RPCResult<IngestResult>>;
    
    /** 报告价值偏离（events/ingest: task.value_divergence_reported） */
    reportDivergence(input: DivergenceInput): Promise<RPCResult<IngestResult>>;
    
    /** 查询任务审计事件（GET /rpc/events/query?source_id=taskId，过滤三类审计事件） */
    getTaskAuditEvents(taskId: string): Promise<AuditEvent[]>;
}
```

## 3. 类型定义

```typescript
// ── 通用 ──
interface RPCResult<T> {
    ok: boolean;
    status: number;          // HTTP status code
    result?: T;
    failure?: { message: string; body?: any };
}

// ── 核心生命循环 ──
interface ProposeTaskInput {
    sourceEntityType: 'card' | 'spark' | 'task' | 'system';
    sourceEntityId: string;      // ULID
    recommendationText: string;  // 必填
    sourceReasoning: string;     // 必填，为什么这个推荐浮现
    targetMaterialRefs?: string[]; // ULID 数组
    materialityScore?: number;   // 0-1
    priorityLevel?: number;      // 1-9
}
interface ProposeTaskResult {
    recommendationId: string;
    eventId: string;
}

interface AcceptInput {
    recommendationId: string;
    bindingContext: {
        conversationId?: string;     // ULID（从 adapter sessions 选）
        conversationUrl?: string;    // 手动粘贴 URL
        executionAgent: string;      // 必填，人或 AI agent 名
        userConfirmedAt: string;     // 必填，ISO timestamp
    };
}
interface AcceptResult {
    taskId: string;
    taskEventId: string;
}

interface ProgressInput {
    taskId: string;
    fromState: 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'failed';
    toState:   'proposed' | 'accepted' | 'in_progress' | 'completed' | 'failed';
    feedbackToMaterials?: { entityId: string; targetAttribution: 'reality_verified' | 'user_tentative' }[];
}
interface ProgressResult {
    eventId: string;
    toState: string;
}

interface CheckpointInput {
    taskId: string;
    checkpointType: string;    // 'manual' | 'auto' | ...
    snapshot: object;          // JSON-serializable
}
interface CheckpointResult {
    checkpointId: string;
    eventId: string;
}

interface CompleteInput {
    taskId: string;
    fromState: 'in_progress';  // 只能从 in_progress 完成
    feedbackToMaterials?: { entityId: string; targetAttribution: 'reality_verified' }[];
}
// CompleteInput 复用 ProgressResult

// ── 跨执行者协作 ──
interface RebindInput {
    taskId: string;
    newBinding: {
        executionAgent: string;       // 必填
        userConfirmedAt: string;      // 必填
        conversationUrl?: string;     // 可选
        conversationId?: string;      // 可选
        reason?: string;              // 可选
    };
}
interface RebindResult {
    eventId: string;
    newBinding: object;
    previousAgent: string | null;
}

interface BindingHistoryEntry {
    eventId: string;
    createdAt: string;
    newBinding: {
        executionAgent: string;
        conversationUrl?: string;
        reason?: string;
    };
    previousAgent: string | null;
    rebindTimestamp: string;
}

interface OverreachInput {
    taskId: string;
    objective: string;
    executedAction: string;
    detectionEvidence: any;
    detectedAt: string;
    detectedBy: string;
    severity: 'critical' | 'warning';
}

interface ExpansionInput {
    taskId: string;
    currentBoundary: string;
    requestedBoundary: string;
    justification: string;
    requestedBy: string;
    // user_decision 始终为 'pending'（由 decideExpansion 推进）
}
interface ExpansionPayload extends ExpansionInput {
    userDecision: 'pending' | 'approved' | 'denied';
}

interface DivergenceInput {
    taskId: string;
    objective: string;
    executionDivergence: string;
    executionRationale: string;
    reportedBy: string;
    category: 'scope' | 'priority' | 'method' | 'other';
}

interface IngestResult {
    eventId: string;
}

interface AuditEvent {
    eventId: string;
    eventType: 'task.overreach_detected' | 'task.privilege_expansion_requested' | 'task.value_divergence_reported';
    payloadJson: any;
    createdAt: string;
}
```

## 4. 最小实现框架（JavaScript, UMD, 零依赖）

```javascript
/**
 * IDEAdapter — 最小实现框架
 * 
 * 依赖：companion HTTP 端点 (默认 http://127.0.0.1:8472)
 * 可直接 require 使用，也可在浏览器中通过 <script> 引入。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.IDEAdapter = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const COMPANION_URL = 'http://127.0.0.1:8472';
    const ULID_ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    function generateULID() {
        let t = Date.now(), ts = '';
        for (let i = 0; i < 10; i++) { ts = ULID_ENC[t % 32] + ts; t = Math.floor(t / 32); }
        let r = '';
        const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
        if (cryptoObj && cryptoObj.getRandomValues) {
            const bytes = new Uint8Array(16);
            cryptoObj.getRandomValues(bytes);
            for (let i = 0; i < 16; i++) r += ULID_ENC[bytes[i] & 31];
        } else {
            for (let i = 0; i < 16; i++) r += ULID_ENC[Math.floor(Math.random() * 32)];
        }
        return ts + r;
    }

    function isValidULID(id) {
        return typeof id === 'string' && id.length === 26 && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id);
    }

    // ── RPC layer (non-throwing) ──
    async function rpc(method, path, payload, url = COMPANION_URL) {
        const opts = { method };
        if (payload !== undefined) {
            opts.headers = { 'Content-Type': 'application/json' };
            opts.body = JSON.stringify(payload);
        }
        try {
            const res = await fetch(url + path, opts);
            let body = null;
            try { body = await res.json(); } catch (_) {}
            if (res.ok && body && !body.error) {
                return { ok: true, status: res.status, result: body.result };
            }
            return { ok: false, status: res.status, failure: { message: body?.error?.message || ('HTTP ' + res.status), body } };
        } catch (err) {
            return { ok: false, status: 0, failure: { message: err.message } };
        }
    }

    // ── 核心生命循环（G4）──

    async function proposeTask(input) {
        const recommendationId = generateULID();
        const envelope = {
            event: {
                event_id: generateULID(),
                source_id: recommendationId,
                event_type: 'recommendation.proposed',
                payload_json: {
                    recommendation_id: recommendationId,
                    source_entity_type: input.sourceEntityType,
                    source_entity_id: input.sourceEntityId,
                    recommendation_text: input.recommendationText,
                    source_reasoning: input.sourceReasoning,
                    target_material_ids: input.targetMaterialRefs || [],
                    materiality_score: input.materialityScore ?? 0.6,
                    priority_level: input.priorityLevel ?? 5
                },
                created_at: new Date().toISOString()
            }
        };
        const res = await rpc('POST', '/rpc/events/ingest', envelope);
        if (res.ok) {
            return { ok: true, status: 200, result: { recommendationId, eventId: res.result.event_id } };
        }
        return res;
    }

    async function acceptRecommendation(input) {
        const payload = {
            recommendation_id: input.recommendationId,
            binding_context: input.bindingContext
        };
        const res = await rpc('POST', '/rpc/recommendation/accept', payload);
        if (res.ok) {
            return { ok: true, status: 200, result: { taskId: res.result.task_id, taskEventId: res.result.task_event_id } };
        }
        return res;
    }

    async function progressTask(input) {
        const payload = { task_id: input.taskId, from_state: input.fromState, to_state: input.toState };
        if (input.feedbackToMaterials) {
            payload.feedback_to_materials = input.feedbackToMaterials.map(f => ({
                entity_id: f.entityId, target_attribution: f.targetAttribution
            }));
        }
        return rpc('POST', '/rpc/task/status', payload);
    }

    async function saveCheckpoint(input) {
        const checkpointId = generateULID();
        const payload = {
            task_id: input.taskId,
            checkpoint_id: checkpointId,
            checkpoint_type: input.checkpointType,
            snapshot_json: JSON.stringify(input.snapshot)
        };
        const res = await rpc('POST', '/rpc/task/checkpoint', payload);
        if (res.ok) {
            return { ok: true, status: 200, result: { checkpointId, eventId: res.result.event_id } };
        }
        return res;
    }

    async function completeTask(input) {
        return progressTask({
            taskId: input.taskId,
            fromState: 'in_progress',
            toState: 'completed',
            feedbackToMaterials: input.feedbackToMaterials
        });
    }

    // ── 跨执行者协作（G5）──

    async function rebindTask(input) {
        const payload = {
            task_id: input.taskId,
            new_binding: {
                execution_agent: input.newBinding.executionAgent,
                user_confirmed_at: input.newBinding.userConfirmedAt
            }
        };
        if (input.newBinding.conversationUrl !== undefined)
            payload.new_binding.conversation_url = input.newBinding.conversationUrl;
        if (input.newBinding.conversationId !== undefined)
            payload.new_binding.conversation_id = input.newBinding.conversationId;
        if (input.newBinding.reason !== undefined)
            payload.new_binding.reason = input.newBinding.reason;
        return rpc('POST', '/rpc/task/rebind', payload);
    }

    async function getBindingHistory(taskId) {
        const res = await rpc('GET', `/rpc/task/query?task_id=${encodeURIComponent(taskId)}&include_binding_history=true`);
        if (!res.ok) return [];
        return (res.result.binding_history || []).map(h => ({
            eventId: h.event_id,
            createdAt: h.created_at,
            newBinding: h.new_binding,
            previousAgent: h.previous_agent,
            rebindTimestamp: h.rebind_timestamp
        }));
    }

    async function reportOverreach(input) {
        return rpc('POST', '/rpc/events/ingest', {
            event: {
                event_id: generateULID(),
                source_id: input.taskId,
                event_type: 'task.overreach_detected',
                payload_json: {
                    task_id: input.taskId,
                    objective: input.objective,
                    executed_action: input.executedAction,
                    detection_evidence: input.detectionEvidence,
                    detected_at: input.detectedAt,
                    detected_by: input.detectedBy,
                    severity: input.severity
                },
                created_at: new Date().toISOString()
            }
        });
    }

    async function requestExpansion(input) {
        return rpc('POST', '/rpc/events/ingest', {
            event: {
                event_id: generateULID(),
                source_id: input.taskId,
                event_type: 'task.privilege_expansion_requested',
                payload_json: {
                    task_id: input.taskId,
                    current_boundary: input.currentBoundary,
                    requested_boundary: input.requestedBoundary,
                    justification: input.justification,
                    requested_by: input.requestedBy,
                    user_decision: 'pending'
                },
                created_at: new Date().toISOString()
            }
        });
    }

    async function decideExpansion(taskId, originalPayload, decision) {
        return rpc('POST', '/rpc/events/ingest', {
            event: {
                event_id: generateULID(),
                source_id: taskId,
                event_type: 'task.privilege_expansion_requested',
                payload_json: {
                    task_id: taskId,
                    current_boundary: originalPayload.currentBoundary || originalPayload.current_boundary,
                    requested_boundary: originalPayload.requestedBoundary || originalPayload.requested_boundary,
                    justification: originalPayload.justification,
                    requested_by: originalPayload.requestedBy || originalPayload.requested_by,
                    user_decision: decision
                },
                created_at: new Date().toISOString()
            }
        });
    }

    async function reportDivergence(input) {
        return rpc('POST', '/rpc/events/ingest', {
            event: {
                event_id: generateULID(),
                source_id: input.taskId,
                event_type: 'task.value_divergence_reported',
                payload_json: {
                    task_id: input.taskId,
                    objective: input.objective,
                    execution_divergence: input.executionDivergence,
                    execution_rationale: input.executionRationale,
                    reported_by: input.reportedBy,
                    category: input.category
                },
                created_at: new Date().toISOString()
            }
        });
    }

    async function getTaskAuditEvents(taskId) {
        const res = await rpc('GET', `/rpc/events/query?source_id=${encodeURIComponent(taskId)}&limit=200`);
        if (!res.ok) return [];
        const types = ['task.overreach_detected', 'task.privilege_expansion_requested', 'task.value_divergence_reported'];
        return (res.result.events || [])
            .filter(e => types.includes(e.event_type))
            .map(e => ({
                eventId: e.event_id,
                eventType: e.event_type,
                payloadJson: typeof e.payload_json === 'string' ? JSON.parse(e.payload_json) : e.payload_json,
                createdAt: e.created_at
            }));
    }

    return {
        generateULID, isValidULID,
        proposeTask, acceptRecommendation, progressTask, saveCheckpoint, completeTask,
        rebindTask, getBindingHistory,
        reportOverreach, requestExpansion, decideExpansion, reportDivergence,
        getTaskAuditEvents
    };
});
```

## 5. 使用示例

```javascript
const adapter = IDEAdapter;

// ① 提出推荐
const proposed = await adapter.proposeTask({
    sourceEntityType: 'system',
    sourceEntityId: adapter.generateULID(),
    recommendationText: 'Refactor the auth module to use JWT',
    sourceReasoning: 'Current session-based auth does not scale',
    targetMaterialRefs: ['01J...material-ulid...'],
    materialityScore: 0.8,
    priorityLevel: 2
});

// ② 接住推荐 → 物化任务
const accepted = await adapter.acceptRecommendation({
    recommendationId: proposed.result.recommendationId,
    bindingContext: {
        conversationUrl: 'https://chatgpt.com/c/abc123',
        executionAgent: 'claude-code',
        userConfirmedAt: new Date().toISOString()
    }
});
const taskId = accepted.result.taskId;

// ③ 推进到 in_progress
await adapter.progressTask({ taskId, fromState: 'proposed', toState: 'accepted' });
await adapter.progressTask({ taskId, fromState: 'accepted', toState: 'in_progress' });

// ④ 保存检查点
await adapter.saveCheckpoint({
    taskId,
    checkpointType: 'manual',
    snapshot: { files: ['auth.js'], tests: 'passing' }
});

// ⑤ 跨执行者：重绑到新 agent
await adapter.rebindTask({
    taskId,
    newBinding: {
        executionAgent: 'human-developer',
        userConfirmedAt: new Date().toISOString(),
        reason: 'AI agent hit a boundary, needs human review'
    }
});

// ⑥ 审计：报告越权
await adapter.reportOverreach({
    taskId,
    objective: 'Refactor auth module',
    executedAction: 'Modified files outside auth/ directory',
    detectionEvidence: { files: ['config/database.js'] },
    detectedAt: new Date().toISOString(),
    detectedBy: 'boundary-guard',
    severity: 'critical'
});

// ⑦ 审计：请求扩权（pending）
const expansion = await adapter.requestExpansion({
    taskId,
    currentBoundary: 'read-only',
    requestedBoundary: 'read-write',
    justification: 'Need to edit config files to complete the refactor',
    requestedBy: 'claude-code'
});

// ⑧ 用户决策：批准扩权
const auditEvents = await adapter.getTaskAuditEvents(taskId);
const pendingExpansion = auditEvents.find(e =>
    e.eventType === 'task.privilege_expansion_requested' &&
    e.payloadJson.user_decision === 'pending'
);
await adapter.decideExpansion(taskId, pendingExpansion.payloadJson, 'approved');

// ⑨ 完成任务 + 回灌
await adapter.completeTask({
    taskId,
    feedbackToMaterials: [{ entityId: '01J...material-ulid...', targetAttribution: 'reality_verified' }]
});

// ⑩ 查看执行者历史
const history = await adapter.getBindingHistory(taskId);
console.log('Rebind chain:', history.map(h => `${h.previousAgent} → ${h.newBinding.executionAgent}`));
```

## 6. Companion RPC 映射表

| IDEAdapter 方法 | HTTP 方法 | 端点 | G 版本 |
|---|---|---|---|
| `proposeTask` | POST | `/rpc/events/ingest` (recommendation.proposed) | G4 |
| `acceptRecommendation` | POST | `/rpc/recommendation/accept` | G4 |
| `progressTask` | POST | `/rpc/task/status` | G4 |
| `saveCheckpoint` | POST | `/rpc/task/checkpoint` | G4 |
| `completeTask` | POST | `/rpc/task/status` (to=completed + feedback) | G4 |
| `rebindTask` | POST | `/rpc/task/rebind` | G5 |
| `getBindingHistory` | GET | `/rpc/task/query?include_binding_history=true` | G5 |
| `reportOverreach` | POST | `/rpc/events/ingest` (task.overreach_detected) | G5 |
| `requestExpansion` | POST | `/rpc/events/ingest` (task.privilege_expansion_requested, pending) | G5 |
| `decideExpansion` | POST | `/rpc/events/ingest` (task.privilege_expansion_requested, approved/denied) | G5 |
| `reportDivergence` | POST | `/rpc/events/ingest` (task.value_divergence_reported) | G5 |
| `getTaskAuditEvents` | GET | `/rpc/events/query?source_id=<taskId>` | G5 |

## 7. 已知边界

1. **expansion 决策无独立 RPC**：`decideExpansion` 通过提交新事件实现"最新事件胜"，而非服务端标记原始 pending 事件。后续可补 `POST /rpc/task/expansion/decide` 端点。
2. **无 pause 状态**：当前五态机（proposed/accepted/in_progress/completed/failed）不含 pause。overreach(critical) 的"暂停"只是 UI 建议，不自动改状态。
3. **binding_history 全表扫描**：companion 从 raw_events 全表扫描聚合 rebind 事件，超大事件量下需后续优化。
4. **IDEAdapter 未含材料管理接口**：材料revision/attribution/export 等 G3 接口不在本最小契约范围。如需可扩展 `MaterialAdapter` 接口。
