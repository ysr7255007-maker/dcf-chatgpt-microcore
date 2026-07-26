/**
 * G4 Companion - Unit Tests
 * 
 * Comprehensive coverage for:
 * - Schema migration (new tables)
 * - Event validation (task, recommendation, card, spark events)
 * - RPC endpoint assertions
 * - Back-propagation chains (material.attribution.transitioned from task feedback_to_materials)
 * - Regression tests (state transition rejection with 400 + error.data.rejection_event_id)
 */

const assert = require('assert');
const { CompanionDB } = require('../companion/db');
const { EventProcessor } = require('../companion/events');
const { generateULID, isValidULID } = require('../companion/ulid');
const {
    TASK_STATES,
    TASK_STATE_TRANSITIONS,
    RECOMMENDATION_STATES,
    CARD_STATES,
    SPARK_STATES,
    validateTaskStateTransition,
    validateTaskEventPayload,
    validateRecommendationEventPayload,
    validateTaskEvent,
    validateRecommendationEvent
} = require('../companion/types');
const {
    applyTaskEvent,
    reduceTaskEvents,
    applyRecommendationEvent,
    reduceRecommendationEvents,
    generateMaterialFeedbackChain
} = require('../companion/reducers/g4-reducers');
const { startTestServer, stopTestServer } = require('../companion/index');

// ============================================================================
// Helper: Create mock DB for testing
// ============================================================================

async function createTestDB() {
    const db = new CompanionDB(':memory:');
    await db.initialize();
    
    // Manually create G4 tables since initialize uses schema.sql
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
// Tests by Category
// ============================================================================

async function main() {

console.log('\n=== Running G4 Companion Unit Tests ===\n');

// 1. Schema Extension Tests
await runSuite('Schema Extension', {
    'tables_exist': async () => {
        const db = await createTestDB();
        const stmt = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks_projection', 'recommendations_projection')");
        const results = stmt.all();
        db.close();
        assert.strictEqual(results.length, 2, 'Both G4 tables should exist');
    }
});

// 2. Task State Machine Validation
await runSuite('Task State Machine Validation', {
    'allows_forward_transitions': () => {
        assert.strictEqual(validateTaskStateTransition('proposed', 'accepted').valid, true);
        assert.strictEqual(validateTaskStateTransition('proposed', 'failed').valid, true);
        assert.strictEqual(validateTaskStateTransition('in_progress', 'completed').valid, true);
    },
    'rejects_backward_transitions': () => {
        assert.strictEqual(validateTaskStateTransition('completed', 'in_progress').valid, false);
        assert.strictEqual(validateTaskStateTransition('failed', 'accepted').valid, false);
        assert.strictEqual(validateTaskStateTransition('in_progress', 'proposed').valid, false);
    }
});

// 3. Task Event Payload Validation
await runSuite('Task Event Payload Validation', {
    'validates_task_created': () => {
        const payload = {
            task_id: generateULID(),
            objective: 'Build a feature'
        };
        const result = validateTaskEventPayload('task.created', payload);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.errors, []);
    },
    'rejects_created_without_objective': () => {
        const payload = { task_id: generateULID() };
        const result = validateTaskEventPayload('task.created', payload);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('objective')));
    },
    'validates_task_completed_with_feedback': () => {
        const payload = {
            task_id: generateULID(),
            result_event_id: generateULID(),
            feedback_to_materials: [{ entity_id: generateULID() }]
        };
        const result = validateTaskEventPayload('task.completed', payload);
        assert.strictEqual(result.valid, true);
    },
    'validates_task_checkpoint_saved': () => {
        const payload = {
            task_id: generateULID(),
            checkpoint_id: generateULID(),
            checkpoint_type: 'progress_update',
            snapshot_json: JSON.stringify({ step: 1 })
        };
        const result = validateTaskEventPayload('task.checkpoint_saved', payload);
        assert.strictEqual(result.valid, true);
    }
});

