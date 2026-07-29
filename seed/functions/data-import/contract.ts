/**
 * seed/functions/data-import/contract.ts — DCF Data Import Contract
 * 
 * Design Principle:
 *   - Type-driven: Zod schema + TS types are the AI validator; illegal states cannot be represented
 *   - Hard boundary: This is the single source of truth for input/output validation
 *   - Executable spec: Run-time checkable via generated contract.js (dual-file to avoid build step)
 * 
 * Usage in companion/index.js (entry/exit dual-check):
 *   import { ImportIntentSchema, ImportResultSchema } from './functions/data-import/contract';
 *   const intent = ImportIntentSchema.parse(requestBody);       // Entry validation
 *   const result = await dataImportFn.fullImport(intent);
 *   return sendJSON(res, ImportResultSchema.parse(result));      // Exit validation
 */

import { z } from 'zod';

// ============================================================================
// Import Intent Schema (input validation)
// ============================================================================

export const ImportIntentSchema = z.object({
    /**
     * Which data sources to import from
     * @default ['cli-tool', 'web-extension']
     */
    sourceTypes: z.array(z.enum(['cli-tool', 'web-extension', 'manual-import', 'deeplink-draft'])).optional(),
    
    /**
     * Number of recent rounds to consider per source (bounded to prevent abuse)
     * @default 20
     * @min 1
     * @max 200
     */
    recentRounds: z.number().int().min(1).max(200).default(20),
    
    /**
     * Optional date range filter
     */
    dateRange: z.object({
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional()
    }).optional(),
    
    /**
     * Additional filters
     */
    filters: z.object({
        keyword: z.string().optional(),
        minTurns: z.number().int().min(0).optional(),
        excludeGenerated: z.boolean().default(true)
    }).default({ excludeGenerated: true })
});

export type ImportIntent = z.infer<typeof ImportIntentSchema>;

export const IncrementalScanIntentSchema = z.object({
    lastImportTime: z.string().datetime().optional()
});

export type IncrementalScanIntent = z.infer<typeof IncrementalScanIntentSchema>;


// ============================================================================
// Import Result Schema (output validation)
// ============================================================================

export const ImportResultSchema = z.object({
    /**
     * Number of conversations successfully imported
     */
    imported: z.number().int().min(0),
    
    /**
     * Number of duplicates skipped
     */
    duplicatesSkipped: z.number().int().min(0),
    
    /**
     * Number of imports that failed
     */
    failed: z.number().int().min(0)
});

export type ImportResult = z.infer<typeof ImportResultSchema>;


export const ScanResultSchema = z.object({
    imported: z.number().int().min(0),
    skipped: z.number().int().min(0),
    failed: z.number().int().min(0)
});

export type ScanResult = z.infer<typeof ScanResultSchema>;

// ============================================================================
// Conversation Record Schema (used internally, exported for type consistency)
// ============================================================================

export const ConversationRecordSchema = z.object({
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

export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;


// ============================================================================
// Adapter Interface Contract (for any new adapters)
// ============================================================================

export const AdapterMetadataSchema = z.object({
    type: z.string(),
    name: z.string(),
    sourceName: z.string(),
    sourceId: z.string().nullable().optional()
});

export type AdapterMetadata = z.infer<typeof AdapterMetadataSchema>;
