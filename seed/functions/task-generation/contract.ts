/**
 * seed/functions/task-generation/contract.ts — Task Generation Contract
 */

import { z } from 'zod';

export const GenerationIntentSchema = z.object({
    kind: z.enum(['card', 'task']),
    prompt: z.string().max(10000),
    sourceIds: z.array(z.string()).optional(),
    limit: z.number().int().min(3).max(30).default(15),
    ide: z.string().optional()
});

export type GenerationIntent = z.infer<typeof GenerationIntentSchema>;

export const GenerationProductSchema = z.object({
    type: z.string(),
    title: z.string(),
    summary: z.string().optional(),
    evidence: z.array(z.string()).optional(),
    boundary_inherit: z.enum(['OBSERVE_CURRENT_ONLY']).optional(),
    source_conversation: z.string().optional()
});

export const GenerationRequestResultSchema = z.object({
    ok: z.boolean(),
    data: z.object({
        task_id: z.string(),
        mode: z.string(),
        ide: z.string(),
        ide_name: z.string(),
        conversations_included: z.number(),
        clipboard: z.string().optional(),
        deeplink_ok: z.boolean().optional(),
        autosubmit: z.boolean().optional()
    })
});

export const GenerationResponseSchema = z.object({
    task_id: z.string(),
    status: z.enum(['dispatched', 'completed', 'failed', 'unknown']),
    session_id: z.string().nullable(),
    output_path: z.string().optional(),
    created_at: z.date().optional(),
    error: z.string().nullable()
});
