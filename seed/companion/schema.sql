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

-- ----------------------------------------------------------------------------
-- G4: task_checkpoints - checkpoint events for task progress tracking
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_checkpoints (
    checkpoint_id TEXT PRIMARY KEY,              -- ULID, stable checkpoint identifier
    task_id TEXT NOT NULL,                       -- ULID, parent task reference
    checkpoint_type TEXT NOT NULL,               -- type (progress_update, state_change, milestone_reached)
    snapshot_json TEXT NOT NULL,                 -- JSON snapshot at this checkpoint
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    CHECK (checkpoint_id IS NOT NULL AND checkpoint_id != ''),
    CHECK (task_id IS NOT NULL AND task_id != ''),
    CHECK (checkpoint_type IS NOT NULL AND checkpoint_type != ''),
    CHECK (snapshot_json IS NOT NULL AND snapshot_json != '')
);

-- Index for querying checkpoints by task_id
CREATE INDEX IF NOT EXISTS idx_task_checkpoints_task_id ON task_checkpoints(task_id);
CREATE INDEX IF NOT EXISTS idx_task_checkpoints_created_at ON task_checkpoints(created_at);

-- ----------------------------------------------------------------------------
-- G4: tasks_projection - computed projection from task lifecycle events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks_projection (
    task_id TEXT PRIMARY KEY,                    -- ULID, unique task identifier
    source_ref TEXT,                             -- original source reference (e.g., card/recommendation ID)
    objective TEXT,                              -- brief objective summary
    boundary_inherited_from TEXT,                -- ULID of event that defined task boundaries
    bound_conversation_id TEXT,                  -- ULID of associated conversation
    bound_conversation_url TEXT,                 -- conversation URL for context
    bound_execution_agent TEXT,                  -- ULID of execution agent assigned
    current_status TEXT NOT NULL,                -- proposed | accepted | in_progress | completed | failed
    progress_json TEXT,                          -- detailed progress tracking (JSON)
    checkpoint_event_id TEXT,                    -- latest checkpoint event reference
    result_event_id TEXT,                        -- final result event reference
    failure_path_event_id TEXT,                  -- failure path diagnostic event
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    CHECK (task_id IS NOT NULL AND task_id != ''),
    CHECK (current_status IN ('proposed', 'accepted', 'in_progress', 'completed', 'failed'))
);

-- Index for common query patterns
CREATE INDEX IF NOT EXISTS idx_tasks_projection_current_status ON tasks_projection(current_status);
CREATE INDEX IF NOT EXISTS idx_tasks_projection_source_ref ON tasks_projection(source_ref);
CREATE INDEX IF NOT EXISTS idx_tasks_projection_bound_conversation_id ON tasks_projection(bound_conversation_id);

-- ----------------------------------------------------------------------------
-- G4: cards_projection - computed projection from card.* events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cards_projection (
    card_id TEXT PRIMARY KEY,                    -- ULID, unique card identifier
    title TEXT,                                  -- card title/summary
    body_text TEXT,                              -- full card content
    materiality_score REAL,                      -- relevance/importance score (0-1)
    priority_level INTEGER,                      -- processing priority (1=highest, 9=lowest)
    status TEXT NOT NULL,                        -- new | triaged | processed | archived
    source_event_id TEXT,                        -- original card.created event
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    CHECK (card_id IS NOT NULL AND card_id != ''),
    CHECK (materiality_score >= 0.0 AND materiality_score <= 1.0),
    CHECK (priority_level >= 1 AND priority_level <= 9),
    CHECK (status IN ('new', 'triaged', 'processed', 'archived'))
);

-- Index for filtering and sorting
CREATE INDEX IF NOT EXISTS idx_cards_projection_materiality_score ON cards_projection(materiality_score);
CREATE INDEX IF NOT EXISTS idx_cards_projection_priority_level ON cards_projection(priority_level);
CREATE INDEX IF NOT EXISTS idx_cards_projection_status ON cards_projection(status);

-- ----------------------------------------------------------------------------
-- G4: sparks_projection - computed projection from spark.* events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sparks_projection (
    spark_id TEXT PRIMARY KEY,                   -- ULID, unique spark identifier
    insight_summary TEXT,                        -- brief insight description
    confidence_score REAL,                       -- confidence level (0-1)
    category TEXT,                               -- topic/domain category
    related_card_ids TEXT,                       -- JSON array of related card IDs
    status TEXT NOT NULL,                        -- emerging | validated | actionable | dismissed
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    CHECK (spark_id IS NOT NULL AND spark_id != ''),
    CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
    CHECK (status IN ('emerging', 'validated', 'actionable', 'dismissed'))
);

