/**
 * ConversationQueryAPI - L2 Interface Definition
 * 
 * Defines the query interface for conversations domain.
 * Implemented by Domain Layer services, queried via Service Layer.
 */

class BaseConversationQueryAPI {
    constructor() {
        if (this.constructor === BaseConversationQueryAPI) {
            throw new Error('Not implemented');
        }
    }
    
    /**
     * Get recent conversations (for incremental generation)
     * @param {Object} options
     * @param {number} [options.limit=20] - Number of conversations
     * @param {boolean} [options.includeAlreadyGenerated=false] - Include if already has artifacts
     * @param {Date|string} [options.since] - Only newer than this
     * @param {string[]} [options.sourceTypes] - Filter by data source type
     * @returns {Promise<Array<Object>>}
     */
    async getRecentConversations(options = {}) {
        throw new Error('Not implemented');
    }
    
    /**
     * Query conversations by date range
     * @param {Object} options
     * @param {Date|string} options.start
     * @param {Date|string} options.end
     * @param {string[]} [options.sourceTypes]
     * @param {string} [options.keyword] - FTS5 search term
     * @returns {Promise<Array<Object>>}
     */
    async queryByDateRange(options) {
        throw new Error('Not implemented');
    }
    
    /**
     * Get starred conversations only
     * @param {number} limit
     * @returns {Promise<Array<Object>>}
     */
    async getStarredConversations(limit = 50) {
        throw new Error('Not implemented');
    }
    
    /**
     * Search conversations by keyword (FTS5)
     * @param {string} keyword
     * @param {number} limit
     * @returns {Promise<Array<Object>>}
     */
    async searchByKeyword(keyword, limit = 100) {
        throw new Error('Not implemented');
    }
    
    /**
     * Get conversations grouped by topic cluster
     * @param {string} [topicId] - Optional filter
     * @returns {Promise<Array<{clusterId: string, count: number, conversations: Array}>>>}
     */
    async groupByTopicCluster(topicId = null) {
        throw new Error('Not implemented');
    }
    
    /**
     * Get conversation statistics (for analytics)
     * @returns {Promise<Object>} Stats object
     */
    async getStatistics() {
        throw new Error('Not implemented');
    }
}

module.exports = BaseConversationQueryAPI;
