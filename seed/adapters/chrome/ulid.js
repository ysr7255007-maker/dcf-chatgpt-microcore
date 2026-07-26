/**
 * G1 Chrome Adapter - ULID utilities (UMD, zero dependency)
 *
 * Works in three environments:
 *   - MV3 service worker via importScripts('ulid.js')  -> globalThis.DCF_ULID
 *   - content script (classic script)                  -> globalThis.DCF_ULID
 *   - Node 18+ tests via require()                     -> module.exports
 *
 * ULID layout: 10 chars timestamp (48 bits) + 16 chars randomness (80 bits),
 * Crockford Base32, 26 chars total. Compatible with the companion's
 * isValidULID regex: /^[0-9A-HJKMNP-TV-Z]{26}$/
 */
(function (global) {
    'use strict';

    const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    // Resolve a WebCrypto implementation for both browser and Node
    let cryptoObj = null;
    if (typeof global.crypto !== 'undefined' && global.crypto.getRandomValues) {
        cryptoObj = global.crypto;
    } else if (typeof require === 'function') {
        try {
            cryptoObj = require('crypto').webcrypto;
        } catch (e) {
            cryptoObj = null;
        }
    }

    /**
     * Encode a millisecond timestamp into `len` Crockford Base32 chars
     */
    function encodeTime(time, len) {
        let str = '';
        for (let i = 0; i < len; i++) {
            str = ENCODING[time % 32] + str;
            time = Math.floor(time / 32);
        }
        return str;
    }

    /**
     * Produce `len` random Crockford Base32 chars
     */
    function encodeRandom(len) {
        const bytes = new Uint8Array(len);
        cryptoObj.getRandomValues(bytes);
        let str = '';
        for (let i = 0; i < len; i++) {
            str += ENCODING[bytes[i] & 31];
        }
        return str;
    }

    /**
     * Generate a fresh ULID (26 chars)
     */
    function generateULID() {
        return encodeTime(Date.now(), 10) + encodeRandom(16);
    }

    /**
     * Validate ULID format (matches companion-side validation)
     */
    function isValidULID(str) {
        return typeof str === 'string' &&
            str.length === 26 &&
            /^[0-9A-HJKMNP-TV-Z]{26}$/.test(str);
    }

    /**
     * Derive a STABLE 26-char ULID-format id from an arbitrary string.
     * Same input always yields the same id, so re-delivery of the same
     * observation after page reload / SW restart is absorbed by the
     * companion's event_id dedup (idempotency requirement).
     *
     * Implementation: SHA-256(input) -> first 130 bits -> 26x5-bit chars.
     * @returns {Promise<string>}
     */
    async function stableIdFromString(input) {
        const data = new TextEncoder().encode(String(input));
        const digest = await cryptoObj.subtle.digest('SHA-256', data);
        const bytes = new Uint8Array(digest);
        let id = '';
        let bitBuffer = 0;
        let bitCount = 0;
        let byteIndex = 0;
        while (id.length < 26) {
            if (bitCount < 5) {
                bitBuffer = (bitBuffer << 8) | bytes[byteIndex++];
                bitCount += 8;
            }
            bitCount -= 5;
            id += ENCODING[(bitBuffer >> bitCount) & 31];
        }
        return id;
    }

    /**
     * Extract the millisecond timestamp from a generated ULID
     */
    function decodeTime(ulidStr) {
        if (!isValidULID(ulidStr)) {
            throw new Error('Invalid ULID: ' + ulidStr);
        }
        let time = 0;
        for (let i = 0; i < 10; i++) {
            time = time * 32 + ENCODING.indexOf(ulidStr[i]);
        }
        return time;
    }

    const api = { generateULID, isValidULID, stableIdFromString, decodeTime, ENCODING };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.DCF_ULID = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
