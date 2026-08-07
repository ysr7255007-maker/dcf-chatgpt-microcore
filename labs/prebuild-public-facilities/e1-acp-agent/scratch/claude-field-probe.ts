import { spawn } from "bun";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type Agent, type Client } from "@agentclientprotocol/sdk";
const bin = new URL("../node_modules/.bin/claude-agent-acp", import.meta.url).pathname;
const proc = spawn([bin], { cwd: process.cwd(), stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env } });
const clientImpl: Client = { requestPermission: async () => ({ outcome: { outcome: "cancelled" } }), sessionUpdate: async () => {} };
const sink = proc.stdin;
const conn = new ClientSideConnection((_a: Agent) => clientImpl, ndJsonStream(
  new WritableStream<Uint8Array>({ write(c) { sink.write(c); sink.flush(); } }),
  proc.stdout as ReadableStream<Uint8Array>));
try {
  await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  const s = await conn.newSession({ cwd: process.cwd(), mcpServers: [] });
  for (const field of ["content", "prompt"] as const) {
    try {
      const r = await (conn as unknown as { prompt(p: unknown): Promise<{ stopReason?: string }> }).prompt(
        { sessionId: s.sessionId, [field]: [{ type: "text", text: "Reply with exactly one word: ready" }] });
      console.log(`FIELD ${field}: OK stopReason=${r.stopReason}`);
      break;
    } catch (e) {
      console.log(`FIELD ${field}: FAIL data=${JSON.stringify((e as { data?: unknown }).data ?? null).slice(0, 300)}`);
    }
  }
} catch (e) { console.log("EARLY FAIL:", String(e).slice(0, 300)); }
finally { proc.kill(); process.exit(0); }
