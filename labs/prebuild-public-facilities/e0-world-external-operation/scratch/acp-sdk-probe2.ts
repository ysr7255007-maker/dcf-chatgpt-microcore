import { spawn } from "bun";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type Agent, type Client } from "@agentclientprotocol/sdk";
const bin = new URL("../node_modules/.bin/codex-acp", import.meta.url).pathname;
const cwd = new URL("../fixtures/acp-work/", import.meta.url).pathname;
const codexHome = new URL("../scratch/codex-home-e0", import.meta.url).pathname;
const proc = spawn([bin], { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, CODEX_HOME: codexHome } });
const clientImpl: Client = { requestPermission: async () => ({ outcome: { outcome: "cancelled" } }), sessionUpdate: async () => {} };
const stdinSink = proc.stdin;
const conn = new ClientSideConnection((_a: Agent) => clientImpl, ndJsonStream(
  new WritableStream<Uint8Array>({ write(chunk) { const s = new TextDecoder().decode(chunk); console.log("[OUT]", s.slice(0, 600)); stdinSink.write(chunk); stdinSink.flush(); } }),
  proc.stdout as ReadableStream<Uint8Array>,
));
try {
  await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  const session = await conn.newSession({ cwd, mcpServers: [] });
  console.log("SESSION OK");
  try {
    const r = await conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Reply with exactly one word: ready" }] as never });
    console.log("PROMPT OK", JSON.stringify(r).slice(0, 150));
  } catch (e) {
    console.log("PROMPT FAIL code:", (e as { code?: number }).code, "data:", JSON.stringify((e as { data?: unknown }).data ?? null).slice(0, 400), "msg:", String(e).slice(0, 200));
  }
} catch (e) { console.log("EARLY FAIL:", String(e).slice(0, 300)); }
finally { proc.kill(); process.exit(0); }
