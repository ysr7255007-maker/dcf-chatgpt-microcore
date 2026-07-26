#!/usr/bin/env node

/**
 * G1 Companion Core - HTTP Server
 * localhost:8472 (configurable via --port flag)
 * 
 * JSON-RPC 2.0 over HTTP, using Node native http module (zero npm dependencies)
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Load modules
const { CompanionDB } = require('./db');
const { EventProcessor } = require('./events');
const { validateRPCRequest, BOUNDARY_STATES } = require('./types');

// Configuration
const DEFAULT_PORT = 8472;
let PORT = parseInt(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1]) || DEFAULT_PORT;
let DB_PATH = process.argv.find(arg => arg.startsWith('--db='))?.split('=').slice(1).join('=') || null;

// Global state
let companionDB = null;
let eventProcessor = null;
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
    return {
        jsonrpc: '2.0',
        error: { code, message },
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
            return sendJSONResponse(res, 400, rpcError(-32000, result.error, requestBody.id));
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
            return sendJSONResponse(res, 400, rpcError(-32000, result.errors[0], requestBody.id));
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
    
    // Initialize database
    companionDB = new CompanionDB(DB_PATH);
    
    try {
        await initializeServer();
    } catch (error) {
        console.error('Startup failed:', error.message);
        process.exit(1);
    }
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