-- Index for filtering
CREATE INDEX IF NOT EXISTS idx_sparks_projection_confidence_score ON sparks_projection(confidence_score);
CREATE INDEX IF NOT EXISTS idx_sparks_projection_status ON sparks_projection(status);
CREATE INDEX IF NOT EXISTS idx_sparks_projection_category ON sparks_projection(category);

-- ----------------------------------------------------------------------------
-- G4: recommendations_projection - computed projection from recommendation.* events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recommendations_projection (
    recommendation_id TEXT PRIMARY KEY,          -- ULID, unique recommendation identifier
    source_entity_type TEXT NOT NULL,            -- card | spark | task | system
    source_entity_id TEXT NOT NULL,              -- ULID of source entity
    recommendation_text TEXT NOT NULL,           -- recommendation content
    suggested_action TEXT,                       -- recommended user action
    target_material_ids TEXT,                    -- JSON array of target material IDs
    materiality_score REAL,                      -- importance score (0-1)
    priority_level INTEGER,                      -- processing priority (1=highest, 9=lowest)
    status TEXT NOT NULL,                        -- pending | accepted | dismissed | expired
    binding_context_json TEXT,                   -- optional context for binding (JSON)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    CHECK (recommendation_id IS NOT NULL AND recommendation_id != ''),
    CHECK (source_entity_type IS NOT NULL AND source_entity_type != ''),
    CHECK (source_entity_id IS NOT NULL AND source_entity_id != ''),
    CHECK (recommendation_text IS NOT NULL AND recommendation_text != ''),
    CHECK (materiality_score >= 0.0 AND materiality_score <= 1.0),
    CHECK (priority_level >= 1 AND priority_level <= 9),
    CHECK (status IN ('pending', 'accepted', 'dismissed', 'expired'))
);

