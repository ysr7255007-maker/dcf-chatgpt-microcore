#!/usr/bin/env node

/**
 * seed/core/event-bus/contracts.js — Runtime Zod Schema Mirror (event register)
 *
 * Event register is the contract for events. Each event name maps to a Zod schema.
 * Dual-file pattern: contracts.ts is the authoritative spec; this file provides
 * runtime validation without a build step. Both files stay in sync manually.
 */

const { z } = require('zod');

// ============================================================================
// Event Type Constants (same as contracts.ts, duplicated for JS runtime)
// ============================================================================

const EventType = {
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
};

// ============================================================================
// Event Schemas (the contract for each event type)
// ============================================================================

const EventContracts = {
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

// ============================================================================
// Event Bus (with schema enforcement)
// ============================================================================

class EventBus {
    constructor() {
        this._listeners = new Map(); // EventType → Set<fn(event)>
    }

    /**
     * Subscribe to an event type
     * @param {string} eventType - must be from EventType constant
     * @param {Function} handler - function(event: Object): void
     */
    on(eventType, handler) {
        if (!this._listeners.has(eventType)) {
            this._listeners.set(eventType, new Set());
        }
        this._listeners.get(eventType).add(handler);
    }

    /**
     * Unsubscribe from an event type
     * @param {string} eventType
     * @param {Function} handler
     */
    off(eventType, handler) {
        const set = this._listeners.get(eventType);
        if (set) {
            set.delete(handler);
            if (set.size === 0) {
                this._listeners.delete(eventType);
            }
        }
    }

    /**
     * Publish an event to all subscribers (schema-enforced)
     * @param {string} eventType - must be registered in EventContracts
     * @param {Object} [payload={}]
     * @throws {Error} if eventType not registered or payload fails schema
     */
    publish(eventType, payload = {}) {
        // Schema enforcement (the cage for events)
        const schema = EventContracts[eventType];
        if (!schema) {
            throw new Error(`Unregistered event type: ${eventType}`);
        }
        schema.parse(payload); // throws if payload invalid

        const listeners = this._listeners.get(eventType);
        if (listeners) {
            // Copy to avoid mutation during iteration
            Array.from(listeners).forEach(fn => {
                try {
                    fn(payload);
                } catch (err) {
                    console.error(`[EventBus] Handler error for ${eventType}:`, err.message);
                }
            });
        }
    }

    /**
     * Clear all listeners (for testing)
     */
    clear() {
        this._listeners.clear();
    }

    /**
     * Get listener count for an event type (for testing)
     * @param {string} eventType
     * @returns {number}
     */
    listenerCount(eventType) {
        return this._listeners.get(eventType)?.size || 0;
    }
}

// Export singleton instance
const bus = new EventBus();

module.exports = {
    bus,
    EventType,
    EventContracts
};
