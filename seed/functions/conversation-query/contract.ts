/**
 * seed/functions/conversation-query/contract.ts — Conversation Query Contract
 */

import { z } from 'zod';

export const ConversationQueryIntentSchema = z.object({
    recentRounds: z.number().int().min(1).max(200).default(50),
    dateRange: z.object({
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional()
    }).optional(),
    sourceTypes: z.array(z.enum(['cli-tool', 'web-extension', 'manual-import', 'deeplink-draft'])).optional(),
    keyword: z.string().optional(),
    minTurns: z.number().int().min(0).optional(),
    isStarred: z.boolean().optional(),
    excludeGenerated: z.boolean().default(true)
});

export type ConversationQueryIntent = z.infer<typeof ConversationQueryIntentSchema>;

export const ConversationResultSchema = z.array(z.object({
    id: z.string(),
    version: z.number(),
    title: z.string(),
    summary: z.string().nullable(),
    first_message_text: z.string(),
    last_message_text: z.string().nullable(),
    total_turns: z.number(),
    user_turns: z.number(),
    ai_turns: z.number(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
    imported_at: z.coerce.date(),
    source_type: z.enum(['cli-tool', 'web-extension', 'manual-import', 'deeplink-draft']),
    source_name: z.string(),
    source_id: z.string().nullable(),
    source_origin: z.string().nullable(),
    metadata: z.string(),
    is_starred: z.boolean(),
    is_sensitive: z.boolean(),
    marked_as_duplicate: z.boolean(),
    exclusion_reason: z.string().nullable(),
    topic_cluster_id: z.string().nullable(),
    popularity_score: z.number(),
    content_hash: z.string().nullable()
}));

export type ConversationResult = z.infer<typeof ConversationResultSchema>;
