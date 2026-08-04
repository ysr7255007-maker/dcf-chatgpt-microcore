/**
 * Abstractions Layer (L2) - Interface Contracts
 * 
 * This layer defines all interface contracts for the architecture.
 * No implementation code lives here — only abstract type definitions.
 * 
 * Principles:
 * - Each file exports a single interface/type
 * - All interfaces are ES6 class abstract base classes
 * - Implementations must extend these abstract classes
 */

// Export all interface contracts
const path = require('path');
const fs = require('fs');

// Load all .js files in this directory as interface definitions
const interfacesDir = __dirname;
const interfaceFiles = fs.readdirSync(interfacesDir).filter(f => f.endsWith('.js'));

interfaceFiles.forEach(file => {
    const filePath = path.join(interfacesDir, file);
    if (file !== 'index.js') {
        // Dynamically load each interface definition
        const module = require(filePath);
        Object.assign(module.exports, module);
    }
});

module.exports = {
    // Core adapters
    DataSourceAdapterInterface: require('./DataSourceAdapterInterface'),
    
    // Data persistence
    DataRepositoryInterface: require('./DataRepositoryInterface'),
    
    // Deduplication strategies
    DeduplicationStrategyInterface: require('./DeduplicationStrategyInterface'),
    
    // Query API
    ConversationQueryAPI: require('./ConversationQueryAPI'),
    
    // Domain events (for decoupling)
    EventBusInterface: require('./EventBusInterface'),
    
    // Type definitions
    Types: require('./types'),
};
