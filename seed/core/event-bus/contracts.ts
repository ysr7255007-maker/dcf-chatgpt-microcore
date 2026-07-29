#!/usr/bin/env node

/**
 * seed/core/event-bus/contracts.ts — Event Contracts (TypeScript version)
 *
 * Event register is the contract for events. Each event name maps to a Zod schema.
 * This file is the authoritative spec; contracts.js provides runtime validation.
 */

import { z } from 'zod';

export const EventType = {
    // Import lifecycle
    ImportStarted: 'import.started',
    ImportProgress: 'import.progress',
    ImportCompleted: 'import.completed',
    
    // Query lifecycle
    QueryExecuted: 'query.executed',
    
    // Generation lifecycle
    GenerationRequested: 'generation.requested',
    GenerationInProgress: 'generation.in_progress',
    GenerationCompleted: 'generation.completed',
    GenerationFailed: 'generation.failed',
    
    // Artifact lifecycle
    ArtifactCreated: 'artifact.created',
    ArtifactUpdated: 'artifact.updated',
    
    // Health & monitoring
    HealthReported: 'health.reported',
    
    // Debug & diagnostics
    DebugLog: 'debug.log'
} as const;

// ============================================================================
// Event Schemas (the contract for each event type)
// ============================================================================

export const EventContractsSchema = {
    'import.started':      z.object({ intent: z.record(z.any()) }),
    'import.progress':     z.object({ processed: z.number().int(), total: z.number().int() }),
    'import.completed':    z.object({ 
        result: z.object({
            imported: z.number().int().min(0),
            duplicatesSkipped: z.number().int().min(0),
            failed: z.number().int().min(0)
        })
    }),
    
    'query.executed':      z.object({ 
        intent: z.record(z.any()),
        resultCount: z.number().int().min(0),
        latencyMs: z.number().nonnegative()
    }),
    
    'generation.requested':z.object({ kind: z.enum(['card','task']), task_id: z.string() }),
    'generation.in_progress': z.object({ task_id: z.string() }),
    'generation.completed': z.object({ 
        kind: z.enum(['card','task']),
        task_id: z.string(),
        output_path: z.string().optional()
    }),
    'generation.failed':   z.object({ 
        kind: z.enum(['card','task']),
        task_id: z.string(),
        error: z.string()
    }),
    
    'artifact.created':    z.object({ artifact_id: z.string(), type: z.string() }),
    'artifact.updated':    z.object({ artifact_id: z.string(), changes: z.record(z.boolean()) }),
    
    'health.reported':     z.object({ track: z.string(), status: z.enum(['ok','degraded','error']) }),
    
    'debug.log':           z.object({ 
        message: z.string(),
        context: z.record(z.any()).optional()
    })
};

// Export type helpers
type EventTypeValue = typeof EventType[keyof typeof EventType];
type ContractByName = typeof EventContractsSchema[EventTypeValue];
export type ParsedEvent<E extends EventTypeValue> = z.infer<ContractByName>;
