#!/usr/bin/env node

/**
 * seed/functions/data-import/service.js — Data Import Service Orchestration
 * 
 * Design Principles:
 *   - 编排模式：协调 adapters、repository 完成完整导入流程
 *   - 复杂度消解：查重走 SQL 集合运算（insertConversationBatch），无 per-record 往返
 *   - 事件驱动：完成时发布 `import.completed` 事件供其他模块订阅（旁路）
 * 
 * Dependencies (allowed):
 *   - core/event-bus (publish events, schema-enforced)
 *   - core/repository (DB access, set-based dedup)
 *   - ./adapters/* (private adapters only)
 * 
 * Usage:
 *   const { dataImportService } = require('./service');
 *   await dataImportService.initialize({ repo, eventBus });
 *   const result = await dataImportService.fullImport(intent);
 */

const path = require('path');
const fs = require('fs');

// Load adapters (private dependency)
const ClaudeCodeAdapter = require('./adapters/ClaudeCodeAdapter');
const CodexAdapter = require('./adapters/CodexAdapter');
const OpenCodeAdapter = require('./adapters/OpenCodeAdapter');
const CursorAdapter = require('./adapters/CursorAdapter');
const GeminiCLIAdapter = require('./adapters/GeminiCLIAdapter');
const AiderAdapter = require('./adapters/AiderAdapter');

class DataImportService {
    constructor() {
        this.repository = null;
        this.eventBus = null;
        this.initialized = false;
        this.adapters = new Map();
    }

    /**
     * Initialize with core dependencies (组合根注入)
     */
    async initialize({ repo, eventBus }) {
        this.repository = repo;
        this.eventBus = eventBus;
        
        // Lazy-load adapters to avoid circular dependencies
        const adapterClasses = [
            ClaudeCodeAdapter,
            CodexAdapter,
            OpenCodeAdapter,
            CursorAdapter,
            GeminiCLIAdapter,
            AiderAdapter
        ];
        for (const AdapterClass of adapterClasses) {
            try {
                const adapter = new AdapterClass();
                if (await adapter.detectPresence()) {
                    this.registerAdapter(adapter.sourceName, adapter);
                    console.log(`[DataImportService] Registered ${adapter.sourceName} adapter`);
                } else {
                    console.log(`[DataImportService] Not present: ${adapter.name}`);
                }
            } catch (err) {
                console.warn(`[DataImportService] Failed to register ${AdapterClass.name}:`, err.message);
            }
        }

        this.initialized = true;
        console.log(`[DataImportService] Initialized with ${this.adapters.size} adapter(s)`);
    }

    /**
     * Register a custom adapter
     */
    registerAdapter(type, adapter) {
        if (!adapter.detectPresence || !adapter.listSources || !adapter.fetchConversation) {
            throw new Error(`Adapter for ${type} must implement detectPresence/listSources/fetchConversation`);
        }
        this.adapters.set(type, adapter);
    }

    /**
     * Full initial import from all registered sources (集合运算查重)
     */
    async fullImport(intent) {
        if (!this.initialized) {
            throw new Error('DataImportService not initialized');
        }

        const { sourceTypes, recentRounds, dateRange, filters } = intent;
        
        console.log(`[DataImportService] Starting fullImport: recentRounds=${recentRounds}, dateRange=${JSON.stringify(dateRange)}, filters=${JSON.stringify(filters)}`);
        
        // Publish start event（旁路）
        this._publishEvent('import.started', { intent });

        // Step 1: 从 adapters 收集 records（fetch 失败计 failed）
        const allRecords = [];
        let failedCount = 0;

        // sourceTypes 是类型类别（cli-tool/web-extension/...），adapters 按 sourceName 注册；
        // 选择：未指定 → 全部；指定 → adapter.type 属于所选类别的全部 adapter
        const requestedTypes = sourceTypes && sourceTypes.length > 0 ? new Set(sourceTypes) : null;
        const adaptersToProcess = [...this.adapters.entries()]
            .filter(([, adapter]) => !requestedTypes || requestedTypes.has(adapter.type));
        
        for (const [sourceName, adapter] of adaptersToProcess) {
            try {
                await adapter.initialize();
                const sources = await adapter.listSources({ limit: recentRounds, since: dateRange?.start });
                
                console.log(`[DataImportService] Processing ${sources.length} sessions from ${adapter.name}...`);
                
                for (const src of sources) {
                    try {
                        const record = await adapter.fetchConversation(src.id);
                        allRecords.push(record);
                    } catch (err) {
                        console.error(`[DataImportService] Failed to fetch conversation ${src.id}:`, err.message);
                        failedCount++;
                    }
                }
                
                await adapter.close();
            } catch (err) {
                console.error(`[DataImportService] Failed to process source ${sourceName}:`, err.message);
                failedCount++;
            }
        }

        // Step 2: 一次集合运算批量入库（SQL 反连接查重）
        const result = await this.repository.conversations.insertConversationBatch(allRecords, filters);
        
        const stats = {
            imported: result.inserted,
            duplicatesSkipped: result.duplicatesSkipped,
            failed: failedCount
        };

        console.log(`[DataImportService] Import complete. Stats:`, stats);
        
        // Publish completion event（旁路，payload 过 schema）
        this._publishEvent('import.completed', { result: stats });
        
        return stats;
    }

    /**
     * Incremental scan (detect new conversations since last import)
     */
    async incrementalScan(lastImportTime = null) {
        if (!this.initialized) {
            throw new Error('DataImportService not initialized');
        }

        console.log('[DataImportService] Starting incremental scan since:', lastImportTime);
        
        const allRecords = [];
        let failedCount = 0;
        
        for (const [type, adapter] of this.adapters) {
            try {
                await adapter.initialize();
                const sources = await adapter.listSources({ limit: 100 });
                
                const newOnes = sources.filter(src => {
                    if (!lastImportTime) return true;
                    const srcDate = new Date(src.createdAt);
                    const lastDate = new Date(lastImportTime);
                    return srcDate > lastDate;
                });
                
                for (const src of newOnes) {
                    try {
                        const record = await adapter.fetchConversation(src.id);
                        allRecords.push(record);
                    } catch (err) {
                        console.error(`[DataImportService] Failed to fetch ${src.id}:`, err.message);
                        failedCount++;
                    }
                }
            } catch (err) {
                console.error(`[DataImportService] Incremental scan failed for ${type}:`, err.message);
                failedCount++;
            }
        }
        
        console.log('[DataImportService] Found', allRecords.length, 'new records');
        
        const result = await this.repository.conversations.insertConversationBatch(allRecords, {});
        
        const stats = {
            imported: result.inserted,
            skipped: result.duplicatesSkipped,
            failed: failedCount
        };
        
        return stats;
    }

    /**
     * Internal: publish event to event bus (schema-enforced, 旁路)
     */
    _publishEvent(eventType, payload) {
        try {
            if (this.eventBus) {
                this.eventBus.publish(eventType, payload);
            }
        } catch (err) {
            // 事件是旁路，schema 校验失败不阻断主流程
            console.debug('[DataImportService] Event bus unavailable or schema violation:', err.message);
        }
    }

    /**
     * Close all adapter connections
     */
    async close() {
        for (const [type, adapter] of this.adapters) {
            try {
                await adapter.close();
            } catch (err) {
                console.warn(`[DataImportService] Failed to close adapter ${type}:`, err.message);
            }
        }
    }
}

// Export singleton instance
const dataImportService = new DataImportService();

module.exports = {
    dataImportService
};
