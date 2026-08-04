#!/usr/bin/env node

/**
 * seed/functions/task-generation/index.js — Task Generation Entry Point
 * 
 * 笼子长在边界上：机械包装 contract 方法（入口 InputSchema.parse、出口 OutputSchema.parse）
 */

const { taskGenerationService } = require('./service');
const { bus } = require('../../core/event-bus');
const { GenerationIntentSchema, GenerationRequestResultSchema } = require('./contract.js');

let initialized = false;

async function initialize({ dbPath }) {
    if (initialized) return;
    
    await taskGenerationService.initialize({ eventBus: bus });
    
    initialized = true;
    console.log('[task-generation] Initialized');
}

/**
 * 机械包装层（笼子关闭的关键）
 */
const CONTRACT_METHODS = {
    generate: { input: GenerationIntentSchema, output: GenerationRequestResultSchema }
};

for (const [name, { input, output }] of Object.entries(CONTRACT_METHODS)) {
    module.exports[name] = async (args) => {
        if (!initialized) {
            throw new Error('task-generation not initialized');
        }
        // args = { kind, prompt, sourceIds?, limit?, ide? } — kind 是路径参数，合并校验
        const parsed = input.parse(args);           // 入口校验（笼子）
        const result = await taskGenerationService[name](
            parsed.kind,
            parsed.prompt,
            parsed.sourceIds || [],
            parsed.ide
        );
        return output.parse(result);                 // 出口校验（笼子）
    };
}

async function shutdown() {
    await taskGenerationService.close();
    initialized = false;
}

module.exports.initialize = initialize;
module.exports.shutdown = shutdown;
module.exports.GenerationIntentSchema = GenerationIntentSchema;
module.exports.GenerationRequestResultSchema = GenerationRequestResultSchema;
