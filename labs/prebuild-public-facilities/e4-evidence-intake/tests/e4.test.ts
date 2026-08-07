/**
 * E4 — Evidence Source 管理 × 可靠采集（任务书 §8）。
 * Route A（薄 Intake）全量行为验证；Route B/C 早停证据见 decision.md。
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { ThinIntake } from "../source/intake.ts";
import { GitProvider, ProbeProvider, SyntheticProvider } from "../source/providers.ts";

const DATA_ROOT = new URL("../fixtures/runs", import.meta.url).pathname;
let dirs: string[] = [];

async function freshIntake(name: string, opts?: { queueCapacity?: number; slowDownstreamEvery?: number }): Promise<ThinIntake> {
  const dir = `${DATA_ROOT}/${name}-${Date.now()}`;
  dirs.push(dir);
  await mkdir(dir, { recursive: true });
  return new ThinIntake({ dataDir: dir, ...opts });
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
});

describe("E4 Route A：薄 Intake × 三 Provider", () => {
  test("T1 生命周期 9 态 + 双 discovery 不产生双 Provider", async () => {
    const intake = await freshIntake("t1");
    const synthetic = new SyntheticProvider("syn-1");
    // 同一来源被两种 discovery 方式发现
    const first = intake.discover("syn-1", "synthetic", "manual-scan");
    const second = intake.discover("syn-1", "synthetic", "mdns-browse");
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(intake.registrationOf("syn-1")?.discoveredVia).toEqual(["manual-scan", "mdns-browse"]);
    // 生命周期：discovered → configured → started → healthy → stopped → removed
    intake.attach("syn-1", synthetic);
    intake.configure("syn-1");
    expect(intake.stateOf("syn-1")).toBe("configured");
    intake.start("syn-1");
    expect(intake.stateOf("syn-1")).toBe("healthy");
    intake.stop("syn-1");
    expect(intake.stateOf("syn-1")).toBe("stopped");
    intake.remove("syn-1");
    expect(intake.stateOf("syn-1")).toBe("removed");
    // 非法迁移被拒绝（HA 状态机纪律）
    intake.discover("syn-2", "synthetic", "scan");
    expect(() => intake.start("syn-2")).toThrow();
  }, 60000);

  test("T2 时间四拆开：processing order 不冒充 occurrence order", async () => {
    const intake = await freshIntake("t2");
    const synthetic = new SyntheticProvider("syn-t2");
    intake.discover("syn-t2", "synthetic", "scan");
    intake.attach("syn-t2", synthetic);
    intake.configure("syn-t2");
    intake.start("syn-t2");
    // 真实发生顺序 0<1<2，但 seq=0 延迟 5 tick、seq=2 先到
    synthetic.setScript([
      { seq: 0, occurrenceTime: 1000, payload: "first-in-reality", delayTicks: 5, times: 1 },
      { seq: 1, occurrenceTime: 2000, payload: "second", delayTicks: 1, times: 1 },
      { seq: 2, occurrenceTime: 3000, payload: "third", delayTicks: 2, times: 1 },
    ]);
    synthetic.advance(10);
    intake.pump();
    const counters = intake.counters();
    expect(counters.storedCount).toBe(3);
    expect(counters.outOfOrderObserved).toBeGreaterThanOrEqual(1); // 处理顺序确实乱了
    // 按 occurrence 查询：现实顺序恢复
    const ordered = intake.byOccurrence("syn-t2");
    expect(ordered.map((e) => e.payload)).toEqual(["first-in-reality", "second", "third"]);
    // 处理顺序与现实顺序显式不同（证据：两者并存且可区分）
    const processing = [...ordered].sort((a, b) => a.processingOrder - b.processingOrder);
    expect(processing.map((e) => e.payload)).not.toEqual(ordered.map((e) => e.payload));
  }, 60000);

  test("T3 Probe 崩溃 → unavailable → 重启恢复（真独立进程）", async () => {
    const intake = await freshIntake("t3");
    const probe = new ProbeProvider("probe-1", { PROBE_COUNT: "50", PROBE_INTERVAL_MS: "20" });
    intake.discover("probe-1", "external-probe", "registry");
    intake.attach("probe-1", probe);
    intake.configure("probe-1");
    intake.start("probe-1");
    expect(probe.alive()).toBe(true);
    // 等事件流入
    await new Promise((r) => setTimeout(r, 300));
    probe.flushRetries();
    intake.pump();
    const before = intake.counters().storedCount;
    expect(before).toBeGreaterThan(0);
    // kill 独立进程 → supervise 必须观察到 unavailable（不得伪装 healthy）
    probe.kill();
    intake.supervise();
    expect(intake.stateOf("probe-1")).toBe("unavailable");
    // 重启恢复
    probe.spawnProcess();
    intake.recover("probe-1");
    expect(intake.stateOf("probe-1")).toBe("healthy");
    await new Promise((r) => setTimeout(r, 400));
    probe.flushRetries();
    intake.pump();
    expect(intake.counters().storedCount).toBeGreaterThan(before);
    probe.kill();
  }, 120000);

  test("T4 重复/背压/intake 重启（World restart）恢复", async () => {
    const intake = await freshIntake("t4", { queueCapacity: 4 });
    const synthetic = new SyntheticProvider("syn-t4");
    intake.discover("syn-t4", "synthetic", "scan");
    intake.attach("syn-t4", synthetic);
    intake.configure("syn-t4");
    intake.start("syn-t4");
    // 重复发送（times=3）+ 事件数超过队列容量（背压）
    synthetic.setScript(
      Array.from({ length: 10 }, (_, i) => ({
        seq: i,
        occurrenceTime: 1000 + i,
        payload: `ev-${i}`,
        delayTicks: 1,
        times: i === 0 ? 3 : 1,
      })),
    );
    for (let i = 0; i < 30 && intake.counters().storedCount < 10; i++) {
      synthetic.advance(1);
      intake.pump();
    }
    const counters = intake.counters();
    expect(counters.storedCount).toBe(10); // 不丢
    expect(counters.duplicates).toBeGreaterThanOrEqual(2); // 重复被识别
    // intake 重启：store 从磁盘恢复，幂等
    const restored = intake.restart();
    expect(restored.restoredStore).toBe(10);
    expect(intake.storedCount()).toBe(10);
  }, 60000);

  test("T5 Git 可重放来源：cursor 恢复、无 WAL、重复重放去重", async () => {
    const intake = await freshIntake("t5");
    const repo = new URL("../../../../", import.meta.url).pathname; // worktree 本身是 git repo
    const git = new GitProvider("git-main", repo);
    intake.discover("git-main", "git", "fs-scan");
    intake.attach("git-main", git);
    intake.configure("git-main");
    intake.start("git-main");
    intake.pump();
    const firstCount = intake.counters().storedCount;
    expect(firstCount).toBeGreaterThan(3);
    expect(intake.counters().walExists).toBe(false); // 可重放来源不落 WAL
    // World restart：新 intake 从 cursor 恢复 → 不产生重复业务数据
    const dir = `${DATA_ROOT}/t5-b-${Date.now()}`;
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    const intake2 = new ThinIntake({ dataDir: dir });
    const git2 = new GitProvider("git-main", repo);
    intake2.discover("git-main", "git", "fs-scan");
    intake2.attach("git-main", git2);
    intake2.configure("git-main");
    intake2.start("git-main"); // replayable(null)：全新 cursor → 全量重放
    intake2.pump();
    expect(intake2.counters().storedCount).toBe(firstCount); // 全量一致（确定性重放）
    // 同一 intake 内再次 start（cursor 已在队尾）→ 无新增
    intake.pump();
    expect(intake.counters().storedCount).toBe(firstCount);
  }, 120000);

  test("T6 下游变慢不丢事件（slow downstream + 背压重试）", async () => {
    const intake = await freshIntake("t6", { queueCapacity: 4, slowDownstreamEvery: 2 });
    const synthetic = new SyntheticProvider("syn-t6");
    intake.discover("syn-t6", "synthetic", "scan");
    intake.attach("syn-t6", synthetic);
    intake.configure("syn-t6");
    intake.start("syn-t6");
    synthetic.setScript(
      Array.from({ length: 8 }, (_, i) => ({
        seq: i,
        occurrenceTime: 1000 + i,
        payload: `slow-${i}`,
        delayTicks: 1,
        times: 1,
      })),
    );
    synthetic.advance(2);
    for (let i = 0; i < 30 && intake.counters().storedCount < 8; i++) {
      synthetic.advance(1); // 背压滞留事件由生产者 tick 重试（ack 语义）
      intake.pump();
    }
    expect(intake.counters().storedCount).toBe(8); // 慢下游只延迟，不丢失
  }, 60000);
});
