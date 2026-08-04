/**
 * Language Ammunition Ejection Module
 * 
 * Provides capabilities for:
 * 1. Extracting language ammo from conversations (auto-generate)
 * 2. Storing memory fragments and knowledge cards
 * 3. Loading the library for firing/emission
 * 4. Updating existing ammo via对话
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// The writable library lives in the user's data dir (~/.dcf). The repo/app
// bundle only carries a read-only seed copy used to initialize it.
const LIBRARY_PATH = process.env.DCF_AMMO_LIBRARY
    || path.join(os.homedir(), '.dcf', 'language-ammo', 'library.json');
const SEED_LIBRARY_CANDIDATES = [
    process.env.DCF_AMMO_SEED,
    path.join(__dirname, '..', '..', 'data', 'language-ammo', 'library.json')
].filter(Boolean);
const AMMO_EVENTS = {
    CREATED: 'memory.fragment.created',
    UPDATE: 'knowledge.card.updated',
    FIRED: 'ammo.emitted',
    EXTRACTED: 'ammo.extracted.request'
};

const AMMO_PROTOCOL = {
    invocation_marker: '〔DCF·语言弹药〕',
    update_marker: '〔DCF·弹药更新〕',
    update_intro: '下面是一枚已经存在的 DCF 语言弹药。请把当前对话作为本次修订的语境和依据，先重新理解它的核心意图，再判断哪些部分需要保留、修正、补充或删除。',
    update_rules: [
        '保留仍然成立的核心意图和适用边界；不要因为当前一句修正就机械重写整枚弹药。',
        '吸收当前对话中已经形成的稳定变化；不要只做措辞润色，也不要把当前对话机械摘要进正文。',
        '这是对同一枚长期弹药的更新，不要另建一枚相似弹药；必须保留原有 id。'
    ],
    output_instruction: '完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
};

/** Load the language ammo library */
function loadLibrary() {
    try {
        if (fs.existsSync(LIBRARY_PATH)) {
            const data = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
            return data;
        }
    } catch (error) {
        console.error('Failed to load language ammo library:', error.message);
    }
    
    // First run: initialize the user library from the bundled seed copy.
    for (const seedPath of SEED_LIBRARY_CANDIDATES) {
        try {
            if (fs.existsSync(seedPath)) {
                const seeded = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
                ensureDirectory(LIBRARY_PATH);
                fs.writeFileSync(LIBRARY_PATH, JSON.stringify(seeded, null, 2));
                console.log(`Language ammo library initialized from seed: ${seedPath}`);
                return seeded;
            }
        } catch (error) {
            console.error('Failed to seed ammo library from', seedPath, error.message);
        }
    }
    
    // Create default library if not exists
    const defaultLibrary = {
        schema: 'dcf.language-ammo.library.v1',
        exported_at: new Date().toISOString(),
        count: 0,
        items: []
    };
    
    ensureDirectory(LIBRARY_PATH);
    fs.writeFileSync(LIBRARY_PATH, JSON.stringify(defaultLibrary, null, 2));
    return defaultLibrary;
}

/** Save library updates */
function saveLibrary(library) {
    ensureDirectory(LIBRARY_PATH);
    fs.writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2));
    return true;
}

