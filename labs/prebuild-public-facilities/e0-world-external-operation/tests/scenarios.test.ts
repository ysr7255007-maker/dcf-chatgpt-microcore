/**
 * E0 — 任务书 §4 必测场景 1-14 + 硬门禁。
 * 全部使用 synthetic worker，不接真实 AI。
 */
import { describe, expect, test } from "bun:test";
import { WorldHost } from "../source/harness.ts";
import { SyntheticWorker } from "../source/synthetic-worker.ts";

async function until(
  host: WorldHost,
  predicate: () => boolean,
  maxFrames = 60,
): Promise<number> {
  let frames = 0;
  while (!predicate() && frames < maxFrames) {
    await host.step();
    frames++;
  }
  return frames;
}

/** 状态迁移序列：逐帧快照 → 折叠连续重复（只保留真实迁移）。 */
function transitions(host: WorldHost, opId: string): string[] {
  const seq = host.gateway.observed
    .flatMap((s) => s.ops.filter((o) => o.opId === opId))
    .map((o) => o.state);
  return seq.filter((state, i) => i === 0 || seq[i - 1] !== state);
}

function start(host: WorldHost, worker: SyntheticWorker, opId: string, script: Parameters<SyntheticWorker["setScript"]>[1], kind = "synthetic-task") {
  worker.setScript(opId, script);
  host.requestStart({ opId, kind, executor: worker.name, owner: "e0-test", spec: { opId } });
}

