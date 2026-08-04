/**
 * Type Definitions - L2 Utility Types
 * 
 * Shared type definitions used across the architecture.
 * These are JavaScript objects/constructors, not TypeScript interfaces.
 */

const SourceInfo = require('./DataSourceAdapterInterface').SourceInfo;
const DataRecord = require('./DataSourceAdapterInterface').DataRecord;

/**
 * ImportResult - Result of a single import operation
 */
const ImportResult = class ImportResult {
    constructor({ success, id, error, duplicate, merged }) {
        this.success = success || false;
        this.id = id || null;
        this.error = error || null;
        this.duplicate = duplicate || false;
        this.merged = merged || false;
    }
};

/**
 * ImportStats - Statistics for bulk import operations
 */
const ImportStats = class ImportStats {
    constructor() {
        this.totalProcessed = 0;
        this.successful = 0;
        this.failed = 0;
        this.duplicatesSkipped = 0;
        this.duplicatesMerged = 0;
    }
};

module.exports = {
    SourceInfo,
    DataRecord,
    ImportResult,
    ImportStats,
};
