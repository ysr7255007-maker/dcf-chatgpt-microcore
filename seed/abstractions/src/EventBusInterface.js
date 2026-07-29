/**
 * EventBusInterface - L2 Interface Definition
 * 
 * Domain event bus for decoupled communication between layers.
 * Enables Event-Driven Architecture pattern implementation.
 */

class BaseEventBus {
    constructor() {
        if (this.constructor === BaseEventBus) {
            throw new Error('Not implemented');
        }
    }
    
    /**
     * Subscribe to an event type
     * @param {string} eventType
     * @param {Function} handler
     * @returns {Function} Unsubscribe function
     */
    on(eventType, handler) {
        throw new Error('Not implemented');
    }
    
    /**
     * Publish event to all subscribers
     * @param {string} eventType
     * @param {Object} payload
     * @returns {Promise<void>}
     */
    async publish(eventType, payload) {
        throw new Error('Not implemented');
    }
    
    /**
     * Clear all subscribers (for testing/cleanup)
     */
    clear() {
        throw new Error('Not implemented');
    }
}

// Standard event types
BaseEventBus.EventType = {
    CONVERSATION_IMPORTED: 'conversation.imported',
    CONVERSATION_GENERATED: 'conversation.generated',
    ARTifact_CREATED: 'artifact.created',
    IMPORT_JOB_STARTED: 'import.job.started',
    IMPORT_JOB_COMPLETED: 'import.job.completed',
};

module.exports = BaseEventBus;