describe("E0 必测场景（synthetic worker）", () => {
  test("S1 正常完成", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker] });
    await host.start();
    start(host, worker, "op-1", { type: "complete", startDelay: 1, workTicks: 2, result: "r:op-1" });
    await until(host, () => host.latestState("op-1") === "completed");
    expect(host.latestState("op-1")).toBe("completed");
    expect(transitions(host, "op-1")).toEqual(["created", "running", "completed"]);
    expect(host.gateway.counters.resultApplyCountTotal).toBe(1);
    await host.terminate();
  });

  test("S2 两个并发 Operation 相互不污染", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker] });
    await host.start();
    start(host, worker, "op-a", { type: "complete", startDelay: 1, workTicks: 3, result: "r:a" });
    start(host, worker, "op-b", { type: "complete", startDelay: 2, workTicks: 1, result: "r:b" });
    await until(host, () => host.latestState("op-a") === "completed" && host.latestState("op-b") === "completed");
    expect(host.gateway.counters.resultApplyCountTotal).toBe(2);
    // 各自 resultRef 不串：从最终快照检查（observed 只含状态，此处用 counters + 无 guard 忽略佐证）
    expect(host.gateway.counters.guardIgnores.ignored_unknown_op).toBe(0);
    expect(host.gateway.counters.guardIgnores.ignored_out_of_order).toBe(0);
    await host.terminate();
  });

  test("S3 执行中取消", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker] });
    await host.start();
    start(host, worker, "op-c", { type: "complete", startDelay: 1, workTicks: 20, result: "r:c" });
    await until(host, () => host.latestState("op-c") === "running");
    host.requestCancel("op-c");
    await until(host, () => host.latestState("op-c") === "cancelled");
    expect(host.latestState("op-c")).toBe("cancelled");
    await host.terminate();
  });

  test("S4 取消后迟到结果不能复活操作", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker] });
    await host.start();
    start(host, worker, "op-d", { type: "complete", startDelay: 1, workTicks: 5, result: "r:d" });
    await until(host, () => host.latestState("op-d") === "running");
    host.requestCancel("op-d");
    await until(host, () => host.latestState("op-d") === "cancelled");
    // 注入迟到结果 + 等待剧本自然结果
    worker.injectLateResult("op-d", "late-1", "r:late");
    await host.steps(10);
    expect(host.latestState("op-d")).toBe("cancelled");
    expect(host.gateway.counters.guardIgnores.ignored_result_after_cancel_intent).toBeGreaterThanOrEqual(1);
    expect(host.gateway.counters.resultApplyCountTotal).toBe(0);
    await host.terminate();
  });

  test("S5 同一结果重复返回只应用一次", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker] });
    await host.start();
    start(host, worker, "op-e", { type: "duplicate-result", startDelay: 1, result: "r:e", eventId: "evt-e-1" });
    await until(host, () => host.latestState("op-e") === "completed");
    await host.steps(3);
    expect(host.gateway.counters.guardIgnores.ignored_duplicate_result).toBeGreaterThanOrEqual(1);
    const final = host.gateway.observed.at(-1)!.ops.find((o) => o.opId === "op-e")!;
    expect(final.resultApplyCount).toBe(1);
    await host.terminate();
  });

  test("S6 Worker 意外崩溃 → 可观察 error", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker] });
    await host.start();
    start(host, worker, "op-f", { type: "crash-after-start", startDelay: 1, crashTicks: 2 });
    await until(host, () => host.latestState("op-f") === "error");
    expect(host.latestState("op-f")).toBe("error");
    await host.terminate();
  });

  test("S7 Worker 不可用时 World 继续运行，其他 op 不受影响", async () => {
    const dead = new SyntheticWorker("worker-dead");
    const live = new SyntheticWorker("worker-live");
    const host = new WorldHost({ executors: [dead, live] });
    await host.start();
    dead.kill();
    start(host, dead, "op-dead", { type: "complete", startDelay: 1, workTicks: 1, result: "x" });
    start(host, live, "op-live", { type: "complete", startDelay: 1, workTicks: 2, result: "r:live" });
    await until(host, () => host.latestState("op-live") === "completed");
    // 死亡 worker 上的 op 停留在可观察的 created，不阻塞世界
    expect(host.latestState("op-dead")).toBe("created");
    expect(host.latestState("op-live")).toBe("completed");
    // World 帧持续推进（observed 每帧一条快照）
    expect(host.gateway.observed.length).toBeGreaterThan(3);
    await host.terminate();
  });

  test("S8 Worker 重启后可恢复服务（重试路径）", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker], leaseFrames: 4 });
    await host.start();
    start(host, worker, "op-g", { type: "silent-death", startDelay: 1 });
    await until(host, () => host.latestState("op-g") === "running");
    await until(host, () => host.latestState("op-g") === "error"); // lease 判 worker_lost
    expect(host.gateway.counters.leaseTimeouts).toBe(1);
    // 重启 worker 并以重试 op 恢复
    worker.restart();
    start(host, worker, "op-g-retry-1", { type: "complete", startDelay: 1, workTicks: 1, result: "r:g-retry" });
    await until(host, () => host.latestState("op-g-retry-1") === "completed");
    expect(host.latestState("op-g-retry-1")).toBe("completed");
    await host.terminate();
  });

  test("S9 进入等待人工输入状态", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker] });
    await host.start();
    start(host, worker, "op-h", { type: "requires-action", startDelay: 1, request: "confirm-delete", afterResolveTicks: 999, result: "r:h" });
    await until(host, () => host.latestState("op-h") === "requires_action");
    expect(host.latestState("op-h")).toBe("requires_action");
    await host.terminate();
  });

  test("S10 等待人工输入后继续并完成", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker] });
    await host.start();
    start(host, worker, "op-i", { type: "requires-action", startDelay: 1, request: "approve", afterResolveTicks: 3, result: "r:i" });
    await until(host, () => host.latestState("op-i") === "requires_action");
    host.resolveAction("op-i");
    // requires-action 剧本在 actionResolved 后计数；此处由 harness 通知 worker
    worker.markResolved("op-i");
    await until(host, () => host.latestState("op-i") === "completed");
    expect(host.latestState("op-i")).toBe("completed");
    await host.terminate();
  });

  test("S11 World 重建后未完成 operation 显式 orphaned", async () => {
    const worker = new SyntheticWorker();
    const host1 = new WorldHost({ executors: [worker] });
    await host1.start();
    start(host1, worker, "op-done", { type: "complete", startDelay: 1, workTicks: 1, result: "r:done" });
    start(host1, worker, "op-mid", { type: "silent-death", startDelay: 1 });
    await until(host1, () => host1.latestState("op-done") === "completed" && host1.latestState("op-mid") === "running");
    const ledger = host1.ledgerSnapshot();
    await host1.terminate();

    const worker2 = new SyntheticWorker();
    const host2 = new WorldHost({ executors: [worker2], restore: ledger });
    await host2.start();
    await host2.step();
    expect(host2.latestState("op-done")).toBe("completed");
    expect(host2.latestState("op-mid")).toBe("orphaned"); // 禁止伪装 running
    await host2.terminate();
  });

  test("S12 外部队列背压：事件不丢、世界不阻塞", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker], eventQueueCapacity: 2 });
    await host.start();
    start(host, worker, "op-j", { type: "burst", startDelay: 1, progressCount: 12, result: "r:j" });
    await until(host, () => host.latestState("op-j") === "completed", 120);
    expect(host.latestState("op-j")).toBe("completed");
    expect(host.gateway.counters.eventsRejectedBackpressure).toBeGreaterThan(0); // 背压真实发生
    const final = host.gateway.observed.at(-1)!.ops.find((o) => o.opId === "op-j")!;
    expect(final.resultApplyCount).toBe(1); // 结果仍只应用一次
    await host.terminate();
  });

  test("S13 错误不会让 Entity 永久卡在伪 running（lease 兜底）", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker], leaseFrames: 3 });
    await host.start();
    start(host, worker, "op-k", { type: "silent-death", startDelay: 1 });
    await host.steps(12);
    expect(host.latestState("op-k")).toBe("error");
    // 终局快照中不允许存在仍在 running 的 op
    const last = host.gateway.observed.at(-1)!;
    expect(last.ops.every((o) => o.state !== "running" && o.state !== "created")).toBe(true);
    await host.terminate();
  });

  test("S14 System defs 顺序改变不改变行为", async () => {
    const run = async (reverseDefs: boolean) => {
      const worker = new SyntheticWorker();
      const host = new WorldHost({ executors: [worker], reverseDefs });
      await host.start();
      start(host, worker, "op-l", { type: "complete", startDelay: 1, workTicks: 2, result: "r:l" });
      await until(host, () => host.latestState("op-l") === "completed");
      const seq = transitions(host, "op-l");
      await host.terminate();
      return seq;
    };
    const normal = await run(false);
    const reversed = await run(true);
    expect(normal).toEqual(["created", "running", "completed"]);
    expect(reversed).toEqual(normal);
  });
});

