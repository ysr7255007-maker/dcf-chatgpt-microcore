/**
 * E0 真实验证（任务书 §4）：
 *   1 个真实异步 AI HTTP Turn + 1 个真实 ACP Agent Session
 *   复用同一套 ExternalOperation 管理骨架（同一个 ExternalExecutor 接口、
 *   同一个 WorldHost、同一组守卫），不各自另造生命周期。
 *
 * 硬门禁 G2 的结构证据：两个真实执行器均不 import 生命周期状态定义。
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { WorldHost } from "../source/harness.ts";
import { HttpTurnExecutor } from "../source/executors/http-turn-executor.ts";
import { AcpSessionExecutor } from "../source/executors/acp-session-executor.ts";

async function envKey(): Promise<string> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const text = await readFile(new URL("../../.env.local", import.meta.url), "utf8");
  const match = text.match(/^DEEPSEEK_API_KEY=(.+)$/m);
  if (!match) throw new Error("DEEPSEEK_API_KEY not available");
  return match[1].trim();
}

async function untilState(
  host: WorldHost,
  opId: string,
  states: string[],
  maxMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await host.step();
    const state = host.latestState(opId);
    if (state && states.includes(state)) return state;
    await new Promise((r) => setTimeout(r, 50));
  }
  return host.latestState(opId);
}

describe("E0 真实验证：同一骨架承载真实异步能力", () => {
  test("R1 真实异步 AI HTTP Turn（ExternalOperation 骨架）", async () => {
    const key = await envKey();
    const http = new HttpTurnExecutor();
    const host = new WorldHost({ executors: [http], leaseFrames: 100000 });
    await host.start();
    host.requestStart({
      opId: "real-ai-turn-1",
      kind: "ai-turn",
      executor: http.name,
      owner: "e0-real",
      spec: {
        url: "https://api.deepseek.com/v1/chat/completions",
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: {
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
          max_tokens: 2048,
        },
        resultPath: "choices.0.finish_reason",
        timeoutMs: 120000,
      },
    });
    const final = await untilState(host, "real-ai-turn-1", ["completed", "error"], 150000);
    expect(final).toBe("completed");
    expect(host.gateway.counters.resultApplyCountTotal).toBe(1);
    // World 主循环在等待真实网络 I/O 期间持续跑帧且单帧不被阻塞
    expect(host.gateway.observed.length).toBeGreaterThan(2);
    await host.terminate();
  }, 200000);

  test("R2 真实 ACP Agent Session（ExternalOperation 骨架）", async () => {
    const acp = new AcpSessionExecutor();
    const host = new WorldHost({ executors: [acp], leaseFrames: 100000 });
    await host.start();
    const bin = new URL("../node_modules/.bin/codex-acp", import.meta.url).pathname;
    const cwd = new URL("../fixtures/acp-work/", import.meta.url).pathname;
    const codexHome = new URL("../scratch/codex-home-e0", import.meta.url).pathname;
    host.requestStart({
      opId: "real-acp-session-1",
      kind: "agent-session",
      executor: acp.name,
      owner: "e0-real",
      spec: {
        agentCommand: [bin],
        cwd,
        // 实验隔离的 CODEX_HOME（ChatGPT 登录态）：本机默认 config 的 custom provider
        // 使 app-server model/list 返回空，导致 session/new 失败（已记入 failures.md）。
        env: { CODEX_HOME: codexHome },
        prompt:
          "This is a connectivity check. Reply with exactly one word: ready. Do not edit any files.",
        timeoutMs: 180000,
      },
    });
    const final = await untilState(host, "real-acp-session-1", ["completed", "error"], 200000);
    expect(final).toBe("completed");
    expect(host.gateway.counters.resultApplyCountTotal).toBe(1);
    await host.terminate();
  }, 260000);

  test("G2 结构证据：真实执行器不自带平行生命周期", async () => {
    const files = [
      "../source/executors/http-turn-executor.ts",
      "../source/executors/acp-session-executor.ts",
    ];
    for (const file of files) {
      const content = await readFile(new URL(file, import.meta.url), "utf8");
      // 不允许 import 或重定义生命周期状态集：状态权威只在 World（bridge.ts）
      expect(content.includes("OPERATION_STATES")).toBe(false);
      expect(content.includes("TERMINAL_STATES")).toBe(false);
      expect(/type\s+\w*State\s*=/.test(content)).toBe(false);
      // 必须实现统一接口
      expect(content.includes("implements ExternalExecutor")).toBe(true);
    }
  });
});