// 4. Recommendation Event Validation
await runSuite('Recommendation Event Payload Validation', {
    'validates_proposed': () => {
        const payload = {
            recommendation_id: generateULID(),
            source_entity_type: 'card',
            source_entity_id: generateULID(),
            recommendation_text: 'This is a recommendation'
        };
        const result = validateRecommendationEventPayload('recommendation.proposed', payload);
        assert.strictEqual(result.valid, true);
    },
    'rejects_without_required_fields': () => {
        const payload = { recommendation_id: generateULID() };
        const result = validateRecommendationEventPayload('recommendation.proposed', payload);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.length > 0);
    },
    'validates_accepted_with_binding_context': () => {
        const payload = {
            recommendation_id: generateULID(),
            binding_context: JSON.stringify({ context: 'value' })
        };
        const result = validateRecommendationEventPayload('recommendation.accepted', payload);
        assert.strictEqual(result.valid, true);
    }
});

// 5. Task Reducer Tests
await runSuite('Task Reducer', {
    'applies_task_created_correctly': () => {
        const taskId = generateULID();
        const event = {
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.created',
            payload_json: {
                task_id: taskId,
                objective: 'Build a feature',
                bound_conversation_id: generateULID()
            },
            created_at: new Date().toISOString()
        };
        
        const result = applyTaskEvent(null, event);
        assert.strictEqual(result.task_id, taskId);
        assert.strictEqual(result.objective, 'Build a feature');
        assert.strictEqual(result.current_status, 'proposed');
    },
    'progresses_through_states': () => {
        const taskId = generateULID();
        const baseEvent = {
            event_id: generateULID(),
            source_id: taskId,
            payload_json: { task_id: taskId },
            created_at: new Date().toISOString()
        };
        
        let proj = applyTaskEvent(null, { ...baseEvent, event_type: 'task.created' });
        assert.strictEqual(proj.current_status, 'proposed');
        
        proj = applyTaskEvent(proj, { ...baseEvent, event_type: 'task.accepted' });
        assert.strictEqual(proj.current_status, 'accepted');
        
        proj = applyTaskEvent(proj, { ...baseEvent, event_type: 'task.progressed' });
        assert.strictEqual(proj.current_status, 'in_progress');
        
        proj = applyTaskEvent(proj, {
            ...baseEvent,
            event_type: 'task.completed',
            payload_json: { ...baseEvent.payload_json, result_event_id: generateULID() }
        });
        assert.strictEqual(proj.current_status, 'completed');
    },
    'accumulates_checkpoints': () => {
        const taskId = generateULID();
        const createEvt = {
            event_id: generateULID(),
            event_type: 'task.created',
            payload_json: { task_id: taskId, objective: 'Test' },
            created_at: new Date().toISOString()
        };
        const ckptEvt = {
            event_id: generateULID(),
            event_type: 'task.checkpoint_saved',
            payload_json: {
                task_id: taskId,
                checkpoint_id: generateULID(),
                checkpoint_type: 'milestone_reached',
                snapshot_json: JSON.stringify({ milestone: 1 })
            },
            created_at: new Date().toISOString()
        };
        
        let proj = applyTaskEvent(null, createEvt);
        proj = applyTaskEvent(proj, ckptEvt);
        
        assert.strictEqual(proj.checkpoint_event_id, ckptEvt.payload_json.checkpoint_id);
    }
});