describe("E0 硬门禁", () => {
  test("G1 World 主循环不被外部 I/O 阻塞", async () => {
    const worker = new SyntheticWorker();
    const host = new WorldHost({ executors: [worker], leaseFrames: 100 });
    await host.start();
    // 一个长期挂起的外部 op 存在期间，连续跑帧并测量 world.execute 耗时
    start(host, worker, "op-slow", { type: "silent-death", startDelay: 1 });
    await host.steps(2);
    const maxExecuteMs = await host.steps(40);
    expect(host.latestState("op-slow")).toBe("running");
    expect(maxExecuteMs).toBeLessThan(10); // 单帧内存操作，远低于任何真实 I/O
    await host.terminate();
  });

  test("G6 长期身份只使用领域稳定 opId（重建后身份连续）", async () => {
    const worker = new SyntheticWorker();
    const host1 = new WorldHost({ executors: [worker] });
    await host1.start();
    start(host1, worker, "op-id-x", { type: "complete", startDelay: 1, workTicks: 1, result: "r:x" });
    await until(host1, () => host1.latestState("op-id-x") === "completed");
    const ledger = host1.ledgerSnapshot();
    await host1.terminate();
    // 台账快照只包含领域字段，不含任何 entity 身份
    for (const entry of ledger) {
      expect(Object.keys(entry).sort()).toEqual(
        ["executor", "kind", "opId", "owner", "resultRef", "state"].sort(),
      );
    }
    const host2 = new WorldHost({ executors: [new SyntheticWorker()], restore: ledger });
    await host2.start();
    await host2.step();
    expect(host2.latestState("op-id-x")).toBe("completed"); // 同一 opId 在新世界可查
    await host2.terminate();
  });

  test("G7 核心桥接代码零 provider 业务分支（源码扫描）", async () => {
    const fs = await import("node:fs/promises");
    const dir = new URL("../source/", import.meta.url);
    const forbidden = [
      "deepseek", "codex", "claude", "openai", "anthropic", "gemini",
      "lancedb", "litellm", "lmstudio", "opencode",
    ];
    const coreFiles = ["contract.ts", "bridge.ts", "harness.ts", "synthetic-worker.ts"];
    for (const file of coreFiles) {
      const content = (await fs.readFile(new URL(file, dir))).toString().toLowerCase();
      for (const word of forbidden) {
        expect(content.includes(word)).toBe(false);
      }
    }
    // 源码扫描：无 if provider == 形式分支
    for (const file of coreFiles) {
      const content = (await fs.readFile(new URL(file, dir))).toString();
      expect(/provider\s*==/.test(content)).toBe(false);
    }
  });
});
