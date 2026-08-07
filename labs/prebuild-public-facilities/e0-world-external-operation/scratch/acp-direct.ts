import { AcpSessionExecutor } from "../source/executors/acp-session-executor.ts";

const acp = new AcpSessionExecutor();
const bin = new URL("../node_modules/.bin/codex-acp", import.meta.url).pathname;
const cwd = new URL("../fixtures/acp-work/", import.meta.url).pathname;
const codexHome = new URL("../scratch/codex-home-e0", import.meta.url).pathname;

acp.onCommand(
  {
    type: "start",
    opId: "probe-acp-1",
    spec: JSON.stringify({
      agentCommand: [bin],
      cwd,
      env: { CODEX_HOME: codexHome },
      prompt: "This is a connectivity check. Reply with exactly one word: ready. Do not edit any files.",
      timeoutMs: 180000,
    }),
  },
  (e) => {
    console.log("EVENT:", JSON.stringify(e).slice(0, 500));
    if (e.kind === "result" || e.kind === "error" || e.kind === "terminated") {
      setTimeout(() => process.exit(0), 200);
    }
    return true;
  },
);
setTimeout(() => {
  console.log("EVENT: timeout-no-terminal");
  process.exit(1);
}, 200000);