/** Ensure directory exists */
function ensureDirectory(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** Build ammo invocation prompt */
function buildAmmoInvocation(item) {
    return [
        AMMO_PROTOCOL.invocation_marker,
        '',
        item.body || ''
    ].join('\n');
}

/** Build ammo update request */
function buildAmmoUpdateRequest(item) {
    const rules = Array.isArray(AMMO_PROTOCOL.update_rules) 
        ? AMMO_PROTOCOL.update_rules 
        : AMMO_PROTOCOL.update_rules.slice();
    
    return [
        AMMO_PROTOCOL.update_marker,
        '',
        AMMO_PROTOCOL.update_intro,
        ...rules.map(rule => `- ${rule}`),
        '',
        AMMO_PROTOCOL.output_instruction,
        '',
        '当前弹药：',
        JSON.stringify(item, null, 2)
    ].join('\n');
}

/** Create a new memory fragment from conversation context */
function createMemoryFragment(conversationContext, title, purpose) {
    const id = `fragment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const fragment = {
        id,
        title: title || '未命名片段',
        purpose: purpose || '临时洞察',
        body: extractSummary(conversationContext),
        tags: extractTags(conversationContext),
        source_events: [],
        created_at: new Date().toISOString(),
        version: 1
    };
    
    return fragment;
}

/** Auto-extract summary from conversation */
function extractSummary(context) {
    // Simple heuristic: last N messages that contain insights
    const messages = context.messages || [];
    const insightKeywords = ['决定', '结论', '应该', '需要', '关键', '重要', '核心'];
    
    const relevant = messages.filter(msg => {
        const text = (msg.text || msg.content || '').toLowerCase();
        return insightKeywords.some(keyword => text.includes(keyword));
    });
    
    return relevant.slice(-5).map(m => m.text || m.content || '').join('\n\n');
}

/** Auto-extract tags from conversation */
function extractTags(context) {
    const keywords = [
        '架构', '性能', '安全性', '用户体验', '自动化',
        'AI', '工具', '方法', '维护', '升级'
    ];
    
    const text = (context.fullText || []).join(' ').toLowerCase();
    return keywords.filter(keyword => text.includes(keyword));
}

/** Fire ammo to composer (insert into conversation) */
function fireAmmo(item) {
    return {
        type: 'composer.insert',
        text: buildAmmoInvocation(item),
        meta: { module: 'ammo', action: 'fire', item_id: item.id }
    };
}

/** Request extraction of new ammo from current conversation */
function requestExtraction() {
    const prompt = [
        '请从当前对话中提取一条最值得长期复用的 DCF 语言弹药。',
        '返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
    ].join('\n');
    
    return {
        type: 'composer.send',
        text: prompt,
        meta: { module: 'ammo', action: 'extract' }
    };
}

/** Update existing ammo via dialog */
function requestUpdate(item) {
    return {
        type: 'composer.send',
        text: buildAmmoUpdateRequest(item),
        meta: { module: 'ammo', action: 'update', item_id: item.id }
    };
}

/** Get all ammo items */
function getAllAmmo() {
    const library = loadLibrary();
    return library.items || [];
}

/** Get single ammo by ID */
function getAmmoById(id) {
    const items = getAllAmmo();
    return items.find(item => item.id === id) || null;
}

/** Add ammo to library */
function addAmmo(item) {
    const library = loadLibrary();
    library.items.push(item);
    library.count = library.items.length;
    library.exported_at = new Date().toISOString();
    saveLibrary(library);
    return item;
}


// ---------------------------------------------------------------------------
// Receiving side: detect DCF_AMMO artifacts inside conversation text and
// auto-load them into the library (protocol from the language-ammo-library
// branch: <<<DCF_AMMO { ...json... } DCF_AMMO>>>).
// ---------------------------------------------------------------------------

const AMMO_START_TOKEN = '<<<DCF_AMMO';
const AMMO_END_TOKEN = 'DCF_AMMO>>>';

/**
 * Scan text for DCF_AMMO artifact blocks and parse them.
 * Broken JSON blocks are skipped silently; only payloads with an id survive.
 * @param {string} text
 * @returns {Array<Object>} parsed ammo payloads
 */
/**
 * Generic artifact block scanner: <<<MARKER { ...json... } MARKER>>>.
 * Malformed JSON blocks are skipped silently.
 * @param {string} text
 * @param {string} marker - e.g. 'DCF_AMMO', 'DCF_TASK_REC'
 * @returns {Array<Object>} parsed JSON payloads
 */
function extractArtifactBlocks(text, marker) {
    const source = String(text || '');
    const startToken = '<<<' + marker;
    const endToken = marker + '>>>';
    const payloads = [];
    let cursor = 0;
    while (cursor < source.length) {
        const start = source.indexOf(startToken, cursor);
        if (start < 0) break;
        const end = source.indexOf(endToken, start + startToken.length);
        if (end < 0) break;
        const bodyStart = source.indexOf('{', start + startToken.length);
        if (bodyStart < 0 || bodyStart >= end) { cursor = end + endToken.length; continue; }
        try {
            const payload = JSON.parse(source.slice(bodyStart, end).trim());
            if (payload && typeof payload === 'object') payloads.push(payload);
        } catch (_) { /* malformed block: skip, never block ingestion */ }
        cursor = end + endToken.length;
    }
    return payloads;
}

function extractAmmoBlocks(text) {
    return extractArtifactBlocks(text, 'DCF_AMMO').filter(p => p.id);
}

/**
 * Insert or update one ammo by id. Updates keep created_at and bump version
 * (the update protocol requires the artifact to reuse the original id).
 * @param {Object} payload - { id, title?, purpose?, body?, tags? }
 * @returns {{action: 'added'|'updated', item: Object}}
 */
function upsertAmmo(payload) {
    const library = loadLibrary();
    const now = new Date().toISOString();
    const incoming = {
        id: String(payload.id),
        title: String(payload.title || payload.id),
        purpose: String(payload.purpose || ''),
        body: String(payload.body || ''),
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : []
    };

    const index = library.items.findIndex(item => item.id === incoming.id);
    let action, item;
    if (index >= 0) {
        const existing = library.items[index];
        item = {
            ...existing,
            ...incoming,
            created_at: existing.created_at || now,
            version: (existing.version || 1) + 1,
            updated_at: now
        };
        library.items[index] = item;
        action = 'updated';
    } else {
        item = { ...incoming, created_at: now, version: 1 };
        library.items.push(item);
        action = 'added';
    }

    library.count = library.items.length;
    library.exported_at = now;
    saveLibrary(library);
    return { action, item };
}

/**
 * Full receiving pipeline: text -> artifact blocks -> library upserts.
 * @param {string} text
 * @returns {Array<{action: string, item: Object}>} load results (may be empty)
 */
function ingestAmmoFromText(text) {
    return extractAmmoBlocks(text).map(payload => upsertAmmo(payload));
}

module.exports = {
    // Core operations
    loadLibrary,
    saveLibrary,
    getAllAmmo,
    getAmmoById,
    addAmmo,
    
    // Invocation builders
    buildAmmoInvocation,
    buildAmmoUpdateRequest,
    AMMO_PROTOCOL,
    
    // Action creators
    createMemoryFragment,
    fireAmmo,
    requestExtraction,
    requestUpdate,
    
    // Receiving side (auto-load from conversation artifacts)
    extractArtifactBlocks,
    extractAmmoBlocks,
    upsertAmmo,
    ingestAmmoFromText,
    
    // Constants
    AMMO_EVENTS
};
