/**
 * G5 Companion - Unit Tests
 *
 * Cross-executor collaboration:
 * - POST /rpc/task/rebind (success, terminal-state rejection, not-found)
 * - binding_history aggregation via GET /rpc/task/query?include_binding_history=true
 * - execution_agent filter via GET /rpc/task/query?execution_agent=<name>
 * - Three audit event types (overreach_detected, privilege_expansion_requested,
 *   value_divergence_reported): ingestion + query-back via events/query
 * - Reducer: task.rebind updates bound_conversation_url + bound_execution_agent
 * - Payload validation: enhanced new_binding fields + three new event types
 */

const assert = require('assert');
const { CompanionDB } = require('../companion/db');
const { EventProcessor } = require('../companion/events');
const { generateULID, isValidULID } = require('../companion/ulid');
const {
    TASK_STATES,
    OVERREACH_SEVERITIES,
    PRIVILEGE_USER_DECISIONS,
    DIVERGENCE_CATEGORIES,
    validateTaskEventPayload
} = require('../companion/types');
const {
    applyTaskEvent
} = require('../companion/reducers/g4-reducers');
const { startTestServer, stopTestServer } = require('../companion/index');

// ============================================================================
// Helper: Create test DB with G4 tables
// ============================================================================

async function createTestDB() {
    const db = new CompanionDB(':memory:');
    await db.initialize();

    if (!db.db.isMock) {
        const schemaSQL = `
            CREATE TABLE IF NOT EXISTS tasks_projection (
                task_id TEXT PRIMARY KEY,
                source_ref TEXT,
                objective TEXT,
                boundary_inherited_from TEXT,
                bound_conversation_id TEXT,
                bound_conversation_url TEXT,
                bound_execution_agent TEXT,
                current_status TEXT NOT NULL DEFAULT 'proposed',
                progress_json TEXT,
                checkpoint_event_id TEXT,
                result_event_id TEXT,
                failure_path_event_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_projection_current_status ON tasks_projection(current_status);
            CREATE TABLE IF NOT EXISTS recommendations_projection (
                recommendation_id TEXT PRIMARY KEY,
                source_entity_type TEXT NOT NULL,
                source_entity_id TEXT NOT NULL,
                recommendation_text TEXT NOT NULL,
                suggested_action TEXT,
                target_material_ids TEXT,
                materiality_score REAL DEFAULT 0.5,
                priority_level INTEGER DEFAULT 5,
                status TEXT NOT NULL DEFAULT 'pending',
                binding_context_json TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_recommendations_projection_status ON recommendations_projection(status);
        `;
        db.db.exec(schemaSQL);
    } else {
        db.db.data.tasks_projection = [];
        db.db.data.recommendations_projection = [];
    }

    return db;
}

