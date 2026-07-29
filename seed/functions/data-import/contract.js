#!/usr/bin/env node

/**
 * seed/functions/data-import/contract.js — Runtime Zod Schema Mirror
 * 
 * Dual-file pattern: contract.ts is the authoritative spec; contract.js provides
 * runtime validation without a build step. Both files stay in sync manually.
 * 
 * Usage:
 *   const { ImportIntentSchema, ImportResultSchema } = require('./functions/data-import/contract');
 */

const { z } = require('zod');

// ============================================================================
// Import Intent Schema (input validation)
// ============================================================================

exports.ImportIntentSchema = z.object({
    sourceTypes: z.array(z.enum(['cli-tool', 'web-extension', 'manual-import', 'deeplink-draft'])).optional(),
    recentRounds: z.number().int().min(1).max(200).default(20),
    dateRange: z.object({
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional()
    }).optional(),
    filters: z.object({
        keyword: z.string().optional(),
        minTurns: z.number().int().min(0).optional(),
        excludeGenerated: z.boolean().default(true)
    }).default({ excludeGenerated: true })
});

exports.IncrementalScanIntentSchema = z.object({
    lastImportTime: z.string().datetime().optional()
});

// ============================================================================
// Import Result Schema (output validation)
// ============================================================================

exports.ImportResultSchema = z.object({
    imported: z.number().int().min(0),
    duplicatesSkipped: z.number().int().min(0),
    failed: z.number().int().min(0)
});

exports.ScanResultSchema = z.object({
    imported: z.number().int().min(0),
    skipped: z.number().int().min(0),
    failed: z.number().int().min(0)
});

exports.ConversationRecordSchema = z.object({
    id: z.string().min(1),
    version: z.number().int().min(1).default(1),
    title: z.string(),
    summary: z.string().nullable(),
    first_message_text: z.string(),
    last_message_text: z.string().nullable(),
    total_turns: z.number().int().min(0),
    user_turns: z.number().int().min(0),
    ai_turns: z.number().int().min(0),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
    imported_at: z.coerce.date(),
    source_type: z.enum(['cli-tool', 'web-extension', 'manual-import', 'deeplink-draft']),
    source_name: z.string(),
    source_id: z.string().nullable(),
    source_origin: z.string().nullable(),
    metadata: z.string().default('{}'),
    is_starred: z.boolean().default(false),
    is_sensitive: z.boolean().default(false),
    marked_as_duplicate: z.boolean().default(false),
    exclusion_reason: z.string().nullable(),
    topic_cluster_id: z.string().nullable(),
    popularity_score: z.number().min(0).default(0),
    content_hash: z.string().length(64).nullable()
});