-- Index for queries
CREATE INDEX IF NOT EXISTS idx_recommendations_projection_source ON recommendations_projection(source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_projection_status ON recommendations_projection(status);
CREATE INDEX IF NOT EXISTS idx_recommendations_projection_materiality_score ON recommendations_projection(materiality_score);
CREATE INDEX IF NOT EXISTS idx_recommendations_projection_priority_level ON recommendations_projection(priority_level);

-- View for joining recommendations with source entities (optional query aid)
-- Note: Views may not be supported in older SQLite versions, kept commented
-- CREATE VIEW IF NOT EXISTS v_recommendations_with_sources AS
-- SELECT 
--     r.*,
--     CASE r.source_entity_type
--         WHEN 'card' THEN c.title
--         WHEN 'spark' THEN s.insight_summary
--         WHEN 'task' THEN t.objective
--         ELSE NULL
--     END AS source_display_name
-- FROM recommendations_projection r
-- LEFT JOIN cards_projection c ON r.source_entity_type = 'card' AND r.source_entity_id = c.card_id
-- LEFT JOIN sparks_projection s ON r.source_entity_type = 'spark' AND r.source_entity_id = s.spark_id
-- LEFT JOIN tasks_projection t ON r.source_entity_type = 'task' AND r.source_entity_id = t.task_id;
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

-- ----------------------------------------------------------------------------
-- G6: patches_projection - personal software modification lifecycle
-- 6-state status machine: proposed → validated → active → (needs_revalidation/reverted/superseded)
-- Environment health monitoring (4-state)
-- Append-only revert semantics (never delete/overwrite)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patches_projection (
    patch_id TEXT PRIMARY KEY,                   -- ULID, unique patch identifier
    title TEXT NOT NULL,                         -- human-readable patch title
    description TEXT,                            -- detailed description of the modification
    patch_body_json TEXT NOT NULL,               -- actual patch content (JSON-encoded diff/instructions)
    patch_status TEXT DEFAULT 'proposed'         -- current status in 6-state machine
        CHECK(patch_status IN ('proposed', 'validated', 'active', 'needs_revalidation', 'reverted', 'superseded')),
    environment_health TEXT DEFAULT 'healthy'    -- runtime environment health status
        CHECK(environment_health IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
    source_ref TEXT,                             -- ULID of source reference (recommendation/task)
    validated_by TEXT,                           -- who validated (agent name or user)
    validated_at TEXT,                           -- ISO8601 validation timestamp
    activated_at TEXT,                           -- ISO8601 activation timestamp
    reverted_at TEXT,                            -- ISO8601 revert timestamp (append-only)
    superseded_by TEXT,                          -- patch_id that superseded this one
    validation_notes_json TEXT,                  -- JSON array of validation notes
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    CHECK (patch_id IS NOT NULL AND patch_id != ''),
    CHECK (title IS NOT NULL AND title != ''),
    CHECK (patch_body_json IS NOT NULL AND patch_body_json != '')
);

-- G6: Primary query indexes for patches_projection (7+ indexes)
CREATE INDEX IF NOT EXISTS idx_patches_status ON patches_projection(patch_status);
CREATE INDEX IF NOT EXISTS idx_patches_env_health ON patches_projection(environment_health);
CREATE INDEX IF NOT EXISTS idx_patches_source ON patches_projection(source_ref);
CREATE INDEX IF NOT EXISTS idx_patches_validated_at ON patches_projection(validated_at);
CREATE INDEX IF NOT EXISTS idx_patches_activated_at ON patches_projection(activated_at);
CREATE INDEX IF NOT EXISTS idx_patches_created_at ON patches_projection(created_at);
CREATE INDEX IF NOT EXISTS idx_patches_superseded_by ON patches_projection(superseded_by);
CREATE INDEX IF NOT EXISTS idx_patches_updated_at ON patches_projection(updated_at);

-- ----------------------------------------------------------------------------
-- G6: patch_environment_projections - file-level impact tracking per patch
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patch_environment_projections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patch_id TEXT NOT NULL REFERENCES patches_projection(patch_id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,                     -- affected file path
    action TEXT NOT NULL                         -- type of file modification
        CHECK(action IN ('create', 'modify', 'delete')),
    before_hash TEXT,                            -- SHA-256 of file content before
    after_hash TEXT,                             -- SHA-256 of file content after
    before_content_text TEXT,                    -- original content (for quick diff)
    after_content_text TEXT,                     -- new content (for quick diff)
    dependency_level INTEGER DEFAULT 0,          -- dependency ordering level
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patch_env_patch_id ON patch_environment_projections(patch_id);
CREATE INDEX IF NOT EXISTS idx_patch_env_file_path ON patch_environment_projections(file_path);

-- ----------------------------------------------------------------------------
-- G3 (phase 3): adapter_commands - persistent Surface -> Adapter command queue
-- Companion is the durable queue; WS /ws/adapter-wake only signals
-- "command available" (no business data), chrome.alarms is the recovery net.
-- Status machine: queued -> delivered -> done|failed, or -> expired (timeout).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adapter_commands (
    command_id TEXT PRIMARY KEY,                 -- ULID, unique command identifier
    kind TEXT NOT NULL,                          -- read-conversation | send-card | list-conversations | read-by-id
    payload_json TEXT,                           -- JSON payload for the command
    status TEXT NOT NULL DEFAULT 'queued'        -- queue lifecycle status
        CHECK (status IN ('queued', 'delivered', 'done', 'failed', 'expired')),
    result_json TEXT,                            -- adapter-reported result or error (JSON)
    timeout_ms INTEGER,                          -- optional expiry window from created_at
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    CHECK (command_id IS NOT NULL AND command_id != ''),
    CHECK (kind IN ('read-conversation', 'send-card', 'list-conversations', 'read-by-id'))
);

CREATE INDEX IF NOT EXISTS idx_adapter_commands_status ON adapter_commands(status);
CREATE INDEX IF NOT EXISTS idx_adapter_commands_created_at ON adapter_commands(created_at);

-- ----------------------------------------------------------------------------
-- G4 (phase 4): ai_cards - AI digest card projections
-- Produced by AI归纳 from OBSERVE_AND_ARCHIVE conversations.
-- Attribution four-state machine (forward-only, same as materials_projection).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_cards (
    card_id TEXT PRIMARY KEY,                    -- ULID, unique card identifier
    title TEXT NOT NULL,                         -- card title (≤40 chars)
    summary TEXT NOT NULL,                       -- card summary (100-300 chars)
    evidence_json TEXT NOT NULL,                 -- JSON array of evidence strings
    boundary_inherit TEXT NOT NULL,              -- inherited boundary state from source
    source_conversation TEXT NOT NULL,           -- source conversation source_id
    source_event_ids TEXT,                       -- JSON array of source event_ids
    markdown_body TEXT,                          -- human-readable Markdown version
    json_body TEXT,                              -- structured JSON version
    attribution_state TEXT NOT NULL DEFAULT 'ai_proposed', -- four-state machine
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    CHECK (card_id IS NOT NULL AND card_id != ''),
    CHECK (title IS NOT NULL AND title != ''),
    CHECK (summary IS NOT NULL AND summary != ''),
    CHECK (boundary_inherit IN ('NOT_OBSERVE', 'OBSERVE_CURRENT_ONLY', 'OBSERVE_AND_ARCHIVE'))
);

CREATE INDEX IF NOT EXISTS idx_ai_cards_attribution_state ON ai_cards(attribution_state);
CREATE INDEX IF NOT EXISTS idx_ai_cards_source_conversation ON ai_cards(source_conversation);
CREATE INDEX IF NOT EXISTS idx_ai_cards_created_at ON ai_cards(created_at);

-- ----------------------------------------------------------------------------
-- G4 (phase 4): ai_maintenance_tasks - AI digest maintenance task projections
-- Produced by AI归纳 from OBSERVE_AND_ARCHIVE conversations.
-- Attribution four-state machine (forward-only).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_maintenance_tasks (
    task_id TEXT PRIMARY KEY,                    -- ULID, unique task identifier
    task TEXT NOT NULL,                          -- task description (actionable)
    criteria_json TEXT NOT NULL,                 -- JSON array of acceptance criteria
    risk TEXT,                                   -- risk description
    rollback_plan TEXT,                          -- rollback plan
    priority INTEGER NOT NULL DEFAULT 5,         -- 1 (highest) to 9 (lowest)
    boundary_inherit TEXT NOT NULL,              -- inherited boundary state from source
    source_conversation TEXT NOT NULL,           -- source conversation source_id
    source_event_ids TEXT,                       -- JSON array of source event_ids
    markdown_body TEXT,                          -- human-readable Markdown version
    json_body TEXT,                              -- structured JSON version
    attribution_state TEXT NOT NULL DEFAULT 'ai_proposed', -- four-state machine
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    CHECK (task_id IS NOT NULL AND task_id != ''),
    CHECK (task IS NOT NULL AND task != ''),
    CHECK (priority >= 1 AND priority <= 9),
    CHECK (boundary_inherit IN ('NOT_OBSERVE', 'OBSERVE_CURRENT_ONLY', 'OBSERVE_AND_ARCHIVE'))
);

CREATE INDEX IF NOT EXISTS idx_ai_maintenance_tasks_attribution_state ON ai_maintenance_tasks(attribution_state);
CREATE INDEX IF NOT EXISTS idx_ai_maintenance_tasks_source_conversation ON ai_maintenance_tasks(source_conversation);
CREATE INDEX IF NOT EXISTS idx_ai_maintenance_tasks_priority ON ai_maintenance_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_ai_maintenance_tasks_created_at ON ai_maintenance_tasks(created_at);

-- ----------------------------------------------------------------------------
-- G4 (phase 4): digest_jobs - AI digest job queue (in-memory + SQLite persistence)
-- Status: queued -> running -> done | failed
-- Idempotent by conversation_id: only one non-terminal job per conversation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS digest_jobs (
    job_id TEXT PRIMARY KEY,                     -- ULID, unique job identifier
    conversation_id TEXT NOT NULL,               -- source conversation source_id
    event_ids_json TEXT,                         -- JSON array of source event_ids
    status TEXT NOT NULL DEFAULT 'queued',       -- queued | running | done | failed
    source_level TEXT,                           -- api | local | opencode | none
    error_message TEXT,                          -- failure reason (if failed)
    products_json TEXT,                          -- JSON array of produced product IDs
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    CHECK (job_id IS NOT NULL AND job_id != ''),
    CHECK (conversation_id IS NOT NULL AND conversation_id != ''),
    CHECK (status IN ('queued', 'running', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_digest_jobs_status ON digest_jobs(status);
CREATE INDEX IF NOT EXISTS idx_digest_jobs_conversation_id ON digest_jobs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_digest_jobs_created_at ON digest_jobs(created_at);
