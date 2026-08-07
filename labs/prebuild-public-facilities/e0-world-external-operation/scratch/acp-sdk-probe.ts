import { spawn } from "bun";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type Client,
} from "@agentclientprotocol/sdk";

const bin = new URL("../node_modules/.bin/codex-acp", import.meta.url).pathname;
const cwd = new URL("../fixtures/acp-work/", import.meta.url).pathname;
const codexHome = new URL("../scratch/codex-home-e0", import.meta.url).pathname;

const proc = spawn([bin], {
  cwd,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, CODEX_HOME: codexHome },
});
const dec = new TextDecoder();
void (async () => {
  for await (const c of proc.stderr) process.stderr.write("[stderr] " + dec.decode(c));
})();

const clientImpl: Client = {
  requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  sessionUpdate: async () => {},
};
const stdinSink = proc.stdin;
const conn = new ClientSideConnection(
  (_a: Agent) => clientImpl,
  ndJsonStream(
    new WritableStream<Uint8Array>({
      write(chunk) {
        stdinSink.write(chunk);
        stdinSink.flush();
      },
    }),
    proc.stdout as ReadableStream<Uint8Array>,
  ),
);

try {
  const init = await conn.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  });
  console.log("INIT OK:", JSON.stringify(init).slice(0, 200));
  const session = await conn.newSession({ cwd, mcpServers: [] });
  console.log("SESSION OK:", session.sessionId);
  const result = await conn.prompt({
    sessionId: session.sessionId,
    content: [{ type: "text", text: "Reply with exactly one word: ready" }],
  });
  console.log("PROMPT OK:", JSON.stringify(result).slice(0, 200));
} catch (e) {
  console.log("FAIL:", String(e).slice(0, 400));
} finally {
  proc.kill();
  process.exit(0);
}
