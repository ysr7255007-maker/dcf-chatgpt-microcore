-- G1 Companion Core Schema
-- SQLite DDL for ~/.dcf/dcf.db
-- Author: Task #3 G1 Implementation

-- ----------------------------------------------------------------------------
-- raw_events: append-only event log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_events (
    event_id TEXT PRIMARY KEY,           -- ULID, stable client-provided or server-generated
    source_id TEXT NOT NULL,             -- ULID, entity/conversation/source identifier
    event_type TEXT NOT NULL,            -- event category (e.g., conversation.updated, card.created)
    payload_json TEXT,                   -- JSON payload (nullable for "don't read" events)
    sha256 TEXT,                         -- content-addressable hash of body/attachment/DOM snapshot
    created_at TEXT NOT NULL DEFAULT (datetime('now')),  -- ISO8601 timestamp
    sequence_number INTEGER,             -- ordering sequence (optional, for audit)
    
    -- Constraints
    CHECK (event_id IS NOT NULL AND event_id != ''),
    CHECK (source_id IS NOT NULL AND source_id != ''),
    CHECK (event_type IS NOT NULL AND event_type != '')
);

-- FTS5 full-text search index on payload
-- Note: Triggers not used to avoid transaction issues in Node sqlite
CREATE VIRTUAL TABLE IF NOT EXISTS raw_events_fts USING fts5 (
    payload_searchable,
    content='raw_events',
    content_rowid='rowid'
);

-- ----------------------------------------------------------------------------
-- views_materialization: tracking computed projections/snapshots
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS views_materialization (
    materialization_name TEXT PRIMARY KEY,     -- unique name (e.g., conversation_summary_v1)
    snapshot_hash TEXT NOT NULL,               -- SHA-256 hash of snapshot content
    last_snapshot_at TEXT NOT NULL,            -- ISO8601 timestamp of last snapshot
    parameters_json TEXT,                      -- optional params used for computation
    
    CHECK (snapshot_hash IS NOT NULL AND snapshot_hash != ''),
    CHECK (last_snapshot_at IS NOT NULL AND last_snapshot_at != '')
);

-- ----------------------------------------------------------------------------
-- boundary_relations: three-state authorization & inheritance
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boundary_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,                 -- ULID of the entity being governed
    scope TEXT NOT NULL,                     -- scope key (e.g., 'conversation:abc123')
    boundary_state TEXT NOT NULL,            -- NOT_OBSERVE | OBSERVE_CURRENT_ONLY | OBSERVE_AND_ARCHIVE
    
    -- Inheritance chain (stored as JSON array for simplicity)
    inherited_from_event_ids TEXT,           -- JSON array of parent event IDs that defined this boundary
    
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    UNIQUE (source_id, scope),
    CHECK (boundary_state IN ('NOT_OBSERVE', 'OBSERVE_CURRENT_ONLY', 'OBSERVE_AND_ARCHIVE'))
);

-- ----------------------------------------------------------------------------
-- G3: materials_projection - computed projection from material evolution events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials_projection (
    entity_id TEXT PRIMARY KEY,              -- ULID of the material entity
    latest_candidate_sha256 TEXT,            -- SHA-256 of current candidate body
    latest_candidate_body TEXT,              -- candidate content (for quick access)
    attribution_state TEXT NOT NULL,         -- ai_proposed | user_tentative | user_confirmed | reality_verified
    continuation_points_json TEXT,           -- JSON array of continuation point refs
    source_ref TEXT,                         -- last known source reference
    assertion_attribution TEXT NOT NULL,     -- ai_proposed | user_tentative | user_confirmed | reality_verified (required for material events)
    last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    CHECK (attribution_state IN ('ai_proposed', 'user_tentative', 'user_confirmed', 'reality_verified')),
    CHECK (assertion_attribution IN ('ai_proposed', 'user_tentative', 'user_confirmed', 'reality_verified'))
);

-- ----------------------------------------------------------------------------
-- G3: sync_metadata - GitHub synchronization tracking
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,                    -- e.g., 'github_last_sync_point'
    value TEXT NOT NULL,                     -- sha256 or other metadata
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_raw_events_source_id ON raw_events(source_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_created_at ON raw_events(created_at);
CREATE INDEX IF NOT EXISTS idx_raw_events_event_type ON raw_events(event_type);
CREATE INDEX IF NOT EXISTS idx_boundary_relations_scope ON boundary_relations(scope);
CREATE INDEX IF NOT EXISTS idx_boundary_relations_source_id ON boundary_relations(source_id);

-- G3: Index for material-related event types
CREATE INDEX IF NOT EXISTS idx_raw_events_event_type_g3 ON raw_events(event_type) WHERE event_type LIKE 'material.%';

-- View for querying events by source_id (simplified, no window function)
-- Create VIEW IF NOT EXISTS v_events_by_source AS
-- SELECT 
--     event_id,
--     source_id,
--     event_type,
--     payload_json,
--     sha256,
--     created_at,
--     sequence_number
-- FROM raw_events;
-- Note: Window functions may not be supported in older SQLite versions

-- ----------------------------------------------------------------------------
-- Initial data: default boundary states ("只用于当前")
-- ----------------------------------------------------------------------------
-- Note: Default boundaries are created per-entity when first encountered.
-- The companion doesn't pre-populate these; they're dynamic based on observed events.