// ============================================================================
// Test Runner
// ============================================================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runTest(name, testFn, isAsync = false) {
    totalTests++;
    try {
        if (isAsync) {
            await testFn();
        } else {
            testFn();
        }
        console.log(`  ✅ ${name}`);
        passedTests++;
        return true;
    } catch (error) {
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${error.message}`);
        failedTests++;
        return false;
    }
}

async function runSuite(suiteName, tests) {
    console.log(`\n🧪 ${suiteName}`);
    console.log('─'.repeat(60));

    for (const [name, fn] of Object.entries(tests)) {
        const isAsync = fn.constructor.name === 'AsyncFunction';
        await runTest(name, fn, isAsync);
    }
}

// ============================================================================
// Tests
// ============================================================================

async function main() {

console.log('\n=== Running G5 Companion Unit Tests ===\n');

// 1. Payload Validation: Enhanced task.rebind new_binding
await runSuite('Payload Validation: task.rebind new_binding', {
    'validates_full_new_binding': () => {
        const payload = {
            task_id: generateULID(),
            new_binding: {
                execution_agent: 'agent-B',
                conversation_id: generateULID(),
                conversation_url: 'https://example.com/chat/2',
                user_confirmed_at: new Date().toISOString(),
                reason: 'Agent A unavailable'
            }
        };
        const result = validateTaskEventPayload('task.rebind', payload);
        assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    },
    'validates_null_conversation_id': () => {
        const payload = {
            task_id: generateULID(),
            new_binding: {
                execution_agent: 'agent-B',
                conversation_id: null,
                conversation_url: null,
                user_confirmed_at: new Date().toISOString()
            }
        };
        const result = validateTaskEventPayload('task.rebind', payload);
        assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    },
    'rejects_missing_execution_agent': () => {
        const payload = {
            task_id: generateULID(),
            new_binding: { user_confirmed_at: new Date().toISOString() }
        };
        const result = validateTaskEventPayload('task.rebind', payload);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('execution_agent')));
    },
    'rejects_missing_user_confirmed_at': () => {
        const payload = {
            task_id: generateULID(),
            new_binding: { execution_agent: 'agent-B' }
        };
        const result = validateTaskEventPayload('task.rebind', payload);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('user_confirmed_at')));
    }
});

// 2. Payload Validation: task.overreach_detected
await runSuite('Payload Validation: task.overreach_detected', {
    'validates_full_payload': () => {
        const payload = {
            task_id: generateULID(),
            objective: 'Fix bug in module X',
            executed_action: 'Deleted production database',
            detection_evidence: { log: 'DROP TABLE users' },
            detected_at: new Date().toISOString(),
            detected_by: 'audit-guard',
            severity: 'critical'
        };
        const result = validateTaskEventPayload('task.overreach_detected', payload);
        assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    },
    'rejects_invalid_severity': () => {
        const payload = {
            task_id: generateULID(),
            objective: 'Fix bug',
            executed_action: 'did something',
            detection_evidence: 'log',
            detected_at: new Date().toISOString(),
            detected_by: 'guard',
            severity: 'minor'
        };
        const result = validateTaskEventPayload('task.overreach_detected', payload);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('severity')));
    },
    'rejects_missing_fields': () => {
        const payload = { task_id: generateULID(), severity: 'warning' };
        const result = validateTaskEventPayload('task.overreach_detected', payload);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.length >= 4);
    }
});

// 3. Payload Validation: task.privilege_expansion_requested
await runSuite('Payload Validation: task.privilege_expansion_requested', {
    'validates_full_payload': () => {
        const payload = {
            task_id: generateULID(),
            current_boundary: 'observe-only',
            requested_boundary: 'read-write',
            justification: 'Need to write config file',
            requested_by: 'agent-A',
            user_decision: 'pending'
        };
        const result = validateTaskEventPayload('task.privilege_expansion_requested', payload);
        assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    },
    'rejects_invalid_user_decision': () => {
        const payload = {
            task_id: generateULID(),
            current_boundary: 'observe-only',
            requested_boundary: 'read-write',
            justification: 'Need write',
            requested_by: 'agent-A',
            user_decision: 'maybe'
        };
        const result = validateTaskEventPayload('task.privilege_expansion_requested', payload);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('user_decision')));
    }
});

// 4. Payload Validation: task.value_divergence_reported
await runSuite('Payload Validation: task.value_divergence_reported', {
    'validates_full_payload': () => {
        const payload = {
            task_id: generateULID(),
            objective: 'Optimize for speed',
            execution_divergence: 'Optimized for memory instead',
            execution_rationale: 'Memory was the real bottleneck',
            reported_by: 'agent-B',
            category: 'method'
        };
        const result = validateTaskEventPayload('task.value_divergence_reported', payload);
        assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    },
    'rejects_invalid_category': () => {
        const payload = {
            task_id: generateULID(),
            objective: 'Fix bug',
            execution_divergence: 'did something else',
            execution_rationale: 'seemed better',
            reported_by: 'agent-B',
            category: 'timing'
        };
        const result = validateTaskEventPayload('task.value_divergence_reported', payload);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('category')));
    }
});

// 5. Reducer: task.rebind updates bound_conversation_url
await runSuite('Reducer: task.rebind', {
    'updates_bound_conversation_url': () => {
        const taskId = generateULID();
        const createEvt = {
            event_id: generateULID(),
            event_type: 'task.created',
            payload_json: {
                task_id: taskId,
                objective: 'Test task',
                bound_conversation_url: 'https://old.url'
            },
            created_at: new Date().toISOString()
        };
        const rebindEvt = {
            event_id: generateULID(),
            event_type: 'task.rebind',
            payload_json: {
                task_id: taskId,
                new_binding: {
                    execution_agent: 'agent-B',
                    conversation_id: generateULID(),
                    conversation_url: 'https://new.url'
                },
                previous_agent: null
            },
            created_at: new Date().toISOString()
        };

        let proj = applyTaskEvent(null, createEvt);
        proj = applyTaskEvent(proj, rebindEvt);

        assert.strictEqual(proj.bound_execution_agent, 'agent-B');
        assert.strictEqual(proj.bound_conversation_url, 'https://new.url');
    },
    'preserves_conversation_url_when_null_in_binding': () => {
        const taskId = generateULID();
        const createEvt = {
            event_id: generateULID(),
            event_type: 'task.created',
            payload_json: {
                task_id: taskId,
                objective: 'Test',
                bound_conversation_url: 'https://existing.url'
            },
            created_at: new Date().toISOString()
        };
        const rebindEvt = {
            event_id: generateULID(),
            event_type: 'task.rebind',
            payload_json: {
                task_id: taskId,
                new_binding: {
                    execution_agent: 'agent-C'
                    // conversation_url not provided → should not overwrite
                }
            },
            created_at: new Date().toISOString()
        };

        let proj = applyTaskEvent(null, createEvt);
        proj = applyTaskEvent(proj, rebindEvt);

        assert.strictEqual(proj.bound_execution_agent, 'agent-C');
        assert.strictEqual(proj.bound_conversation_url, 'https://existing.url');
    }
});

// 6. Integration: Ingest three new audit event types and query back
await runSuite('Integration: Audit events ingest + query-back', {
    'overreach_detected_persists_and_queryable': async () => {
        const db = await createTestDB();
        const ep = new EventProcessor(db);

        const taskId = generateULID();
        // Seed a task first
        await ep.ingestEvent({
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.created',
            payload_json: { task_id: taskId, objective: 'Test' }
        });

        const eventId = generateULID();
        const result = await ep.ingestEvent({
            event_id: eventId,
            source_id: taskId,
            event_type: 'task.overreach_detected',
            payload_json: {
                task_id: taskId,
                objective: 'Fix bug in X',
                executed_action: 'Modified schema without approval',
                detection_evidence: { diff: 'ALTER TABLE...' },
                detected_at: new Date().toISOString(),
                detected_by: 'audit-guard',
                severity: 'critical'
            }
        });

        assert.strictEqual(result.success, true, result.error);

        // Query back via events/query by source_id
        const queryResult = ep.queryEventsBySource(taskId, { limit: 100, orderBy: 'ASC' });
        assert.strictEqual(queryResult.success, true);
        const overreachEvent = queryResult.events.find(e => e.event_type === 'task.overreach_detected');
        assert.ok(overreachEvent, 'overreach event must be in the event log');
        assert.strictEqual(overreachEvent.event_id, eventId);

        db.close();
    },
    'privilege_expansion_requested_persists_and_queryable': async () => {
        const db = await createTestDB();
        const ep = new EventProcessor(db);

        const taskId = generateULID();
        await ep.ingestEvent({
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.created',
            payload_json: { task_id: taskId, objective: 'Test' }
        });

        const eventId = generateULID();
        const result = await ep.ingestEvent({
            event_id: eventId,
            source_id: taskId,
            event_type: 'task.privilege_expansion_requested',
            payload_json: {
                task_id: taskId,
                current_boundary: 'observe-only',
                requested_boundary: 'read-write',
                justification: 'Need to update config',
                requested_by: 'agent-A',
                user_decision: 'pending'
            }
        });

        assert.strictEqual(result.success, true, result.error);

        const queryResult = ep.queryEventsBySource(taskId, { limit: 100, orderBy: 'ASC' });
        const privEvent = queryResult.events.find(e => e.event_type === 'task.privilege_expansion_requested');
        assert.ok(privEvent, 'privilege expansion event must be in the event log');

        db.close();
    },
    'value_divergence_reported_persists_and_queryable': async () => {
        const db = await createTestDB();
        const ep = new EventProcessor(db);

        const taskId = generateULID();
        await ep.ingestEvent({
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.created',
            payload_json: { task_id: taskId, objective: 'Test' }
        });

        const eventId = generateULID();
        const result = await ep.ingestEvent({
            event_id: eventId,
            source_id: taskId,
            event_type: 'task.value_divergence_reported',
            payload_json: {
                task_id: taskId,
                objective: 'Optimize for speed',
                execution_divergence: 'Optimized for memory',
                execution_rationale: 'Memory was bottleneck',
                reported_by: 'agent-B',
                category: 'method'
            }
        });

        assert.strictEqual(result.success, true, result.error);

        const queryResult = ep.queryEventsBySource(taskId, { limit: 100, orderBy: 'ASC' });
        const divEvent = queryResult.events.find(e => e.event_type === 'task.value_divergence_reported');
        assert.ok(divEvent, 'value divergence event must be in the event log');

        db.close();
    },
    'audit_events_do_not_change_task_status': async () => {
        const db = await createTestDB();
        const ep = new EventProcessor(db);

        const taskId = generateULID();
        await ep.ingestEvent({
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.created',
            payload_json: { task_id: taskId, objective: 'Test' }
        });
        await ep.ingestEvent({
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.accepted',
            payload_json: { task_id: taskId }
        });

        // Ingest all three audit events
        for (const evtType of ['task.overreach_detected', 'task.privilege_expansion_requested', 'task.value_divergence_reported']) {
            const payload = { task_id: taskId };
            if (evtType === 'task.overreach_detected') {
                Object.assign(payload, {
                    objective: 'X', executed_action: 'Y', detection_evidence: 'Z',
                    detected_at: new Date().toISOString(), detected_by: 'guard', severity: 'warning'
                });
            } else if (evtType === 'task.privilege_expansion_requested') {
                Object.assign(payload, {
                    current_boundary: 'a', requested_boundary: 'b',
                    justification: 'c', requested_by: 'agent', user_decision: 'pending'
                });
            } else {
                Object.assign(payload, {
                    objective: 'X', execution_divergence: 'Y', execution_rationale: 'Z',
                    reported_by: 'agent', category: 'other'
                });
            }
            const r = await ep.ingestEvent({
                event_id: generateULID(),
                source_id: taskId,
                event_type: evtType,
                payload_json: payload
            });
            assert.strictEqual(r.success, true, `${evtType}: ${r.error}`);
        }

        // Task status must remain 'accepted' (not changed by audit events)
        let taskRow;
        if (db.db.isMock) {
            taskRow = (db.db.data.tasks_projection || []).find(t => t.task_id === taskId);
        } else {
            taskRow = db.db.prepare('SELECT current_status FROM tasks_projection WHERE task_id = ?').get(taskId);
        }
        assert.ok(taskRow, 'task projection must exist');
        assert.strictEqual(taskRow.current_status, 'accepted', 'audit events must not change task status');

        db.close();
    }
});

// 7. RPC Endpoints: POST /rpc/task/rebind + query extensions
{
    const ctx = await startTestServer({ dbPath: ':memory:' });
    const base = `http://127.0.0.1:${ctx.port}`;

    const post = async (path, body) => {
        const resp = await fetch(base + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return { status: resp.status, body: await resp.json() };
    };
    const get = async (path) => {
        const resp = await fetch(base + path);
        return { status: resp.status, body: await resp.json() };
    };

    // Seed a task via task.status RPC (proposed → accepted)
    const taskA = generateULID();
    const taskB = generateULID();
    const conversationIdA = generateULID();

    // Create task A via recommendation accept flow (to get bound_execution_agent set)
    const recId = generateULID();
    const sourceEntityId = generateULID();
    await ctx.eventProcessor.ingestEvent({
        event_id: generateULID(),
        source_id: recId,
        event_type: 'recommendation.proposed',
        payload_json: {
            recommendation_id: recId,
            source_entity_type: 'system',
            source_entity_id: sourceEntityId,
            recommendation_text: 'Test recommendation'
        }
    });
    const acceptResult = await post('/rpc/recommendation/accept', {
        recommendation_id: recId,
        binding_context: {
            conversation_id: conversationIdA,
            conversation_url: 'https://example.com/chat-a',
            execution_agent: 'agent-A'
        }
    });
    const rebindableTaskId = acceptResult.body.result.task_id;
    assert.ok(isValidULID(rebindableTaskId), 'accept must materialize a task');

    // Also create a simple task B via direct event ingestion
    await ctx.eventProcessor.ingestEvent({
        event_id: generateULID(),
        source_id: taskB,
        event_type: 'task.created',
        payload_json: {
            task_id: taskB,
            objective: 'Task B',
            bound_execution_agent: 'agent-B'
        }
    });

    await runSuite('RPC: POST /rpc/task/rebind', {
        'rebind_success_returns_event_and_previous_agent': async () => {
            const { status, body } = await post('/rpc/task/rebind', {
                task_id: rebindableTaskId,
                new_binding: {
                    execution_agent: 'agent-X',
                    conversation_id: generateULID(),
                    conversation_url: 'https://example.com/chat-x',
                    user_confirmed_at: new Date().toISOString(),
                    reason: 'Agent A context lost'
                }
            });

            assert.strictEqual(status, 200, JSON.stringify(body));
            assert.ok(isValidULID(body.result.event_id));
            assert.strictEqual(body.result.new_binding.execution_agent, 'agent-X');
            assert.strictEqual(body.result.previous_agent, 'agent-A');
        },
        'rebind_updates_projection_bound_agent': async () => {
            const { status, body } = await get(`/rpc/task/query?task_id=${rebindableTaskId}`);
            assert.strictEqual(status, 200);
            assert.strictEqual(body.result.tasks[0].bound_execution_agent, 'agent-X');
        },
        'rebind_on_terminal_state_rejected_400': async () => {
            // Complete the task first
            await post('/rpc/task/status', {
                task_id: rebindableTaskId,
                from_state: 'accepted',
                to_state: 'completed'
            });

            const { status, body } = await post('/rpc/task/rebind', {
                task_id: rebindableTaskId,
                new_binding: {
                    execution_agent: 'agent-Z',
                    user_confirmed_at: new Date().toISOString()
                }
            });

            assert.strictEqual(status, 400);
            assert.ok(body.error.message.includes('terminal') || body.error.message.includes('completed'));
        },
        'rebind_on_nonexistent_task_rejected_400': async () => {
            const { status, body } = await post('/rpc/task/rebind', {
                task_id: generateULID(),
                new_binding: {
                    execution_agent: 'agent-Z',
                    user_confirmed_at: new Date().toISOString()
                }
            });

            assert.strictEqual(status, 400);
            assert.ok(body.error.message.includes('not found') || body.error.message.includes('Task not found'));
        },
        'rebind_missing_execution_agent_rejected_400': async () => {
            const { status, body } = await post('/rpc/task/rebind', {
                task_id: taskB,
                new_binding: {
                    user_confirmed_at: new Date().toISOString()
                }
            });

            assert.strictEqual(status, 400);
            assert.ok(body.error.message.includes('execution_agent'));
        },
        'rebind_missing_new_binding_rejected_400': async () => {
            const { status, body } = await post('/rpc/task/rebind', {
                task_id: taskB
            });

            assert.strictEqual(status, 400);
            assert.ok(body.error.message.includes('new_binding'));
        }
    });

    // 8. RPC: binding_history query
    await runSuite('RPC: include_binding_history', {
        'binding_history_returns_rebind_events_chronologically': async () => {
            // Create a new task and rebind it twice
            const tId = generateULID();
            await ctx.eventProcessor.ingestEvent({
                event_id: generateULID(),
                source_id: tId,
                event_type: 'task.created',
                payload_json: {
                    task_id: tId,
                    objective: 'Multi-rebind test',
                    bound_execution_agent: 'initial-agent'
                }
            });

            // First rebind
            await post('/rpc/task/rebind', {
                task_id: tId,
                new_binding: {
                    execution_agent: 'first-rebind',
                    user_confirmed_at: new Date().toISOString()
                }
            });

            // Small delay to ensure timestamp ordering
            await new Promise(r => setTimeout(r, 10));

            // Second rebind
            await post('/rpc/task/rebind', {
                task_id: tId,
                new_binding: {
                    execution_agent: 'second-rebind',
                    user_confirmed_at: new Date().toISOString()
                }
            });

            const { status, body } = await get(`/rpc/task/query?task_id=${tId}&include_binding_history=true`);
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.result.binding_history));
            assert.strictEqual(body.result.binding_history.length, 2);
            // Chronological order (ascending by created_at)
            assert.strictEqual(body.result.binding_history[0].new_binding.execution_agent, 'first-rebind');
            assert.strictEqual(body.result.binding_history[1].new_binding.execution_agent, 'second-rebind');
            // Each entry has required fields
            assert.ok(body.result.binding_history[0].event_id);
            assert.ok(body.result.binding_history[0].previous_agent !== undefined);
            assert.ok(body.result.binding_history[0].rebind_timestamp);
        },
        'binding_history_empty_when_no_rebinds': async () => {
            const { status, body } = await get(`/rpc/task/query?task_id=${taskB}&include_binding_history=true`);
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.result.binding_history));
            assert.strictEqual(body.result.binding_history.length, 0);
        }
    });

    // 9. RPC: execution_agent filter
    await runSuite('RPC: execution_agent filter', {
        'filters_by_execution_agent': async () => {
            const { status, body } = await get('/rpc/task/query?execution_agent=agent-B');
            assert.strictEqual(status, 200);
            assert.ok(body.result.count >= 1);
            // All returned tasks must have bound_execution_agent === 'agent-B'
            for (const t of body.result.tasks) {
                assert.strictEqual(t.bound_execution_agent, 'agent-B');
            }
        },
        'returns_empty_for_nonexistent_agent': async () => {
            const { status, body } = await get('/rpc/task/query?execution_agent=nonexistent-agent-xyz');
            assert.strictEqual(status, 200);
            assert.strictEqual(body.result.count, 0);
        }
    });

    // 10. RPC: audit event ingestion via /rpc/events/ingest
    await runSuite('RPC: Audit events via /rpc/events/ingest', {
        'overreach_detected_ingested_via_rpc': async () => {
            const tId = generateULID();
            await ctx.eventProcessor.ingestEvent({
                event_id: generateULID(),
                source_id: tId,
                event_type: 'task.created',
                payload_json: { task_id: tId, objective: 'Test' }
            });

            const eventId = generateULID();
            const { status, body } = await post('/rpc/events/ingest', {
                event: {
                    event_id: eventId,
                    source_id: tId,
                    event_type: 'task.overreach_detected',
                    payload_json: {
                        task_id: tId,
                        objective: 'Fix bug',
                        executed_action: 'Wrote to prod DB',
                        detection_evidence: { log: 'INSERT INTO...' },
                        detected_at: new Date().toISOString(),
                        detected_by: 'guard',
                        severity: 'critical'
                    }
                }
            });

            assert.strictEqual(status, 200, JSON.stringify(body));
            assert.strictEqual(body.result.event_id, eventId);

            // Query back
            const q = await get(`/rpc/events/query?source_id=${tId}`);
            const found = q.body.result.events.find(e => e.event_type === 'task.overreach_detected');
            assert.ok(found, 'overreach event must be queryable');
        },
        'value_divergence_reported_ingested_via_rpc': async () => {
            const tId = generateULID();
            await ctx.eventProcessor.ingestEvent({
                event_id: generateULID(),
                source_id: tId,
                event_type: 'task.created',
                payload_json: { task_id: tId, objective: 'Test' }
            });

            const eventId = generateULID();
            const { status, body } = await post('/rpc/events/ingest', {
                event: {
                    event_id: eventId,
                    source_id: tId,
                    event_type: 'task.value_divergence_reported',
                    payload_json: {
                        task_id: tId,
                        objective: 'Do X',
                        execution_divergence: 'Did Y instead',
                        execution_rationale: 'Y was more urgent',
                        reported_by: 'agent-C',
                        category: 'priority'
                    }
                }
            });

            assert.strictEqual(status, 200, JSON.stringify(body));
            assert.strictEqual(body.result.event_id, eventId);
        },
        'privilege_expansion_rejected_with_invalid_payload': async () => {
            const tId = generateULID();
            await ctx.eventProcessor.ingestEvent({
                event_id: generateULID(),
                source_id: tId,
                event_type: 'task.created',
                payload_json: { task_id: tId, objective: 'Test' }
            });

            const { status, body } = await post('/rpc/events/ingest', {
                event: {
                    event_id: generateULID(),
                    source_id: tId,
                    event_type: 'task.privilege_expansion_requested',
                    payload_json: {
                        task_id: tId
                        // missing required fields
                    }
                }
            });

            assert.strictEqual(status, 400);
            assert.ok(body.error.message.includes('privilege_expansion'));
        }
    });

    await stopTestServer();
}

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '═'.repeat(60));
console.log(`✅ Passed: ${passedTests}/${totalTests}`);
console.log(`❌ Failed: ${failedTests}/${totalTests}`);
console.log('═'.repeat(60) + '\n');

if (failedTests > 0) {
    console.log('⚠️  Some tests failed!');
    process.exit(1);
} else {
    console.log('🎉 All G5 companion unit tests passed!');
    process.exit(0);
}

}

main().catch(error => {
    console.error('Fatal test error:', error);
    process.exit(1);
});
