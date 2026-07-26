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
const { validateRPCRequest, BOUNDARY_STATES, ATTRIBUTION_STATES } = require('./types');
const { runDoctor } = require('./doctor');
const { GitHubSync, checkGhAuth, sha256 } = require('./github-sync');
const { MaterialProcessor } = require('./materials');
const { exportMaterials } = require('./export');

// Configuration
const DEFAULT_PORT = 8472;
let PORT = parseInt(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1]) || DEFAULT_PORT;
let DB_PATH = process.argv.find(arg => arg.startsWith('--db='))?.split('=').slice(1).join('=') || null;
let BASE_DIR = process.argv.find(arg => arg.startsWith('--dcf-dir='))?.split('=').slice(1).join('=') || null;

// Global state
let companionDB = null;
let eventProcessor = null;
let materialProcessor = null;
let server = null;

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
        
        // Create HTTP server
        server = http.createServer(handleRequest);
        
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
module.exports = { initializeServer, handleRequest, readRequestBody, companionDB, eventProcessor };

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
