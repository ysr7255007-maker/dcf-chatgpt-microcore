#!/usr/bin/env node
/**
 * DCF Surface + Target Adapter - BrowserClaw E2E Test Suite
 * 
 * Requirements:
 * - BrowserClaw browser must be signed into ChatGPT
 * - Companion server running on http://127.0.0.1:8472
 * - Electron Surface launched in macOS GUI session
 * - Chrome Extension loaded in BrowserClaw
 * 
 * This test suite validates the complete end-to-end flow:
 * 1. Read real ChatGPT conversation via Extension → Save to Companion
 * 2. Display conversation in DCF Surface Electron window
 * 3. Send card from DCF Surface back to ChatGPT input
 * 
 * NO MOCKS - All tests use real BrowserClaw interactions with actual DOM elements.
 */

const { execSync } = require('child_process');
const assert = require('assert');

const COMPANION_URL = 'http://127.0.0.1:8472';

// Helper: RPC call to Companion
async function companionRPC(method, params = {}) {
    const res = await fetch(`${COMPANION_URL}/rpc/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
        throw new Error(`Companion RPC error: ${JSON.stringify(data.error)}`);
    }
    return data.result;
}

// Test suite structure (to be filled with BrowserClaw MCP calls)
describe('DCF Surface E2E with BrowserClaw', () => {
    before(async () => {
        console.log('🚀 Starting BrowserClaw E2E test suite...');
        
        // Step 1: Verify Companion is healthy
        const health = await companionRPC('health');
        assert.strictEqual(health.status, 'healthy', 'Companion should be healthy');
        console.log('✅ Companion verified:', health);
        
        // Step 2: Launch Electron Surface (requires macOS GUI)
        console.log('⚠️  NOTE: Electron Surface launch requires macOS GUI session');
        console.log('   Please run: cd packages/desktop-electron && npm start');
        
        // Step 3: Load Chrome Extension (requires Chrome DevTools Protocol)
        console.log('⚠️  NOTE: Chrome Extension loading requires CDP attachment');
        console.log('   Please load extension: packages/target-adapter-chrome');
    });
    
    after(() => {
        console.log('🏁 Test suite completed');
    });
    
    describe('T1: Read real ChatGPT conversation', () => {
        it('should read last 5 messages from active tab', async () => {
            // TODO: BrowserClaw MCP call: navigate to chatgpt.com
            // TODO: BrowserClaw MCP call: click Extension popup
            // TODO: BrowserClaw MCP call: trigger "Test Read" button
            // TODO: Assert: Conversation saved to Companion DB
            throw new Error('TODO: Implement BrowserClaw navigation & interaction');
        });
    });
    
    describe('T2: Boundary persistence', () => {
        it('should save boundary state to SQLite', async () => {
            throw new Error('TODO: Implement BrowserClaw boundary settings interaction');
        });
    });
    
    describe('T3: Send card to ChatGPT', () => {
        it('should insert card text into ChatGPT input box', async () => {
            throw new Error('TODO: Implement BrowserClaw card send action');
        });
    });
});

if (require.main === module) {
    console.log('⚠️  This test requires BrowserClaw MCP integration');
    console.log('Current environment: No BrowserClaw MCP client available');
    console.log('');
    console.log('Manual validation steps:');
    console.log('1. Start Companion: ./quick-start-electron.sh');
    console.log('2. Launch Electron: cd packages/desktop-electron && npm start');
    console.log('3. Load Chrome Extension: chrome://extensions → Load unpacked');
    console.log('4. Open https://chatgpt.com/ in BrowserClaw browser');
    console.log('5. Use BrowserClaw MCP tools to interact');
    process.exit(1);
}

module.exports = { companionRPC };
