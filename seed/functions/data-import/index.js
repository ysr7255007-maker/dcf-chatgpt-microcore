#!/usr/bin/env node

/**
 * seed/functions/data-import/index.js — Data Import Public Entry Point
 * 
 * Design Principle:
 *   - 笼子长在边界上：机械包装每个 contract 方法（入口 InputSchema.parse、出口 OutputSchema.parse）
 *   - 不依赖 service 自觉——AI 把 service 重写成什么样都逃不出去
 * 
 * Usage (from companion/index.js):
 *   const { dataImportFn } = require('./functions/data-import');
 *   const validatedIntent = ImportIntentSchema.parse(requestBody);
 *   const result = await dataImportFn.fullImport(validatedIntent);
 */

const zod = require('zod');
const { dataImportService } = require('./service');
const { repo } = require('../../core/repository');
const { bus } = require('../../core/event-bus');

let initialized = false;

/**
 * Initialize the module with repository path（组合根注入模式）
 */
async function initialize(dbPath) {
    if (initialized) return;
    
    // Initialize core dependencies（注入实例，不构造）
    await repo.initialize(dbPath);
    await dataImportService.initialize({ repo, eventBus: bus });
    
    initialized = true;
    console.log('[data-import] Initialized');
}

/**
 * 机械包装层（笼子关闭的关键）
 * 数据驱动：对每个 contract 方法机械生成双 parse 包装
 */
const { ImportIntentSchema, ImportResultSchema, IncrementalScanIntentSchema, ScanResultSchema } = require('./contract.js');

const CONTRACT_METHODS = {
    fullImport:      { input: ImportIntentSchema,        output: ImportResultSchema },
    incrementalScan: { input: IncrementalScanIntentSchema, output: ScanResultSchema }
};

for (const [name, { input, output }] of Object.entries(CONTRACT_METHODS)) {
    module.exports[name] = async (args) => {
        if (!initialized) {
            throw new Error('data-import not initialized');
        }
        const parsed = input.parse(args);           // 入口校验（笼子）
        const result = await dataImportService[name](parsed);
        return output.parse(result);                 // 出口校验（笼子）
    };
}

/**
 * Register a custom adapter（透传到 service，用于测试注入与扩展）
 */
function registerAdapter(type, adapter) {
    dataImportService.registerAdapter(type, adapter);
}

/**
 * Close all connections
 */
async function shutdown() {
    await dataImportService.close();
    if (repo.db) {
        await repo.close();
    }
    initialized = false;
    console.log('[data-import] Shutdown complete');
}

module.exports.initialize = initialize;
module.exports.registerAdapter = registerAdapter;
module.exports.shutdown = shutdown;

// Re-export schemas for external use（contract.ts 是权威规格，contract.js 是运行时镜像）
module.exports.ImportIntentSchema = ImportIntentSchema;
module.exports.ImportResultSchema = ImportResultSchema;
module.exports.IncrementalScanIntentSchema = IncrementalScanIntentSchema;
module.exports.ScanResultSchema = ScanResultSchema;
