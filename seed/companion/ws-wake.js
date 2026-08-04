/**
 * G3 (phase 3) - Minimal WebSocket wake channel (/ws/adapter-wake)
 *
 * Purpose-built narrow channel per ruling C3: the ONLY payload ever sent is
 * the short text frame {"type":"command_available"}. No business data, no
 * second control plane. Chrome MV3 service workers keep an active WS
 * connection alive (Chrome 116+ resets the idle timer on WS traffic), so
 * this doubles as a wake-up path; chrome.alarms remains the recovery net.
 *
 * Minimal RFC6455 implementation (zero npm dependencies, node:crypto only):
 *   - HTTP 101 upgrade handshake (Sec-WebSocket-Accept)
 *   - server -> client short unmasked text frames (< 126 bytes)
 *   - client ping (0x9) -> server pong (0xA); client close (0x8) -> close
 *   - anything else from the client is ignored (channel is one-way by design)
 */

'use strict';

const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WAKE_PATH = '/ws/adapter-wake';

/**
 * Compute the Sec-WebSocket-Accept header value for a client key.
 * @param {string} key - Sec-WebSocket-Key request header
 * @returns {string} base64 accept token
 */
function computeAccept(key) {
    return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

/**
 * Encode a short (< 126 byte payload) unmasked server->client text frame.
 * @param {string} text
 * @returns {Buffer}
 */
function encodeTextFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    if (payload.length >= 126) {
        // Wake channel only ever carries {"type":"command_available"};
        // longer payloads indicate misuse of the channel.
        throw new Error('wake channel frames must be < 126 bytes');
    }
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

/**
 * Decode a single client->server frame (client frames are always masked
 * per RFC6455). Returns null when the buffer does not hold a full frame.
 * @param {Buffer} buf
 * @returns {{opcode:number, payload:Buffer, frameLength:number}|null}
 */
function decodeClientFrame(buf) {
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
        if (buf.length < 4) return null;
        len = buf.readUInt16BE(2);
        offset = 4;
    } else if (len === 127) {
        if (buf.length < 10) return null;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
    }
    let mask = null;
    if (masked) {
        if (buf.length < offset + 4) return null;
        mask = buf.subarray(offset, offset + 4);
        offset += 4;
    }
    if (buf.length < offset + len) return null;
    const payload = Buffer.from(buf.subarray(offset, offset + len));
    if (mask) {
        for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
    }
    return { opcode, payload, frameLength: offset + len };
}

/**
 * Wake channel server. Attach to an existing http.Server; broadcasts only
 * the fixed command_available notification.
 */
class AdapterWakeChannel {
    /**
     * @param {Object} [opts]
     * @param {Function} [opts.log] - logger, defaults to no-op
     */
    constructor(opts = {}) {
        this.sockets = new Set();
        this.log = opts.log || function () {};
    }

    /**
     * Attach the upgrade handler to an http.Server.
     * Non-wake upgrade paths are refused with 404 (single narrow channel).
     * @param {import('http').Server} server
     */
    attach(server) {
        server.on('upgrade', (req, socket) => {
            const pathname = (req.url || '').split('?')[0];
            const key = req.headers['sec-websocket-key'];
            const isUpgrade = /websocket/i.test(String(req.headers.upgrade || ''));

            if (pathname !== WAKE_PATH || !key || !isUpgrade) {
                socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }

            socket.write(
                'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${computeAccept(key)}\r\n` +
                '\r\n'
            );

            this.sockets.add(socket);
            this.log('[ws-wake] client connected, total:', this.sockets.size);

            let pending = Buffer.alloc(0);
            socket.on('data', (chunk) => {
                pending = Buffer.concat([pending, chunk]);
                let frame;
                while ((frame = decodeClientFrame(pending)) !== null) {
                    pending = pending.subarray(frame.frameLength);
                    if (frame.opcode === 0x9) {
                        // ping -> pong with same payload
                        const pong = Buffer.concat([
                            Buffer.from([0x8a, frame.payload.length]),
                            frame.payload
                        ]);
                        try { socket.write(pong); } catch (_) { /* dropped below */ }
                    } else if (frame.opcode === 0x8) {
                        // close -> echo close and drop
                        try { socket.write(Buffer.from([0x88, 0x00])); } catch (_) { /* ignore */ }
                        this._drop(socket);
                        return;
                    }
                    // text/binary/pong from client: ignored (one-way channel)
                }
            });

            const drop = () => this._drop(socket);
            socket.on('close', drop);
            socket.on('error', drop);
            socket.on('end', drop);
        });
    }

    _drop(socket) {
        if (this.sockets.delete(socket)) {
            this.log('[ws-wake] client dropped, total:', this.sockets.size);
        }
        try { socket.destroy(); } catch (_) { /* already gone */ }
    }

    /**
     * Broadcast the fixed wake notification to all connected adapters.
     * Never throws; a dead socket is dropped honestly.
     * @returns {number} number of sockets notified
     */
    broadcastCommandAvailable() {
        const frame = encodeTextFrame(JSON.stringify({ type: 'command_available' }));
        let notified = 0;
        for (const socket of [...this.sockets]) {
            try {
                socket.write(frame);
                notified++;
            } catch (_) {
                this._drop(socket);
            }
        }
        return notified;
    }

    /** Close all wake sockets (graceful shutdown). */
    closeAll() {
        for (const socket of [...this.sockets]) {
            this._drop(socket);
        }
    }
}

module.exports = { AdapterWakeChannel, computeAccept, encodeTextFrame, decodeClientFrame, WAKE_PATH };
