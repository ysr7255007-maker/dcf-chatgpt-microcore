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

// Load all sites/*.js files - extract __SITE_XXX = {...} block using brace-matching function.
// CRITICAL: each site file only defines `const __SITE_XXX = {...}`; index.js reads adapters from
// __DCF_WEB_CAPTURE__['<site-key>']. The bundle MUST wire each const into that registry, else
// index.js sees undefined and isolates every adapter (loaded=0, captures nothing).
const sitesDir = path.join(webCaptureRoot, 'sites');
const siteFiles = fs.readdirSync(sitesDir).sort().filter(f => f.endsWith('.js') && !f.startsWith('.') && !f.includes('.legacy'));
const registryWiring = [];
for (const siteFile of siteFiles) {
  console.log(`  Loading site: ${siteFile}`);
  const siteKey = siteFile.replace(/\.js$/, ''); // e.g. 'claude-ai' matches index.js SITE_KEYS
  const siteCode = fs.readFileSync(path.join(sitesDir, siteFile), 'utf8');
  
  // Extract __SITE_XXX block using brace-matching (not regex)
  const posRegex = /const\s+(\S+)\s*=\s*\{/g;
  let match;
  let constName = null;
  while ((match = posRegex.exec(siteCode)) !== null) {
    const name = match[1];
    if (!name.startsWith('__SITE_')) {
      continue;
    }
    constName = name;
    
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
  if (!constName) {
    console.error(`❌ FAIL: no __SITE_ const found in ${siteFile}`);
    process.exit(1);
  }
  // Wire const -> registry key so index.js can register it.
  registryWiring.push(`__DCF_WEB_CAPTURE__[${JSON.stringify(siteKey)}] = ${constName};`);
}

// Emit registry wiring after all site consts (runtime-check.js already initialized the object).
bundleContent += '\n(function(g){ g.__DCF_WEB_CAPTURE__ = g.__DCF_WEB_CAPTURE__ || {}; const __DCF_WEB_CAPTURE__ = g.__DCF_WEB_CAPTURE__;\n'
  + registryWiring.join('\n')
  + '\n})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';

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

// Count registered site consts (source-level sanity; real registration checked in VM below)
const siteConstCount = (bundleContent.match(/const __SITE_/g) || []).length;
const registryAssignCount = (bundleContent.match(/__DCF_WEB_CAPTURE__\[/g) || []).length;
console.log(`✅ Built bundle with ${siteConstCount} site consts, ${registryAssignCount} registry assignments`);

// Calculate bundle hash
const bundleHash = sha256(Buffer.from(bundleContent, 'utf8'));
console.log(`Bundle SHA256: ${bundleHash}`);

// Verify bundle loads AND registers adapters in a Node VM context (real registration proof).
console.log('\nTesting bundle execution in VM...');
try {
  const vm = require('vm');
  const attrSet = {};
  const documentEl = {
    setAttribute(k, v) { attrSet[k] = v; },
    getAttribute(k) { return attrSet[k] || null; }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      readyState: 'complete',
      documentElement: documentEl,
      addEventListener() {},
      querySelectorAll() { return []; },
      querySelector() { return null; }
    },
    location: { href: 'https://www.doubao.com/chat/123', hostname: 'www.doubao.com', pathname: '/chat/123' },
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (cb) => { cb(); return 0; },
    clearTimeout: () => {},
    URL,
    Intl,
    Date,
    NodeFilter: typeof NodeFilter !== 'undefined' ? NodeFilter : { SHOW_TEXT: 3 },
    chrome: { runtime: { sendMessage: async () => Promise.resolve(), id: 'build-check' } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundleContent, sandbox, { filename: 'g1-web-capture-bundle.js', timeout: 5000 });

  const ENGINE = sandbox.__DCF_WEB_CAPTURE_ENGINE__;
  if (!ENGINE) throw new Error('bundle did not expose __DCF_WEB_CAPTURE_ENGINE__');
  const registered = ENGINE.adapterCount();
  console.log(`✅ Bundle executed; engine registered ${registered} adapters`);
  if (registered < 8) {
    throw new Error(`Expected >= 8 registered adapters (8 verified sites), got ${registered} — registry wiring broken`);
  }
  const beaconRaw = attrSet['data-dcf-web-capture'];
  if (!beaconRaw || JSON.parse(beaconRaw).started !== true) {
    throw new Error('engine did not start / write beacon on a matching host');
  }
  console.log(`✅ Engine started on matching host, beacon written`);
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
  sites_registered: registryAssignCount
}, null, 2));
