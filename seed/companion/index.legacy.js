#!/usr/bin/env node

/**
 * G1 Companion Core - HTTP Server
 * localhost:8472 (configurable via --port flag)
 * 
 * JSON-RPC 2.0 over HTTP, using Node native http module (zero npm dependencies)
 * 
 * G3 extension: material metabolism endpoints
 *   POST /rpc/material/revision     Submit revision candidate
 *   POST /rpc/material/attribution  Four-state attribution transition
 *   GET  /rpc/material/query        Query projections / material events
 *   POST /rpc/sync/github/push      Push three-way-merged candidate to remote
 *   POST /rpc/sync/github/pull      Pull-back detection of remote changes
 *   GET/POST /rpc/export            Self-interpreting Markdown+JSONL export
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Load modules
const { CompanionDB } = require('./db');
const { EventProcessor } = require('./events');
const { validateRPCRequest, BOUNDARY_STATES, ATTRIBUTION_STATES, TASK_STATES, TASK_STATE_TRANSITIONS, RECOMMENDATION_STATES, validateTaskStateTransition } = require('./types');
const { runDoctor } = require('./doctor');
const { GitHubSync, checkGhAuth, sha256 } = require('./github-sync');
const { MaterialProcessor } = require('./materials');
const { exportMaterials } = require('./export');
const { generateULID, isValidULID } = require('./ulid');
const { AdapterWakeChannel } = require('./ws-wake');
const { AIDigestEngine } = require('./ai-digest');
const { getStatus: getAiStatus, readConfigFile } = require('./ai-config');
const { 
    loadLibrary, 
    getAllAmmo, 
    addAmmo, 
    buildAmmoInvocation,
    createMemoryFragment,
    fireAmmo,
    requestExtraction,
    ingestAmmoFromText,
    extractArtifactBlocks
} = require('./ammo-ejection');
// Loaded eagerly so a missing/deleted reducer fails at startup (visible to the
// spawning Surface app) instead of failing mid-flight on first lens request.
const weeklyDigestReducer = require('./reducers/weekly-digest.ts');

// Configuration
const DEFAULT_PORT = 8472;
let PORT = parseInt(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1]) || DEFAULT_PORT;
let DB_PATH = process.argv.find(arg => arg.startsWith('--db='))?.split('=').slice(1).join('=') || null;
let BASE_DIR = process.argv.find(arg => arg.startsWith('--dcf-dir='))?.split('=').slice(1).join('=') || null;

// Global state
let companionDB = null;
let eventProcessor = null;
let materialProcessor = null;
let aiDigestEngine = null;
let server = null;
let wakeChannel = null;
let openCodeBridge = null;

// ---------------------------------------------------------------------------
// OpenCode Bridge — lazy-loaded ESM module (Phase 5)
// ---------------------------------------------------------------------------

let _OpenCodeBridgeClass = null;

/**
 * Lazy-load the OpenCodeBridge ESM module.
 * @returns {Promise<Class|null>}
 */
async function loadOpenCodeBridgeClass() {
    if (_OpenCodeBridgeClass) return _OpenCodeBridgeClass;
    try {
        const mod = await import('../adapters/opencode/bridge.mjs');
        _OpenCodeBridgeClass = mod.OpenCodeBridge;
    } catch (e) {
        console.error('Failed to load OpenCode bridge module:', e.message);
    }
    return _OpenCodeBridgeClass;
}

/**
 * Read OpenCode server config from env vars or ai-config.json.
 * @returns {{baseURL: string, username: string, password: string|null}}
 */
function getOpenCodeBridgeConfig() {
    const envUrl = process.env.OPENCODE_SERVER_URL;
    if (envUrl) {
        return {
            baseURL: envUrl,
            username: process.env.OPENCODE_SERVER_USERNAME || 'opencode',
            password: process.env.OPENCODE_SERVER_PASSWORD || null
        };
    }
    try {
        const raw = readConfigFile();
        if (raw && raw.opencode_server) {
            return {
                baseURL: raw.opencode_server.base_url || 'http://127.0.0.1:4096',
                username: raw.opencode_server.username || 'opencode',
                password: raw.opencode_server.password || null
            };
        }
    } catch (_) { /* config not available */ }
    return { baseURL: 'http://127.0.0.1:4096', username: 'opencode', password: null };
}

/**
 * Ensure the OpenCode bridge is instantiated (idempotent).
 * @returns {Promise<Object|null>} bridge instance or null if module unavailable
 */
async function ensureOpenCodeBridge() {
    if (openCodeBridge) return openCodeBridge;
    const Bridge = await loadOpenCodeBridgeClass();
    if (!Bridge) return null;
    const config = getOpenCodeBridgeConfig();
    openCodeBridge = new Bridge(config);
    return openCodeBridge;
}

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    
    for (const arg of args) {
        if (arg.startsWith('--port=')) {
            PORT = parseInt(arg.split('=')[1]);
            if (isNaN(PORT) || PORT < 1024 || PORT > 65535) {
                console.error(`Invalid port: ${PORT}. Must be between 1024 and 65535`);
                process.exit(1);
            }
        } else if (arg.startsWith('--db=')) {
            DB_PATH = arg.split('=').slice(1).join('=');
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg.startsWith('--dcf-dir=')) {
            BASE_DIR = arg.split('=').slice(1).join('=');
        }
    }
}

/**
 * Print usage information
 */
function printUsage() {
    console.log(`
G1 Companion Core - HTTP JSON-RPC Server

Usage: node index.js [options]

Options:
  --port=<number>  Listen on specified port (default: ${DEFAULT_PORT})
  --db=<path>      SQLite database path (default: ~/.dcf/dcf.db)
  --help, -h       Show this help message

Endpoints:
  POST /rpc/events/ingest         Ingest single event
  POST /rpc/events/batch          Batch ingest events
  GET  /rpc/events/query          Query events by source_id or search (q)
  GET  /rpc/boundary              Get boundary state
  POST /rpc/boundary              Set boundary state
  POST /rpc/boundary/update       Update boundary via JSON-RPC
  GET  /rpc/health                Health check
  GET  /rpc/stats                 Database statistics
  POST /rpc/material/revision     Submit material revision candidate (G3)
  POST /rpc/material/attribution  Attribution four-state transition (G3)
  GET  /rpc/material/query        Query material projections/events (G3)
  POST /rpc/sync/github/push      Push merged candidate to remote (G3)
  POST /rpc/sync/github/pull      Pull-back remote changes (G3)
  GET/POST /rpc/export            Self-interpreting export (G3)
  
  # G4: Task lifecycle management
  GET  /rpc/task/query            Query tasks (task_id, status, execution_agent, include_binding_history params)
  POST /rpc/task/status           Query task status transition
  POST /rpc/task/checkpoint       Save checkpoint for task
  POST /rpc/task/rebind           Rebind task to new execution agent (G5)
  
  # G4: Recommendation management
  GET  /rpc/recommendation/query  Query recommendations (source_id, status params)
  POST /rpc/recommendation/accept Accept recommendation
  POST /rpc/recommendation/dismiss Dismiss recommendation
  
  # Lens Projections (Three Cognitive Lens Architecture)
  GET  /rpc/projection/tasks     Get task recommendations for Task View (Lens 1)
  GET  /rpc/projection/graph    Get knowledge graph for Exploration View (Lens 2)
  GET  /rpc/projection/weekly-digest  Get weekly reflection digest for Reflection View (Lens 3)
  
  # G4: Adapter sessions (for conversation context)
  GET  /rpc/adapter/sessions      List active adapter sessions

  # G3 phase 3: Surface -> Adapter persistent command queue (ruling C3)
  POST /rpc/adapter/command        Enqueue command {kind, payload, timeout_ms?}
  GET  /rpc/adapter/command/poll   Take queued commands (marks delivered; idempotent)
  POST /rpc/adapter/command/result Report result {command_id, ok, result?|error?}
  GET  /rpc/adapter/command/:id    Query single command status
  WS   /ws/adapter-wake            Wake-only channel ({"type":"command_available"})
`);
}

/**
 * Send JSON-RPC response
 */
function sendJSONResponse(res, statusCode, body) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(body));
}

/**
 * Handle CORS preflight
 */
function handleCORS(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return true;
    }
    return false;
}

/**
 * Read request body as JSON
 */
async function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
            // Limit payload size to 1MB
            if (body.length > 1024 * 1024) {
                reject(new Error('Request body too large'));
            }
        });
        
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(new Error('Invalid JSON in request body'));
            }
        });
        
        req.on('error', error => {
            reject(error);
        });
    });
}

/**
 * Create JSON-RPC error response
 */
function rpcError(code, message, data = null) {
    const error = { code, message };
    if (data !== null && data !== undefined) {
        error.data = data;
    }
    return {
        jsonrpc: '2.0',
        error,
        id: null
    };
}

/**
 * Create JSON-RPC success response
 */
function rpcResult(result, id) {
    return {
        jsonrpc: '2.0',
        result,
        id
    };
}

/**
 * Receiving side of the language-ammo loop: scan conversation events for
 * DCF_AMMO artifacts and auto-load them into the library. Fire-and-forget:
 * a broken artifact must never block event ingestion.
 * Each successful load is recorded as an ammo.loaded event for traceability.
 */
function autoLoadAmmoFromEvent(event, sourceEventId) {
    try {
        if (!event || typeof event.event_type !== 'string') return;
        if (!event.event_type.startsWith('conversation.')) return;
        const text = extractEventText(event.payload_json);
        if (!text) return;
        // Echo guard: our own generate/extract prompts contain artifact
        // format examples; when the adapter captures them back as user
        // messages they must never be parsed as real artifacts.
        if (text.includes('[DCF-REQUEST]')) return;
        const results = ingestAmmoFromText(text);
        for (const { action, item } of results) {
            console.log(`Language ammo auto-${action}: ${item.id} (v${item.version})`);
            eventProcessor.ingestEvent({
                event_id: generateULID(),
                source_id: generateULID(),
                event_type: 'ammo.loaded',
                payload_json: { ammo_id: item.id, action, version: item.version, source_event_id: sourceEventId || null }
            }).catch(() => { /* trace event is best-effort */ });
        }
        
        // DCF_CARD artifacts become knowledge cards in ai_cards (visible via
        // /rpc/cards and the G4 lifecycle surface), attribution ai_proposed.
        const cards = extractArtifactBlocks(text, 'DCF_CARD').filter(p => p.title && p.summary);
        for (const card of cards) {
            const cardId = generateULID();
            try {
                companionDB.upsertAiCard({
                    card_id: cardId,
                    title: String(card.title).slice(0, 80),
                    summary: String(card.summary),
                    evidence: Array.isArray(card.evidence) ? card.evidence.map(String) : [],
                    boundary_inherit: 'OBSERVE_AND_ARCHIVE',
                    source_conversation: event.source_id || 'unknown',
                    source_event_ids: sourceEventId ? [sourceEventId] : null,
                    markdown_body: null,
                    json_body: JSON.stringify(card),
                    attribution_state: 'ai_proposed'
                });
                console.log(`Knowledge card auto-created: ${cardId} (${String(card.title).slice(0, 30)})`);
                eventProcessor.ingestEvent({
                    event_id: generateULID(),
                    source_id: generateULID(),
                    event_type: 'card.loaded',
                    payload_json: { card_id: cardId, title: String(card.title).slice(0, 80), source_event_id: sourceEventId || null }
                }).catch(() => { /* trace is best-effort */ });
            } catch (cardError) {
                console.warn('Knowledge card auto-create failed:', cardError.message);
            }
        }
        
        // DCF_TASK_REC artifacts become real task recommendations: they flow
        // through the same recommendation.proposed event as any other source,
        // so Task View, accept/dismiss and ammo conversion all apply.
        const taskRecs = extractArtifactBlocks(text, 'DCF_TASK_REC').filter(p => p.title);
        for (const rec of taskRecs) {
            const recommendationId = generateULID();
            const priority = Math.min(9, Math.max(1, parseInt(rec.priority) || 4));
            const confidence = Math.min(1, Math.max(0, Number(rec.confidence) || 0.6));
            eventProcessor.ingestEvent({
                event_id: generateULID(),
                source_id: recommendationId,
                event_type: 'recommendation.proposed',
                payload_json: {
                    recommendation_id: recommendationId,
                    source_entity_type: 'system',
                    source_entity_id: generateULID(),
                    recommendation_text: String(rec.title) + (rec.reason ? ' — ' + String(rec.reason) : ''),
                    suggested_action: 'create_task',
                    materiality_score: confidence,
                    priority_level: priority
                }
            }).then(result => {
                if (result.success) console.log(`AI task recommendation loaded: ${recommendationId} (${String(rec.title).slice(0, 30)})`);
                else console.warn('AI task recommendation rejected:', result.error);
            }).catch(() => { /* best-effort */ });
        }
    } catch (error) {
        console.warn('Ammo auto-load failed (ingestion unaffected):', error.message);
    }
}

/**
 * Handler: POST /rpc/events/ingest
 */
