// Direct CDP connection to load DCF extension into BrowserClaw
import { createConnection } from 'net';
import { createHash } from 'crypto';

const CDP_PORT = 9110;
const EXT_PATH = '/Users/looy/Documents/dcf/dist/dcf-chrome-extension';

// Simple WebSocket client over raw TCP for CDP
class CdpClient {
  constructor() {
    this.id = 0;
    this.socket = null;
    this.pending = new Map();
    this.buffer = '';
  }

  async connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const url = new URL(wsUrl);
      this.socket = createConnection({ port: url.port || 80, host: url.hostname }, () => {
        // Send WebSocket upgrade request
        const key = createHash('sha1').update(Math.random().toString()).digest('base64');
        this.socket.write([
          `GET ${url.pathname}${url.search} HTTP/1.1`,
          `Host: ${url.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          ''
        ].join('\r\n'));
      });

      let headersReceived = false;
      this.socket.on('data', (data) => {
        if (!headersReceived) {
          this.buffer += data.toString();
          if (this.buffer.includes('\r\n\r\n')) {
            headersReceived = true;
            const headerEnd = this.buffer.indexOf('\r\n\r\n') + 4;
            const rest = this.buffer.slice(headerEnd);
            this.buffer = rest;
            resolve();
          }
          return;
        }
        // Parse WebSocket frames
        this.buffer += typeof data === 'string' ? data : data.toString('utf8');
        this.processMessages();
      });
      this.socket.on('error', reject);
    });
  }

  processMessages() {
    // Simple frame parsing for text frames
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer.charCodeAt(0);
      const secondByte = this.buffer.charCodeAt(1);
      const opcode = firstByte & 0x0F;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7F;
      let offset = 2;

      if (payloadLen === 126) {
        payloadLen = (this.buffer.charCodeAt(2) << 8) | this.buffer.charCodeAt(3);
        offset = 4;
      } else if (payloadLen === 127) {
        // Very large frames - skip for simplicity
        break;
      }

      let maskKey = null;
      if (masked) {
        maskKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) break;

      let payload = this.buffer.slice(offset, offset + payloadLen);
      if (masked) {
        payload = Buffer.from(payload, 'binary').map((byte, i) => byte ^ maskKey.charCodeAt(i % 4)).toString('utf8');
      }

      this.buffer = this.buffer.slice(offset + payloadLen);

      if (opcode === 1) { // Text frame
        try {
          const msg = JSON.parse(payload);
          const resolver = this.pending.get(msg.id);
          if (resolver) {
            this.pending.delete(msg.id);
            resolver(msg);
          }
        } catch (e) {
          console.error('Parse error:', e.message);
        }
      }
    }
  }

  send(method, params = {}, sessionId = null) {
    this.id++;
    const msg = { id: this.id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    
    const payload = JSON.stringify(msg);
    const frame = this.createFrame(payload);
    return new Promise((resolve) => {
      this.pending.set(this.id, resolve);
      this.socket.write(frame);
    });
  }

  createFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }

  close() {
    if (this.socket) this.socket.end();
  }
}

async function main() {
  console.log('Connecting to BrowserClaw CDP on port', CDP_PORT);
  
  // Get browser WebSocket URL
  const http = await import('http');
  const resp = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  
  const wsUrl = resp.webSocketDebuggerUrl;
  console.log('Browser WS URL:', wsUrl);
  
  const cdp = new CdpClient();
  await cdp.connect(wsUrl);
  console.log('Connected to CDP');
  
  // Get list of targets
  const targetsResult = await cdp.send('Target.getTargets', {});
  const targets = targetsResult.result.targetInfos;
  console.log('Targets:', targets.length);
  
  // Find extensions page
  let extTarget = targets.find(t => t.url === 'chrome://extensions/');
  if (!extTarget) {
    // Create extensions page
    const createResult = await cdp.send('Target.createTarget', { 
      url: 'chrome://extensions/', 
      background: true 
    });
    extTarget = createResult.result;
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('Extensions page target:', extTarget.targetId);
  
  if (!extTarget) {
    console.error('Could not find or create extensions page');
    cdp.close();
    return;
  }
  
  // Attach to the extensions page
  const attachResult = await cdp.send('Target.attachToTarget', {
    targetId: extTarget.targetId,
    flatten: true
  });
  const sid = attachResult.result.sessionId;
  console.log('Attached with session ID:', sid);
  
  // First check if developer mode is on - if not, we need to navigate to enable it
  // The extensions page needs to be in developer mode to use loadUnpacked
  
  // Navigate to ensure fresh page
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Page.navigate', { url: 'chrome://extensions/' }, sid);
  await new Promise(r => setTimeout(r, 2000));
  
  // Check developerPrivate API
  const checkResult = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        // Toggle developer mode on if needed - click the switch
        const switches = document.querySelectorAll('cr-toggle, #devMode, [id*=\"dev\"], [id*=\"Dev\"]');
        for (const s of switches) {
          if (s.offsetParent !== null) {
            s.click();
            break;
          }
        }
        await new Promise(r => setTimeout(r, 500));
        
        // Now try to find the 'load unpacked' button and click it
        // Or better, try the developerPrivate API
        if (typeof chrome.developerPrivate !== 'undefined' && 
            typeof chrome.developerPrivate.loadUnpacked === 'function') {
          try {
            const r = await chrome.developerPrivate.loadUnpacked({ failQuietly: true });
            return { ok: true, result: JSON.stringify(r) };
          } catch(loadErr) {
            return { ok: false, loadError: loadErr.message, loadName: loadErr.name };
          }
        }
        return { ok: false, error: 'developerPrivate not available' };
      } catch(e) {
        return { ok: false, error: e.message, stack: e.stack };
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, sid);
  
  console.log('Check result:', JSON.stringify(checkResult.result.result.value, null, 2));
  
  cdp.close();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
