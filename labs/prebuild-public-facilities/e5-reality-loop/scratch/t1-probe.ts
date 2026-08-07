import { initTaskRepo } from "../source/fixture-repo.ts";
import { manifests } from "../../e1-acp-agent/source/manifests.ts";
import { DcfAcpClient } from "../../e1-acp-agent/source/acp-client.ts";
const REPO = new URL("../fixtures/task-repo", import.meta.url).pathname;
await initTaskRepo(REPO);
const client = new DcfAcpClient(manifests.codex, {
  permissionPolicy: (req) => {
    console.log("PERMISSION REQUEST:", JSON.stringify(req).slice(0, 300));
    const allow = req.options.find((o) => /allow|proceed|approve/i.test(o.kind));
    return allow ? { selectOptionId: allow.optionId } : { cancel: true };
  },
  onActivity: (_k, _s, a) => { if (a.type === "tool_call") console.log("TOOL:", JSON.stringify(a).slice(0, 200)); },
});
try {
  await client.connect();
  const session = await client.newSession(REPO);
  console.log("SESSION OK");
  const result = await client.prompt(session.sessionId,
    "In this repo, append a new line containing exactly MAGIC-E5-42 to task.txt. Then run `bash verify.sh` to confirm. Reply with one word: done.",
    240000);
  console.log("RESULT:", result.stopReason, "acts:", result.activities.length);
  const text = result.activities.filter((a) => a.type === "agent_message").map((a) => (a as {text:string}).text).join("");
  console.log("AGENT TEXT:", text.slice(0, 300));
} catch (e) { console.log("FAIL:", String(e).slice(0, 400)); }
finally { client.dispose(); const fs = await import("node:fs"); console.log("TASK FILE:", fs.readFileSync(REPO + "/task.txt", "utf8")); process.exit(0); }
