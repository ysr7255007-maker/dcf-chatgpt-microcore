'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * build-g1-adapter.js - Build script for G1 Target Adapter (seed/adapters/chrome)
 * 
 * Purpose: Bundle web-capture content scripts into seed/adapters/chrome/web-capture/bundle.js
 * This creates a zero-dependency bundle that can be injected via content_scripts in G1 manifest.
 * 
 * Build order: runtime-check → engine → sites/*.js → index
 */

const root = path.resolve(__dirname, '..');
const g1Root = path.join(root, 'seed/adapters/chrome');
const webCaptureRoot = path.join(g1Root, 'web-capture');
const outputDir = webCaptureRoot;
const outputPath = path.join(outputDir, 'bundle.js');

const VERSION_NAME = '1.0.0-rc.3';

function sha256(value) { 
  return crypto.createHash('sha256').update(value).digest('hex'); 
}

// Read source files
console.log('Building G1 adapter web-capture bundle...');
console.log(`Source dir: ${webCaptureRoot}`);
console.log(`Output: ${outputPath}`);

let bundleContent = '';

// Load runtime-check.js (first line for VM environment check)
const runtimeCheck = fs.readFileSync(path.join(webCaptureRoot, 'runtime-check.js'), 'utf8');
bundleContent += runtimeCheck + '\n\n';

// Load engine.js
const engine = fs.readFileSync(path.join(webCaptureRoot, 'engine.js'), 'utf8');
bundleContent += engine + '\n\n';

// Load all sites/*.js files - extract __SITE_XXX = {...} block using brace-matching function
const sitesDir = path.join(webCaptureRoot, 'sites');
const siteFiles = fs.readdirSync(sitesDir).sort().filter(f => f.endsWith('.js') && !f.startsWith('.') && !f.includes('.legacy'));
for (const siteFile of siteFiles) {
  console.log(`  Loading site: ${siteFile}`);
  const siteCode = fs.readFileSync(path.join(sitesDir, siteFile), 'utf8');
  
  // Extract __SITE_XXX block using brace-matching (not regex)
  const posRegex = /const\s+(\S+)\s*=\s*\{/g;
  let match;
  while ((match = posRegex.exec(siteCode)) !== null) {
    const name = match[1];
    if (!name.startsWith('__SITE_')) {
      continue;
    }
    
    const braceStart = posRegex.lastIndex - 1;
    let braceCount = 0;
    let i = braceStart;
    while (i < siteCode.length) {
      if (siteCode[i] === '{') {
        braceCount++;
      } else if (siteCode[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          const block = siteCode.substring(match.index, i + 1);
          bundleContent += block + ';';
          break;
        }
      }
      i++;
    }
  }
}

// Load index.js
const index = fs.readFileSync(path.join(webCaptureRoot, 'index.js'), 'utf8');
bundleContent += index + '\n';

// Remove module.exports lines entirely
bundleContent = bundleContent.replace(/if\s*\(\s*typeof\s+module\s*!==\s*'undefined'\s*&&\s*module\.exports\s*\)\s*\{\s*module\.exports\s*=[^;]+;\s*\}/g, '');

// Write bundle
fs.writeFileSync(outputPath, bundleContent, 'utf8');

// Verify: assertZeroRequire
const requirePattern = /\brequire\s*\(/;
if (requirePattern.test(bundleContent)) {
  const matches = bundleContent.match(requirePattern);
  console.error(`❌ FAIL: bundle contains require() calls (${matches.length} occurrences)`);
  process.exit(1);
}

// Count registered sites
const siteCount = (bundleContent.match(/const __SITE_/g) || []).length;
console.log(`✅ Built bundle with ${siteCount} site adapters`);

// Calculate bundle hash
const bundleHash = sha256(Buffer.from(bundleContent, 'utf8'));
console.log(`Bundle SHA256: ${bundleHash}`);

// Verify bundle loads in Node VM context
console.log('\nTesting bundle execution in VM...');
try {
  const vm = require('vm');
  const context = vm.createContext({
    globalThis: {},
    console: console,
    URL: URL,
    Intl: Intl,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    TypeError: Error,
    NodeFilter: typeof NodeFilter !== 'undefined' ? NodeFilter : { SHOW_TEXT: 3 },
    document: null, // Will be provided dynamically during runtime
    location: {
      href: 'https://chatgpt.com'
    }, // Needed by engine.js (line 102)
    chrome: {
      runtime: {
        sendMessage: async (msg) => { 
          console.log('[VM] Would send:', msg.type); 
          return Promise.resolve(); 
        },
        id: 'test-extension-id'
      }
    }
  });
  
  vm.runInContext(bundleContent, context, { timeout: 5000 });
  
  // Check that __DCF_WEB_CAPTURE__ is initialized
  if (!context.globalThis.__DCF_WEB_CAPTURE__) {
    throw new Error('Failed to initialize __DCF_WEB_CAPTURE__');
  }
  
  const wc = context.globalThis.__DCF_WEB_CAPTURE__;
  console.log(`✅ Bundle executed successfully, loaded ${wc.loaded} sites, isolated ${wc.isolated} invalid ones`);
  
  if (wc.loaded < 4) {
    console.error(`❌ FAIL: Expected at least 4 good sites to load, got ${wc.loaded}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ FAIL: Bundle execution error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}

console.log('\n✅ G1 web-capture bundle built successfully');
console.log(JSON.stringify({
  ok: true,
  version: VERSION_NAME,
  bundle_path: outputPath,
  bundle_size: fs.statSync(outputPath).size,
  bundle_hash: bundleHash,
  sites_loaded: siteCount
}, null, 2));
