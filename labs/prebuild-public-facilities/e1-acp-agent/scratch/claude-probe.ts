import { DcfAcpClient } from "../source/acp-client.ts";

const manifest = {
  agentKey: "claude",
  command: [new URL("../node_modules/.bin/claude-agent-acp", import.meta.url).pathname],
  promptFieldName: "content" as const,
};

const client = new DcfAcpClient(manifest, {
  permissionPolicy: () => ({ cancel: true }),
  onActivity: (key, sid, activity) => {
    if (activity.type !== "agent_message" && activity.type !== "agent_thought")
      console.log("ACT:", key, activity.type, JSON.stringify(activity).slice(0, 160));
  },
});

try {
  const profile = await client.connect();
  console.log("PROFILE:", JSON.stringify({ ...profile, rawCapabilities: undefined }));
  const session = await client.newSession(new URL("../fixtures/", import.meta.url).pathname);
  console.log("SESSION:", session.sessionId);
  const result = await client.prompt(
    session.sessionId,
    "Reply with exactly one word: ready. Do not use any tools.",
    120000,
  );
  console.log("RESULT:", result.stopReason, "activities:", result.activities.length);
  const list = await client.listSessions();
  console.log("LIST:", list.supported, Array.isArray(list.sessions) ? list.sessions.length : -1);
} catch (e) {
  console.log("FAIL:", String(e).slice(0, 500));
} finally {
  client.dispose();
  process.exit(0);
}