async function handleEventsIngest(req, res, requestBody) {
    try {
        const event = requestBody.event;
        
        if (!event) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: event'));
        }
        
        const result = await eventProcessor.ingestEvent(event);
        
        if (result.success) {
            autoLoadAmmoFromEvent(event, result.event_id);
            return sendJSONResponse(res, 200, rpcResult({
                event_id: result.event_id,
                duplicated: result.duplicated || false
            }, requestBody.id));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.error));
        }
    } catch (error) {
        console.error('Ingest error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/events/batch
 */
async function handleEventsBatch(req, res, requestBody) {
    try {
        const events = requestBody.events;
        
        if (!Array.isArray(events)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: events array'));
        }
        
        const result = await eventProcessor.batchIngestEvents(events);
        
        if (result.success) {
            for (const event of events) autoLoadAmmoFromEvent(event, event.event_id);
            return sendJSONResponse(res, 200, rpcResult({
                inserted: result.inserted,
                total: events.length,
                duplicated: events.length - result.inserted
            }, requestBody.id));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.errors[0]));
        }
    } catch (error) {
        console.error('Batch ingest error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/events/query
 */
function handleEventsQuery(req, res) {
    try {
        const urlObj = url.parse(req.url, true);
        const query = urlObj.query;
        
        // Support q parameter for full-text search
        const searchText = query.q || null;
        
        if (!query.source_id && !searchText) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: source_id or q (search query)'));
        }
        
        const options = {
            limit: parseInt(query.limit) || 100,
            offset: parseInt(query.offset) || 0,
            orderBy: query.orderBy || 'ASC'
        };
        
        let result;
        if (searchText) {
            // Full-text search across all sources
            result = eventProcessor.searchEvents(searchText, options.limit);
        } else {
            // Query by source_id
            result = eventProcessor.queryEventsBySource(query.source_id, options);
        }
        
        if (result.success) {
            return sendJSONResponse(res, 200, rpcResult({
                events: result.events,
                count: result.events.length,
                source_id: query.source_id || null,
                search_query: searchText || null
            }, query.id || null));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.error));
        }
    } catch (error) {
        console.error('Query error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/health
 */
function handleHealth(req, res) {
    const stats = companionDB.getStats();
    const healthy = stats.event_count !== undefined;
    
    sendJSONResponse(res, 200, rpcResult({
        status: healthy ? 'healthy' : 'unhealthy',
        database: stats.mock_mode ? 'mock' : 'real',
        event_count: stats.event_count || 0,
        // Identity of this server instance: lets clients detect stale/ghost
        // Companions whose source files were deleted or belong to another install.
        source: __filename,
        timestamp: new Date().toISOString()
    }, null));
}

/**
 * Handler: GET /rpc/stats
 */
function handleStats(req, res) {
    const stats = companionDB.getStats();
    sendJSONResponse(res, 200, rpcResult(stats, null));
}

/**
 * Handler: GET /rpc/adapter/sessions
 * List active adapter sessions (for conversation context)
 */
function handleAdapterSessions(req, res) {
    try {
        // Sessions are derived from the append-only event log: one session
        // per conversation source observed by adapters (conversation.* events)
        const sessionsById = new Map();
        
        const collect = (row) => {
            let payload = {};
            try {
                payload = typeof row.payload_json === 'string'
                    ? JSON.parse(row.payload_json)
                    : (row.payload_json || {});
            } catch (_) { payload = {}; }
            
            const existing = sessionsById.get(row.source_id);
            if (!existing || row.created_at > existing.last_seen) {
                sessionsById.set(row.source_id, {
                    conversation_id: row.source_id,
                    session_id: payload.session_id || (existing ? existing.session_id : null),
                    conversation_url: payload.url || payload.conversation_url || (existing ? existing.conversation_url : null),
                    adapter: payload.adapter || payload.source || (existing ? existing.adapter : null),
                    last_seen: row.created_at,
                    event_count: (existing ? existing.event_count : 0) + 1
                });
            } else {
                existing.event_count += 1;
            }
        };
        
        if (companionDB.db.isMock) {
            for (const row of (companionDB.db.data.raw_events || [])) {
                if (typeof row.event_type === 'string' && row.event_type.startsWith('conversation.')) {
                    collect(row);
                }
            }
        } else {
            const rows = companionDB.db.prepare(
                "SELECT source_id, event_type, payload_json, created_at FROM raw_events WHERE event_type LIKE 'conversation.%' ORDER BY created_at ASC LIMIT 5000"
            ).all();
            for (const row of rows) collect(row);
        }
        
        const sessions = [...sessionsById.values()]
            .sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1))
            .slice(0, 100);
        
        return sendJSONResponse(res, 200, rpcResult({
            sessions,
            count: sessions.length
        }, null));
    } catch (error) {
        console.error('Adapter sessions error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/adapter/command
 * Enqueue a Surface -> Adapter command (persistent queue, ruling C3).
 * Body: { kind: 'read-conversation'|'send-card'|'list-conversations'|'read-by-id', payload: {...}, timeout_ms? }
 * The WS wake channel only signals "command available"; the queue row in
 * SQLite is the single durable source of truth.
 */
function handleAdapterCommandEnqueue(req, res, requestBody) {
    try {
        const kind = requestBody.kind;
        // Allowed adapter command kinds. list-conversations / read-by-id
        // (task #12) reuse the same enqueue -> poll -> result pipeline; the
        // adapter reads synchronously and reports the result into result_json,
        // so no status extension is required here.
        const ALLOWED_KINDS = ['read-conversation', 'send-card', 'list-conversations', 'read-by-id'];
        if (!ALLOWED_KINDS.includes(kind)) {
            return sendJSONResponse(res, 400, rpcError(-32602,
                "Invalid kind: must be one of " + ALLOWED_KINDS.join(', ')));
        }
        const timeoutMs = requestBody.timeout_ms;
        if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'timeout_ms must be a positive integer'));
        }

        const commandId = generateULID();
        const inserted = companionDB.insertAdapterCommand({
            command_id: commandId,
            kind,
            payload: requestBody.payload || {},
            timeout_ms: timeoutMs || null
        });
        if (!inserted.success) {
            return sendJSONResponse(res, 500, rpcError(-32000, inserted.error));
        }

        // Narrow wake: notify connected adapters that a command is available.
        // No business data crosses the WS; adapters must poll to receive it.
        const notified = wakeChannel ? wakeChannel.broadcastCommandAvailable() : 0;

        return sendJSONResponse(res, 200, rpcResult({
            command_id: commandId,
            status: 'queued',
            wake_notified: notified
        }, requestBody.id || null));
    } catch (error) {
        console.error('Adapter command enqueue error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/adapter/command/poll
 * Take all queued commands, atomically marking them delivered. Idempotent:
 * polling again without new enqueues returns an empty list.
 */
function handleAdapterCommandPoll(req, res) {
    try {
        const commands = companionDB.pollAdapterCommands().map(row => ({
            command_id: row.command_id,
            kind: row.kind,
            payload: row.payload_json ? JSON.parse(row.payload_json) : {},
            timeout_ms: row.timeout_ms || null,
            created_at: row.created_at
        }));
        return sendJSONResponse(res, 200, rpcResult({ commands, count: commands.length }, null));
    } catch (error) {
        console.error('Adapter command poll error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/adapter/command/result
 * Adapter reports the command outcome: { command_id, ok, result?|error? }.
 * done/failed is terminal; expired commands honestly refuse late results.
 */
function handleAdapterCommandResult(req, res, requestBody) {
    try {
        const commandId = requestBody.command_id;
        if (!commandId || typeof commandId !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: command_id'));
        }
        if (typeof requestBody.ok !== 'boolean') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: ok (boolean)'));
        }

        const outcome = companionDB.completeAdapterCommand(
            commandId,
            requestBody.ok,
            requestBody.ok ? (requestBody.result ?? null) : { error: requestBody.error ?? 'unknown error' }
        );
        if (!outcome.success) {
            const notFound = outcome.error === 'command not found';
            return sendJSONResponse(res, notFound ? 404 : 409, rpcError(-32000, outcome.error));
        }
        return sendJSONResponse(res, 200, rpcResult({
            command_id: commandId,
            status: outcome.status
        }, requestBody.id || null));
    } catch (error) {
        console.error('Adapter command result error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/adapter/command/:id
 * Single-command status query (Electron waits on this while a command is
 * in flight; no polling happens when the queue is idle).
 */
function handleAdapterCommandGet(req, res, commandId) {
    try {
        const row = companionDB.getAdapterCommand(commandId);
        if (!row) {
            return sendJSONResponse(res, 404, rpcError(-32000, 'command not found: ' + commandId));
        }
        return sendJSONResponse(res, 200, rpcResult({
            command_id: row.command_id,
            kind: row.kind,
            status: row.status,
            result: row.result_json ? JSON.parse(row.result_json) : null,
            created_at: row.created_at,
            updated_at: row.updated_at
        }, null));
    } catch (error) {
        console.error('Adapter command get error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/task/query
 * Query tasks with optional filters: task_id, status, execution_agent, limit
 * G5 extension: include_binding_history=true appends binding_history array
 *               (aggregated from task.rebind events in raw_events)
 */
function handleTaskQueryGet(req, res) {
    try {
        const urlObj = url.parse(req.url, true);
        const query = urlObj.query;
        
        const taskId = query.task_id || null;
        const status = query.status || null;
        const executionAgent = query.execution_agent || null;
        const includeBindingHistory = query.include_binding_history === 'true';
        const limit = parseInt(query.limit) || 50;
        
        if (!taskId && !status && !executionAgent) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: task_id, status, or execution_agent'));
        }
        
        if (companionDB.db.isMock) {
            // Mock mode: filter in-memory
            let tasks = (companionDB.db.data.tasks_projection || []).slice();
            if (taskId) tasks = tasks.filter(t => t.task_id === taskId);
            if (status) {
                if (!TASK_STATES.includes(status)) {
                    return sendJSONResponse(res, 400, rpcError(-32602, `Invalid status: ${status}. Must be one of: ${TASK_STATES.join(', ')}`));
                }
                tasks = tasks.filter(t => t.current_status === status);
            }
            if (executionAgent) tasks = tasks.filter(t => t.bound_execution_agent === executionAgent);
            tasks = tasks.slice(0, limit);
            
            const response = { tasks, count: tasks.length };
            
            if (includeBindingHistory && taskId) {
                response.binding_history = aggregateBindingHistory(taskId);
            }
            
            return sendJSONResponse(res, 200, rpcResult(response, null));
        }
        
        // Build query conditions
        let conditions = [];
        let params = [];
        
        if (taskId) {
            conditions.push('task_id = ?');
            params.push(taskId);
        }
        
        if (status) {
            if (!TASK_STATES.includes(status)) {
                return sendJSONResponse(res, 400, rpcError(-32602, `Invalid status: ${status}. Must be one of: ${TASK_STATES.join(', ')}`));
            }
            conditions.push('current_status = ?');
            params.push(status);
        }
        
        if (executionAgent) {
            conditions.push('bound_execution_agent = ?');
            params.push(executionAgent);
        }
        
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const stmt = companionDB.db.prepare(`
            SELECT * FROM tasks_projection 
            ${whereClause}
            LIMIT ?
        `);
        
        params.push(limit);
        const tasks = stmt.all(...params);
        
        const response = { tasks, count: tasks.length };
        
        if (includeBindingHistory && taskId) {
            response.binding_history = aggregateBindingHistory(taskId);
        }
        
        return sendJSONResponse(res, 200, rpcResult(response, null));
    } catch (error) {
        console.error('Task query error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * G5: Aggregate all task.rebind events for a given task_id from raw_events.
 * Returns an array sorted by created_at ascending (chronological order).
 * Each entry contains: event_id, created_at, new_binding, previous_agent, rebind_timestamp.
 */
function aggregateBindingHistory(taskId) {
    let rebindEvents = [];
    
    try {
        if (companionDB.db.isMock) {
            rebindEvents = (companionDB.db.data.raw_events || []).filter(e =>
                e.event_type === 'task.rebind' && e.source_id === taskId
            );
        } else {
            rebindEvents = companionDB.db.prepare(
                `SELECT event_id, source_id, event_type, payload_json, created_at 
                 FROM raw_events 
                 WHERE event_type = 'task.rebind' AND source_id = ? 
                 ORDER BY created_at ASC`
            ).all(taskId);
        }
    } catch (_) {
        return [];
    }
    
    // Sort ascending by created_at
    rebindEvents.sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return ta - tb;
    });
    
    return rebindEvents.map(e => {
        let payload = {};
        try {
            payload = typeof e.payload_json === 'string'
                ? JSON.parse(e.payload_json)
                : (e.payload_json || {});
        } catch (_) { payload = {}; }
        
        return {
            event_id: e.event_id,
            created_at: e.created_at,
            new_binding: payload.new_binding || null,
            previous_agent: payload.previous_agent || null,
            rebind_timestamp: payload.rebind_timestamp || e.created_at
        };
    });
}

/**
 * Record an honest task.transition_rejected event (full chain: the
 * rejected request itself is part of the log) and return its event_id.
 */
async function recordTaskTransitionRejection(task_id, from_state, to_state, reason) {
    const rejectionEventId = generateULID();
    const rejection = await eventProcessor.ingestEvent({
        event_id: rejectionEventId,
        source_id: task_id,
        event_type: 'task.transition_rejected',
        payload_json: {
            task_id,
            requested_from_state: from_state,
            requested_to_state: to_state,
            reason
        }
    });
    return rejection.success ? rejectionEventId : null;
}

/**
 * Handler: POST /rpc/task/status
 * Query task status transition and event_id
 */
async function handleTaskStatus(req, res, requestBody) {
    try {
        const { task_id, from_state, to_state } = requestBody;
        
        if (!task_id || !isValidULID(task_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Invalid task_id'));
        }
        
        if (!from_state || !to_state) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing from_state or to_state'));
        }
        
        if (!TASK_STATES.includes(from_state) || !TASK_STATES.includes(to_state)) {
            return sendJSONResponse(res, 400, rpcError(-32602, `Invalid state. Must be one of: ${TASK_STATES.join(', ')}`));
        }
        
        // Validate transition (forward-only, skipping allowed); a rejected
        // regression is recorded as an independent event (honest chain)
        const transitionCheck = validateTaskStateTransition(from_state, to_state);
        if (!transitionCheck.valid) {
            const rejectionEventId = await recordTaskTransitionRejection(
                task_id, from_state, to_state, transitionCheck.error
            );
            return sendJSONResponse(res, 400, rpcError(-32000, `Invalid transition: ${transitionCheck.error}`, {
                rejected: true,
                rejection_event_id: rejectionEventId
            }));
        }
        
        // Generate event and ingest it. Contract per target state:
        //   accepted -> task.accepted, in_progress -> task.progressed,
        //   completed -> task.completed, failed -> task.failed
        const eventId = generateULID();
        const EVENT_TYPE_BY_STATE = {
            accepted: 'task.accepted',
            in_progress: 'task.progressed',
            completed: 'task.completed',
            failed: 'task.failed'
        };
        const eventType = EVENT_TYPE_BY_STATE[to_state] || 'task.progressed';
        
        const payload = {
            task_id,
            current_status: to_state,
            from_state,
            to_state
        };
        
        // task.completed / task.failed carry mandatory evidence references;
        // the status event itself is the evidence when none is supplied
        if (to_state === 'completed') {
            payload.result_event_id = isValidULID(requestBody.result_event_id)
                ? requestBody.result_event_id : eventId;
        }
        if (to_state === 'failed') {
            payload.failure_path_event_id = isValidULID(requestBody.failure_path_event_id)
                ? requestBody.failure_path_event_id : eventId;
        }
        if (Array.isArray(requestBody.feedback_to_materials)) {
            payload.feedback_to_materials = requestBody.feedback_to_materials;
        }
        
        const event = {
            event_id: eventId,
            source_id: task_id,
            event_type: eventType,
            payload_json: payload
        };
        
        const result = await eventProcessor.ingestEvent(event);
        
        if (result.success) {
            return sendJSONResponse(res, 200, rpcResult({
                event_id: eventId,
                from_state,
                to_state,
                success: true
            }, requestBody.id || null));
        } else if (result.rejected) {
            // Regression detected against the persisted projection state
            const rejectionEventId = await recordTaskTransitionRejection(
                task_id, from_state, to_state, result.error
            );
            return sendJSONResponse(res, 400, rpcError(-32000, result.error, {
                rejected: true,
                rejection_event_id: rejectionEventId
            }));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.error));
        }
    } catch (error) {
        console.error('Task status error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/task/rebind (G5)
 * Rebind a task to a new execution agent / conversation.
 * Required: task_id, new_binding (object with execution_agent, user_confirmed_at)
 * Validation: task must exist and not be in terminal state (completed/failed)
 * Returns: {event_id, new_binding, previous_agent}
 */
async function handleTaskRebind(req, res, requestBody) {
    try {
        const { task_id, new_binding } = requestBody;
        
        if (!task_id || !isValidULID(task_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Invalid task_id'));
        }
        
        if (!new_binding || typeof new_binding !== 'object') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: new_binding (object)'));
        }
        
        if (!new_binding.execution_agent || typeof new_binding.execution_agent !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'new_binding.execution_agent is required (string)'));
        }
        
        if (!new_binding.user_confirmed_at || typeof new_binding.user_confirmed_at !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'new_binding.user_confirmed_at is required (string)'));
        }
        
        // Fetch current task projection to validate existence and non-terminal state
        let taskRow;
        if (companionDB.db.isMock) {
            taskRow = (companionDB.db.data.tasks_projection || []).find(t => t.task_id === task_id) || null;
        } else {
            try {
                taskRow = companionDB.db.prepare('SELECT * FROM tasks_projection WHERE task_id = ?').get(task_id) || null;
            } catch (_) {
                taskRow = null;
            }
        }
        
        if (!taskRow) {
            return sendJSONResponse(res, 400, rpcError(-32000, `Task not found: ${task_id}`));
        }
        
        const TERMINAL_STATES = ['completed', 'failed'];
        if (TERMINAL_STATES.includes(taskRow.current_status)) {
            return sendJSONResponse(res, 400, rpcError(-32000, `Task is in terminal state: ${taskRow.current_status}. Rebind not allowed.`));
        }
        
        const previousAgent = taskRow.bound_execution_agent || null;
        const rebindTimestamp = new Date().toISOString();
        
        // Generate and ingest task.rebind event (append-only)
        const eventId = generateULID();
        const event = {
            event_id: eventId,
            source_id: task_id,
            event_type: 'task.rebind',
            payload_json: {
                task_id,
                new_binding: {
                    execution_agent: new_binding.execution_agent,
                    conversation_id: new_binding.conversation_id || null,
                    conversation_url: new_binding.conversation_url || null,
                    user_confirmed_at: new_binding.user_confirmed_at,
                    reason: new_binding.reason || undefined
                },
                previous_agent: previousAgent,
                rebind_timestamp: rebindTimestamp
            }
        };
        
        const result = await eventProcessor.ingestEvent(event);
        
        if (result.success) {
            return sendJSONResponse(res, 200, rpcResult({
                event_id: eventId,
                new_binding: event.payload_json.new_binding,
                previous_agent: previousAgent
            }, requestBody.id || null));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.error));
        }
    } catch (error) {
        console.error('Task rebind error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/task/checkpoint
 * Save checkpoint for task progress tracking
 */
async function handleTaskCheckpoint(req, res, requestBody) {
    try {
        const { task_id, checkpoint_id, checkpoint_type, snapshot_json } = requestBody;
        
        if (!task_id || !isValidULID(task_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Invalid task_id'));
        }
        
        if (!checkpoint_id || !isValidULID(checkpoint_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Invalid checkpoint_id'));
        }
        
        if (!checkpoint_type || typeof checkpoint_type !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing checkpoint_type'));
        }
        
        if (!snapshot_json || typeof snapshot_json !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing snapshot_json'));
        }
        
        // Ingest checkpoint event
        const eventId = generateULID();
        const event = {
            event_id: eventId,
            source_id: task_id,
            event_type: 'task.checkpoint_saved',
            payload_json: {
                task_id,
                checkpoint_id,
                checkpoint_type,
                snapshot_json
            }
        };
        
        const result = await eventProcessor.ingestEvent(event);
        
        if (result.success) {
            // Persist checkpoint row + update tasks_projection pointer
            const createdAt = new Date().toISOString();
            if (companionDB.db.isMock) {
                const arr = companionDB.db.data.task_checkpoints = companionDB.db.data.task_checkpoints || [];
                arr.push({ checkpoint_id, task_id, checkpoint_type, snapshot_json, created_at: createdAt });
                const tasks = companionDB.db.data.tasks_projection || [];
                const t = tasks.find(row => row.task_id === task_id);
                if (t) { t.checkpoint_event_id = eventId; t.updated_at = createdAt; }
            } else {
                companionDB.db.prepare(
                    'INSERT OR REPLACE INTO task_checkpoints (checkpoint_id, task_id, checkpoint_type, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)'
                ).run(checkpoint_id, task_id, checkpoint_type, snapshot_json, createdAt);
                companionDB.db.prepare(
                    'UPDATE tasks_projection SET checkpoint_event_id = ?, updated_at = datetime(\'now\') WHERE task_id = ?'
                ).run(eventId, task_id);
            }
            
            return sendJSONResponse(res, 200, rpcResult({
                checkpoint_id,
                event_id: eventId,
                success: true
            }, requestBody.id || null));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.error));
        }
    } catch (error) {
        console.error('Task checkpoint error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/recommendation/query
 * Query recommendations by source_id or status
 */
async function handleRecommendationQueryPost(req, res, requestBody) {
    try {
        const { source_id, source_type, status } = requestBody;
        
        if (!source_id && !status) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing source_id or status'));
        }
        
        // Build query conditions
        let conditions = [];
        let params = [];
        
        if (source_id) {
            if (!isValidULID(source_id)) {
                return sendJSONResponse(res, 400, rpcError(-32602, 'Invalid source_id'));
            }
            // If source_type provided, filter by it; otherwise search both types
            if (source_type) {
                if (!['card', 'spark', 'task', 'system'].includes(source_type)) {
                    return sendJSONResponse(res, 400, rpcError(-32602, `Invalid source_type: ${source_type}`));
                }
                conditions.push('source_entity_id = ? AND source_entity_type = ?');
                params.push(source_id, source_type);
            } else {
                conditions.push('source_entity_id = ?');
                params.push(source_id);
            }
        }
        
        if (status) {
            if (!RECOMMENDATION_STATES.includes(status)) {
                return sendJSONResponse(res, 400, rpcError(-32602, `Invalid status: ${status}. Must be one of: ${RECOMMENDATION_STATES.join(', ')}`));
            }
            conditions.push('status = ?');
            params.push(status);
        }
        
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const stmt = companionDB.db.prepare(`
            SELECT * FROM recommendations_projection 
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        const recommendations = stmt.all(...params);
        
        return sendJSONResponse(res, 200, rpcResult({
            recommendations,
            count: recommendations.length
        }, requestBody.id || null));
    } catch (error) {
        console.error('Recommendation query error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/recommendation/accept
 * Accept a recommendation and optionally create a task
 */
async function handleRecommendationAccept(req, res, requestBody) {
    try {
        const { recommendation_id, binding_context } = requestBody;
        
        if (!recommendation_id || !isValidULID(recommendation_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Invalid recommendation_id'));
        }
        
        // Validate existing recommendation
        let rec;
        if (companionDB.db.isMock) {
            rec = (companionDB.db.data.recommendations_projection || []).find(r => r.recommendation_id === recommendation_id);
        } else {
            const stmt = companionDB.db.prepare('SELECT * FROM recommendations_projection WHERE recommendation_id = ?');
            rec = stmt.get(recommendation_id);
        }
        
        if (!rec) {
            return sendJSONResponse(res, 404, rpcError(-32001, 'Recommendation not found'));
        }
        
        if (rec.status !== 'pending') {
            return sendJSONResponse(res, 400, rpcError(-32000, `Recommendation is already in state: ${rec.status}`));
        }
        
        // Ingest acceptance event
        const eventId = generateULID();
        const event = {
            event_id: eventId,
            source_id: recommendation_id,
            event_type: 'recommendation.accepted',
            payload_json: {
                recommendation_id,
                binding_context: binding_context ? JSON.stringify(binding_context) : null
            }
        };
        
        const result = await eventProcessor.ingestEvent(event);
        
        if (result.success) {
            // Update recommendation status
            if (!companionDB.db.isMock) {
                companionDB.db.prepare(
                    "UPDATE recommendations_projection SET status = 'accepted', binding_context_json = ?, updated_at = datetime('now') WHERE recommendation_id = ?"
                ).run(binding_context ? JSON.stringify(binding_context) : null, recommendation_id);
            }
            
            // Contract: acceptance materializes a task bound to the given
            // context (source_ref keeps the provenance to the recommendation)
            const taskId = generateULID();
            const bc = binding_context && typeof binding_context === 'object' ? binding_context : {};
            const taskEvent = {
                event_id: generateULID(),
                source_id: taskId,
                event_type: 'task.created',
                payload_json: {
                    task_id: taskId,
                    objective: rec.recommendation_text || `Follow recommendation ${recommendation_id}`,
                    source_ref: recommendation_id,
                    bound_conversation_id: isValidULID(bc.conversation_id) ? bc.conversation_id : undefined,
                    bound_conversation_url: typeof bc.conversation_url === 'string' ? bc.conversation_url : undefined,
                    bound_execution_agent: typeof bc.execution_agent === 'string' ? bc.execution_agent : undefined,
                    boundary_inherited_from: isValidULID(bc.boundary_inherited_from) ? bc.boundary_inherited_from : undefined
                }
            };
            
            const taskResult = await eventProcessor.ingestEvent(taskEvent);
            
            // Language Ammunition Auto-Ejection:
            // When user accepts a recommendation, auto-extract and store it as a memory fragment
            try {
                const conversationContext = {
                    fullText: [rec.recommendation_text],
                    messages: [{ text: rec.recommendation_text }]
                };
                
                const fragment = createMemoryFragment(
                    conversationContext,
                    rec.recommendation_text?.slice(0, 60) || 'Accepted Recommendation',
                    '通过接受任务转化的语言弹药'
                );
                
                addAmmo(fragment);
                console.log(`Language ammunition auto-loaded from accepted recommendation: ${fragment.id}`);
            } catch (ammoError) {
                console.warn('Failed to auto-create ammo from accepted recommendation:', ammoError.message);
            }
            
            return sendJSONResponse(res, 200, rpcResult({
                recommendation_id,
                event_id: eventId,
                task_id: taskResult.success ? taskId : null,
                task_event_id: taskResult.success ? taskEvent.event_id : null,
                binding_context,
                success: true,
                ammo_loaded: true
            }, requestBody.id || null));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.error));
        }
    } catch (error) {
        console.error('Recommendation accept error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/recommendation/dismiss
 * Dismiss a recommendation with optional reason
 */
async function handleRecommendationDismiss(req, res, requestBody) {
    try {
        const { recommendation_id, reason } = requestBody;
        
        if (!recommendation_id || !isValidULID(recommendation_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Invalid recommendation_id'));
        }
        
        // Validate existing recommendation
        let rec;
        if (companionDB.db.isMock) {
            rec = (companionDB.db.data.recommendations_projection || []).find(r => r.recommendation_id === recommendation_id);
        } else {
            const stmt = companionDB.db.prepare('SELECT * FROM recommendations_projection WHERE recommendation_id = ?');
            rec = stmt.get(recommendation_id);
        }
        
        if (!rec) {
            return sendJSONResponse(res, 404, rpcError(-32001, 'Recommendation not found'));
        }
        
        if (rec.status !== 'pending') {
            return sendJSONResponse(res, 400, rpcError(-32000, `Recommendation is already in state: ${rec.status}`));
        }
        
        // Ingest dismissal event
        const eventId = generateULID();
        const event = {
            event_id: eventId,
            source_id: recommendation_id,
            event_type: 'recommendation.dismissed',
            payload_json: {
                recommendation_id,
                reason: reason || null
            }
        };
        
        const result = await eventProcessor.ingestEvent(event);
        
        if (result.success) {
            // Update recommendation status
            if (!companionDB.db.isMock) {
                companionDB.db.prepare(
                    "UPDATE recommendations_projection SET status = 'dismissed', updated_at = datetime('now') WHERE recommendation_id = ?"
                ).run(recommendation_id);
            }
            
            return sendJSONResponse(res, 200, rpcResult({
                recommendation_id,
                event_id: eventId,
                reason,
                success: true
            }, requestBody.id || null));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.error));
        }
    } catch (error) {
        console.error('Recommendation dismiss error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/boundary/update
 */
async function handleBoundaryUpdate(req, res, requestBody) {
    try {
        const { source_id, boundary_state, scope } = requestBody;
        
        if (!source_id) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: source_id'));
        }
        
        if (!boundary_state || !BOUNDARY_STATES.includes(boundary_state)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Invalid or missing boundary_state'));
        }
        
        const relation = {
            source_id: source_id,
            scope: scope || `OBSERVE_CURRENT_ONLY:${source_id}`,
            boundary_state: boundary_state,
            inherited_from_event_ids: []
        };
        
        const result = eventProcessor.setBoundary(relation);
        
        if (result.success) {
            return sendJSONResponse(res, 200, rpcResult({
                success: true,
                source_id: source_id,
                boundary_state: boundary_state,
                scope: relation.scope
            }, requestBody.id || null));
        } else {
            return sendJSONResponse(res, 400, rpcError(-32000, result.error));
        }
    } catch (error) {
        console.error('Boundary update error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/material/revision (G3)
 * Submit a material revision candidate.
 * Required: entity_id, candidate_body, source_ref, assertion_attribution
 * Optional: base_sha256, source_id
 */
async function handleMaterialRevision(req, res, requestBody) {
    try {
        const result = await materialProcessor.submitRevisionCandidate({
            entity_id: requestBody.entity_id,
            base_sha256: requestBody.base_sha256 || null,
            candidate_body: requestBody.candidate_body,
            source_ref: requestBody.source_ref,
            assertion_attribution: requestBody.assertion_attribution,
            source_id: requestBody.source_id || null
        });
        
        if (result.success) {
            return sendJSONResponse(res, 200, rpcResult({
                event_id: result.event_id,
                candidate_sha256: result.candidate_sha256
            }, requestBody.id || null));
        }
        return sendJSONResponse(res, 400, rpcError(-32000, result.error));
    } catch (error) {
        console.error('Material revision error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/material/attribution (G3)
 * Four-state transition (forward-only). Regression -> 400 + rejection event.
 * Required: entity_id, target_ref, from_state, to_state
 * Optional: evidence_ref, source_id
 */
async function handleMaterialAttribution(req, res, requestBody) {
    try {
        const result = await materialProcessor.transitionAttribution({
            entity_id: requestBody.entity_id,
            target_ref: requestBody.target_ref,
            from_state: requestBody.from_state,
            to_state: requestBody.to_state,
            evidence_ref: requestBody.evidence_ref || null,
            source_id: requestBody.source_id || null
        });
        
        if (result.success) {
            return sendJSONResponse(res, 200, rpcResult({
                event_id: result.event_id,
                from_state: result.from_state,
                to_state: result.to_state
            }, requestBody.id || null));
        }
        return sendJSONResponse(res, 400, rpcError(-32000, result.error, {
            rejected: result.rejected || false,
            rejection_event_id: result.rejection_event_id || null
        }));
    } catch (error) {
        console.error('Material attribution error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/material/query (G3)
 * Optional query param: entity_id
 */
function handleMaterialQuery(req, res) {
    try {
        const urlObj = url.parse(req.url, true);
        const entityId = urlObj.query.entity_id || null;
        
        const result = materialProcessor.queryMaterials(entityId);
        return sendJSONResponse(res, 200, rpcResult(result, null));
    } catch (error) {
        console.error('Material query error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/sync/github/push (G3)
 * Three-way merge and push a revision candidate; never overwrites the
 * user's canonical file. Conflict -> no push, conflict recorded as event.
 * Required: remote, entity_id, file_path
 * Optional: candidate_body (default: latest projection candidate), default_branch
 */
async function handleSyncGithubPush(req, res, requestBody) {
    try {
        const { remote, entity_id, file_path } = requestBody;
        if (!remote || !entity_id || !file_path) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameters: remote, entity_id, file_path'));
        }
        
        // Real GitHub remotes require gh auth; local bare repos work via plain git
        const isLocalRemote = remote.startsWith('/') || remote.startsWith('file://');
        if (!isLocalRemote) {
            const gh = await checkGhAuth();
            if (!gh.available) {
                return sendJSONResponse(res, 503, rpcError(-32001,
                    `GitHub sync unavailable (local-only mode): ${gh.detail}`));
            }
        }
        
        // Candidate body: explicit or latest projection candidate
        let candidateBody = requestBody.candidate_body;
        if (typeof candidateBody !== 'string') {
            const projection = companionDB.getMaterialProjection(entity_id);
            if (!projection || typeof projection.latest_candidate_body !== 'string') {
                return sendJSONResponse(res, 400, rpcError(-32000,
                    `No candidate_body provided and no revision candidate found for entity ${entity_id}`));
            }
            candidateBody = projection.latest_candidate_body;
        }
        
        // base = content at last sync point (stored per remote+file)
        const syncKey = `sync:${remote}:${file_path}`;
        const baseContent = companionDB.getSyncMetadata(syncKey) || '';
        
        const sync = new GitHubSync({
            remote,
            defaultBranch: requestBody.default_branch || 'main'
        });
        
        try {
            const pushResult = await sync.pushCandidate({
                entityId: entity_id,
                filePath: file_path,
                candidateBody,
                baseContent
            });
            
            if (pushResult.hasConflict) {
                // Honest stop: record conflict verbatim, no push
                const conflictEvent = await materialProcessor.recordSyncEvent(
                    'material.sync.conflict_detected',
                    {
                        entity_id,
                        remote,
                        file_path,
                        conflict_text: pushResult.conflictText
                    }
                );
                return sendJSONResponse(res, 409, {
                    jsonrpc: '2.0',
                    error: {
                        code: -32002,
                        message: 'Three-way merge conflict: candidate NOT pushed. Conflict recorded for user decision.',
                        data: {
                            conflict_text: pushResult.conflictText,
                            conflict_event_id: conflictEvent.success ? conflictEvent.event_id : null
                        }
                    },
                    id: requestBody.id || null
                });
            }
            
            if (!pushResult.success) {
                return sendJSONResponse(res, 502, rpcError(-32003, `Push failed: ${pushResult.error}`));
            }
            
            // Record the push fact + advance the sync point to the merged content
            const pushEvent = await materialProcessor.recordSyncEvent('material.sync.pushed', {
                entity_id,
                remote,
                file_path,
                candidate_path: pushResult.candidatePath,
                branch: pushResult.branch,
                merged_sha256: pushResult.mergedSha256,
                commit_sha: pushResult.commitSha
            });
            companionDB.setSyncMetadata(syncKey, pushResult.mergedContent);
            
            return sendJSONResponse(res, 200, rpcResult({
                pushed: true,
                candidate_path: pushResult.candidatePath,
                branch: pushResult.branch,
                merged_sha256: pushResult.mergedSha256,
                commit_sha: pushResult.commitSha,
                sync_event_id: pushEvent.success ? pushEvent.event_id : null
            }, requestBody.id || null));
        } finally {
            if (requestBody.cleanup_clone === true) sync.cleanup();
        }
    } catch (error) {
        console.error('GitHub push error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/sync/github/pull (G3)
 * Pull-back detection: compare the remote canonical file against the last
 * sync point sha256; changed content is ingested as an evolution fact.
 * Required: remote, entity_id, file_path
 * Optional: default_branch
 */
async function handleSyncGithubPull(req, res, requestBody) {
    try {
        const { remote, entity_id, file_path } = requestBody;
        if (!remote || !entity_id || !file_path) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameters: remote, entity_id, file_path'));
        }
        
        const isLocalRemote = remote.startsWith('/') || remote.startsWith('file://');
        if (!isLocalRemote) {
            const gh = await checkGhAuth();
            if (!gh.available) {
                return sendJSONResponse(res, 503, rpcError(-32001,
                    `GitHub sync unavailable (local-only mode): ${gh.detail}`));
            }
        }
        
        const sync = new GitHubSync({
            remote,
            defaultBranch: requestBody.default_branch || 'main'
        });
        
        try {
            const fetchResult = await sync.fetchCanonical(file_path);
            if (!fetchResult.success) {
                return sendJSONResponse(res, 502, rpcError(-32003, `Pull failed: ${fetchResult.error}`));
            }
            
            const syncKey = `sync:${remote}:${file_path}`;
            const baseContent = companionDB.getSyncMetadata(syncKey);
            const baseSha = baseContent != null ? sha256(baseContent) : null;
            
            if (!fetchResult.exists) {
                return sendJSONResponse(res, 200, rpcResult({
                    changed: false,
                    exists: false,
                    remote_sha256: null,
                    last_sync_sha256: baseSha
                }, requestBody.id || null));
            }
            
            const changed = fetchResult.sha256 !== baseSha;
            
            if (!changed) {
                return sendJSONResponse(res, 200, rpcResult({
                    changed: false,
                    exists: true,
                    remote_sha256: fetchResult.sha256,
                    last_sync_sha256: baseSha
                }, requestBody.id || null));
            }
            
            // Changed: ingest the remote change as an evolution fact + advance sync point
            const pullEvent = await materialProcessor.recordSyncEvent('material.sync.pulled_back', {
                entity_id,
                remote,
                file_path,
                remote_sha256: fetchResult.sha256,
                previous_sha256: baseSha,
                remote_content: fetchResult.content
            });
            companionDB.setSyncMetadata(syncKey, fetchResult.content);
            
            return sendJSONResponse(res, 200, rpcResult({
                changed: true,
                exists: true,
                remote_sha256: fetchResult.sha256,
                last_sync_sha256: baseSha,
                pull_event_id: pullEvent.success ? pullEvent.event_id : null
            }, requestBody.id || null));
        } finally {
            if (requestBody.cleanup_clone === true) sync.cleanup();
        }
    } catch (error) {
        console.error('GitHub pull error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET/POST /rpc/export (G3)
 * Self-interpreting Markdown + JSONL export with NOT_OBSERVE zero residue.
 * Optional (POST body or query): output_dir
 */
async function handleExport(req, res, requestBody = {}) {
    try {
        const urlObj = url.parse(req.url, true);
        const outputDir = requestBody.output_dir || urlObj.query.output_dir || null;
        
        const events = companionDB.getAllRawEventsOfType('material.');
        const projections = companionDB.getAllMaterialProjections();
        const notObserveSourceIds = eventProcessor.getNotObserveSourceIds();
        
        const result = await exportMaterials({
            events,
            projections,
            notObserveSourceIds,
            outputDir
        });
        
        if (result.success) {
            return sendJSONResponse(res, 200, rpcResult({
                export_path: result.exportPath,
                stats: result.stats
            }, requestBody.id || null));
        }
        return sendJSONResponse(res, 400, rpcError(-32000, result.error));
    } catch (error) {
        console.error('Export error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

// ============================================================================
// G6: Personal software modification (Patch management) handlers
// ============================================================================

const { PATCH_STATUSES, ENV_HEALTH_STATUSES, PATCH_EVENT_TYPES } = require('./types');
const { applyPatchEvent, applyEnvHealthEvent, createEmptyPatchProjection, patchFromRow } = require('./reducers/g6-patch-reducers');

/**
 * Get patch projection from DB (real or mock)
 */
function getPatchProjectionRow(patchId) {
    if (companionDB.db.isMock) {
        return (companionDB.db.data.patches_projection || []).find(p => p.patch_id === patchId) || null;
    }
    try {
        return companionDB.db.prepare('SELECT * FROM patches_projection WHERE patch_id = ?').get(patchId) || null;
    } catch (_) {
        return null;
    }
}

/**
 * Upsert patch projection to DB
 */
function upsertPatchProjection(proj) {
    const record = {
        patch_id: proj.patch_id,
        title: proj.title || null,
        description: proj.description || null,
        patch_body_json: proj.patch_body_json || null,
        patch_status: proj.patch_status || 'proposed',
        environment_health: proj.environment_health || 'healthy',
        source_ref: proj.source_ref || null,
        validated_by: proj.validated_by || null,
        validated_at: proj.validated_at || null,
        activated_at: proj.activated_at || null,
        reverted_at: proj.reverted_at || null,
        superseded_by: proj.superseded_by || null,
        validation_notes_json: proj.validation_notes_json || null,
        created_at: proj.created_at || new Date().toISOString(),
        updated_at: proj.updated_at || new Date().toISOString()
    };
    
    if (companionDB.db.isMock) {
        const arr = companionDB.db.data.patches_projection = companionDB.db.data.patches_projection || [];
        const idx = arr.findIndex(p => p.patch_id === record.patch_id);
        if (idx >= 0) arr[idx] = record; else arr.push(record);
        return { success: true };
    }
    
    try {
        companionDB.db.prepare(`
            INSERT OR REPLACE INTO patches_projection
                (patch_id, title, description, patch_body_json, patch_status, environment_health,
                 source_ref, validated_by, validated_at, activated_at, reverted_at,
                 superseded_by, validation_notes_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.patch_id, record.title, record.description, record.patch_body_json,
            record.patch_status, record.environment_health, record.source_ref,
            record.validated_by, record.validated_at, record.activated_at,
            record.reverted_at, record.superseded_by, record.validation_notes_json,
            record.created_at, record.updated_at
        );
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Handler: GET /rpc/patch/query
 * Query patches by status, include_environment
 */
function handlePatchQuery(req, res) {
    try {
        const parsedUrl = url.parse(req.url, true);
        const { status, patch_id, include_environment } = parsedUrl.query;
        
        let results = [];
        
        if (companionDB.db.isMock) {
            const all = companionDB.db.data.patches_projection || [];
            if (patch_id) {
                const found = all.find(p => p.patch_id === patch_id);
                results = found ? [found] : [];
            } else if (status) {
                results = all.filter(p => p.patch_status === status);
            } else {
                results = [...all];
            }
        } else {
            if (patch_id) {
                const row = companionDB.db.prepare('SELECT * FROM patches_projection WHERE patch_id = ?').get(patch_id);
                results = row ? [row] : [];
            } else if (status) {
                results = companionDB.db.prepare('SELECT * FROM patches_projection WHERE patch_status = ? ORDER BY updated_at DESC').all(status);
            } else {
                results = companionDB.db.prepare('SELECT * FROM patches_projection ORDER BY updated_at DESC').all();
            }
        }
        
        // Optionally include environment projections
        if (include_environment === 'true' && results.length > 0) {
            for (const patch of results) {
                if (companionDB.db.isMock) {
                    patch.environment_files = (companionDB.db.data.patch_environment_projections || [])
                        .filter(e => e.patch_id === patch.patch_id);
                } else {
                    try {
                        patch.environment_files = companionDB.db.prepare(
                            'SELECT * FROM patch_environment_projections WHERE patch_id = ?'
                        ).all(patch.patch_id);
                    } catch (_) {
                        patch.environment_files = [];
                    }
                }
            }
        }
        
        return sendJSONResponse(res, 200, rpcResult({ patches: results, count: results.length }));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/patch/propose
 * Propose a new patch.
 * Required: title, patch_body_json
 * Optional: description, source_ref
 */
async function handlePatchPropose(req, res, requestBody) {
    try {
        const { title, description, patch_body_json, source_ref } = requestBody;
        
        if (!title || typeof title !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'title is required (string)'));
        }
        if (!patch_body_json || typeof patch_body_json !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'patch_body_json is required (stringified JSON)'));
        }
        
        const patchId = generateULID();
        const eventId = generateULID();
        const now = new Date().toISOString();
        
        // Create event
        const event = {
            event_id: eventId,
            source_id: patchId,
            event_type: 'patch.proposed',
            payload_json: {
                patch_id: patchId,
                title,
                description: description || null,
                patch_body_json,
                source_ref: source_ref || null
            },
            created_at: now
        };
        
        // Persist event
        const insertResult = companionDB.insertEvent(event);
        if (!insertResult.success) {
            return sendJSONResponse(res, 500, rpcError(-32603, 'Failed to persist event: ' + insertResult.error));
        }
        
        // Apply reducer
        const proj = applyPatchEvent(null, event);
        upsertPatchProjection(proj);
        
        return sendJSONResponse(res, 200, rpcResult({
            patch_id: patchId,
            event_id: eventId,
            patch_status: 'proposed'
        }));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/patch/validate
 * Validate a proposed patch.
 * Required: patch_id, validated_by
 * Optional: validation_notes_json
 */
async function handlePatchValidate(req, res, requestBody) {
    try {
        const { patch_id, validated_by, validation_notes_json } = requestBody;
        
        if (!patch_id || !isValidULID(patch_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'patch_id is required (valid ULID)'));
        }
        if (!validated_by || typeof validated_by !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'validated_by is required (string)'));
        }
        
        // Check current state
        const current = getPatchProjectionRow(patch_id);
        if (!current) {
            return sendJSONResponse(res, 404, rpcError(-32001, `Patch ${patch_id} not found`));
        }
        if (current.patch_status !== 'proposed' && current.patch_status !== 'needs_revalidation') {
            return sendJSONResponse(res, 400, rpcError(-32000, `Cannot validate patch in status: ${current.patch_status}. Must be proposed or needs_revalidation`));
        }
        
        const eventId = generateULID();
        const now = new Date().toISOString();
        
        const event = {
            event_id: eventId,
            source_id: patch_id,
            event_type: 'patch.validate',
            payload_json: {
                patch_id,
                validated_by,
                validation_notes_json: validation_notes_json || null
            },
            created_at: now
        };
        
        const insertResult = companionDB.insertEvent(event);
        if (!insertResult.success) {
            return sendJSONResponse(res, 500, rpcError(-32603, 'Failed to persist event: ' + insertResult.error));
        }
        
        const proj = applyPatchEvent({ ...current }, event);
        upsertPatchProjection(proj);
        
        return sendJSONResponse(res, 200, rpcResult({
            patch_id,
            event_id: eventId,
            patch_status: 'validated',
            validated_by,
            validated_at: now
        }));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/patch/activate
 * Activate a validated patch.
 * Required: patch_id
 */
async function handlePatchActivate(req, res, requestBody) {
    try {
        const { patch_id } = requestBody;
        
        if (!patch_id || !isValidULID(patch_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'patch_id is required (valid ULID)'));
        }
        
        const current = getPatchProjectionRow(patch_id);
        if (!current) {
            return sendJSONResponse(res, 404, rpcError(-32001, `Patch ${patch_id} not found`));
        }
        if (current.patch_status !== 'validated') {
            return sendJSONResponse(res, 400, rpcError(-32000, `Cannot activate patch in status: ${current.patch_status}. Must be validated`));
        }
        
        const eventId = generateULID();
        const now = new Date().toISOString();
        
        const event = {
            event_id: eventId,
            source_id: patch_id,
            event_type: 'patch.activate',
            payload_json: { patch_id },
            created_at: now
        };
        
        const insertResult = companionDB.insertEvent(event);
        if (!insertResult.success) {
            return sendJSONResponse(res, 500, rpcError(-32603, 'Failed to persist event: ' + insertResult.error));
        }
        
        const proj = applyPatchEvent({ ...current }, event);
        upsertPatchProjection(proj);
        
        return sendJSONResponse(res, 200, rpcResult({
            patch_id,
            event_id: eventId,
            patch_status: 'active',
            activated_at: now
        }));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/patch/deactivate
 * Deactivate an active patch (transition to needs_revalidation).
 * Required: patch_id
 */
async function handlePatchDeactivate(req, res, requestBody) {
    try {
        const { patch_id } = requestBody;
        
        if (!patch_id || !isValidULID(patch_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'patch_id is required (valid ULID)'));
        }
        
        const current = getPatchProjectionRow(patch_id);
        if (!current) {
            return sendJSONResponse(res, 404, rpcError(-32001, `Patch ${patch_id} not found`));
        }
        if (current.patch_status !== 'active') {
            return sendJSONResponse(res, 400, rpcError(-32000, `Cannot deactivate patch in status: ${current.patch_status}. Must be active`));
        }
        
        const eventId = generateULID();
        const now = new Date().toISOString();
        
        const event = {
            event_id: eventId,
            source_id: patch_id,
            event_type: 'patch.deactivate',
            payload_json: { patch_id },
            created_at: now
        };
        
        const insertResult = companionDB.insertEvent(event);
        if (!insertResult.success) {
            return sendJSONResponse(res, 500, rpcError(-32603, 'Failed to persist event: ' + insertResult.error));
        }
        
        const proj = applyPatchEvent({ ...current }, event);
        upsertPatchProjection(proj);
        
        return sendJSONResponse(res, 200, rpcResult({
            patch_id,
            event_id: eventId,
            patch_status: 'needs_revalidation'
        }));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/patch/revert
 * Revert an active/validated patch (append-only, never deletes history).
 * Required: patch_id, reverted_by
 * Optional: revert_reason
 */
async function handlePatchRevert(req, res, requestBody) {
    try {
        const { patch_id, reverted_by, revert_reason } = requestBody;
        
        if (!patch_id || !isValidULID(patch_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'patch_id is required (valid ULID)'));
        }
        if (!reverted_by || typeof reverted_by !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'reverted_by is required (string)'));
        }
        
        const current = getPatchProjectionRow(patch_id);
        if (!current) {
            return sendJSONResponse(res, 404, rpcError(-32001, `Patch ${patch_id} not found`));
        }
        if (current.patch_status !== 'active' && current.patch_status !== 'validated') {
            return sendJSONResponse(res, 400, rpcError(-32000, `Cannot revert patch in status: ${current.patch_status}. Must be active or validated`));
        }
        
        const eventId = generateULID();
        const now = new Date().toISOString();
        
        const event = {
            event_id: eventId,
            source_id: patch_id,
            event_type: 'patch.revert',
            payload_json: {
                patch_id,
                reverted_by,
                revert_reason: revert_reason || null
            },
            created_at: now
        };
        
        const insertResult = companionDB.insertEvent(event);
        if (!insertResult.success) {
            return sendJSONResponse(res, 500, rpcError(-32603, 'Failed to persist event: ' + insertResult.error));
        }
        
        const proj = applyPatchEvent({ ...current }, event);
        upsertPatchProjection(proj);
        
        return sendJSONResponse(res, 200, rpcResult({
            patch_id,
            event_id: eventId,
            patch_status: 'reverted',
            reverted_at: now,
            reverted_by
        }));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/patch/revalidate
 * Revalidate a needs_revalidation patch.
 * Required: patch_id
 * Optional: validation_result ('valid'|'invalid'), validated_by, validation_notes_json
 */
async function handlePatchRevalidate(req, res, requestBody) {
    try {
        const { patch_id, validation_result, validated_by, validation_notes_json } = requestBody;
        
        if (!patch_id || !isValidULID(patch_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'patch_id is required (valid ULID)'));
        }
        
        const current = getPatchProjectionRow(patch_id);
        if (!current) {
            return sendJSONResponse(res, 404, rpcError(-32001, `Patch ${patch_id} not found`));
        }
        if (current.patch_status !== 'needs_revalidation') {
            return sendJSONResponse(res, 400, rpcError(-32000, `Cannot revalidate patch in status: ${current.patch_status}. Must be needs_revalidation`));
        }
        
        const eventId = generateULID();
        const now = new Date().toISOString();
        
        const event = {
            event_id: eventId,
            source_id: patch_id,
            event_type: 'patch.revalidate',
            payload_json: {
                patch_id,
                validation_result: validation_result || 'valid',
                validated_by: validated_by || null,
                validation_notes_json: validation_notes_json || null
            },
            created_at: now
        };
        
        const insertResult = companionDB.insertEvent(event);
        if (!insertResult.success) {
            return sendJSONResponse(res, 500, rpcError(-32603, 'Failed to persist event: ' + insertResult.error));
        }
        
        const proj = applyPatchEvent({ ...current }, event);
        upsertPatchProjection(proj);
        
        return sendJSONResponse(res, 200, rpcResult({
            patch_id,
            event_id: eventId,
            patch_status: proj.patch_status,
            validation_result: validation_result || 'valid'
        }));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/patch/supersede
 * Mark a patch as superseded by another.
 * Required: patch_id, superseded_by_patch_id
 */
async function handlePatchSupersede(req, res, requestBody) {
    try {
        const { patch_id, superseded_by_patch_id } = requestBody;
        
        if (!patch_id || !isValidULID(patch_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'patch_id is required (valid ULID)'));
        }
        if (!superseded_by_patch_id || !isValidULID(superseded_by_patch_id)) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'superseded_by_patch_id is required (valid ULID)'));
        }
        
        const current = getPatchProjectionRow(patch_id);
        if (!current) {
            return sendJSONResponse(res, 404, rpcError(-32001, `Patch ${patch_id} not found`));
        }
        if (current.patch_status !== 'active' && current.patch_status !== 'validated') {
            return sendJSONResponse(res, 400, rpcError(-32000, `Cannot supersede patch in status: ${current.patch_status}. Must be active or validated`));
        }
        
        const eventId = generateULID();
        const now = new Date().toISOString();
        
        const event = {
            event_id: eventId,
            source_id: patch_id,
            event_type: 'patch.supersede',
            payload_json: {
                patch_id,
                superseded_by_patch_id
            },
            created_at: now
        };
        
        const insertResult = companionDB.insertEvent(event);
        if (!insertResult.success) {
            return sendJSONResponse(res, 500, rpcError(-32603, 'Failed to persist event: ' + insertResult.error));
        }
        
        const proj = applyPatchEvent({ ...current }, event);
        upsertPatchProjection(proj);
        
        return sendJSONResponse(res, 200, rpcResult({
            patch_id,
            event_id: eventId,
            patch_status: 'superseded',
            superseded_by: superseded_by_patch_id
        }));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/ai/status
 * Returns AI capability configuration status.
 */
function handleAiStatus(req, res) {
    try {
        const status = aiDigestEngine ? aiDigestEngine.getStatus() : getAiStatus();
        return sendJSONResponse(res, 200, rpcResult(status, null));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/ai/digest/trigger
 * Manually trigger a digest job for a conversation.
 * Body: { conversation_id: string, event_ids?: string[] }
 * If AI is not configured, auto-generates a repair task.
 */
async function handleAiDigestTrigger(req, res, requestBody) {
    try {
        const conversationId = requestBody.conversation_id;
        if (!conversationId || typeof conversationId !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: conversation_id'));
        }

        const status = aiDigestEngine.getStatus();

        // If AI not configured, auto-generate repair task
        if (status.level === 'unconfigured') {
            const repairTask = aiDigestEngine.generateRepairTask(conversationId);
            return sendJSONResponse(res, 200, rpcResult({
                success: false,
                configured: false,
                repair_task_id: repairTask.task_id,
                message: 'AI归纳能力未配置，已自动生成修复任务'
            }, requestBody.id || null));
        }

        // Enqueue digest job
        const eventIds = Array.isArray(requestBody.event_ids) ? requestBody.event_ids : null;
        const enqueueResult = aiDigestEngine.enqueueDigest(conversationId, eventIds);

        // If duplicated (already queued/done), return honestly
        if (enqueueResult.duplicated) {
            return sendJSONResponse(res, 200, rpcResult({
                success: true,
                job_id: enqueueResult.job_id,
                status: enqueueResult.status,
                duplicated: true,
                message: `Digest job already ${enqueueResult.status}`
            }, requestBody.id || null));
        }

        // Run the digest job
        const job = {
            job_id: enqueueResult.job_id,
            conversation_id: conversationId,
            event_ids: eventIds || []
        };
        const result = await aiDigestEngine.runDigest(job, requestBody.material_text || null);

        return sendJSONResponse(res, 200, rpcResult({
            success: result.success,
            job_id: enqueueResult.job_id,
            source_level: result.source_level,
            products: result.products.map(p => ({
                type: p.type,
                id: p._id,
                title: p.title || p.task
            })),
            error: result.error || null
        }, requestBody.id || null));
    } catch (error) {
        console.error('AI digest trigger error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/cards
 * Query AI-produced cards with optional filters.
 */
function handleAiCardsQuery(req, res, urlObj) {
    try {
        const conversationId = urlObj.query.conversation_id;
        let cards;
        if (conversationId) {
            cards = companionDB.getAiCardsByConversation(conversationId);
        } else {
            cards = companionDB.getAllAiCards();
        }

        // Parse JSON fields for response
        const formatted = cards.map(c => ({
            ...c,
            evidence: c.evidence_json ? JSON.parse(c.evidence_json) : [],
            source_event_ids: c.source_event_ids ? JSON.parse(c.source_event_ids) : [],
            evidence_json: undefined
        }));

        return sendJSONResponse(res, 200, rpcResult({
            cards: formatted,
            count: formatted.length
        }, null));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/maintenance-tasks
 * Query AI-produced maintenance tasks with optional filters.
 */
function handleAiMaintenanceTasksQuery(req, res, urlObj) {
    try {
        const conversationId = urlObj.query.conversation_id;
        let tasks;
        if (conversationId) {
            tasks = companionDB.getAiMaintenanceTasksByConversation(conversationId);
        } else {
            tasks = companionDB.getAllAiMaintenanceTasks();
        }

        // Parse JSON fields for response
        const formatted = tasks.map(t => ({
            ...t,
            criteria: t.criteria_json ? JSON.parse(t.criteria_json) : [],
            source_event_ids: t.source_event_ids ? JSON.parse(t.source_event_ids) : [],
            criteria_json: undefined
        }));

        return sendJSONResponse(res, 200, rpcResult({
            tasks: formatted,
            count: formatted.length
        }, null));
    } catch (error) {
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/opencode/dispatch
 * Dispatch a task to OpenCode via the bridge.
 * Body: { prompt, conversation_url?, entity_id?, title?, agent?, model?, timeout_ms? }
 */
async function handleOpencodeDispatch(req, res, requestBody) {
    try {
        const prompt = requestBody.prompt;
        if (!prompt || typeof prompt !== 'string') {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing required parameter: prompt'));
        }

        const bridge = await ensureOpenCodeBridge();
        if (!bridge) {
            return sendJSONResponse(res, 503, rpcError(-32000, 'OpenCode bridge module unavailable'));
        }

        const taskId = `dcf-oc-${generateULID()}`;
        const nonce = require('crypto').randomBytes(16).toString('hex');
        const os = require('os');
        const outputPath = require('path').join(os.tmpdir(), `dcf-opencode-${taskId}.json`);

        const dispatchResult = await bridge.dispatchTask({
            task_id: taskId,
            prompt,
            output_path: outputPath,
            nonce,
            conversation_url: requestBody.conversation_url || null,
            entity_id: requestBody.entity_id || null,
            title: requestBody.title || null,
            agent: requestBody.agent || null,
            model: requestBody.model || null
        });

        // If dispatch succeeded, start a background watcher
        if (dispatchResult.status !== 'failed') {
            const timeoutMs = requestBody.timeout_ms || 10 * 60 * 1000;
            bridge.watchResult(outputPath, { timeoutMs, nonce, task_id: taskId })
                .then(result => {
                    if (result.ok) {
                        bridge.updateTaskStatus(taskId, 'completed', result.data);
                    } else if (result.rejected) {
                        bridge.updateTaskStatus(taskId, 'failed', null, `Result rejected: ${result.reason}`);
                    } else if (result.timeout) {
                        bridge.updateTaskStatus(taskId, 'failed', null, 'timeout');
                    }
                })
                .catch(err => {
                    bridge.updateTaskStatus(taskId, 'failed', null, err.message);
                });
        }

        return sendJSONResponse(res, 200, rpcResult({
            task_id: taskId,
            status: dispatchResult.status,
            session_id: dispatchResult.session_id || null,
            deep_link: dispatchResult.deep_link || null,
            deep_link_result: dispatchResult.deep_link_result || null,
            output_path: outputPath,
            nonce,
            error: dispatchResult.error || null
        }, requestBody.id || null));
    } catch (error) {
        console.error('OpenCode dispatch error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: GET /rpc/opencode/status/:task_id
 * Query the status of a dispatched OpenCode task.
 */
async function handleOpencodeStatus(req, res, taskId) {
    try {
        if (!taskId) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing task_id in path'));
        }

        const bridge = await ensureOpenCodeBridge();
        if (!bridge) {
            return sendJSONResponse(res, 503, rpcError(-32000, 'OpenCode bridge module unavailable'));
        }

        const status = await bridge.getStatus(taskId);
        return sendJSONResponse(res, 200, rpcResult(status, null));
    } catch (error) {
        console.error('OpenCode status error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Handler: POST /rpc/opencode/abort/:task_id
 * Abort a running OpenCode task.
 */
async function handleOpencodeAbort(req, res, taskId) {
    try {
        if (!taskId) {
            return sendJSONResponse(res, 400, rpcError(-32602, 'Missing task_id in path'));
        }

        const bridge = await ensureOpenCodeBridge();
        if (!bridge) {
            return sendJSONResponse(res, 503, rpcError(-32000, 'OpenCode bridge module unavailable'));
        }

        const result = await bridge.abortTask(taskId);
        const statusCode = result.status === 'unknown' ? 404 : 200;
        return sendJSONResponse(res, statusCode, rpcResult(result, null));
    } catch (error) {
        console.error('OpenCode abort error:', error);
        return sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Main request handler
 */
async function handleRequest(req, res) {
    // Handle CORS
    if (handleCORS(req, res)) return;
    
    const urlObj = url.parse(req.url, true);
    const pathname = urlObj.pathname;
    
    // Route handling
    try {
        // Health and stats don't require JSON body
        if (pathname === '/rpc/health') {
            return handleHealth(req, res);
        }
        
        if (pathname === '/rpc/stats') {
            return handleStats(req, res);
        }
        
        if (pathname === '/rpc/events/query') {
            return handleEventsQuery(req, res);
        }
        
        if (pathname === '/rpc/material/query' && req.method === 'GET') {
            return handleMaterialQuery(req, res);
        }
        
        if (pathname === '/rpc/export' && req.method === 'GET') {
            return handleExport(req, res, {});
        }
        
        // G4: Adapter sessions
        if (pathname === '/rpc/adapter/sessions' && req.method === 'GET') {
            return handleAdapterSessions(req, res);
        }
        
        // G3 phase 3: adapter command queue (GET routes)
        if (pathname === '/rpc/adapter/command/poll' && req.method === 'GET') {
            return handleAdapterCommandPoll(req, res);
        }
        if (pathname.startsWith('/rpc/adapter/command/') && req.method === 'GET') {
            const commandId = pathname.slice('/rpc/adapter/command/'.length);
            return handleAdapterCommandGet(req, res, commandId);
        }
        
        if (pathname === '/rpc/ai/status' && req.method === 'GET') {
            return handleAiStatus(req, res);
        }

        if (pathname === '/rpc/cards' && req.method === 'GET') {
            return handleAiCardsQuery(req, res, urlObj);
        }

        if (pathname === '/rpc/maintenance-tasks' && req.method === 'GET') {
            return handleAiMaintenanceTasksQuery(req, res, urlObj);
        }

        // G4: Task query (GET)
        if (pathname === '/rpc/task/query' && req.method === 'GET') {
            return handleTaskQueryGet(req, res);
        }
        
        // Lens Projections (Three Cognitive Lens Architecture) - GET endpoints
        if (pathname === '/rpc/projection/tasks' && req.method === 'GET') {
            return handleProjectionTasksGet(req, res, urlObj.query);
        }
        
        // Language Ammunition: list the library (GET)
        if (pathname === '/rpc/ammo/library' && req.method === 'GET') {
            return handleAmmoLibraryGet(req, res);
        }
        
        // Stored conversation log grouped by source (GET)
        if (pathname === '/rpc/conversations' && req.method === 'GET') {
            return handleConversationsGet(req, res, urlObj.query);
        }
        
        // IDE DeepLink targets for generation dispatch (GET)
        if (pathname === '/rpc/ide/targets' && req.method === 'GET') {
            return sendJSONResponse(res, 200, { ok: true, data: { targets: getIdeTargets() } });
        }
        
        if (pathname === '/rpc/projection/graph' && req.method === 'GET') {
            return handleProjectionGraphGet(req, res, urlObj.query);
        }
        
        if (pathname === '/rpc/projection/weekly-digest' && req.method === 'GET') {
            return handleProjectionWeeklyDigestGet(req, res, urlObj.query);
        }
        
        // G6: Patch query (GET)
        if (pathname === '/rpc/patch/query' && req.method === 'GET') {
            return handlePatchQuery(req, res);
        }
        
        // Phase 5: OpenCode status (GET)
        if (pathname.startsWith('/rpc/opencode/status/') && req.method === 'GET') {
            const taskId = decodeURIComponent(pathname.slice('/rpc/opencode/status/'.length));
            return handleOpencodeStatus(req, res, taskId);
        }
        
        // For POST endpoints, need to read body
        if (['POST', 'PUT'].includes(req.method)) {
            const requestBody = await readRequestBody(req);
            
            if (pathname === '/rpc/events/ingest') {
                return handleEventsIngest(req, res, requestBody);
            }
            
            if (pathname === '/rpc/events/batch') {
                return handleEventsBatch(req, res, requestBody);
            }
            
            if (pathname === '/rpc/boundary/update') {
                return handleBoundaryUpdate(req, res, requestBody);
            }
            
            // G3 phase 3: adapter command queue (POST routes)
            if (pathname === '/rpc/adapter/command') {
                return handleAdapterCommandEnqueue(req, res, requestBody);
            }
            if (pathname === '/rpc/adapter/command/result') {
                return handleAdapterCommandResult(req, res, requestBody);
            }
            
            if (pathname === '/rpc/material/revision') {
                return handleMaterialRevision(req, res, requestBody);
            }
            
            if (pathname === '/rpc/material/attribution') {
                return handleMaterialAttribution(req, res, requestBody);
            }
            
            if (pathname === '/rpc/sync/github/push') {
                return handleSyncGithubPush(req, res, requestBody);
            }
            
            if (pathname === '/rpc/sync/github/pull') {
                return handleSyncGithubPull(req, res, requestBody);
            }
            
            if (pathname === '/rpc/export') {
                return handleExport(req, res, requestBody);
            }
            
            // G4: Recommendation query
            if (pathname === '/rpc/recommendation/query' && req.method === 'POST') {
                return handleRecommendationQueryPost(req, res, requestBody);
            }
            
            // G4: Task status query
            if (pathname === '/rpc/task/status') {
                return handleTaskStatus(req, res, requestBody);
            }
            
            // G4: Task checkpoint save
            if (pathname === '/rpc/task/checkpoint') {
                return handleTaskCheckpoint(req, res, requestBody);
            }
            
            // G5: Task rebind
            if (pathname === '/rpc/task/rebind') {
                return handleTaskRebind(req, res, requestBody);
            }
            
            // G6: Patch management endpoints
            if (pathname === '/rpc/patch/propose') {
                return handlePatchPropose(req, res, requestBody);
            }
            if (pathname === '/rpc/patch/validate') {
                return handlePatchValidate(req, res, requestBody);
            }
            if (pathname === '/rpc/patch/activate') {
                return handlePatchActivate(req, res, requestBody);
            }
            if (pathname === '/rpc/patch/deactivate') {
                return handlePatchDeactivate(req, res, requestBody);
            }
            if (pathname === '/rpc/patch/revert') {
                return handlePatchRevert(req, res, requestBody);
            }
            if (pathname === '/rpc/patch/revalidate') {
                return handlePatchRevalidate(req, res, requestBody);
            }
            if (pathname === '/rpc/patch/supersede') {
                return handlePatchSupersede(req, res, requestBody);
            }
            
            // G4 (phase 4): AI digest trigger
            if (pathname === '/rpc/ai/digest/trigger') {
                return handleAiDigestTrigger(req, res, requestBody);
            }

            // G4: Recommendation accept
            if (pathname === '/rpc/recommendation/accept') {
                return handleRecommendationAccept(req, res, requestBody);
            }
            
            // Language Ammunition: fire / manual add (POST)
            if (pathname === '/rpc/ammo/fire') {
                return handleAmmoFire(req, res, requestBody);
            }
            if (pathname === '/rpc/ammo/add') {
                return handleAmmoAdd(req, res, requestBody);
            }
            if (pathname === '/rpc/ammo/extract-request') {
                return handleAmmoExtractRequest(req, res, requestBody);
            }
            if (pathname === '/rpc/task/generate-request') {
                return handleTaskGenerateRequest(req, res, requestBody);
            }
            if (pathname === '/rpc/card/generate-request') {
                return handleCardGenerateRequest(req, res, requestBody);
            }
            
            // G4: Recommendation dismiss
            if (pathname === '/rpc/recommendation/dismiss') {
                return handleRecommendationDismiss(req, res, requestBody);
            }
            
            // Phase 5: OpenCode dispatch (POST)
            if (pathname === '/rpc/opencode/dispatch') {
                return handleOpencodeDispatch(req, res, requestBody);
            }
            // Phase 5: OpenCode abort (POST)
            if (pathname.startsWith('/rpc/opencode/abort/') && req.method === 'POST') {
                const taskId = decodeURIComponent(pathname.slice('/rpc/opencode/abort/'.length));
                return handleOpencodeAbort(req, res, taskId);
            }
            
            // Default to /rpc/events/ingest if not matched
            return handleEventsIngest(req, res, requestBody);
        }
        
        // No route found
        sendJSONResponse(res, 404, rpcError(-32601, 'Method not found'));
        
    } catch (error) {
        console.error('Request handler error:', error);
        sendJSONResponse(res, 500, rpcError(-32603, 'Internal error: ' + error.message));
    }
}

/**
 * Initialize server
 */
async function initializeServer() {
    try {
        console.log(`G1 Companion starting...`);
        console.log(`Port: ${PORT}`);
        console.log(`Database path: ${companionDB.dbPath}`);
        
        // Initialize database
        await companionDB.initialize();
        
        // Initialize event processor
        eventProcessor = new EventProcessor(companionDB);
        
        // Initialize material processor (G3)
        materialProcessor = new MaterialProcessor({ db: companionDB, eventProcessor });
        
        // Initialize AI digest engine (phase 4 + phase 5 OpenCode bridge)
        const Bridge = await loadOpenCodeBridgeClass();
        if (Bridge) {
            const config = getOpenCodeBridgeConfig();
            openCodeBridge = new Bridge(config);
        }
        aiDigestEngine = new AIDigestEngine({ db: companionDB, eventProcessor, opencodeBridge: openCodeBridge });
        
        // Create HTTP server
        server = http.createServer(handleRequest);
        
        // Attach the narrow WS wake channel (/ws/adapter-wake) to the same
        // HTTP server (ruling C3: wake-only, no business data).
        wakeChannel = new AdapterWakeChannel({ log: console.log.bind(console) });
        wakeChannel.attach(server);
        
        // Periodic honest-timeout sweep for queued/delivered commands.
        // unref() so the sweep never keeps the process alive on its own.
        const expirySweep = setInterval(() => {
            try { companionDB.expireAdapterCommands(); } catch (_) { /* next sweep */ }
        }, 5000);
        if (expirySweep.unref) expirySweep.unref();
        
        // Start listening
        await new Promise((resolve, reject) => {
            server.listen(PORT, '127.0.0.1', () => {
                console.log(`✓ HTTP server running at http://127.0.0.1:${PORT}`);
                console.log(`✓ Endpoint examples:`);
                console.log(`  POST http://127.0.0.1:${PORT}/rpc/events/ingest`);
                console.log(`  POST http://127.0.0.1:${PORT}/rpc/events/batch`);
                console.log(`  GET  http://127.0.0.1:${PORT}/rpc/events/query?source_id=xxx`);
                console.log(`  GET  http://127.0.0.1:${PORT}/rpc/health`);
                console.log(`  POST http://127.0.0.1:${PORT}/rpc/material/revision`);
                console.log(`  GET  http://127.0.0.1:${PORT}/rpc/material/query`);
                console.log('');
                console.log('Press Ctrl+C to stop');
                resolve();
            });
            
            server.on('error', error => {
                reject(new Error(`Server failed: ${error.message}`));
            });
        });
        
        return server;
    } catch (error) {
        console.error('Failed to initialize server:', error);
        throw error;
    }
}

/**
 * Graceful shutdown
 */
function gracefulShutdown() {
    console.log('\nShutting down gracefully...');
    
    if (wakeChannel) {
        wakeChannel.closeAll();
    }
    
    if (server) {
        server.close(() => {
            console.log('HTTP server closed');
        });
    }
    
    if (companionDB) {
        companionDB.close();
        console.log('Database connection closed');
    }
    
    setTimeout(() => {
        console.log('Shutdown complete');
        process.exit(0);
    }, 1000);
}

// Setup signal handlers
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Main entry point
async function main() {
    parseArgs();
    
    // Run self-healing doctor first (self-fixing, not guidance)
    console.log('Running G2 companion doctor...\n');
    const baseDir = BASE_DIR || getDefaultBaseDirForDoctor();
    const doctorResult = await runDoctor({ port: PORT, dbPath: DB_PATH, baseDir });
    console.log(`doctor summary:\n${doctorResult.summary.join('\n')}`);
    console.log('');

    if (doctorResult.shouldExit) {
        console.error(`doctor exit condition: ${doctorResult.checks.port.detail}`);
        process.exit(doctorResult.exitCode);
    }

    // Apply doctor fixes to global config
    PORT = doctorResult.port;
    DB_PATH = doctorResult.dbPath;

    // Initialize database
    companionDB = new CompanionDB(DB_PATH);
    
    try {
        await initializeServer();
    } catch (error) {
        console.error('Startup failed:', error.message);
        process.exit(1);
    }
}

/**
 * Get default base dir for doctor (--dcf-dir not provided)
 */
function getDefaultBaseDirForDoctor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, '.dcf');
}

// Export for testing
/**
 * Start an in-process server for tests (no doctor, ephemeral port by default).
 * Returns { server, port, db, eventProcessor } and wires module-level globals
 * so exported handlers operate against the test database.
 */
async function startTestServer({ port = 0, dbPath = ':memory:' } = {}) {
    companionDB = new CompanionDB(dbPath);
    await companionDB.initialize();
    eventProcessor = new EventProcessor(companionDB);
    materialProcessor = new MaterialProcessor({ db: companionDB, eventProcessor });
    // Phase 5: load OpenCode bridge (best-effort, may be null)
    const Bridge = await loadOpenCodeBridgeClass();
    if (Bridge) {
        const config = getOpenCodeBridgeConfig();
        openCodeBridge = new Bridge(config);
    }
    aiDigestEngine = new AIDigestEngine({ db: companionDB, eventProcessor, opencodeBridge: openCodeBridge });
    server = http.createServer(handleRequest);
    wakeChannel = new AdapterWakeChannel();
    wakeChannel.attach(server);
    
    await new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', resolve);
        server.on('error', reject);
    });
    
    return {
        server,
        port: server.address().port,
        db: companionDB,
        eventProcessor,
        wakeChannel
    };
}

/**
 * Stop the in-process test server and release globals.
 */
async function stopTestServer() {
    if (wakeChannel) {
        wakeChannel.closeAll();
        wakeChannel = null;
    }
    if (server) {
        await new Promise(resolve => server.close(resolve));
        server = null;
    }
    if (companionDB) {
        companionDB.close();
        companionDB = null;
    }
    eventProcessor = null;
    materialProcessor = null;
    aiDigestEngine = null;
    openCodeBridge = null;
}

module.exports = {
    initializeServer,
    handleRequest,
    readRequestBody,
    companionDB,
    eventProcessor,
    // G4/G5 handlers for testing
    handleTaskQueryGet,
    handleTaskStatus,
    handleTaskCheckpoint,
    handleTaskRebind,
    handleRecommendationQueryPost,
    handleRecommendationAccept,
    handleRecommendationDismiss,
    handleAdapterSessions,
    // G3 phase 3 adapter command queue handlers for testing
    handleAdapterCommandEnqueue,
    handleAdapterCommandPoll,
    handleAdapterCommandResult,
    handleAdapterCommandGet,
    // G6 patch handlers for testing
    handlePatchQuery,
    handlePatchPropose,
    handlePatchValidate,
    handlePatchActivate,
    handlePatchDeactivate,
    handlePatchRevert,
    handlePatchRevalidate,
    handlePatchSupersede,
    // G4 phase 4 AI digest handlers for testing
    handleAiStatus,
    handleAiDigestTrigger,
    handleAiCardsQuery,
    handleAiMaintenanceTasksQuery,
    // Phase 5 OpenCode bridge handlers for testing
    handleOpencodeDispatch,
    handleOpencodeStatus,
    handleOpencodeAbort,
    // G4 in-process test harness
    startTestServer,
    stopTestServer
};

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}


/**
 * Lens Projection: Get Task Recommendations (Lens 1 - Task View)
 * 
 * Provides a Kanban-ready list of recommendations and accepted tasks,
 * sorted by priority score using the formula:
 *   priority_score = maturityScore * 0.6 + time_sensitivity * 0.4
 */
async function handleProjectionTasksGet(req, res, query) {
    try {
        const { status = 'recommended,accepted', limit = 50, offset = 0 } = query;
        const statusArray = status.split(',').map(s => s.trim());
        // The plan's public statuses map onto recommendations_projection rows:
        // 'recommended' -> 'pending' (awaiting user decision).
        const dbStatuses = statusArray.map(s => s === 'recommended' ? 'pending' : s);
        
        let rows;
        if (companionDB.db.isMock) {
            rows = (companionDB.db.data.recommendations_projection || [])
                .filter(r => dbStatuses.includes(r.status));
        } else {
            const placeholders = dbStatuses.map(() => '?').join(',');
            rows = companionDB.db.prepare(
                `SELECT * FROM recommendations_projection WHERE status IN (${placeholders})`
            ).all(...dbStatuses);
        }
        
        const now = Date.now();
        const projections = rows.map(r => {
            const maturityScore = Math.round((r.materiality_score != null ? r.materiality_score : 0.5) * 100);
            // time_sensitivity: 100 for activity within the last hour,
            // decaying linearly to 0 over 7 days.
            const lastTs = Date.parse(r.updated_at || r.created_at || '') || now;
            const ageMs = Math.max(0, now - lastTs);
            const timeSensitivity = Math.max(0, 100 - (ageMs / (7 * 86400000)) * 100);
            const priorityLevel = r.priority_level || 5;
            return {
                id: r.recommendation_id,
                title: r.recommendation_text,
                summary: r.suggested_action || '',
                status: r.status === 'pending' ? 'recommended' : r.status,
                priority: priorityLevel <= 3 ? 'high' : (priorityLevel <= 6 ? 'medium' : 'low'),
                maturityScore,
                lastActivityTs: lastTs,
                sourceEvents: r.source_entity_id ? [r.source_entity_id] : [],
                tags: safeParseJSONArray(r.target_material_ids),
                priorityScore: maturityScore * 0.6 + timeSensitivity * 0.4
            };
        });
        
        projections.sort((a, b) => b.priorityScore - a.priorityScore);
        const paginated = projections.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
        
        return sendJSONResponse(res, 200, {
            ok: true,
            data: paginated
        });
    } catch (error) {
        console.error('Projection tasks error:', error);
        return sendJSONResponse(res, 500, {
            ok: false,
            error: error.message
        });
    }
}

/** Parse a JSON array column defensively; non-arrays become []. */
function safeParseJSONArray(text) {
    if (!text) return [];
    try {
        const parsed = typeof text === 'string' ? JSON.parse(text) : text;
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

/** Extract human text from a raw event payload for projection reducers. */
function extractEventText(payloadJson) {
    let payload = payloadJson;
    if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (_) { return payload; }
    }
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.content === 'string') return payload.content;
    if (typeof payload.body === 'string') return payload.body;
    if (typeof payload.summary === 'string') return payload.summary;
    if (typeof payload.title === 'string') return payload.title;
    if (Array.isArray(payload.messages)) {
        return payload.messages
            .map(m => (m && typeof m === 'object') ? (m.text || m.content || '') : String(m || ''))
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

/**
 * Strip artifact blocks and skip our own request messages when building
 * digests for AI prompts, so old artifacts never pollute new generations.
 */
function sanitizeForDigest(text) {
    if (text.includes('[DCF-REQUEST]')) return '';
    return text.replace(/<<<DCF_\w+[\s\S]*?DCF_\w+>>>/g, '').replace(/\s+/g, ' ').trim();
}

/** Load conversation events as {id, ts, text, sourceId} rows for reducers. */
function loadConversationEvents() {
    const rawEvents = companionDB.getAllRawEventsOfType('conversation.') || [];
    return rawEvents
        .map(e => ({
            id: e.event_id,
            sourceId: e.source_id,
            ts: Date.parse(e.created_at || '') || Date.now(),
            text: extractEventText(e.payload_json)
        }))
        .filter(e => e.text);
}

/**
 * Lens Projection: Get Knowledge Graph (Lens 2 - Exploration View)
 * 
 * Builds a graph of topics, events, and relationships for visualization
 * in Obsidian-style force-directed graph. Topics are keyword clusters
 * extracted from the raw event log (single source of truth); edges carry
 * co-occurrence weights.
 */
async function handleProjectionGraphGet(req, res, query) {
    try {
        const { depth = 2, filterByTag } = query;
        const events = loadConversationEvents();
        
        const digestReducer = weeklyDigestReducer;
        const maxTopics = Math.max(3, Math.min(30, parseInt(depth) * 10 || 20));
        const topics = digestReducer.extractTopics(events, maxTopics)
            .filter(t => !filterByTag || t.name.includes(filterByTag));
        
        // Conversation nodes: one per distinct source (most recent 20).
        const bySource = new Map();
        for (const ev of events) {
            const existing = bySource.get(ev.sourceId);
            if (!existing || ev.ts > existing.ts) bySource.set(ev.sourceId, ev);
        }
        const conversationNodes = [...bySource.values()]
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 20);
        
        const nodes = [];
        const edges = [];
        const maxPct = topics.length ? topics[0].percentage : 1;
        
        for (const topic of topics) {
            nodes.push({
                id: 'topic:' + topic.name,
                label: topic.name,
                type: 'topic',
                ts: Date.now(),
                importance: topic.percentage / (maxPct || 1)
            });
        }
        
        for (const conv of conversationNodes) {
            nodes.push({
                id: 'event:' + conv.sourceId,
                label: conv.text.slice(0, 24) || conv.sourceId.slice(0, 8),
                type: 'event',
                ts: conv.ts,
                importance: 0.4
            });
            
            // mentioned_in edges: topic keyword appears in this conversation's texts.
            const sourceText = events
                .filter(e => e.sourceId === conv.sourceId)
                .map(e => e.text.toLowerCase())
                .join('\n');
            for (const topic of topics) {
                const hits = sourceText.split(topic.name.toLowerCase()).length - 1;
                if (hits > 0) {
                    edges.push({
                        source: 'topic:' + topic.name,
                        target: 'event:' + conv.sourceId,
                        relation: 'mentioned_in',
                        weight: Math.min(5, hits)
                    });
                }
            }
        }
        
        // related_to edges between topics sharing at least one conversation.
        const topicSources = new Map();
        for (const edge of edges) {
            const t = edge.source;
            if (!topicSources.has(t)) topicSources.set(t, new Set());
            topicSources.get(t).add(edge.target);
        }
        const topicIds = [...topicSources.keys()];
        for (let i = 0; i < topicIds.length; i++) {
            for (let j = i + 1; j < topicIds.length; j++) {
                const shared = [...topicSources.get(topicIds[i])]
                    .filter(s => topicSources.get(topicIds[j]).has(s)).length;
                if (shared > 0) {
                    edges.push({
                        source: topicIds[i],
                        target: topicIds[j],
                        relation: 'related_to',
                        weight: shared
                    });
                }
            }
        }
        
        // Clusters: each conversation with its mentioned topics forms a theme.
        const clusters = conversationNodes
            .map(conv => {
                const clusterNodes = ['event:' + conv.sourceId].concat(
                    edges
                        .filter(e => e.relation === 'mentioned_in' && e.target === 'event:' + conv.sourceId)
                        .map(e => e.source)
                );
                return {
                    id: 'cluster:' + conv.sourceId,
                    nodes: clusterNodes,
                    theme: conv.text.slice(0, 16) || conv.sourceId.slice(0, 8)
                };
            })
            .filter(c => c.nodes.length > 1)
            .slice(0, 8);
        
        return sendJSONResponse(res, 200, {
            ok: true,
            data: { nodes, edges, clusters }
        });
    } catch (error) {
        console.error('Projection graph error:', error);
        return sendJSONResponse(res, 500, {
            ok: false,
            error: error.message
        });
    }
}

/**
 * Lens Projection: Weekly Reflection Digest (Lens 3 - Reflection View)
 * 
 * Recomputes the WeeklyDigest projection from the raw event log via the
 * weekly-digest reducer (projections stay a pure function of the log).
 * A native scheduler pre-warms the cache every Sunday at 03:00 local.
 */
const weeklyDigestCache = new Map();

async function handleProjectionWeeklyDigestGet(req, res, query) {
    try {
        const digestReducer = weeklyDigestReducer;
        const week = query.week || digestReducer.getISOWeek(new Date());
        
        if (!weeklyDigestCache.has(week)) {
            const range = digestReducer.getWeekRange(week);
            if (!range) {
                return sendJSONResponse(res, 400, {
                    ok: false,
                    error: `Invalid week format: ${week} (expected e.g. "2024-W30")`
                });
            }
            const events = loadConversationEvents()
                .filter(e => e.ts >= range.startTs && e.ts < range.endTs);
            weeklyDigestCache.set(week, digestReducer.generateWeeklyDigest(week, events));
            // Past weeks are immutable; only the current week needs refresh.
            if (week === digestReducer.getISOWeek(new Date())) {
                setTimeout(() => weeklyDigestCache.delete(week), 5 * 60 * 1000).unref?.();
            }
        }
        
        return sendJSONResponse(res, 200, {
            ok: true,
            data: weeklyDigestCache.get(week)
        });
    } catch (error) {
        console.error('Weekly digest error:', error);
        return sendJSONResponse(res, 500, {
            ok: false,
            error: error.message
        });
    }
}

/**
 * Handler: GET /rpc/ammo/library
 * List all language ammunition in the library.
 */
function handleAmmoLibraryGet(req, res) {
    try {
        const library = loadLibrary();
        return sendJSONResponse(res, 200, {
            ok: true,
            data: {
                count: library.count,
                exported_at: library.exported_at,
                items: library.items
            }
        });
    } catch (error) {
        console.error('Ammo library error:', error);
        return sendJSONResponse(res, 500, { ok: false, error: error.message });
    }
}

/**
 * Handler: POST /rpc/ammo/fire
 * Fire an ammo: build the invocation text and enqueue a send-card adapter
 * command so the Chrome adapter writes it into the target composer.
 * Falls back to returning the text for clipboard use when no adapter.
 */
function handleAmmoFire(req, res, requestBody) {
    try {
        const { ammo_id } = requestBody;
        if (!ammo_id) {
            return sendJSONResponse(res, 400, { ok: false, error: 'Missing ammo_id' });
        }
        const item = getAllAmmo().find(a => a.id === ammo_id);
        if (!item) {
            return sendJSONResponse(res, 404, { ok: false, error: `Ammo not found: ${ammo_id}` });
        }
        
        const invocationText = buildAmmoInvocation(item);
        
        // Reuse the adapter command pipeline (same as send-card) so the
        // Chrome adapter delivers the ammo into the active composer.
        const commandId = generateULID();
        const inserted = companionDB.insertAdapterCommand({
            command_id: commandId,
            kind: 'send-card',
            payload: { text: invocationText, source: 'ammo', ammo_id },
            timeout_ms: null
        });
        const notified = (inserted.success && wakeChannel) ? wakeChannel.broadcastCommandAvailable() : 0;
        
        // Record the emission in the event log (projections stay honest).
        eventProcessor.ingestEvent({
            event_id: generateULID(),
            source_id: generateULID(),
            event_type: 'conversation.ammo_fired',
            payload_json: { ammo_id, title: item.title, command_id: inserted.success ? commandId : null }
        }).catch(() => {});
        
        return sendJSONResponse(res, 200, {
            ok: true,
            data: {
                ammo_id,
                invocation_text: invocationText,
                command_id: inserted.success ? commandId : null,
                adapter_notified: notified > 0
            }
        });
    } catch (error) {
        console.error('Ammo fire error:', error);
        return sendJSONResponse(res, 500, { ok: false, error: error.message });
    }
}

/**
 * Handler: POST /rpc/ammo/add
 * Manually load one ammo (id/title/purpose/body) into the library.
 */
function handleAmmoAdd(req, res, requestBody) {
    try {
        const { id, title, purpose, body, tags } = requestBody;
        if (!title || !body) {
            return sendJSONResponse(res, 400, { ok: false, error: 'title and body are required' });
        }
        if (id && getAllAmmo().some(a => a.id === id)) {
            return sendJSONResponse(res, 400, { ok: false, error: `Ammo already exists: ${id}` });
        }
        const item = {
            id: id || `ammo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            title: String(title),
            purpose: String(purpose || ''),
            body: String(body),
            tags: Array.isArray(tags) ? tags.map(String) : [],
            created_at: new Date().toISOString(),
            version: 1
        };
        addAmmo(item);
        return sendJSONResponse(res, 200, { ok: true, data: item });
    } catch (error) {
        console.error('Ammo add error:', error);
        return sendJSONResponse(res, 500, { ok: false, error: error.message });
    }
}

/**
 * Handler: POST /rpc/ammo/extract-request
 * Ask the AI in the target conversation to distill one reusable language
 * ammo. The reply's DCF_AMMO artifact is auto-loaded by the receiving hook
 * once the adapter ingests it as a conversation event (full loop).
 */
async function handleAmmoExtractRequest(req, res, requestBody) {
    try {
        const recent = scopeConversationEvents(requestBody.source_ids).sort((a, b) => b.ts - a.ts).slice(0, 10).reverse()
            .map(e => sanitizeForDigest(e.text)).filter(Boolean);
        const contextLines = recent.length
            ? ['', '参考我最近存档的对话要点：', ...recent.map(t => '- ' + t.slice(0, 150))]
            : [];
        const prompt = [
            '请提取 1 条最值得长期复用的语言弹药，放入 products 数组。每个元素字段：',
            '{ "id": "唯一标识", "title": "标题", "purpose": "用途", "body": "弹药正文" }',
            ...contextLines
        ].join('\n');
        return await dispatchGeneration('ammo', prompt, recent.length, requestBody.ide, res);
    } catch (error) {
        console.error('Ammo extract-request error:', error);
        return sendJSONResponse(res, 500, { ok: false, error: error.message });
    }
}

/**
 * Filter conversation events down to user-selected conversations. An empty
 * or missing selection means "all stored conversations".
 */
function scopeConversationEvents(sourceIds) {
    const events = loadConversationEvents();
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) return events;
    const wanted = new Set(sourceIds.map(String));
    return events.filter(e => wanted.has(String(e.sourceId)));
}

/**
 * Load products returned by a local OpenCode generation task into the
 * corresponding store (task recommendations / knowledge cards / ammo).
 * Returns the number of products actually loaded.
 */
function loadGeneratedProducts(kind, products, taskId) {
    let loaded = 0;
    for (const p of (Array.isArray(products) ? products : [])) {
        try {
            if (kind === 'task' && p.title) {
                const recommendationId = generateULID();
                const priority = Math.min(9, Math.max(1, parseInt(p.priority) || 4));
                const confidence = Math.min(1, Math.max(0, Number(p.confidence) || 0.6));
                eventProcessor.ingestEvent({
                    event_id: generateULID(),
                    source_id: recommendationId,
                    event_type: 'recommendation.proposed',
                    payload_json: {
                        recommendation_id: recommendationId,
                        source_entity_type: 'system',
                        source_entity_id: generateULID(),
                        recommendation_text: String(p.title) + (p.reason ? ' — ' + String(p.reason) : ''),
                        suggested_action: 'create_task',
                        materiality_score: confidence,
                        priority_level: priority
                    }
                }).catch(() => {});
                loaded++;
            } else if (kind === 'card' && p.title && p.summary) {
                companionDB.upsertAiCard({
                    card_id: generateULID(),
                    title: String(p.title).slice(0, 80),
                    summary: String(p.summary),
                    evidence: Array.isArray(p.evidence) ? p.evidence.map(String) : [],
                    boundary_inherit: 'OBSERVE_AND_ARCHIVE',
                    source_conversation: 'opencode:' + taskId,
                    source_event_ids: null,
                    markdown_body: null,
                    json_body: JSON.stringify(p),
                    attribution_state: 'ai_proposed'
                });
                loaded++;
            } else if (kind === 'ammo' && (p.body || p.title)) {
                const { action, item } = require('./ammo-ejection').upsertAmmo({
                    id: p.id || ('opencode.' + taskId.slice(-8) + '.' + loaded),
                    title: p.title, purpose: p.purpose, body: p.body, tags: p.tags
                });
                eventProcessor.ingestEvent({
                    event_id: generateULID(),
                    source_id: generateULID(),
                    event_type: 'ammo.loaded',
                    payload_json: { ammo_id: item.id, action, version: item.version, source_event_id: 'opencode:' + taskId }
                }).catch(() => {});
                loaded++;
            }
        } catch (e) {
            console.warn('Generated product load failed:', e.message);
        }
    }
    return loaded;
}

/**
 * Built-in IDE generation targets. ~/.dcf/ai-config.json may override via an
 * `ide_targets` array. Each target has a `method`:
 *   - 'api'      : drive the IDE's local HTTP API (OpenCode bridge)
 *   - 'cli'      : run the IDE's headless CLI (claude / codex)
 *   - 'deeplink' : open via DeepLink (qoder pre-fills a chat; cursor/vscode
 *                  only open the app, so the prompt goes to the clipboard)
 * `autosubmit` marks whether the IDE processes the prompt without manual step.
 */
const DEFAULT_IDE_TARGETS = [
    { id: 'opencode', name: 'OpenCode', method: 'api', deeplink: 'opencode://', template: 'opencode://append?text={prompt}&action=submit', autosubmit: true },
    { id: 'claude', name: 'Claude Code', method: 'cli', cli: 'claude', deeplink: 'claude-cli://', template: 'claude-cli://open?q={prompt}', autosubmit: true },
    { id: 'codex', name: 'Codex (ChatGPT)', method: 'cli', cli: 'codex', deeplink: 'codex://', template: 'codex://new?prompt={prompt}', autosubmit: true },
    { id: 'qoder', name: 'Qoder', method: 'deeplink', deeplink: 'qoder://', template: 'qoder://aicoding.aicoding-deeplink/chat?text={prompt}&mode=agent&isNewChat=true', autosubmit: false },
    { id: 'cursor', name: 'Cursor', method: 'deeplink', deeplink: 'cursor://', template: 'cursor://anysphere.cursor-deeplink/prompt?text={prompt}', autosubmit: false },
    { id: 'vscode', name: 'VS Code', method: 'deeplink', deeplink: 'vscode://', template: 'vscode://', autosubmit: false }
];

function getIdeTargets() {
    try {
        const raw = readConfigFile();
        if (raw && Array.isArray(raw.ide_targets) && raw.ide_targets.length) {
            return raw.ide_targets
                .filter(t => t && t.id)
                .map(t => ({
                    id: String(t.id),
                    name: String(t.name || t.id),
                    method: String(t.method || 'deeplink'),
                    cli: t.cli ? String(t.cli) : undefined,
                    deeplink: String(t.deeplink || ''),
                    template: String(t.template || t.deeplink || ''),
                    autosubmit: Boolean(t.autosubmit)
                }));
        }
    } catch (_) { /* config not available, use defaults */ }
    return DEFAULT_IDE_TARGETS;
}

/** Best-effort: bring the chosen IDE to the front via its DeepLink. */
function openDeepLink(url) {
    return new Promise(resolve => {
        const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'linux' ? 'xdg-open' : null;
        if (!cmd) { resolve({ ok: false, error: 'DeepLink not supported on ' + process.platform }); return; }
        try {
            const child = require('child_process').spawn(cmd, [url], { stdio: 'ignore' });
            child.on('error', err => resolve({ ok: false, error: err.message }));
            child.on('exit', code => resolve({ ok: code === 0, error: code !== 0 ? 'exit ' + code : null }));
        } catch (e) { resolve({ ok: false, error: e.message }); }
    });
}

/** Best-effort clipboard copy (macOS pbcopy). Never throws. */
function copyToClipboard(text) {
    return new Promise(resolve => {
        if (process.platform !== 'darwin') { resolve(false); return; }
        try {
            const child = require('child_process').spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
            child.on('error', () => resolve(false));
            child.on('exit', code => resolve(code === 0));
            child.stdin.write(String(text));
            child.stdin.end();
        } catch (_) { resolve(false); }
    });
}

/**
 * Lightweight inbox watcher: resolve when filePath holds a JSON object with a
 * products array (no nonce handshake — the IDE's AI writes it per prompt).
 */
function watchInboxFile(filePath, timeoutMs) {
    const fs = require('fs');
    const path = require('path');
    return new Promise(resolve => {
        let watcher = null, pollTimer = null, timeoutTimer = null, resolved = false;
        const cleanup = () => {
            if (watcher) { try { watcher.close(); } catch (_) {} }
            if (pollTimer) clearInterval(pollTimer);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        };
        const checkFile = () => {
            if (resolved) return;
            try {
                if (!fs.existsSync(filePath)) return;
                const raw = fs.readFileSync(filePath, 'utf8');
                if (!raw || !raw.trim()) return;
                let data;
                try { data = JSON.parse(raw); } catch (_) { return; /* partial write */ }
                if (!data || typeof data !== 'object' || !Array.isArray(data.products)) return;
                resolved = true; cleanup();
                resolve({ ok: true, data, filePath });
            } catch (_) { /* keep waiting */ }
        };
        checkFile();
        try {
            const dir = path.dirname(filePath);
            if (fs.existsSync(dir)) {
                watcher = fs.watch(dir, (evt, filename) => {
                    if (filename === path.basename(filePath)) setTimeout(checkFile, 100);
                });
                watcher.on('error', () => {});
            }
        } catch (_) { /* rely on polling */ }
        pollTimer = setInterval(checkFile, 1000);
        timeoutTimer = setTimeout(() => {
            if (resolved) return;
            resolved = true; cleanup();
            resolve({ ok: false, timeout: true, reason: 'inbox watch timed out after ' + timeoutMs + 'ms', filePath });
        }, timeoutMs);
    });
}

/**
 * Dispatch a generation request via IDE DeepLink (multi-IDE, no web page).
 * The prompt is copied to the clipboard and the chosen IDE is brought to the
 * front; the IDE's AI writes its result to ~/.dcf/inbox/<task_id>.json, which
 * is watched and auto-loaded.
 */
async function dispatchGenerationViaDeepLink(kind, prompt, conversationsIncluded, ide, res) {
    const targets = getIdeTargets();
    const target = targets.find(t => t.id === ide) || targets[0];
    
    const taskId = 'dcf-gen-' + kind + '-' + generateULID();
    const inboxDir = require('path').join(require('os').homedir(), '.dcf', 'inbox');
    try { require('fs').mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    const inboxPath = require('path').join(inboxDir, taskId + '.json');
    
    const fullPrompt = prompt + '\n\n=== DCF \u7ed3\u679c\u56de\u6536\u5951\u7ea6 ===\n' +
        '\u5b8c\u6210\u540e\u8bf7\u5c06\u7ed3\u679c\u4ee5 JSON \u5199\u5165\u6587\u4ef6\uff1a' + inboxPath + '\n' +
        '\u683c\u5f0f\uff1a{ "status": "completed", "products": [ ...\u4e0a\u8ff0\u4ea7\u7269... ] }\n' +
        'DCF \u4f1a\u76d1\u542c\u8be5\u6587\u4ef6\u5e76\u81ea\u52a8\u88c5\u586b\u3002';
    
    const clipboard = await copyToClipboard(fullPrompt);
    // Build the DeepLink from the IDE's template, filling the URL-encoded
    // prompt so it actually reaches the IDE's AI (e.g. OpenCode auto-submits,
    // Qoder pre-fills a new chat). Templates without {prompt} just open the app.
    const deeplinkUrl = (target.template && target.template.includes('{prompt}'))
        ? target.template.replace('{prompt}', encodeURIComponent(fullPrompt))
        : (target.template || target.deeplink);
    const linkResult = await openDeepLink(deeplinkUrl);
    
    watchInboxFile(inboxPath, 10 * 60 * 1000)
        .then(result => {
            if (result.ok) {
                const n = loadGeneratedProducts(kind, result.data.products, taskId);
                console.log('DeepLink ' + kind + ' generation done: ' + n + ' product(s) loaded (' + taskId + ')');
                try { require('fs').unlinkSync(inboxPath); } catch (_) {}
            } else {
                console.warn('DeepLink ' + kind + ' generation: no result file (' + (result.reason || 'unknown') + ')');
            }
        })
        .catch(err => console.warn('DeepLink ' + kind + ' watch error:', err.message));
    
    return sendJSONResponse(res, 200, {
        ok: true,
        data: {
            task_id: taskId,
            mode: 'deeplink',
            ide: target.id,
            ide_name: target.name,
            conversations_included: conversationsIncluded,
            clipboard: clipboard,
            deeplink_ok: linkResult.ok,
            autosubmit: Boolean(target.autosubmit)
        }
    });
}

/**
 * Dispatch a generation request through the LOCAL OpenCode bridge (fully
 * automatic): create a session, submit the prompt, watch the result file the
 * AI writes, and auto-load the products. Requires OpenCode running locally
 * with file-write permission allowed.
 */
async function dispatchGenerationViaOpenCode(kind, prompt, conversationsIncluded, res) {
    const bridge = await ensureOpenCodeBridge();
    if (!bridge) {
        return sendJSONResponse(res, 503, { ok: false, error: 'OpenCode bridge module unavailable' });
    }
    const health = await bridge.healthCheck();
    if (!health.ok) {
        return sendJSONResponse(res, 503, {
            ok: false,
            error: '\u672c\u5730 OpenCode \u670d\u52a1\u4e0d\u53ef\u8fbe (' + (health.error || 'unknown') + ')\uff0c\u8bf7\u5148\u542f\u52a8 OpenCode'
        });
    }
    
    const taskId = 'dcf-gen-' + kind + '-' + generateULID();
    const nonce = require('crypto').randomBytes(16).toString('hex');
    const outputPath = require('path').join(require('os').tmpdir(), 'dcf-opencode-' + taskId + '.json');
    
    const dispatchResult = await bridge.dispatchTask({
        task_id: taskId,
        prompt,
        output_path: outputPath,
        nonce,
        title: 'DCF ' + kind + ' generation'
    });
    if (dispatchResult.status === 'failed') {
        return sendJSONResponse(res, 502, { ok: false, error: 'OpenCode dispatch failed: ' + (dispatchResult.error || 'unknown') });
    }
    
    // Auto-approve any permission request from this session so unattended
    // generation is not blocked by OpenCode's permission prompts (works even
    // if the permission config has not been reloaded).
    const stopAutoApprove = dispatchResult.session_id
        ? bridge.autoApproveSession(dispatchResult.session_id, 10 * 60 * 1000)
        : () => {};
    
    bridge.watchResult(outputPath, { timeoutMs: 10 * 60 * 1000, nonce, task_id: taskId })
        .then(result => {
            stopAutoApprove();
            if (result.ok && result.data && Array.isArray(result.data.products)) {
                const n = loadGeneratedProducts(kind, result.data.products, taskId);
                console.log('OpenCode ' + kind + ' generation done: ' + n + ' product(s) loaded (' + taskId + ')');
                try { require('fs').unlinkSync(outputPath); } catch (_) {}
            } else {
                console.warn('OpenCode ' + kind + ' generation: no valid result (' + (result.reason || 'unknown') + ')');
            }
        })
        .catch(err => { stopAutoApprove(); console.warn('OpenCode ' + kind + ' watch error:', err.message); });
    
    return sendJSONResponse(res, 200, {
        ok: true,
        data: {
            task_id: taskId,
            mode: 'opencode',
            ide: 'opencode',
            ide_name: 'OpenCode',
            conversations_included: conversationsIncluded,
            autosubmit: true
        }
    });
}

/**
 * Resolve an IDE CLI binary to an absolute path. macOS .app processes have a
 * bare PATH, so probe common install locations before falling back to `which`.
 */
function resolveCli(name) {
    if (!name) return null;
    const home = require('os').homedir();
    const candidates = [
        '/opt/homebrew/bin/' + name,
        '/usr/local/bin/' + name,
        require('path').join(home, '.local', 'bin', name),
        require('path').join(home, '.opencode', 'bin', name),
        '/usr/bin/' + name
    ];
    const fs = require('fs');
    for (const c of candidates) {
        try { if (fs.existsSync(c)) return c; } catch (_) {}
    }
    try {
        const out = require('child_process').execSync('which ' + name, { encoding: 'utf8' }).trim();
        if (out) return out;
    } catch (_) {}
    return null;
}

/** Read generation-related config (e.g. codex_model). */
function getGenerationConfig() {
    try {
        const raw = readConfigFile();
        return (raw && raw.generation) || {};
    } catch (_) { return {}; }
}

/**
 * Dispatch a generation request through an IDE's headless CLI (claude/codex).
 * The CLI runs the prompt with permission checks bypassed and writes the result
 * file, which is watched and auto-loaded — fully unattended (no DeepLink, no
 * manual paste).
 */
async function dispatchGenerationViaCli(kind, prompt, conversationsIncluded, ide, res) {
    const targets = getIdeTargets();
    const target = targets.find(t => t.id === ide) || targets[0];
    const cliName = target.cli || target.id;
    const cliPath = resolveCli(cliName);
    if (!cliPath) {
        // CLI unavailable — fall back to the IDE's prompt-carrying DeepLink.
        console.warn('CLI not found for ' + cliName + ', falling back to DeepLink');
        return dispatchGenerationViaDeepLink(kind, prompt, conversationsIncluded, ide, res);
    }
    
    const taskId = 'dcf-gen-' + kind + '-' + generateULID();
    const inboxDir = require('path').join(require('os').homedir(), '.dcf', 'inbox');
    try { require('fs').mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    const inboxPath = require('path').join(inboxDir, taskId + '.json');
    
    const fullPrompt = prompt + '\n\n=== DCF \u7ed3\u679c\u56de\u6536\u5951\u7ea6 ===\n' +
        '\u5b8c\u6210\u540e\u8bf7\u5c06\u7ed3\u679c\u4ee5 JSON \u5199\u5165\u6587\u4ef6\uff1a' + inboxPath + '\n' +
        '\u683c\u5f0f\uff1a{ "status": "completed", "products": [ ...\u4e0a\u8ff0\u4ea7\u7269... ] }\n' +
        '\u3010\u5173\u952e\u3011\u8f93\u51fa\u5fc5\u987b\u662f\u4e25\u683c\u5408\u6cd5\u7684 JSON\uff1a\u5b57\u7b26\u4e32\u5185\u5982\u9700\u5f15\u53f7\u4e00\u5f8b\u7528\u4e2d\u6587\u5f15\u53f7 \u201c\u201d\uff0c\u4e0d\u8981\u672a\u8f6c\u4e49\u82f1\u6587\u53cc\u5f15\u53f7\uff0c\u4e0d\u8981\u5c3e\u968f\u9017\u53f7\u3002\n' +
        'DCF \u4f1a\u76d1\u542c\u8be5\u6587\u4ef6\u5e76\u81ea\u52a8\u88c5\u586b\u3002';
    
    let args;
    if (cliName === 'claude') {
        args = ['-p', fullPrompt, '--output-format', 'text', '--dangerously-skip-permissions'];
    } else if (cliName === 'codex') {
        args = ['exec', fullPrompt, '--dangerously-bypass-approvals-and-sandbox'];
        const model = getGenerationConfig().codex_model;
        if (model) args.push('-m', String(model));
    } else {
        return sendJSONResponse(res, 400, { ok: false, error: 'Unsupported CLI target: ' + cliName });
    }
    
    try {
        const child = require('child_process').spawn(cliPath, args, { detached: true, stdio: 'ignore', env: process.env });
        child.on('error', err => console.warn('CLI spawn error (' + cliName + '):', err.message));
        child.unref();
    } catch (e) {
        return sendJSONResponse(res, 502, { ok: false, error: 'CLI spawn failed: ' + e.message });
    }
    
    watchInboxFile(inboxPath, 10 * 60 * 1000)
        .then(result => {
            if (result.ok) {
                const n = loadGeneratedProducts(kind, result.data.products, taskId);
                console.log('CLI(' + cliName + ') ' + kind + ' generation done: ' + n + ' product(s) loaded (' + taskId + ')');
                try { require('fs').unlinkSync(inboxPath); } catch (_) {}
            } else {
                console.warn('CLI(' + cliName + ') ' + kind + ' generation: no result file (' + (result.reason || 'unknown') + ')');
            }
        })
        .catch(err => console.warn('CLI(' + cliName + ') ' + kind + ' watch error:', err.message));
    
    return sendJSONResponse(res, 200, {
        ok: true,
        data: {
            task_id: taskId,
            mode: 'cli',
            ide: target.id,
            ide_name: target.name,
            conversations_included: conversationsIncluded,
            autosubmit: true
        }
    });
}

/**
 * Auto-send in OpenCode after a DeepLink pre-fill. Fallback when HTTP API unavailable.
 */
function autoSendOpenCode(delayMs) {
    return new Promise(resolve => {
        if (process.platform !== 'darwin') { resolve(false); return; }
        const script = 'tell application "OpenCode" to activate\n' +
            'delay ' + ((delayMs || 1800) / 1000) + '\n' +
            'tell application "System Events" to keystroke return';
        try {
            const child = require('child_process').spawn('osascript', ['-e', script], { stdio: 'ignore' });
            child.on('error', () => resolve(false));
            child.on('exit', code => resolve(code === 0));
        } catch (_) { resolve(false); }
    });
}

/**
 * Dispatch a generation request via OpenCode's visible DeepLink: pre-fill UI,
 * auto-send via keystroke, then watch result file. This is the FALLBACK for when
 * HTTP API fails or user prefers UI visibility.
 */
async function dispatchGenerationViaOpenCodeVisible(kind, prompt, conversationsIncluded, res) {
    const taskId = 'dcf-gen-' + kind + '-' + generateULID();
    const inboxDir = require('path').join(require('os').homedir(), '.dcf', 'inbox');
    try { require('fs').mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
    const inboxPath = require('path').join(inboxDir, taskId + '.json');
    
    const fullPrompt = prompt + '\n\n=== DCF \u7ed3\u679c\u56de\u6536\u5951\u7ea6 ===\n' +
        '\u5b8c\u6210\u540e\u8bf7\u5c06\u7ed3\u679c\u4ee5 JSON \u5199\u5165\u6587\u4ef6\uff1a' + inboxPath + '\n' +
        '\u683c\u5f0f\uff1a{ "status": "completed", "products": [ ...\u4e0a\u8ff0\u4ea7\u7269... ] }\n' +
        '\u3010\u5173\u952e\u3011\u8f93\u51fa\u5fc5\u987b\u662f\u4e25\u683c\u5408\u6cd5\u7684 JSON\uff1a\u5b57\u7b26\u4e32\u5185\u5982\u9700\u5f15\u53f7\u4e00\u5f8b\u7528\u4e2d\u6587\u5f15\u53f7 \u201c\u201d\uff0c\u4e0d\u8981\u672a\u8f6c\u4e49\u82f1\u6587\u53cc\u5f15\u53f7\uff0c\u4e0d\u8981\u5c3e\u968f\u9017\u53f7\u3002\n' +
        'DCF \u4f1a\u76d1\u542c\u8be5\u6587\u4ef6\u5e76\u81ea\u52a8\u88c5\u586b\u3002';
    
    const cwd = encodeURIComponent(require('os').homedir());
    const deeplinkUrl = 'opencode://new-session?directory=' + cwd + '&prompt=' + encodeURIComponent(fullPrompt);
    const linkResult = await openDeepLink(deeplinkUrl);
    
    const sent = await autoSendOpenCode(1800);
    
    watchInboxFile(inboxPath, 10 * 60 * 1000)
        .then(result => {
            if (result.ok) {
                const n = loadGeneratedProducts(kind, result.data.products, taskId);
                console.log('OpenCode-visible ' + kind + ' generation done: ' + n + ' product(s) loaded (' + taskId + ')');
                try { require('fs').unlinkSync(inboxPath); } catch (_) {}
            } else {
                console.warn('OpenCode-visible ' + kind + ' generation: no result file (' + (result.reason || 'unknown') + ')');
            }
        })
        .catch(err => console.warn('OpenCode-visible ' + kind + ' watch error:', err.message));
    
    return sendJSONResponse(res, 200, {
        ok: true,
        data: {
            task_id: taskId,
            mode: 'opencode-visible',
            ide: 'opencode',
            ide_name: 'OpenCode',
            conversations_included: conversationsIncluded,
            deeplink_ok: linkResult.ok,
            autosubmit: sent
        }
    });
}

/**
 * Unified generation dispatch: route to the best channel per IDE method.
 *   opencode -> HTTP API (primary, reliable with history visibility)
 *              fallback -> DeepLink UI visible path (less reliable but visible)
 *   api      -> OpenCode local HTTP bridge (alternative config)
 *   cli      -> headless CLI (claude / codex)
 *   deeplink -> DeepLink (qoder pre-fills; cursor/vscode open + clipboard)
 */
async function dispatchGeneration(kind, prompt, conversationsIncluded, ide, res) {
    const targets = getIdeTargets();
    const target = targets.find(t => t.id === (ide || 'opencode')) || targets[0];
    const method = target.method || 'api';
    
    // OpenCode: primary HTTP API -> fallback visible DeepLink
    if (target.id === 'opencode') {
        try {
            return await dispatchGenerationViaOpenCode(kind, prompt, conversationsIncluded, res);
        } catch (err) {
            console.warn('OpenCode API generation failed:', err.message, ', falling back to visible DeepLink');
            return dispatchGenerationViaOpenCodeVisible(kind, prompt, conversationsIncluded, res);
        }
    }
    
    if (method === 'api') {
        return dispatchGenerationViaOpenCode(kind, prompt, conversationsIncluded, res);
    }
    if (method === 'cli') {
        return dispatchGenerationViaCli(kind, prompt, conversationsIncluded, target.id, res);
    }
    return dispatchGenerationViaDeepLink(kind, prompt, conversationsIncluded, target.id, res);
}

/**
 * Handler: GET /rpc/conversations
 * Stored conversation log grouped by source (one row per conversation),
 * newest first, with a text preview - feeds the Conversations view.
 */
function handleConversationsGet(req, res, query) {
    try {
        const limit = Math.min(200, Math.max(1, parseInt(query.limit) || 50));
        const events = loadConversationEvents();
        const bySource = new Map();
        for (const e of events) {
            let g = bySource.get(e.sourceId);
            if (!g) {
                g = { source_id: e.sourceId, message_count: 0, first_ts: e.ts, last_ts: e.ts, preview: '', messages: [] };
                bySource.set(e.sourceId, g);
            }
            g.message_count++;
            if (e.ts >= g.last_ts) { g.last_ts = e.ts; }
            if (e.ts <= g.first_ts) { g.first_ts = e.ts; }
            g.messages.push({ id: e.id, ts: e.ts, text: e.text });
        }
        const conversations = [...bySource.values()]
            .map(g => {
                g.messages.sort((a, b) => a.ts - b.ts);
                const firstClean = g.messages.map(m => sanitizeForDigest(m.text)).find(Boolean) || '';
                g.preview = firstClean.slice(0, 120);
                // Cap per-conversation messages in the payload (newest kept)
                g.messages = g.messages.slice(-50);
                return g;
            })
            .sort((a, b) => b.last_ts - a.last_ts)
            .slice(0, limit);
        
        return sendJSONResponse(res, 200, { ok: true, data: { count: conversations.length, conversations } });
    } catch (error) {
        console.error('Conversations query error:', error);
        return sendJSONResponse(res, 500, { ok: false, error: error.message });
    }
}

/**
 * Handler: POST /rpc/task/generate-request
 * Proactive task generation: assemble a digest of the stored conversation
 * log and ask the AI in the target conversation to propose tasks as
 * DCF_TASK_REC artifacts. The receiving hook turns each artifact into a
 * recommendation.proposed event, so they appear in Task View for accept/dismiss.
 */
async function handleTaskGenerateRequest(req, res, requestBody) {
    try {
        const limit = Math.min(30, Math.max(3, parseInt(requestBody.limit) || 15));
        const events = scopeConversationEvents(requestBody.source_ids)
            .sort((a, b) => b.ts - a.ts)
            .slice(0, limit)
            .reverse();
        if (events.length === 0) {
            return sendJSONResponse(res, 400, { ok: false, error: 'No stored conversations yet - nothing to generate tasks from' });
        }
        const digest = events
            .map(e => ({ ...e, clean: sanitizeForDigest(e.text) }))
            .filter(e => e.clean)
            .map(e => '- ' + e.clean.slice(0, 200))
            .join('\n');
        const prompt = [
            '以下是我最近存档的对话要点（由 DCF 从本地事件日志提取）：',
            '',
            digest,
            '',
            '请基于这些对话，提出 1-3 条最值得执行的任务建议，放入 products 数组。每个元素字段：',
            '{ "title": "任务标题", "reason": "为什么值得做", "priority": 3, "confidence": 0.8 }',
            '其中 priority 为 1-9（1 最高），confidence 为 0-1。'
        ].join('\n');
        return await dispatchGeneration('task', prompt, events.length, requestBody.ide, res);
    } catch (error) {
        console.error('Task generate-request error:', error);
        return sendJSONResponse(res, 500, { ok: false, error: error.message });
    }
}

/**
 * Handler: POST /rpc/card/generate-request
 * Proactive knowledge-card generation from the stored conversation log.
 * The AI replies with DCF_CARD artifacts which the receiving hook persists
 * into ai_cards (attribution ai_proposed).
 */
async function handleCardGenerateRequest(req, res, requestBody) {
    try {
        const limit = Math.min(30, Math.max(3, parseInt(requestBody.limit) || 15));
        const events = scopeConversationEvents(requestBody.source_ids).sort((a, b) => b.ts - a.ts).slice(0, limit).reverse();
        if (events.length === 0) {
            return sendJSONResponse(res, 400, { ok: false, error: 'No stored conversations yet - nothing to generate cards from' });
        }
        const digest = events
            .map(e => ({ ...e, clean: sanitizeForDigest(e.text) }))
            .filter(e => e.clean)
            .map(e => '- ' + e.clean.slice(0, 200))
            .join('\n');
        const prompt = [
            '以下是我最近存档的对话要点（由 DCF 从本地事件日志提取）：',
            '',
            digest,
            '',
            '请基于这些对话，归纳 1-3 张最有长期价值的知识卡片，放入 products 数组。每个元素字段：',
            '{ "title": "标题（≤40字）", "summary": "摘要（100-300字）", "evidence": ["引用原对话关键句 1", "引用 2"] }'
        ].join('\n');
        return await dispatchGeneration('card', prompt, events.length, requestBody.ide, res);
    } catch (error) {
        console.error('Card generate-request error:', error);
        return sendJSONResponse(res, 500, { ok: false, error: error.message });
    }
}

/**
 * Helper: Get current ISO week number
 */
function getCurrentWeek() {
    return weeklyDigestReducer.getISOWeek(new Date());
}

// Export new handlers for testing
module.exports.handleProjectionTasksGet = handleProjectionTasksGet;
module.exports.handleProjectionGraphGet = handleProjectionGraphGet;
module.exports.handleProjectionWeeklyDigestGet = handleProjectionWeeklyDigestGet;
module.exports.getCurrentWeek = getCurrentWeek;
