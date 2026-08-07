import { spawn } from "bun";
const proc = spawn(["codex", "app-server"], { stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd: process.cwd() });
const dec = new TextDecoder();
void (async () => { for await (const c of proc.stderr) process.stderr.write("[stderr] " + dec.decode(c).slice(0, 800)); })();
void (async () => {
  let buf = "";
  for await (const c of proc.stdout) {
    buf += dec.decode(c, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) console.log("[stdout]", line);
    }
  }
})();
const send = (o: unknown) => { proc.stdin.write(JSON.stringify(o) + "\n"); proc.stdin.flush(); };
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "e0-probe", version: "0.0.1" } } });
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "model/list", params: {} }), 1500);
setTimeout(() => send({ jsonrpc: "2.0", id: 3, method: "provider/list", params: {} }), 2500);
setTimeout(() => send({ jsonrpc: "2.0", id: 4, method: "model/list", params: { providerId: "custom" } }), 3500);
setTimeout(() => { proc.kill(); process.exit(0); }, 20000);
