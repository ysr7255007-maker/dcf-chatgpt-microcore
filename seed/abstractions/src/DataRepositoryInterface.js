/**
 * DataRepositoryInterface - L2 Interface Definition
 * 
 * Central database access abstraction. All CRUD operations go through this interface.
 * This enforces the principle that Infrastructure Layer (L3) implementations
 * are hidden from Domains Layer (L4).
 */

class BaseDataRepository {
    constructor() {
        if (this.constructor === BaseDataRepository) {
            throw new Error('Not implemented');
        }
    }
    
    /**
     * Insert a conversation record
     * @param {Object} conversation - Normalized conversation data
     * @returns {Promise<string>} Inserted record ID
     */
    async insertConversation(conversation) {
        throw new Error('Not implemented');
    }
    
    /**
     * Query conversations by various filters
     * @param {Object} options
     * @param {Date|string} [options.since] - Filter by created_at
     * @param {string[]} [options.sourceTypes] - Filter by source_type
     * @param {boolean} [options.onlyStarred] - Only starred conversations
     * @param {number} [options.limit=50] - Limit results
     * @param {string} [options.orderBy='created_at'] - Sort field
     * @param {string} [options.orderDesc=true] - Descending order
     * @returns {Promise<Array<Object>>} Matching conversations
     */
    async queryConversations(options = {}) {
        throw new Error('Not implemented');
    }
    
    /**
     * Check if conversation exists (by triple key or content hash)
     * @param {Object} criteria
     * @param {string} criteria.sourceType
     * @param {string} criteria.sourceName
     * @param {string} [criteria.sourceId]
     * @param {string} [criteria.contentHash]
     * @returns {Promise<boolean>} True if exists
     */
    async conversationExists(criteria) {
        throw new Error('Not implemented');
    }
    
    /**
     * Get conversation by ID
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getConversationById(id) {
        throw new Error('Not implemented');
    }
    
    /**
     * Update conversation metadata
     * @param {string} id
     * @param {Object} updates
     * @returns {Promise<void>}
     */
    async updateConversationMetadata(id, updates) {
        throw new Error('Not implemented');
    }
    
    /**
     * Insert artifact (card/task/ammo)
     * @param {Object} artifact
     * @returns {Promise<string>} Artifact ID
     */
    async insertArtifact(artifact) {
        throw new Error('Not implemented');
    }
    
    /**
     * Get artifacts for a conversation
     * @param {string} conversationId
     * @param {string} [type] - Optional type filter
     * @returns {Promise<Array<Object>>}
     */
    async getArtifactsForConversation(conversationId, type = null) {
        throw new Error('Not implemented');
    }
    
    /**
     * Log duplicate detection trail
     * @param {Object} entry
     * @param {string} entry.primaryId
     * @param {string} entry.duplicateId
     * @param {string} entry.resolutionMethod
     * @param {string} [entry.notes]
     * @returns {Promise<void>}
     */
    async logDuplicateTrail(entry) {
        throw new Error('Not implemented');
    }
    
    /**
     * Close database connection
     * @returns {Promise<void>}
     */
    async close() {
        throw new Error('Not implemented');
    }
}

module.exports = BaseDataRepository;
