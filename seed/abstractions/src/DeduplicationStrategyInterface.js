/**
 * DeduplicationStrategyInterface - L2 Interface Definition
 * 
 * Encapsulates all deduplication logic, separated from the import flow.
 * Enables swapping strategies without changing core ingestion code.
 */

class BaseDeduplicationStrategy {
    constructor() {
        if (this.constructor === BaseDeduplicationStrategy) {
            throw new Error('Not implemented');
        }
    }
    
    /**
     * Check for exact duplicate using triple key (source_type, source_name, source_id)
     * @param {string} sourceType
     * @param {string} sourceName
     * @param {string} sourceId
     * @returns {Promise<{exists: boolean, primaryId?: string}>}
     */
    async checkExactDuplicate(sourceType, sourceName, sourceId) {
        throw new Error('Not implemented');
    }
    
    /**
     * Check for fuzzy duplicate using content hash
     * @param {string} contentHash
     * @returns {Promise<{exists: boolean, primaryId?: string, similarity?: number}>}
     */
    async checkFuzzyDuplicate(contentHash) {
        throw new Error('Not implemented');
    }
    
    /**
     * Resolve conflict when duplicates are detected
     * @param {Object} options
     * @param {string} options.primaryId
     * @param {string} options.duplicateId
     * @param {string} [options.resolutionMethod='latest-wins']
     * @param {string} [options.notes]
     * @returns {Promise<{result: 'keep-primary'|'keep-duplicate'|'merged', primaryId?: string}>}
     */
    async resolveConflict(options) {
        throw new Error('Not implemented');
    }
    
    /**
     * Log deduplication event for audit trail
     * @param {Object} entry
     * @returns {Promise<void>}
     */
    async logDetection(entry) {
        // No-op by default
    }
}

module.exports = BaseDeduplicationStrategy;
