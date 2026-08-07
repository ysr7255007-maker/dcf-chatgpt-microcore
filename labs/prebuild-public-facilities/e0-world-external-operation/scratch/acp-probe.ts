import { spawn } from "bun";
const proc = spawn(["./node_modules/.bin/codex-acp"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
const dec = new TextDecoder();
let sessionId: string | null = null;
void (async () => { for await (const c of proc.stderr) process.stderr.write("[stderr] " + dec.decode(c)); })();
void (async () => {
  let buf = "";
  for await (const c of proc.stdout) {
    buf += dec.decode(c, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      console.log("[stdout]", line.slice(0, 400));
      try {
        const msg = JSON.parse(line);
        if (msg.id === 2 && msg.result?.sessionId) sessionId = msg.result.sessionId;
      } catch {}
    }
  }
})();
const send = (o: unknown) => { proc.stdin.write(JSON.stringify(o) + "\n"); proc.stdin.flush(); };
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } } });
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd() + "/fixtures/acp-work", mcpServers: [] } }), 2000);
setTimeout(() => {
  if (!sessionId) { console.log("[probe] no sessionId yet"); return; }
  send({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId, content: [{ type: "text", text: "Reply with exactly one word: ready" }] } });
  console.log("[probe] prompt sent");
}, 4000);
setTimeout(() => { proc.kill(); process.exit(0); }, 120000);
