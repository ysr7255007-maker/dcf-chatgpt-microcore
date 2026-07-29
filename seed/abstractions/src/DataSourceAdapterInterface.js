/**
 * DataSourceAdapterInterface - L2 Interface Definition
 * 
 * All external data source adapters MUST implement these methods.
 * This is the cornerstone of L1 Interfaces Layer.
 * 
 * Implementation Contract:
 * 1. Every adapter must provide: detectPresence(), listSources(), fetchItem()
 * 2. Each adapter implements ONE specific data source only
 * 3. No cross-dependency between adapters
 * 4. All methods are async and return Promises
 * 
 * Usage Pattern:
 * ```javascript
 * const MyAdapter = require('./my-adapter');
 * class MyAdapter extends BaseAdapter {} // OR just implement same methods
 * ```
 */

class BaseDataSourceAdapter {
    constructor(name, type) {
        /** @type {string} - Adapter unique identifier */
        this.name = name;
        
        /** @type {string} - Source category */
        this.type = type;
    }
    
    /**
     * @abstract
     * @returns {Promise<boolean>}
     */
    async detectPresence() {
        throw new Error('Not implemented: detectPresence()');
    }
    
    /**
     * @abstract
     * @param {Object} options
     * @param {number} [options.limit=100]
     * @param {Date} [options.since=null]
     * @returns {Promise<Array<SourceInfo>>}
     */
    async listSources(options = {}) {
        throw new Error('Not implemented: listSources()');
    }
    
    /**
     * @abstract
     * @param {string} id
     * @returns {Promise<DataRecord>}
     */
    async fetchItem(id) {
        throw new Error('Not implemented: fetchItem()');
    }
    
    /**
     * Optional cleanup method
     */
    async close() {
        // No-op by default
    }
}

/**
 * SourceInfo - Metadata for listing data sources
 * @constructor
 */
BaseDataSourceAdapter.SourceInfo = function SourceInfo(id, name, createdAt, updatedAt, metadata = {}) {
    this.id = id;
    this.name = name || 'Untitled';
    this.createdAt = new Date(createdAt);
    this.updatedAt = new Date(updatedAt);
    this.metadata = metadata || {};
};

/**
 * DataRecord - Normalized conversation data record
 * @constructor
 */
BaseDataSourceAdapter.DataRecord = function DataRecord(data) {
    Object.assign(this, data);
};

module.exports = BaseDataSourceAdapter;