// 6. Recommendation Reducer Tests
await runSuite('Recommendation Reducer', {
    'applies_recommendation_proposed': () => {
        const recId = generateULID();
        const cardId = generateULID();
        const event = {
            event_id: generateULID(),
            source_id: recId,
            event_type: 'recommendation.proposed',
            payload_json: {
                recommendation_id: recId,
                source_entity_type: 'card',
                source_entity_id: cardId,
                recommendation_text: 'Review this code',
                materiality_score: 0.8,
                priority_level: 2
            },
            created_at: new Date().toISOString()
        };
        
        const result = applyRecommendationEvent(null, event);
        
        assert.strictEqual(result.recommendation_id, recId);
        assert.strictEqual(result.source_entity_type, 'card');
        assert.strictEqual(result.materiality_score, 0.8);
        assert.strictEqual(result.status, 'pending');
    },
    'transitions_on_accept_dismiss': () => {
        const recId = generateULID();
        const baseEvent = {
            event_id: generateULID(),
            source_id: recId,
            payload_json: { recommendation_id: recId },
            created_at: new Date().toISOString()
        };
        
        // Accept path
        let proj = applyRecommendationEvent(null, {
            ...baseEvent,
            event_type: 'recommendation.proposed',
            payload_json: {
                ...baseEvent.payload_json,
                source_entity_type: 'system',
                source_entity_id: 'system',
                recommendation_text: 'Do something'
            }
        });
        assert.strictEqual(proj.status, 'pending');
        
        proj = applyRecommendationEvent(proj, {
            ...baseEvent,
            event_type: 'recommendation.accepted',
            payload_json: { ...baseEvent.payload_json, binding_context: '{}' }
        });
        assert.strictEqual(proj.status, 'accepted');
        
        // Dismiss path
        proj = applyRecommendationEvent(null, {
            ...baseEvent,
            event_type: 'recommendation.dismissed',
            payload_json: { ...baseEvent.payload_json, reason: 'Not relevant' }
        });
        assert.strictEqual(proj.status, 'dismissed');
    }
});

// 7. Full Reduction Tests
await runSuite('Full Reduction (recompute === incremental)', {
    'produces_identical_results': () => {
        const taskId = generateULID();
        const events = [
            {
                event_id: generateULID(),
                event_type: 'task.created',
                payload_json: { task_id: taskId, objective: 'Initial task' },
                created_at: new Date().toISOString()
            },
            {
                event_id: generateULID(),
                event_type: 'task.accepted',
                payload_json: { task_id: taskId },
                created_at: new Date().toISOString()
            },
            {
                event_id: generateULID(),
                event_type: 'task.completed',
                payload_json: { task_id: taskId, result_event_id: generateULID() },
                created_at: new Date().toISOString()
            }
        ];
        
        // Incremental
        let incrementalProj = null;
        for (const event of events) {
            incrementalProj = applyTaskEvent(incrementalProj, event);
        }
        
        // Recompute
        const reducedMap = reduceTaskEvents(events);
        const recomputedProj = reducedMap.get(taskId);
        
        assert.strictEqual(incrementalProj.current_status, recomputedProj.current_status);
        assert.strictEqual(incrementalProj.objective, recomputedProj.objective);
    }
});

// 8. Material Feedback Chain Tests
await runSuite('Material Feedback Chain (Back-propagation)', {
    'generates_material_feedback_on_completion': () => {
        const taskEvent = {
            event_id: generateULID(),
            event_type: 'task.completed',
            source_id: generateULID(),
            payload_json: {
                task_id: generateULID(),
                result_event_id: generateULID(),
                feedback_to_materials: [
                    { entity_id: generateULID() },
                    { entity_id: generateULID() }
                ]
            },
            created_at: new Date().toISOString()
        };
        
        const chain = generateMaterialFeedbackChain(taskEvent, new Map());
        
        assert.strictEqual(chain.length, 2);
        assert.strictEqual(chain[0].payload_json.to_state, 'reality_verified');
        assert.strictEqual(chain[0].payload_json.from_state, 'ai_proposed');
        assert.strictEqual(chain[0].payload_json.evidence_ref, taskEvent.event_id);
        assert.ok(chain[0].provenance);
        assert.strictEqual(chain[0].provenance.originating_task_event_id, taskEvent.event_id);
    },
    'uses_existing_attribution_state': () => {
        const targetEntityId = generateULID();
        const existingProj = {
            entity_id: targetEntityId,
            attribution_state: 'user_tentative'
        };
        const projectionsMap = new Map();
        projectionsMap.set(targetEntityId, existingProj);
        
        const taskEvent = {
            event_id: generateULID(),
            event_type: 'task.completed',
            payload_json: {
                task_id: generateULID(),
                feedback_to_materials: [{ entity_id: targetEntityId }]
            },
            created_at: new Date().toISOString()
        };
        
        const chain = generateMaterialFeedbackChain(taskEvent, projectionsMap);
        
        assert.strictEqual(chain.length, 1);
        assert.strictEqual(chain[0].payload_json.from_state, 'user_tentative');
        assert.strictEqual(chain[0].payload_json.to_state, 'reality_verified');
    },
    'marks_failure_as_user_tentative': () => {
        const taskEvent = {
            event_id: generateULID(),
            event_type: 'task.failure_recorded',
            payload_json: {
                task_id: generateULID(),
                failure_path_event_id: generateULID(),
                feedback_to_materials: [{ entity_id: generateULID() }]
            },
            created_at: new Date().toISOString()
        };
        
        const chain = generateMaterialFeedbackChain(taskEvent, new Map());
        
        assert.strictEqual(chain.length, 1);
        assert.strictEqual(chain[0].payload_json.to_state, 'user_tentative');
    }
});

