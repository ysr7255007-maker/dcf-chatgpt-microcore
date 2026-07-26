/**
 * G1 Companion - ULID Generator (Pure JavaScript Implementation)
 * Zero dependency, Node 18+ compatible
 * 
 * ULID (Universally Unique Lexicographically Sortable Identifier)
 * Based on: https://github.com/ulid/spec
 * 
 * Uses crypto.randomBytes for randomness and Date.now() for timestamp
 */

const crypto = require('crypto');

// Crockford's Base32 alphabet (excludes ambiguous characters: I, L, 1, O, 0)
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Encode a buffer to ULID-compatible base32 string
 * @param {Buffer} buffer - Input buffer (must be multiple of 5 bits)
 * @returns {string} Base32 encoded string
 */
function encodeBase32(buffer) {
    const bytes = Buffer.from(buffer);
    let result = '';
    
    // 8 octets = 64 bits = 10 base32 characters (5 bits each)
    const groups = Math.floor(bytes.length * 8 / 5);
    let bitBuffer = 0;
    let bitCount = 0;
    
    for (let i = 0; i < bytes.length; i++) {
        bitBuffer = (bitBuffer << 8) | bytes[i];
        bitCount += 8;
        
        while (bitCount >= 5) {
            bitCount -= 5;
            const index = (bitBuffer >> bitCount) & 0x1F;
            result += ENCODING[index];
        }
    }
    
    if (bitCount > 0) {
        const index = (bitBuffer << (5 - bitCount)) & 0x1F;
        result += ENCODING[index];
    }
    
    return result;
}

/**
 * Generate a ULID
 * @param {Object} options
 * @param {number} options.timestamp - Unix timestamp in ms (default: Date.now())
 * @param {Buffer} options.randomness - Random bytes (default: crypto.randomBytes(16), using first 10 after truncation)
 * @returns {string} ULID string (26 characters)
 */
function generateULID(options = {}) {
    const timestamp = options.timestamp || Date.now();
    const randomness = options.randomness || crypto.randomBytes(16);
    
    // Standard ULID layout: 10 chars timestamp (48 bits) + 16 chars randomness (80 bits)
    let time = timestamp;
    let ts = '';
    for (let i = 0; i < 10; i++) {
        ts = ENCODING[time % 32] + ts;
        time = Math.floor(time / 32);
    }
    
    let rnd = '';
    for (let i = 0; i < 16; i++) {
        rnd += ENCODING[randomness[i] & 31];
    }
    
    return ts + rnd;
}

/**
 * Parse a ULID back to timestamp and randomness
 * @param {string} ulid - ULID string
 * @returns {{timestamp: number, randomness: Buffer}} Parsed components
 */
function parseULID(ulid) {
    if (typeof ulid !== 'string' || ulid.length !== 26) {
        throw new Error(`Invalid ULID: ${ulid}`);
    }
    
    try {
        // Verify all characters are valid base32
        if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(ulid)) {
            throw new Error(`Invalid ULID characters: ${ulid}`);
        }
        
        const ENCODING_MAP = {};
        for (let i = 0; i < ENCODING.length; i++) {
            ENCODING_MAP[ENCODING[i]] = i;
        }
        
        // First 10 chars encode the 48-bit millisecond timestamp
        let timestamp = 0;
        for (let i = 0; i < 10; i++) {
            timestamp = timestamp * 32 + ENCODING_MAP[ulid[i]];
        }
        
        // Remaining 16 chars carry the randomness (5 bits per char)
        const randomness = Buffer.from(
            ulid.slice(10).split('').map(c => ENCODING_MAP[c])
        );
        
        return { timestamp, randomness };
    } catch (error) {
        throw new Error(`Failed to parse ULID ${ulid}: ${error.message}`);
    }
}

/**
 * Check if a string is a valid ULID
 * @param {string} str - String to validate
 * @returns {boolean} True if valid ULID
 */
function isValidULID(str) {
    try {
        parseULID(str);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Compare two ULIDs
 * @param {string} ulid1 - First ULID
 * @param {string} ulid2 - Second ULID
 * @returns {number} Negative if ulid1 < ulid2, positive if ulid1 > ulid2, 0 if equal
 */
function compareULIDs(ulid1, ulid2) {
    if (ulid1 === ulid2) return 0;
    
    // Lexicographic comparison works because ULIDs are lexicographically sortable
    return ulid1.localeCompare(ulid2);
}

/**
 * Generate ULID with entropy fallback for Node 18 compatibility
 * @param {Object} options
 * @returns {string} ULID string
 */
function generateULIDWithEntropy(options = {}) {
    return generateULID(options);
}

module.exports = {
    generateULID,
    generateULIDWithEntropy,
    parseULID,
    isValidULID,
    compareULIDs,
    ENCODING
};
