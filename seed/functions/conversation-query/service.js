#!/usr/bin/env node

/**
 * seed/functions/conversation-query/service.js — Conversation Query Service
 */

class ConversationQueryService {
    constructor() {
        this.queryEngine = null;
        this.repository = null;
        this.initialized = false;
    }

    async initialize({ queryEngine, repository }) {
        this.queryEngine = queryEngine;
        this.repository = repository;
        this.initialized = true;
    }

    /**
     * Normalize a raw SQLite row to the contract shape:
     * SQLite stores DATETIME as ISO strings and BOOLEAN as 0/1.
     */
    _normalizeRow(row) {
        if (!row) return row;
        return {
            ...row,
            created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
            updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
            imported_at: row.imported_at instanceof Date ? row.imported_at : new Date(row.imported_at),
            is_starred: Boolean(row.is_starred),
            is_sensitive: Boolean(row.is_sensitive),
            marked_as_duplicate: Boolean(row.marked_as_duplicate)
        };
    }

    /**
     * Get recent conversations excluding generated artifacts
     */
    async getRecentExcludingGenerated(limit = 20) {
        const rows = await this.queryEngine.getAvailableConversations(limit);
        return rows.map(r => this._normalizeRow(r));
    }

    /**
     * Execute query intent (declarative SQL via QueryEngine)
     */
    async executeIntent(intent) {
        if (!this.initialized) {
            throw new Error('ConversationQueryService not initialized');
        }

        const results = await this.queryEngine.select(intent);
        return results.map(r => this._normalizeRow(r));
    }

    /**
     * Find by source triple key
     */
    async findBySource(sourceType, sourceName, sourceId) {
        return this.repository.conversations.findBySource(sourceType, sourceName, sourceId);
    }

    /**
     * Find by ID
     */
    async findById(id) {
        return this.repository.conversations.findById(id);
    }

    /**
     * Health check
     */
    async healthCheck() {
        return this.queryEngine.healthCheck();
    }
}

// Export singleton instance
const conversationQueryService = new ConversationQueryService();

module.exports = {
    conversationQueryService
};
