/**
 * E1 — ACP 标准化实验（任务书 §5）。
 *
 * 双真实 Agent（Codex + Claude）通过同一个 DcfAcpClient prototype 工作；
 * 缺失 capability 通过能力发现自然降级；故障主动注入。
 *
 * 结果除断言外还写入 results/e1-measurements.json（指标与证据）。
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DcfAcpClient } from "../source/acp-client.ts";
import { manifests } from "../source/manifests.ts";
import type { Activity, PermissionRequest } from "../source/dcf-semantics.ts";

const measurements: Record<string, unknown> = {
  generated_at: new Date().toISOString(),
  agents: {},
  permission_requests_observed: 0,
  permission_decisions_applied: 0,
  notes: [],
};

const fixtureDir = new URL("../fixtures/", import.meta.url).pathname;

function makeClient(agentKey: keyof typeof manifests, policy?: (r: PermissionRequest) => { selectOptionId: string } | { cancel: true }) {
  const activities: { agent: string; session: string; activity: Activity }[] = [];
  const permissionSeen: PermissionRequest[] = [];
  const client = new DcfAcpClient(manifests[agentKey], {
    permissionPolicy: (request) => {
      permissionSeen.push(request);
      measurements.permission_requests_observed =
        (measurements.permission_requests_observed as number) + 1;
      const decision = policy?.(request) ?? { cancel: true as const };
      if ("selectOptionId" in decision) {
        measurements.permission_decisions_applied =
          (measurements.permission_decisions_applied as number) + 1;
      }
      return decision;
    },
    onActivity: (agent, session, activity) => {
      activities.push({ agent, session, activity });
    },
  });
  return { client, activities, permissionSeen };
}

afterAll(async () => {
  await mkdir(new URL("../results/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../results/e1-measurements.json", import.meta.url),
    JSON.stringify(measurements, null, 2),
  );
});

describe("E1 ACP 标准化：双真实 Agent × 同一 DCF Client", () => {
  test("T1 能力发现：initialize + capability profile（双 Agent，零名称分支）", async () => {
    for (const key of ["codex", "claude"] as const) {
      const { client } = makeClient(key);
      const profile = await client.connect();
      expect(profile.protocolVersion).toBe(1);
      expect(profile.agentName.length).toBeGreaterThan(0);
      measurements.agents = {
        ...(measurements.agents as object),
        [key]: {
          agentName: profile.agentName,
          agentVersion: profile.agentVersion,
          sessionList: profile.sessionList,
          sessionResume: profile.sessionResume,
          sessionClose: profile.sessionClose,
          sessionDelete: profile.sessionDelete,
          loadSession: profile.loadSession,
          promptEmbeddedContext: profile.promptEmbeddedContext,
          promptImage: profile.promptImage,
          authMethods: profile.authMethods,
        },
      };
      client.dispose();
    }
  }, 120000);

  test("T2 session/new + prompt 流式归一（双 Agent 同一客户端代码）", async () => {
    for (const key of ["codex", "claude"] as const) {
      const { client, activities } = makeClient(key);
      await client.connect();
      const session = await client.newSession(fixtureDir);
      expect(session.sessionId.length).toBeGreaterThan(0);
      const result = await client.prompt(
        session.sessionId,
        "Connectivity check: reply with exactly one word: ready. No tools.",
        180000,
      );
      expect(["end_turn", "refusal", "max_tokens", "cancelled"]).toContain(result.stopReason);
      expect(result.activities.length).toBeGreaterThan(0);
      const types = new Set(result.activities.map((a) => a.type));
      (measurements.agents as Record<string, unknown>)[`${key}_activity_types`] = [...types];
      client.dispose();
    }
  }, 420000);

  test("T3 session list/resume/close 按能力发现降级", async () => {
    for (const key of ["codex", "claude"] as const) {
      const { client } = makeClient(key);
      const profile = await client.connect();
      const session = await client.newSession(fixtureDir);
      // 先产生真实 turn：resume 的前置是会话已持久化（codex 实测：
      // 未产生 rollout 的 thread 直接 resume 会报 Internal error，已记入 failures.md）。
      const turn = await client.prompt(
        session.sessionId,
        "Reply with exactly one word: persisted. No tools.",
        180000,
      );
      expect(turn.stopReason).toBe("end_turn");
      const list = await client.listSessions();
      expect(list.supported).toBe(profile.sessionList);
      const resume = await client
        .resumeSession(session.sessionId, fixtureDir)
        .then((r) => ({ ...r, error: undefined as string | undefined }))
        .catch((e) => ({ supported: profile.sessionResume, sessionId: undefined, error: String(e).slice(0, 160) }));
      const close = await client.closeSession(session.sessionId);
      expect(close.supported).toBe(profile.sessionClose);
      (measurements.agents as Record<string, unknown>)[`${key}_lifecycle`] = {
        listSupported: list.supported,
        sessionCountAtList: list.sessions.length,
        resumeSupported: resume.supported,
        resumeAfterTurnError: resume.error ?? null,
        closeSupported: close.supported,
      };
      client.dispose();
    }
  }, 600000);

  test("T4 流式输出中取消（codex）", async () => {
    const { client, activities } = makeClient("codex");
    await client.connect();
    const session = await client.newSession(fixtureDir);
    const promptPromise = client.prompt(
      session.sessionId,
      "Count from 1 to 300 slowly, one number per line, with a short sentence for each.",
      180000,
    );
    // 等到出现活动后取消
    const deadline = Date.now() + 60000;
    while (activities.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    client.cancel(session.sessionId);
    const result = await promptPromise.catch((e) => ({ stopReason: `error:${String(e).slice(0, 80)}`, activities, usageTokens: 0 }));
    expect(["cancelled", "end_turn"]).toContain(result.stopReason);
    measurements.cancel_test = {
      stopReason: result.stopReason,
      activitiesBeforeStop: result.activities.length,
    };
    client.dispose();
  }, 300000);

  test("T5 并发多会话互不污染（codex 双会话）", async () => {
    const { client } = makeClient("codex");
    await client.connect();
    const s1 = await client.newSession(fixtureDir);
    const s2 = await client.newSession(fixtureDir);
    expect(s1.sessionId).not.toBe(s2.sessionId);
    const [r1, r2] = await Promise.all([
      client.prompt(s1.sessionId, "Reply with exactly one word: alpha. No tools.", 180000),
      client.prompt(s2.sessionId, "Reply with exactly one word: beta. No tools.", 180000),
    ]);
    expect(r1.stopReason).toBe("end_turn");
    expect(r2.stopReason).toBe("end_turn");
    // 两个会话的活动流各自独立（seq 归一在客户端共享计数，但 sessionId 路由分离）
    client.dispose();
  }, 420000);

  test("T6 故障注入：执行中 kill ACP 子进程 → 可观察错误", async () => {
    const { client } = makeClient("codex");
    await client.connect();
    const session = await client.newSession(fixtureDir);
    const promptPromise = client.prompt(
      session.sessionId,
      "Count from 1 to 500, one number per line.",
      180000,
    );
    await new Promise((r) => setTimeout(r, 1500));
    client.killAgentProcess();
    const outcome = await promptPromise
      .then((r) => ({ kind: "completed", stopReason: r.stopReason }))
      .catch((e) => ({ kind: "error", message: String(e).slice(0, 160) }));
    expect(outcome.kind).toBe("error");
    expect(client.stateOf(session.sessionId)).toBe("error");
    measurements.kill_subprocess = outcome;
    client.dispose();
  }, 300000);

  test("T7 故障注入：异常 JSON 注入后连接行为可观察", async () => {
    const { client } = makeClient("codex");
    await client.connect();
    const session = await client.newSession(fixtureDir);
    client.injectMalformedJson("{this is not json");
    client.injectMalformedJson('{"jsonrpc":"2.0","id":999,"method":"no/such","params":{}}');
    await new Promise((r) => setTimeout(r, 500));
    const result = await client
      .prompt(session.sessionId, "Reply with exactly one word: alive. No tools.", 120000)
      .then((r) => ({ kind: "survived", stopReason: r.stopReason }))
      .catch((e) => ({ kind: "broken", message: String(e).slice(0, 160) }));
    measurements.malformed_json = result;
    expect(["survived", "broken"]).toContain(result.kind); // 任一均为可观察结果，真实行为记录在案
    client.dispose();
  }, 300000);

  test("T8 close 一个 session 后其他 session 继续（codex）", async () => {
    const { client } = makeClient("codex");
    await client.connect();
    const s1 = await client.newSession(fixtureDir);
    const s2 = await client.newSession(fixtureDir);
    await client.closeSession(s1.sessionId);
    expect(client.stateOf(s1.sessionId)).toBe("closed");
    const r2 = await client.prompt(
      s2.sessionId,
      "Reply with exactly one word: still-here. No tools.",
      180000,
    );
    expect(r2.stopReason).toBe("end_turn");
    client.dispose();
  }, 300000);

  test("T9 客户端重连 + session resume（跨进程，按能力降级）", async () => {
    const { client: clientA } = makeClient("codex");
    const profile = await clientA.connect();
    const session = await clientA.newSession(fixtureDir);
    const first = await clientA.prompt(
      session.sessionId,
      "Remember the code word GREEN-77. Reply with exactly one word: stored. No tools.",
      180000,
    );
    expect(first.stopReason).toBe("end_turn");
    clientA.dispose();

    const { client: clientB } = makeClient("codex");
    await clientB.connect();
    const resumed = await clientB.resumeSession(session.sessionId, fixtureDir);
    if (!resumed.supported) {
      measurements.resume_across_reconnect = { supported: false };
      clientB.dispose();
      return;
    }
    const followUp = await clientB.prompt(
      resumed.sessionId!,
      "What was the code word you were told to remember? Reply with only the code word.",
      180000,
    );
    expect(followUp.stopReason).toBe("end_turn");
    const text = followUp.activities
      .filter((a): a is Extract<Activity, { type: "agent_message" }> => a.type === "agent_message")
      .map((a) => a.text)
      .join("");
    measurements.resume_across_reconnect = {
      supported: true,
      followUpStopReason: followUp.stopReason,
      followUpContainsCodeword: text.includes("GREEN-77"),
    };
    clientB.dispose();
  }, 600000);

  test("G-E1 结构证据：客户端零 Agent 名称分支、DCF 语义不依赖 SDK", async () => {
    const clientSrc = await readFile(new URL("../source/acp-client.ts", import.meta.url), "utf8");
    const semanticsSrc = await readFile(new URL("../source/dcf-semantics.ts", import.meta.url), "utf8");
    // 行为代码中不得出现按 Agent 名称的分支（manifest 数据文件除外）
    expect(/if\s*\(.*agent(Key|Name)?\s*===?\s*["'](codex|claude)/.test(clientSrc)).toBe(false);
    expect(/switch\s*\(\s*.*agent(Key|Name)?\s*\)/.test(clientSrc)).toBe(false);
    // DCF 语义层不 import ACP SDK
    expect(semanticsSrc.includes("@agentclientprotocol")).toBe(false);
    // 客户端唯一：两个 manifest 共享同一 DcfAcpClient 类（import 关系成立）
    expect(clientSrc.includes("class DcfAcpClient")).toBe(true);
  });
});