// 9. Faulty Transition Rejection
await runSuite('Faulty Transition Rejection', {
    'rejects_regression_clearly': () => {
        const result = validateTaskStateTransition('completed', 'in_progress');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('Cannot transition'));
    },
    'rejects_invalid_states': () => {
        const result1 = validateTaskStateTransition('invalid', 'accepted');
        assert.strictEqual(result1.valid, false);
        assert.ok(result1.error.includes('Invalid fromState'));
        
        const result2 = validateTaskStateTransition('accepted', 'also_invalid');
        assert.strictEqual(result2.valid, false);
        assert.ok(result2.error.includes('Invalid toState'));
    }
});

// 10. Integration Test
await runSuite('Integration: End-to-End Task Lifecycle', {
    'full_lifecycle_with_backpropagation': async () => {
        const db = await createTestDB();
        const eventProcessor = new EventProcessor(db);
        
        const taskId = generateULID();
        const conversationId = generateULID();
        
        // Create task
        const createEvent = {
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.created',
            payload_json: {
                task_id: taskId,
                objective: 'Implement feature X',
                bound_conversation_id: conversationId
            },
            created_at: new Date().toISOString()
        };
        
        const createResult = await eventProcessor.ingestEvent(createEvent);
        assert.strictEqual(createResult.success, true);
        
        // Accept task
        const acceptEvent = {
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.accepted',
            payload_json: { task_id: taskId },
            created_at: new Date().toISOString()
        };
        
        const acceptResult = await eventProcessor.ingestEvent(acceptEvent);
        assert.strictEqual(acceptResult.success, true);
        
        // Complete with feedback
        const targetMaterialId = generateULID();
        const completeEvent = {
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.completed',
            payload_json: {
                task_id: taskId,
                result_event_id: generateULID(),
                feedback_to_materials: [{ entity_id: targetMaterialId }]
            },
            created_at: new Date().toISOString()
        };
        
        const completeResult = await eventProcessor.ingestEvent(completeEvent);
        assert.strictEqual(completeResult.success, true);
        
        // Verify projection
        if (!db.db.isMock) {
            const stmt = db.db.prepare('SELECT current_status FROM tasks_projection WHERE task_id = ?');
            const row = stmt.get(taskId);
            assert.strictEqual(row.current_status, 'completed');
        }
        
        db.close();
    },
    'rejects_state_regression': async () => {
        const db = await createTestDB();
        const eventProcessor = new EventProcessor(db);
        
        const taskId = generateULID();
        
        // Complete first
        const completeEvent = {
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.completed',
            payload_json: { task_id: taskId, result_event_id: generateULID() },
            created_at: new Date().toISOString()
        };
        
        await eventProcessor.ingestEvent(completeEvent);
        
        // Try regression
        const regressionEvent = {
            event_id: generateULID(),
            source_id: taskId,
            event_type: 'task.progressed',
            payload_json: {
                task_id: taskId,
                current_status: 'in_progress',
                from_state: 'completed',
                to_state: 'in_progress'
            },
            created_at: new Date().toISOString()
        };
        
        const regressionResult = await eventProcessor.ingestEvent(regressionEvent);
        assert.strictEqual(regressionResult.success, false);
        assert.ok(regressionResult.error.toLowerCase().includes('regression') ||
                 regressionResult.error.toLowerCase().includes('transition'));
        
        db.close();
    }
});

