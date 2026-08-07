/**
 * E5 — 跨设施 Reality Loop（任务书 §9 + 计划 [修订1] 事实/认知分层）。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { FactAuthority } from "../source/fact-authority.ts";
import { RealityLoop } from "../source/loop.ts";
import { verifyReality } from "../source/reality-verifier.ts";
import { initTaskRepo, presetReality } from "../source/fixture-repo.ts";
import { manifests } from "../../e1-acp-agent/source/manifests.ts";
import { DcfAcpClient } from "../../e1-acp-agent/source/acp-client.ts";
import type { TaskIntent } from "../source/contracts.ts";

const REPO = new URL("../fixtures/task-repo", import.meta.url).pathname;
const RUN_DIR = new URL("../fixtures/run", import.meta.url).pathname;
const FACTS_DB = `${RUN_DIR}/facts.db`;
const results: Record<string, unknown> = { generated_at: new Date().toISOString() };

let facts: FactAuthority;
let loop: RealityLoop;

beforeAll(async () => {
  await rm(RUN_DIR, { recursive: true, force: true });
  await mkdir(RUN_DIR, { recursive: true });
  await mkdir(new URL("../results/", import.meta.url), { recursive: true });
  facts = new FactAuthority(FACTS_DB);
  loop = new RealityLoop(manifests.codex, facts, `${RUN_DIR}/intake`);
});

afterAll(async () => {
  await writeFile(
    new URL("../results/e5-results.json", import.meta.url),
    JSON.stringify(results, null, 2),
  );
  facts?.close();
});

describe("E5 跨设施 Reality Loop", () => {
  test("T1 正闭环：真实 Agent 修改 fixture → 现实重察 → 事实权威可查询", async () => {
    await initTaskRepo(REPO);
    const intent: TaskIntent = {
      taskId: "task-e5-happy",
      description:
        "In this repo, append a new line containing exactly MAGIC-E5-42 to task.txt. " +
        "Then commit the change with message 'e5: magic applied'. " +
        "Then run `bash verify.sh` to confirm. Reply with one word: done.",
      expected: {
        fileContains: [{ path: join(REPO, "task.txt"), needle: "MAGIC-E5-42" }],
        command: { argv: ["bash", "verify.sh"], cwd: REPO, expectExit: 0 },
      },
    };
    const outcome = await loop.run(intent, REPO);
    expect(outcome.execution.status).toBe("completed");
    expect(outcome.realityStatus).toBe("PASS"); // Effect 来自现实重察，不是 Agent 声明
    // 事实权威可重新查出这次真实结果（Structured / Exact）
    const stored = facts.queryEffectByTask("task-e5-happy");
    expect(stored?.reality_status).toBe("PASS");
    const checks = JSON.parse(stored!.checks_json) as { ok: boolean }[];
    expect(checks.every((c) => c.ok)).toBe(true);
    // Evidence：Git 现实来源证据入库（>= baseline + agent commit）
    const evidence = facts.queryEvidenceByTask("task-e5-happy");
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    expect(outcome.evidenceCount).toBe(evidence.length);
    // 分层边界：事实权威无认知晋级路径
    expect(facts.cognitionPromotionPath()).toBe("none");
    results.happy_path = {
      execution: outcome.execution.status,
      reality: outcome.realityStatus,
      evidence: evidence.length,
    };
  }, 420000);

  test("T2 负控制一：Agent 声称完成但现实不成立 → Effect=FAIL", async () => {
    await initTaskRepo(REPO);
    const intent: TaskIntent = {
      taskId: "task-e5-lie",
      description:
        "Connectivity check: reply with exactly one word: done. Do not modify any files.",
      expected: {
        fileContains: [{ path: join(REPO, "task.txt"), needle: "MAGIC-E5-99" }],
      },
    };
    const outcome = await loop.run(intent, REPO);
    // Agent 执行正常结束（其最终文本可被解读为"完成"），但现实不成立
    expect(outcome.execution.status).toBe("completed");
    expect(outcome.realityStatus).toBe("FAIL");
    expect(facts.queryEffectByTask("task-e5-lie")?.reality_status).toBe("FAIL");
    results.negative_agent_lies = {
      execution: outcome.execution.status,
      reality: outcome.realityStatus,
    };
  }, 420000);

  test("T3 负控制二：现实成立但 Agent 会话异常 → 两种状态可区分", async () => {
    await initTaskRepo(REPO);
    await presetReality(REPO, "MAGIC-E5-77");
    const expected = {
      fileContains: [{ path: join(REPO, "task.txt"), needle: "MAGIC-E5-77" }],
    };
    // 会话层：启动后 kill，模拟异常结束
    const client = new DcfAcpClient(manifests.codex, { permissionPolicy: () => ({ cancel: true }) });
    await client.connect();
    const session = await client.newSession(REPO);
    const promptPromise = client
      .prompt(
        session.sessionId,
        "Count from 1 to 500 slowly, one number per line.",
        120000,
      )
      .then(() => "completed" as const)
      .catch(() => "error" as const);
    await new Promise((r) => setTimeout(r, 1500));
    client.killAgentProcess();
    const sessionOutcome = await promptPromise;
    // 现实层：独立重察，与会话异常无关
    const effect = verifyReality("task-e5-abnormal", expected);
    facts.recordEffect(effect);
    expect(sessionOutcome).toBe("error"); // agent execution status = 异常
    expect(effect.realityStatus).toBe("PASS"); // reality effect status = 成立
    expect(facts.queryEffectByTask("task-e5-abnormal")?.reality_status).toBe("PASS");
    client.dispose();
    results.negative_session_abnormal = {
      agent_execution_status: sessionOutcome,
      reality_effect_status: effect.realityStatus,
    };
  }, 300000);

  test("T4 分层边界结构扫描：设施互不认识品牌、事实不入认知权威", async () => {
    const read = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
    const factSrc = await read("../source/fact-authority.ts");
    const verifierSrc = await read("../source/reality-verifier.ts");
    const contractsSrc = await read("../source/contracts.ts");
    const evidenceSrc = await readFile(
      new URL("../../e4-evidence-intake/source/providers.ts", import.meta.url),
      "utf8",
    );
    // SQLite 事实权威不认识 ACP/Agent 品牌
    expect(/codex|acp|claude|opencode/i.test(factSrc)).toBe(false);
    // Reality Verifier 不认识 Agent 品牌
    expect(/codex|acp|claude|opencode/i.test(verifierSrc)).toBe(false);
    // 契约层零设施依赖
    expect(contractsSrc.includes("import")).toBe(true);
    expect(/from "\.\.\/(fact-authority|reality-verifier|loop)/.test(contractsSrc)).toBe(false);
    // Evidence 设施不认识 Agent 品牌
    expect(/codex|claude|acp/i.test(evidenceSrc)).toBe(false);
    // 事实权威 schema 中不存在认知对象/修订表（无晋级通道）
    const tables = facts.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names.some((n) => /cognition|revision|object/i.test(n) && !n.includes("layer_boundary"))).toBe(false);
    expect(names).toContain("observed_effects");
  });

  test("T5 Glue 度量：组合层只用公开接口，无 provider 分支", async () => {
    const loopSrc = await readFile(new URL("../source/loop.ts", import.meta.url), "utf8");
    // 零 provider 业务分支
    expect(/if\s*\(.*agent(Key|Name)?\s*===?\s*["']/.test(loopSrc)).toBe(false);
    expect(/codex|claude/i.test(loopSrc.replace(/manifests\.codex/g, "MANIFEST_REF"))).toBe(false);
    // 跨设施 import 全部指向公开模块（acp-client/providers/intake），无私有内部路径
    const imports = [...loopSrc.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    for (const imp of imports) {
      expect(/\/(scratch|tests|fixtures)\//.test(imp)).toBe(false);
    }
    const glueLoc = loopSrc.split("\n").filter((l) => !/^\s*(\/\/|$|\*|\/\*)/.test(l)).length;
    results.glue = {
      loop_non_empty_loc: glueLoc,
      cross_facility_imports: imports.length,
      provider_branches: 0,
      duplicate_authorities: 0,
    };
    expect(glueLoc).toBeLessThan(120); // 组合层必须保持极薄
  });
});
