/**
 * G1 Companion - Database Operations Module
 * Uses Node.js native sqlite3 (DatabaseSync) with fallback support
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Try to import DatabaseSync (Node 20.10+ preferred, but we'll check compatibility)
let DatabaseSync;
let DATABASE_SYNC_AVAILABLE = false;

try {
    // Node 20.10+ has DatabaseSync in node:sqlite
    if (typeof process.versions.sqlite !== 'undefined') {
        const sqlite = require('node:sqlite');
        if (sqlite.DatabaseSync) {
            DatabaseSync = sqlite.DatabaseSync;
            DATABASE_SYNC_AVAILABLE = true;
        }
    } else if (require.main === module) {
        console.log('Warning: node:sqlite not available, falling back to sqlite3 CLI for schema initialization');
    }
} catch (error) {
    if (require.main === module) {
        console.log('Warning: Failed to load node:sqlite:', error.message);
    }
}

class CompanionDB {
    constructor(dbPath = null) {
        this.dbPath = dbPath || this.getDefaultDbPath();
        this.db = null;
        
        // Content-addressable hash helper
        this.sha256 = this.sha256.bind(this);
    }
    
    /**
     * Get default database path (~/.dcf/dcf.db)
     * @returns {string} Path to database file
     */
    getDefaultDbPath() {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
        const dcfDir = path.join(homeDir, '.dcf');
        
        // Ensure directory exists
        if (!fs.existsSync(dcfDir)) {
            fs.mkdirSync(dcfDir, { recursive: true });
        }
        
        return path.join(dcfDir, 'dcf.db');
    }
    
    /**
     * Calculate SHA-256 hash of content
     * @param {string|Buffer} content - Input content
     * @returns {string} Hex-encoded SHA-256 hash
     */
    sha256(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }
    
    /**
     * Initialize and open database connection
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        if (!DATABASE_SYNC_AVAILABLE) {
            // For development/testing, create stub methods
            if (require.main === module) {
                console.log('Using mock database mode (node:sqlite unavailable)');
            }
            return await this.initializeMockMode();
        }
        
        try {
            this.db = new DatabaseSync(this.dbPath);
            
            // Read and execute schema. A packaged binary embeds the schema
            // as a global string so runtime never depends on the source dir.
            const schema = (typeof globalThis.__DCF_EMBEDDED_SCHEMA__ === 'string')
                ? globalThis.__DCF_EMBEDDED_SCHEMA__
                : fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
            
            // Execute statement by statement (to handle multiple statements).
            // Strip comment lines first: a statement chunk may START with
            // "--" comment lines while still containing real DDL, so filtering
            // whole chunks by prefix would silently drop CREATE TABLE statements.
            const statements = schema
                .split('\n')
                .filter(line => !line.trim().startsWith('--'))
                .join('\n')
                .split(';')
                .map(s => s.trim())
                .filter(s => s);
            
            for (const stmt of statements) {
                if (stmt) {
                    this.db.exec(stmt + ';');
                }
            }
            
            // Create index on sequence_number if not exists (for compatibility)
            try {
                this.db.exec(`
                    CREATE INDEX IF NOT EXISTS idx_raw_events_sequence 
                    ON raw_events(sequence_number) 
                    WHERE sequence_number IS NOT NULL;
                `);
            } catch (e) {
                // Ignore if already exists
            }
            
            if (require.main === module) {
                console.log(`✓ Database initialized at ${this.dbPath}`);
            }
            
            return true;
        } catch (error) {
            throw new Error(`Failed to initialize database: ${error.message}`);
        }
    }
    
    /**
     * Initialize mock database for testing when node:sqlite unavailable
     */
    async initializeMockMode() {
        this.db = {
            isMock: true,
            data: {
                raw_events: [],
                views_materialization: [],
                boundary_relations: []
            },
            nextEventId: 1,
            nextSequence: 1
        };
        
        return true;
    }
    
    /**
     * Close database connection
     */
    close() {
        if (this.db && !this.db.isMock) {
            this.db.close();
            this.db = null;
        }
    }
    
    /**
     * Insert a single event (idempotent)
     * @param {Object} event - Event object
     * @returns {{success: boolean, event_id?: string, error?: string}}
     */
    insertEvent(event) {
        if (this.db.isMock) {
            return this.insertEventMock(event);
        }
        
        try {
            const { valid, errors } = require('./types').validateRawEvent(event);
            if (!valid) {
                return { success: false, error: `Validation failed: ${errors.join(', ')}` };
            }
            
            // Check for duplicate event_id (idempotency)
            // node:sqlite StatementSync API: get/all/run (no bind/step/free)
            const existing = this.db.prepare('SELECT 1 FROM raw_events WHERE event_id = ?').get(event.event_id);
            if (existing) {
                return { success: true, event_id: event.event_id, duplicated: true };
            }
            
            // Insert event
            const insertStmt = this.db.prepare(`
                INSERT INTO raw_events (event_id, source_id, event_type, payload_json, sha256, created_at, sequence_number)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            // Payload is validated as an object; persist as JSON text
            const payloadText = event.payload_json == null
                ? null
                : (typeof event.payload_json === 'string' ? event.payload_json : JSON.stringify(event.payload_json));
            
            const now = new Date().toISOString();
            insertStmt.run(
                event.event_id,
                event.source_id,
                event.event_type,
                payloadText,
                event.sha256 || null,
                event.created_at || now,
                event.sequence_number || null
            );
            
            // Sync FTS index (schema uses no triggers; keep index in step manually)
            try {
                const row = this.db.prepare('SELECT rowid FROM raw_events WHERE event_id = ?').get(event.event_id);
                if (row && payloadText) {
                    this.db.prepare('INSERT INTO raw_events_fts (rowid, payload_searchable) VALUES (?, ?)')
                        .run(row.rowid, payloadText);
                }
            } catch (ftsError) {
                // FTS indexing failure must not block event persistence
                console.warn('FTS index update failed:', ftsError.message);
            }
            
            return { success: true, event_id: event.event_id, duplicated: false };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Mock insert event for testing
     */
    insertEventMock(event) {
        const { valid, errors } = require('./types').validateRawEvent(event);
        if (!valid) {
            return { success: false, error: `Validation failed: ${errors.join(', ')}` };
        }
        
        // Check for duplicate
        const exists = this.db.data.raw_events.find(e => e.event_id === event.event_id);
        if (exists) {
            return { success: true, event_id: event.event_id, duplicated: true };
        }
        
        // Insert
        const now = new Date().toISOString();
        const mockEvent = {
            ...event,
            created_at: event.created_at || now,
            sequence_number: this.db.nextSequence++
        };
        
        this.db.data.raw_events.push(mockEvent);
        
        return { success: true, event_id: event.event_id, duplicated: false };
    }
    
    /**
     * Batch insert events (all or nothing)
     * @param {Array} events - Array of events
     * @returns {{success: boolean, inserted: number, errors: string[]}}
     */
    batchInsertEvents(events) {
        if (!Array.isArray(events)) {
            return { success: false, inserted: 0, errors: ['Events must be an array'] };
        }
        
        if (events.length === 0) {
            return { success: true, inserted: 0, errors: [] };
        }
        
        // Validate all events first (fail fast)
        const validationErrors = [];
        for (const event of events) {
            const { valid, errors } = require('./types').validateRawEvent(event);
            if (!valid) {
                validationErrors.push(...errors.map(e => `${event.event_id || 'unknown'}: ${e}`));
            }
        }
        
        if (validationErrors.length > 0) {
            return { success: false, inserted: 0, errors: validationErrors };
        }
        
        try {
            // Begin transaction
            if (!this.db.isMock) {
                this.db.exec('BEGIN TRANSACTION');
            }
            
            let inserted = 0;
            for (const event of events) {
                const result = this.insertEvent(event);
                if (result.success && !result.duplicated) {
                    inserted++;
                } else if (result.error) {
                    // Rollback on error (except duplicates)
                    if (!this.db.isMock) {
                        this.db.exec('ROLLBACK');
                    }
                    return { success: false, inserted, errors: [result.error] };
                }
            }
            
            // Commit
            if (!this.db.isMock) {
                this.db.exec('COMMIT');
            }
            
            return { success: true, inserted, errors: [] };
        } catch (error) {
            if (!this.db.isMock) {
                this.db.exec('ROLLBACK');
            }
            return { success: false, inserted: 0, errors: [error.message] };
        }
    }
    
    /**
     * Query events by source_id
     * @param {string} sourceId - Source ID
     * @param {Object} options - Query options
     * @returns {Array} Array of events
     */
    queryEventsBySource(sourceId, options = {}) {
        if (this.db.isMock) {
            return this.queryEventsBySourceMock(sourceId, options);
        }
        
        try {
            const limit = options.limit || 100;
            const offset = options.offset || 0;
            const orderBy = options.orderBy || 'DESC';
            
            const stmt = this.db.prepare(`
                SELECT event_id, source_id, event_type, payload_json, sha256, created_at, sequence_number
                FROM raw_events
                WHERE source_id = ?
                ORDER BY created_at ${orderBy}
                LIMIT ? OFFSET ?
            `);
            
            return stmt.all(sourceId, limit, offset);
        } catch (error) {
            console.error('Query error:', error);
            return [];
        }
    }
    
    /**
     * Mock query by source_id
     */
    queryEventsBySourceMock(sourceId, options = {}) {
        const limit = options.limit || 100;
        const offset = options.offset || 0;
        const orderBy = options.orderBy || 'DESC';
        
        const filtered = this.db.data.raw_events.filter(e => e.source_id === sourceId);
        
        // Sort
        filtered.sort((a, b) => {
            const timeA = new Date(a.created_at).getTime();
            const timeB = new Date(b.created_at).getTime();
            return orderBy === 'DESC' ? timeB - timeA : timeA - timeB;
        });
        
        // Paginate
        return filtered.slice(offset, offset + limit);
    }
    
    /**
     * Set boundary state for a source/scop
e combination
 * @param {Object} relation - Boundary relation
 * @returns {{success: boolean, error?: string}}
 */
    setBoundaryRelation(relation) {
        if (this.db.isMock) {
            return this.setBoundaryRelationMock(relation);
        }
        
        try {
            const { valid, errors } = require('./types').validateBoundaryRelation(relation);
            if (!valid) {
                return { success: false, error: `Validation failed: ${errors.join(', ')}` };
            }
            
            const inheritedJson = relation.inherited_from_event_ids 
                ? JSON.stringify(relation.inherited_from_event_ids) 
                : null;
            
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO boundary_relations 
                    (source_id, scope, boundary_state, inherited_from_event_ids, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            `);
            
            stmt.run(
                relation.source_id,
                relation.scope,
                relation.boundary_state,
                inheritedJson
            );
            
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Mock boundary relation
     */
    setBoundaryRelationMock(relation) {
        const { valid, errors } = require('./types').validateBoundaryRelation(relation);
        if (!valid) {
            return { success: false, error: `Validation failed: ${errors.join(', ')}` };
        }
        
        const idx = this.db.data.boundary_relations.findIndex(
            r => r.source_id === relation.source_id && r.scope === relation.scope
        );
        
        if (idx >= 0) {
            this.db.data.boundary_relations[idx] = {
                ...relation,
                updated_at: new Date().toISOString()
            };
        } else {
            this.db.data.boundary_relations.push({
                ...relation,
                updated_at: new Date().toISOString()
            });
        }
        
        return { success: true };
    }
    
    /**
     * Get boundary state
     * @param {string} sourceId - Source ID
     * @param {string} scope - Scope
     * @returns {Object|null} Boundary relation or null
     */
    getBoundaryRelation(sourceId, scope) {
        if (this.db.isMock) {
            return this.getBoundaryRelationMock(sourceId, scope);
        }
        
        try {
            const stmt = this.db.prepare(`
                SELECT source_id, scope, boundary_state, inherited_from_event_ids, updated_at
                FROM boundary_relations
                WHERE source_id = ? AND scope = ?
            `);
            
            const row = stmt.get(sourceId, scope);
            return row || null;
        } catch (error) {
            console.error('Get boundary error:', error);
            return null;
        }
    }
    
    /**
     * Mock get boundary relation
     */
    getBoundaryRelationMock(sourceId, scope) {
        const relation = this.db.data.boundary_relations.find(
            r => r.source_id === sourceId && r.scope === scope
        );
        return relation || null;
    }
    
    /**
     * Search events using FTS
     * @param {string} query - Search query
     * @param {number} limit - Max results
     * @returns {Array} Matching events
     */
    searchEvents(query, limit = 50) {
        if (this.db.isMock) {
            // Simple substring search as FTS not available in mock
            return this.searchEventsMock(query, limit);
        }
        
        try {
            const stmt = this.db.prepare(`
                SELECT re.event_id, re.source_id, re.event_type, re.payload_json, re.sha256, re.created_at, re.sequence_number
                FROM raw_events_fts fts
                JOIN raw_events re ON fts.rowid = re.rowid
                WHERE raw_events_fts MATCH ?
                LIMIT ?
            `);
            
            const ftsResults = stmt.all(query, limit);
            // FTS index may miss rows inserted before index sync existed;
            // fall back to LIKE substring scan when FTS finds nothing.
            if (ftsResults.length > 0) {
                return ftsResults;
            }
            return this.searchEventsLike(query, limit);
        } catch (error) {
            // FTS query syntax error (e.g. special chars): fall back to LIKE substring search
            return this.searchEventsLike(query, limit);
        }
    }
    
    /**
     * LIKE-based substring search fallback (blueprint spec)
     */
    searchEventsLike(query, limit = 50) {
        try {
            const fallback = this.db.prepare(`
                SELECT event_id, source_id, event_type, payload_json, sha256, created_at, sequence_number
                FROM raw_events
                WHERE payload_json LIKE ?
                ORDER BY sequence_number ASC
                LIMIT ?
            `);
            return fallback.all('%' + query + '%', limit);
        } catch (fallbackError) {
            console.error('Fallback search error:', fallbackError);
            return [];
        }
    }
    
    /**
     * Mock search
     */
    searchEventsMock(query, limit = 50) {
        const lowerQuery = query.toLowerCase();
        const results = this.db.data.raw_events.filter(event => {
            if (!event.payload_json) return false;
            try {
                const payload = JSON.parse(event.payload_json);
                const searchText = JSON.stringify(payload).toLowerCase();
                return searchText.includes(lowerQuery);
            } catch {
                return false;
            }
        });
        
        return results.slice(0, limit);
    }
    
    /**
     * Materialize a view/snapshot
     * @param {string} name - Materialization name
     * @param {string} snapshotContent - Snapshot content
     * @param {Object} parameters - Optional parameters
     * @returns {{success: boolean, snapshot_hash?: string, error?: string}}
     */
    materializeView(name, snapshotContent, parameters = {}) {
        const snapshotHash = this.sha256(snapshotContent);
        const parametersJson = Object.keys(parameters).length > 0 
            ? JSON.stringify(parameters) 
            : null;
        
        const now = new Date().toISOString();
        
        if (this.db.isMock) {
            const idx = this.db.data.views_materialization.findIndex(v => v.materialization_name === name);
            if (idx >= 0) {
                this.db.data.views_materialization[idx] = {
                    materialization_name: name,
                    snapshot_hash: snapshotHash,
                    last_snapshot_at: now,
                    parameters_json: parametersJson
                };
            } else {
                this.db.data.views_materialization.push({
                    materialization_name: name,
                    snapshot_hash: snapshotHash,
                    last_snapshot_at: now,
                    parameters_json: parametersJson
                });
            }
            return { success: true, snapshot_hash: snapshotHash };
        }
        
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO views_materialization 
                    (materialization_name, snapshot_hash, last_snapshot_at, parameters_json)
                VALUES (?, ?, ?, ?)
            `);
            
            stmt.run(name, snapshotHash, now, parametersJson);
            
            return { success: true, snapshot_hash: snapshotHash };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Get statistics about the database
     * @returns {Object} Statistics
     */
    getStats() {
        if (this.db.isMock) {
            return this.getStatsMock();
        }
        
        try {
            const eventCount = this.db.prepare('SELECT COUNT(*) as count FROM raw_events').get().count;
            const boundaryCount = this.db.prepare('SELECT COUNT(*) as count FROM boundary_relations').get().count;
            
            return {
                event_count: eventCount,
                boundary_count: boundaryCount,
                db_path: this.dbPath,
                mock_mode: false
            };
        } catch (error) {
            return { error: error.message };
        }
    }
    
    /**
     * Mock stats
     */
    getStatsMock() {
        return {
            event_count: this.db.data.raw_events.length,
            boundary_count: this.db.data.boundary_relations.length,
            db_path: this.dbPath,
            mock_mode: true
        };
    }
    
    // ==========================================================
    // G3: Materials Projection CRUD & Recomputation
    // ==========================================================
    
    /**
     * Upsert materials projection record
     */
    upsertMaterialProjection(materialData) {
        if (this.db.isMock) {
            return this.upsertMaterialProjectionMock(materialData);
        }
        
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO materials_projection
                    (entity_id, latest_candidate_sha256, latest_candidate_body, attribution_state,
                     continuation_points_json, source_ref, assertion_attribution, last_updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `);
            
            const pointsJson = materialData.continuation_points ? JSON.stringify(materialData.continuation_points) : null;
            
            stmt.run(
                materialData.entity_id,
                materialData.latest_candidate_sha256 || null,
                materialData.latest_candidate_body || null,
                materialData.attribution_state,
                pointsJson,
                materialData.source_ref || null,
                materialData.assertion_attribution
            );
            
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Mock upsert
     */
    upsertMaterialProjectionMock(materialData) {
        const idx = this.db.data.materials_projection?.findIndex(m => m.entity_id === materialData.entity_id) ?? -1;
        const record = {
            entity_id: materialData.entity_id,
            latest_candidate_sha256: materialData.latest_candidate_sha256 || null,
            latest_candidate_body: materialData.latest_candidate_body || null,
            attribution_state: materialData.attribution_state,
            continuation_points_json: materialData.continuation_points ? JSON.stringify(materialData.continuation_points) : null,
            source_ref: materialData.source_ref || null,
            assertion_attribution: materialData.assertion_attribution,
            last_updated_at: new Date().toISOString()
        };
        
        if (!this.db.data.materials_projection) {
            this.db.data.materials_projection = [];
        }
        
        if (idx >= 0) {
            this.db.data.materials_projection[idx] = record;
        } else {
            this.db.data.materials_projection.push(record);
        }
        
        return { success: true };
    }
    
    /**
     * Get projection by entity_id
     */
    getMaterialProjection(entityId) {
        if (this.db.isMock) {
            return this.getMaterialProjectionMock(entityId);
        }
        
        try {
            const stmt = this.db.prepare('SELECT * FROM materials_projection WHERE entity_id = ?');
            return stmt.get(entityId) || null;
        } catch (error) {
            return null;
        }
    }
    
    getMaterialProjectionMock(entityId) {
        return (this.db.data.materials_projection || []).find(m => m.entity_id === entityId) || null;
    }
    
    /**
     * Get all projections
     */
    getAllMaterialProjections() {
        if (this.db.isMock) {
            return [...(this.db.data.materials_projection || [])];
        }
        
        try {
            const stmt = this.db.prepare('SELECT * FROM materials_projection');
            return stmt.all();
        } catch (error) {
            return [];
        }
    }
    
    /**
     * Sync metadata table operations
     */
    setSyncMetadata(key, value) {
        if (this.db.isMock) {
            return this.setSyncMetadataMock(key, value);
        }
        
        try {
            const stmt = this.db.prepare("INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, datetime('now'))");
            stmt.run(key, value);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    setSyncMetadataMock(key, value) {
        const idx = this.db.data.sync_metadata?.findIndex(m => m.key === key) ?? -1;
        const record = { key, value, updated_at: new Date().toISOString() };
        
        if (!this.db.data.sync_metadata) {
            this.db.data.sync_metadata = [record];
        } else if (idx >= 0) {
            this.db.data.sync_metadata[idx] = record;
        } else {
            this.db.data.sync_metadata.push(record);
        }
        
        return { success: true };
    }
    
    getSyncMetadata(key) {
        if (this.db.isMock) {
            return this.getSyncMetadataMock(key);
        }
        
        try {
            const stmt = this.db.prepare('SELECT value FROM sync_metadata WHERE key = ?');
            const row = stmt.get(key);
            return row ? row.value : null;
        } catch (error) {
            return null;
        }
    }
    
    getSyncMetadataMock(key) {
        const record = (this.db.data.sync_metadata || []).find(r => r.key === key);
        return record ? record.value : null;
    }
    
    /**
     * Reconstruct materials_projection from raw_events (idempotent recomputation)
     * Delegates to the SAME pure reducer used by the incremental ingest path
     * (materials.reduceMaterialEvents), so recompute === incremental by construction.
     */
    recomputeMaterialsProjection() {
        // Lazy require avoids circular dependency at module load
        const { reduceMaterialEvents } = require('./materials');

        const events = this.getAllRawEventsOfType('material.');
        const projectionsMap = reduceMaterialEvents(events);

        // Persist recomputed projections (NOT NULL columns require seeded states)
        let persisted = 0;
        for (const [entityId, data] of projectionsMap.entries()) {
            if (!data.attribution_state || !data.assertion_attribution) continue;
            this.upsertMaterialProjection({
                entity_id: entityId,
                latest_candidate_sha256: data.latest_candidate_sha256,
                latest_candidate_body: data.latest_candidate_body,
                attribution_state: data.attribution_state,
                continuation_points: data.continuation_points,
                assertion_attribution: data.assertion_attribution,
                source_ref: data.source_ref
            });
            persisted++;
        }

        return {
            success: true,
            recomputedCount: persisted
        };
    }

    /**
     * Get all raw events with optional type prefix filter (log order)
     */
    getAllRawEventsOfType(typePrefix = null) {
        if (this.db.isMock) {
            return this.getAllRawEventsOfTypeMock(typePrefix);
        }

        try {
            let stmt;
            if (typePrefix) {
                stmt = this.db.prepare("SELECT * FROM raw_events WHERE event_type LIKE ? ORDER BY rowid ASC");
                return stmt.all(typePrefix + '%');
            } else {
                stmt = this.db.prepare('SELECT * FROM raw_events ORDER BY rowid ASC');
                return stmt.all();
            }
        } catch (error) {
            return [];
        }
    }

    getAllRawEventsOfTypeMock(typePrefix = null) {
        let events = [...(this.db.data.raw_events || [])];

        if (typePrefix) {
            events = events.filter(e => e.event_type.startsWith(typePrefix));
        }

        return events;
    }
}

module.exports = { CompanionDB, DATABASE_SYNC_AVAILABLE };