// 11. RPC Endpoint Assertions (real HTTP round-trips over ephemeral port)
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
    
    const rpcTaskId = generateULID();
    
    await runSuite('RPC Endpoints (G4 contract)', {
        'adapter_sessions_returns_list': async () => {
            const { status, body } = await get('/rpc/adapter/sessions');
            assert.strictEqual(status, 200);
            assert.ok(Array.isArray(body.result.sessions));
        },
        'task_status_forward_transition': async () => {
            const { status, body } = await post('/rpc/task/status', {
                task_id: rpcTaskId,
                from_state: 'proposed',
                to_state: 'accepted'
            });
            assert.strictEqual(status, 200);
            assert.ok(isValidULID(body.result.event_id));
            assert.strictEqual(body.result.from_state, 'proposed');
            assert.strictEqual(body.result.to_state, 'accepted');
        },
        'task_query_returns_projection': async () => {
            const { status, body } = await get(`/rpc/task/query?task_id=${rpcTaskId}`);
            assert.strictEqual(status, 200);
            assert.strictEqual(body.result.count, 1);
            assert.strictEqual(body.result.tasks[0].current_status, 'accepted');
        },
        'task_checkpoint_persists_row': async () => {
            const checkpointId = generateULID();
            const { status, body } = await post('/rpc/task/checkpoint', {
                task_id: rpcTaskId,
                checkpoint_id: checkpointId,
                checkpoint_type: 'progress_update',
                snapshot_json: JSON.stringify({ step: 1 })
            });
            assert.strictEqual(status, 200);
            assert.strictEqual(body.result.checkpoint_id, checkpointId);
            assert.ok(isValidULID(body.result.event_id));
            
            if (!ctx.db.db.isMock) {
                const row = ctx.db.db.prepare('SELECT * FROM task_checkpoints WHERE checkpoint_id = ?').get(checkpointId);
                assert.ok(row, 'checkpoint row must be persisted');
                assert.strictEqual(row.task_id, rpcTaskId);
            }
        },
        'task_status_regression_rejected_400_with_rejection_event': async () => {
            // Drive to completed first
            const done = await post('/rpc/task/status', {
                task_id: rpcTaskId,
                from_state: 'accepted',
                to_state: 'completed'
            });
            assert.strictEqual(done.status, 200);
            
            // Regression attempt: completed -> in_progress
            const { status, body } = await post('/rpc/task/status', {
                task_id: rpcTaskId,
                from_state: 'completed',
                to_state: 'in_progress'
            });
            assert.strictEqual(status, 400);
            assert.strictEqual(body.error.data.rejected, true);
            assert.ok(isValidULID(body.error.data.rejection_event_id), 'rejection_event_id must be recorded');
            
            // The rejection event itself must be part of the append-only log
            if (!ctx.db.db.isMock) {
                const row = ctx.db.db.prepare('SELECT * FROM raw_events WHERE event_id = ?').get(body.error.data.rejection_event_id);
                assert.ok(row, 'rejection event must be in raw_events');
                assert.strictEqual(row.event_type, 'task.transition_rejected');
            }
        },
        'task_status_regression_via_db_state_rejected': async () => {
            // Claimed from_state is forward-valid, but DB state (completed) is ahead
            const { status, body } = await post('/rpc/task/status', {
                task_id: rpcTaskId,
                from_state: 'accepted',
                to_state: 'in_progress'
            });
            assert.strictEqual(status, 400);
            assert.strictEqual(body.error.data.rejected, true);
            assert.ok(isValidULID(body.error.data.rejection_event_id));
        },
        'recommendation_query_accept_dismiss_flow': async () => {
            // Seed two proposals through the event log
            const recA = generateULID();
            const recB = generateULID();
            const sourceCard = generateULID();
            
            for (const recId of [recA, recB]) {
                const result = await ctx.eventProcessor.ingestEvent({
                    event_id: generateULID(),
                    source_id: recId,
                    event_type: 'recommendation.proposed',
                    payload_json: {
                        recommendation_id: recId,
                        source_entity_type: 'card',
                        source_entity_id: sourceCard,
                        recommendation_text: `Recommendation for ${recId}`,
                        materiality_score: 0.7,
                        priority_level: 3
                    }
                });
                assert.strictEqual(result.success, true);
            }
            
            // Query pending by source
            const q1 = await post('/rpc/recommendation/query', { source_id: sourceCard, status: 'pending' });
            assert.strictEqual(q1.status, 200);
            assert.strictEqual(q1.body.result.count, 2);
            
            // Accept A -> returns task_id + binding_context
            const conversationId = generateULID();
            const accept = await post('/rpc/recommendation/accept', {
                recommendation_id: recA,
                binding_context: { conversation_id: conversationId, execution_agent: 'test-agent' }
            });
            assert.strictEqual(accept.status, 200);
            assert.ok(isValidULID(accept.body.result.task_id), 'accept must materialize a task');
            assert.strictEqual(accept.body.result.binding_context.conversation_id, conversationId);
            
            // The materialized task carries binding + provenance
            const tq = await get(`/rpc/task/query?task_id=${accept.body.result.task_id}`);
            assert.strictEqual(tq.body.result.tasks[0].source_ref, recA);
            assert.strictEqual(tq.body.result.tasks[0].bound_conversation_id, conversationId);
            
            // Double-accept rejected
            const accept2 = await post('/rpc/recommendation/accept', { recommendation_id: recA });
            assert.strictEqual(accept2.status, 400);
            
            // Dismiss B with reason
            const dismiss = await post('/rpc/recommendation/dismiss', {
                recommendation_id: recB,
                reason: 'not relevant'
            });
            assert.strictEqual(dismiss.status, 200);
            assert.strictEqual(dismiss.body.result.reason, 'not relevant');
            
            // Only dismissed B remains out of pending
            const q2 = await post('/rpc/recommendation/query', { source_id: sourceCard, status: 'pending' });
            assert.strictEqual(q2.body.result.count, 0);
            const q3 = await post('/rpc/recommendation/query', { source_id: sourceCard, status: 'dismissed' });
            assert.strictEqual(q3.body.result.count, 1);
        },
        'rpc_backpropagation_feedback_to_materials': async () => {
            // Task completes over RPC with feedback_to_materials ->
            // material.attribution.transitioned chain lands in the log
            const taskId = generateULID();
            const materialId = generateULID();
            
            const accepted = await post('/rpc/task/status', {
                task_id: taskId, from_state: 'proposed', to_state: 'accepted'
            });
            assert.strictEqual(accepted.status, 200);
            
            const completed = await post('/rpc/task/status', {
                task_id: taskId, from_state: 'accepted', to_state: 'completed',
                feedback_to_materials: [{ entity_id: materialId }]
            });
            assert.strictEqual(completed.status, 200);
            
            if (!ctx.db.db.isMock) {
                const rows = ctx.db.db.prepare(
                    "SELECT * FROM raw_events WHERE event_type = 'material.attribution.transitioned' AND source_id = ?"
                ).all(materialId);
                assert.strictEqual(rows.length, 1);
                const payload = JSON.parse(rows[0].payload_json);
                assert.strictEqual(payload.to_state, 'reality_verified');
                assert.strictEqual(payload.evidence_ref, completed.body.result.event_id);
            }
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
    console.log('🎉 All G4 companion unit tests passed!');
    process.exit(0);
}

}

main().catch(error => {
    console.error('Fatal test error:', error);
    process.exit(1);
});
