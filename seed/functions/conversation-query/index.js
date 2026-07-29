#!/usr/bin/env node

/**
 * seed/functions/conversation-query/index.js — Conversation Query Entry Point
 * 
 * 笼子长在边界上：机械包装 contract 方法（入口 InputSchema.parse、出口 OutputSchema.parse）
 */

const { conversationQueryService } = require('./service');
const { repo } = require('../../core/repository');
const { queryEngine } = require('../../core/query-engine/QueryEngine');

let initialized = false;

async function initialize(dbPath) {
    if (initialized) return;
    
    // Initialize core dependencies（注入实例，不构造）
    await repo.initialize(dbPath);
    await queryEngine.initialize(repo);
    await conversationQueryService.initialize({ queryEngine, repository: repo });
    
    initialized = true;
    console.log('[conversation-query] Initialized');
}

/**
 * 机械包装层（笼子关闭的关键）
 */
const { ConversationQueryIntentSchema, ConversationResultSchema } = require('./contract.js');

const CONTRACT_METHODS = {
    executeIntent: { input: ConversationQueryIntentSchema, output: ConversationResultSchema }
};

for (const [name, { input, output }] of Object.entries(CONTRACT_METHODS)) {
    module.exports[name] = async (args) => {
        if (!initialized) {
            throw new Error('conversation-query not initialized');
        }
        const parsed = input.parse(args);           // 入口校验（笼子）
        const result = await conversationQueryService[name](parsed);
        return output.parse(result);                 // 出口校验（笼子）
    };
}

async function shutdown() {
    if (repo.db) {
        await repo.close();
    }
    initialized = false;
}

module.exports.initialize = initialize;
module.exports.shutdown = shutdown;
module.exports.ConversationQueryIntentSchema = ConversationQueryIntentSchema;
module.exports.ConversationResultSchema = ConversationResultSchema;
