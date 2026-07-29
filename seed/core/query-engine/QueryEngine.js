#!/usr/bin/env node

/**
 * seed/core/query-engine/QueryEngine.js — Problem-Accelerated Declarative Querying
 * 
 * Design Principles:
 *   - 复杂度消解：筛选逻辑交给 SQL，不手写嵌套 JS 过滤
 *   - 声明式 API：intent → SQL 编译（两个方法，规划让渡 SQLite）
 *   - 参数化查询：防 SQL 注入，类型安全
 * 
 * Usage:
 *   const { queryEngine } = require('./query-engine');
 *   await queryEngine.initialize(repo);
 *   const results = await queryEngine.select({ recentRounds: 20, excludeGenerated: true });
 */

class QueryEngine {
    constructor() {
        this.repository = null;
        this.initialized = false;
    }

    /**
     * Initialize with repository instance
     */
    async initialize(repository) {
        this.repository = repository;
        this.initialized = true;
        console.log('[QueryEngine] Initialized with repository');
    }

    /**
     * 编译 intent 为 SQL（纯函数，无 planner 语义，规划让渡 SQLite）
     * @param {Object} intent
     * @returns {{ sql: string, params: Array }}
     */
    compile(intent = {}) {
        const {
            recentRounds,
            dateRange,
            sourceTypes,
            keyword,
            minTurns,
            isStarred,
            excludeGenerated,
            limit = 50
        } = intent;

        // Build WHERE conditions declaratively (params order matches placeholders)
        const conditions = ['c.marked_as_duplicate = 0'];
        const params = [];

        // Exclude artifacts (declarative SQL, not JS filtering)
        if (excludeGenerated !== false) {
            conditions.push('c.id NOT IN (SELECT DISTINCT conversation_id FROM artifacts)');
        }

        if (dateRange) {
            if (dateRange.start) {
                conditions.push('c.created_at >= ?');
                params.push(dateRange.start);
            }
            if (dateRange.end) {
                conditions.push('c.created_at <= ?');
                params.push(dateRange.end);
            }
        }

        if (sourceTypes && Array.isArray(sourceTypes) && sourceTypes.length > 0) {
            const placeholders = sourceTypes.map(() => '?').join(', ');
            conditions.push(`c.source_type IN (${placeholders})`);
            params.push(...sourceTypes);
        }

        if (keyword) {
            conditions.push('(c.title LIKE ? OR c.first_message_text LIKE ?)');
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        if (typeof minTurns === 'number') {
            conditions.push('c.total_turns >= ?');
            params.push(minTurns);
        }

        if (typeof isStarred === 'boolean') {
            conditions.push('c.is_starred = ?');
            params.push(isStarred ? 1 : 0);
        }

        // recentRounds 是 LIMIT 的语义化别名（问题体质：最近 N 轮）
        const effectiveLimit = recentRounds || limit;

        const sql = `SELECT c.* FROM conversations_v2 c WHERE ${conditions.join(' AND ')} ORDER BY c.created_at DESC LIMIT ?`;
        params.push(effectiveLimit);

        return { sql, params };
    }

    /**
     * 执行查询（编译后经 repo 执行，含事件发布用于 observability）
     */
    async select(intent = {}) {
        if (!this.initialized) {
            throw new Error('QueryEngine not initialized');
        }

        const { sql, params } = this.compile(intent);
        const startTime = Date.now();
        const results = await this.repository.executeSql(sql, params);
        const latency = Date.now() - startTime;

        // Publish event for observability（旁路副作用，不驱动主流程）
        this._publishQueryEvent(results, intent, latency);

        return results;
    }

    /**
     * Get available conversations (exclude artifact-linked)
     */
    async getAvailableConversations(limit = 200) {
        const { sql, params } = this.compile({ excludeGenerated: true, limit });
        return this.repository.executeSql(sql, params);
    }

    /**
     * Find by exact triple key
     */
    async findBySource(sourceType, sourceName, sourceId) {
        return this.repository.conversations.findBySource(sourceType, sourceName, sourceId);
    }

    /**
     * Find by ULID ID
     */
    async findById(id) {
        return this.repository.conversations.findById(id);
    }

    /**
     * Health check (delegates to repository.stats)
     */
    async healthCheck() {
        return this.repository.stats();
    }

    /**
     * Internal: publish query execution event for observability
     */
    _publishQueryEvent(results, intent, latency) {
        try {
            const { bus, EventType } = require('../event-bus/contracts.js');
            bus.publish(EventType.QueryExecuted, {
                intent,
                resultCount: results.length,
                latencyMs: latency
            });
        } catch (err) {
            // Non-fatal, log but don't propagate
            console.debug('[QueryEngine] Event bus unavailable:', err.message);
        }
    }
}

// Export singleton instance
const queryEngine = new QueryEngine();

module.exports = {
    queryEngine
};
