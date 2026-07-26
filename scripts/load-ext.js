// Load DCF extension into BrowserClaw via CDP WebSocket
const http = require('http');
const crypto = require('crypto');
const net = require('net');

const CDP_PORT = 9110;
const EXT_PATH = '/Users/looy/Documents/dcf/dist/dcf-chrome-extension';

function createWebSocketKey() {
  return crypto.randomBytes(16).toString('base64');
}

function sendFrame(socket, data) {
  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  const len = buf.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, buf]));
}

function parseFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0F;
  let len = second & 0x7F;
  let offset = 2;
  if (len === 126) { len = buffer.readUInt16BE(2); offset = 4; }
  else if (len === 127) { /* skip huge frames */ return null; }
  if (buffer.length < offset + len) return null;
  let payload;
  if ((second & 0x80) !== 0) { // masked
    const mask = buffer.slice(offset, offset + 4);
    payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buffer[offset + 4 + i] ^ mask[i % 4];
    offset += 4;
  } else {
    payload = buffer.slice(offset, offset + len);
  }
  return { opcode, payload, totalSize: offset + len };
}

async function connectCDP() {
  // Get WebSocket URL
  const wsUrl = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d).webSocketDebuggerUrl));
    }).on('error', reject);
  });

  const url = new URL(wsUrl);
  const key = createWebSocketKey();
  
  return new Promise((resolve, reject) => {
    const socket = net.connect(url.port || 80, url.hostname);
    let buf = Buffer.alloc(0);
    let headersDone = false;
    let msgId = 0;
    const pending = new Map();
    
    socket.on('connect', () => {
      const path = url.pathname + (url.search || '');
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', ''
      ].join('\r\n'));
    });
    
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      
      if (!headersDone) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx !== -1) {
          headersDone = true;
          const header = buf.slice(0, idx).toString();
          if (!header.includes('101')) {
            reject(new Error('WS handshake failed: ' + header));
            return;
          }
          buf = buf.slice(idx + 4);
          console.log('WebSocket connected');
          resolve({ socket, send, pending });
        }
        return;
      }
      
      // Parse frames
      while (buf.length > 0) {
        const frame = parseFrame(buf);
        if (!frame) break;
        buf = buf.slice(frame.totalSize);
        
        if (frame.opcode === 1) { // text
          try {
            const msg = JSON.parse(frame.payload.toString());
            const resolver = pending.get(msg.id);
            if (resolver) { pending.delete(msg.id); resolver(msg); }
          } catch(e) {}
        } else if (frame.opcode === 8) { // close
          console.log('WebSocket closed');
          socket.end();
        } else if (frame.opcode === 9) { // ping
          socket.write(Buffer.from([0x8A, 0x00])); // pong
        }
      }
    });
    
    socket.on('error', reject);
    
    function send(method, params = {}, sessionId = null) {
      msgId++;
      const msg = { id: msgId, method, params };
      if (sessionId) msg.sessionId = sessionId;
      return new Promise(resolve => {
        pending.set(msgId, resolve);
        sendFrame(socket, msg);
      });
    }
  });
}

async function main() {
  console.log('Connecting to BrowserClaw CDP on port', CDP_PORT);
  const { send } = await connectCDP();
  
  // Get targets
  const targets = await send('Target.getTargets');
  const infos = targets.result.targetInfos;
  console.log('Targets:', infos.length);
  
  // Find a regular page to attach to
  let page = infos.find(t => t.type === 'page');
  if (!page || page.url === 'chrome://newtab/') {
    page = infos.find(t => t.type === 'page' && t.url !== 'chrome://newtab/');
  }
  if (!page) {
    // Create a page
    const create = await send('Target.createTarget', { url: 'about:blank' });
    page = { targetId: create.result.targetId };
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('Using page:', page.url?.substring(0, 80) || page.targetId);
  
  // Attach to it
  const attach = await send('Target.attachToTarget', {
    targetId: page.targetId, flatten: true
  });
  const sid = attach.result.sessionId;
  console.log('Session:', sid);
  
  // Try to load extension using Input.dispatchKeyEvent
  // First click on the extension Load Unpacked button
  // But we need to be on extensions page...
  
  // Better approach: try Extensions domain method on page session
  const result = await send('Extensions.loadUnpacked', {
    path: EXT_PATH
  }, sid);
  
  console.log('loadUnpacked result:', JSON.stringify(result));
  
  if (result.error && result.error.message === 'Method not available') {
    console.log('\nTrying alternative: Browser Extensions method');
    // Try browser-level
    const result2 = await send('Extensions.loadUnpacked', {
      path: EXT_PATH
    });
    console.log('Browser-level result:', JSON.stringify(result2));
  }
  
  process.exit(0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
