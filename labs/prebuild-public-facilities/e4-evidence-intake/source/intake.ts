/**
 * E4 — Route A：DCF 薄 Intake（Bun 实现，机制继承见 decision.md 继承表）。
 *
 * 继承的已踩坑机制（不是"参考了一下"）：
 *   - Home Assistant：Source 生命周期状态机 + unique_id 注册去重（双 discovery 不产生双实体）；
 *   - OTel Collector：receiver/processor/exporter 三段分离 + ack 语义（生产者持有事件直到确认）；
 *   - Redpanda Connect：持久 cursor + checkpoint 恢复（可重放 Source 不建 WAL）。
 *
 * 时间纪律（任务书 §8.3）：四个时间轴从第一天分开，
 * processing order 永远不得冒充 occurrence order。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const SOURCE_STATES = [
  "discovered",
  "configured",
  "started",
  "healthy",
  "unavailable",
  "recovered",
  "stopped",
  "removed",
] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

/** RawEvidence：四个时间轴显式分离。 */
export interface RawEvidence {
  /** 领域稳定身份：sourceId + 序列 或内容哈希（去重键）。 */
  evidenceId: string;
  sourceId: string;
  sourceOccurrenceTime: number;
  /** 来源自身的顺序号（有则保留）。 */
  sourceSequence: number | null;
  ingestionTime: number;
  processingOrder: number;
  kind: string;
  payload: string;
}

export interface SourceRegistration {
  /** 稳定唯一身份：内容派生（不依赖 discovery 通道）。 */
  identity: string;
  kind: string;
  discoveredVia: string[];
}

/** 来源端实现：把事件交付给 intake；必须持有未确认事件直到 ack（E0 F4 教训）。 */
export interface EvidenceSource {
  identity: string;
  kind: string;
  start(deliver: (ev: Omit<RawEvidence, "ingestionTime" | "processingOrder">) => boolean): void;
  stop(): void;
  alive(): boolean;
  /** 可重放来源：从 cursor 重新播放，从而不需要 WAL。 */
  replayable?: (cursor: string | null) => void;
  cursor?(): string | null;
}

export interface IntakeOptions {
  dataDir: string;
  queueCapacity?: number;
  /** 模拟下游写入变慢（每 N 条延迟一次，用于背压/顺序实验）。 */
  slowDownstreamEvery?: number;
}

export class ThinIntake {
  readonly dataDir: string;
  private queueCapacity: number;
  private queue: Omit<RawEvidence, "ingestionTime" | "processingOrder">[] = [];
  private registry = new Map<string, SourceRegistration>();
  private states = new Map<string, SourceState>();
  private sources = new Map<string, EvidenceSource>();
  private processingCounter = 0;
  private seen = new Set<string>();
  private stored: RawEvidence[] = [];
  private cursors = new Map<string, string | null>();
  private walPath: string;
  private storePath: string;
  private cursorPath: string;
  private dropped = 0;
  private duplicates = 0;
  private outOfOrderObserved = 0;
  private lastOccurrenceSeen = new Map<string, number>();
  slowDownstreamEvery = 0;

  constructor(options: IntakeOptions) {
    this.dataDir = options.dataDir;
    this.queueCapacity = options.queueCapacity ?? 16;
    this.slowDownstreamEvery = options.slowDownstreamEvery ?? 0;
    mkdirSync(options.dataDir, { recursive: true });
    this.walPath = join(options.dataDir, "wal.ndjson");
    this.storePath = join(options.dataDir, "store.ndjson");
    this.cursorPath = join(options.dataDir, "cursors.json");
    this.restore();
  }

  /* ---------- Source 生命周期（HA 风格状态机 + 注册去重） ---------- */

  /** 双 discovery 通道登记同一来源：identity 相同 → 单一注册，不产生双 Provider。 */
  discover(identity: string, kind: string, via: string): { isNew: boolean } {
    const existing = this.registry.get(identity);
    if (existing) {
      if (!existing.discoveredVia.includes(via)) existing.discoveredVia.push(via);
      return { isNew: false };
    }
    this.registry.set(identity, { identity, kind, discoveredVia: [via] });
    this.states.set(identity, "discovered");
    return { isNew: true };
  }

  configure(identity: string): void {
    this.transition(identity, "configured", ["discovered", "recovered"]);
  }

  attach(identity: string, source: EvidenceSource): void {
    this.sources.set(identity, source);
  }

  start(identity: string): void {
    this.transition(identity, "started", ["configured"]);
    const source = this.sources.get(identity);
    if (!source) throw new Error(`no source attached: ${identity}`);
    // 可重放来源：先从 cursor 恢复播放（Redpanda Connect checkpoint 语义）
    if (source.replayable) {
      source.replayable(this.cursors.get(identity) ?? null);
    }
    source.start((ev) => this.deliver(ev));
    this.transition(identity, "healthy", ["started", "unavailable", "recovered"]);
  }

  /** 健康监管：外部周期调用；死亡 → unavailable（可观察，不伪装 healthy）。 */
  supervise(): void {
    for (const [identity, source] of this.sources) {
      const state = this.states.get(identity);
      if (!source.alive() && (state === "healthy" || state === "started")) {
        this.states.set(identity, "unavailable");
      }
    }
  }

  recover(identity: string): void {
    const state = this.states.get(identity);
    if (state !== "unavailable") return;
    this.states.set(identity, "recovered");
    this.transition(identity, "configured", ["recovered"]);
    this.start(identity);
  }

  stop(identity: string): void {
    this.sources.get(identity)?.stop();
    this.states.set(identity, "stopped");
  }

  remove(identity: string): void {
    this.stop(identity);
    this.states.set(identity, "removed");
    this.registry.delete(identity);
  }

  stateOf(identity: string): SourceState | undefined {
    return this.states.get(identity);
  }

  registrationOf(identity: string): SourceRegistration | undefined {
    return this.registry.get(identity);
  }

  private transition(identity: string, to: SourceState, from: SourceState[]): void {
    const current = this.states.get(identity);
    if (!current || !from.includes(current)) {
      throw new Error(`illegal transition ${current} -> ${to} for ${identity}`);
    }
    this.states.set(identity, to);
  }

  /* ---------- 数据面（OTel 风格 ack + Redpanda 风格 cursor） ---------- */

  /** 交付入口：队列满 → 返回 false，生产者必须持有重试（ack 语义）。 */
  deliver(ev: Omit<RawEvidence, "ingestionTime" | "processingOrder">): boolean {
    if (this.queue.length >= this.queueCapacity) {
      return false;
    }
    // 非重放来源的未落盘事件进 WAL（崩溃恢复）；重放来源靠 cursor，不落 WAL
    const source = this.sources.get(ev.sourceId);
    if (!source?.replayable) {
      appendFileSync(this.walPath, JSON.stringify(ev) + "\n");
    }
    this.queue.push(ev);
    return true;
  }

  /** 处理泵：消费队列 → 去重 → 落盘 store；返回本次处理条数。 */
  pump(): number {
    let processed = 0;
    while (this.queue.length > 0) {
      if (this.slowDownstreamEvery > 0 && processed > 0 && processed % this.slowDownstreamEvery === 0) {
        break; // 模拟下游变慢：本泵周期提前让出
      }
      const ev = this.queue.shift()!;
      if (this.seen.has(ev.evidenceId)) {
        this.duplicates++;
        continue;
      }
      const last = this.lastOccurrenceSeen.get(ev.sourceId);
      if (last !== undefined && ev.sourceOccurrenceTime < last) {
        this.outOfOrderObserved++;
      }
      this.lastOccurrenceSeen.set(ev.sourceId, Math.max(last ?? 0, ev.sourceOccurrenceTime));
      this.seen.add(ev.evidenceId);
      const full: RawEvidence = {
        ...ev,
        ingestionTime: Date.now(),
        processingOrder: this.processingCounter++,
      };
      this.stored.push(full);
      appendFileSync(this.storePath, JSON.stringify(full) + "\n");
      // checkpoint：可重放来源推进 cursor（以来源序列为准）
      const source = this.sources.get(ev.sourceId);
      if (source?.cursor) {
        this.cursors.set(ev.sourceId, source.cursor());
      }
      processed++;
    }
    this.persistCursors();
    return processed;
  }

  /** 模拟 intake 重启（World restart）：内存态丢弃，从磁盘恢复。 */
  restart(): { restoredStore: number; restoredWal: number } {
    this.queue = [];
    this.stored = [];
    this.seen = new Set();
    this.processingCounter = 0;
    const restored = this.restore();
    // WAL 中未落盘事件重新入队（非重放来源的 at-least-once 保证）
    return restored;
  }

  private restore(): { restoredStore: number; restoredWal: number } {
    let restoredStore = 0;
    let restoredWal = 0;
    if (existsSync(this.storePath)) {
      for (const line of readFileSync(this.storePath, "utf8").trim().split("\n")) {
        if (!line) continue;
        const ev = JSON.parse(line) as RawEvidence;
        this.stored.push(ev);
        this.seen.add(ev.evidenceId);
        this.processingCounter = Math.max(this.processingCounter, ev.processingOrder + 1);
        restoredStore++;
      }
    }
    if (existsSync(this.cursorPath)) {
      const cursors = JSON.parse(readFileSync(this.cursorPath, "utf8")) as Record<string, string | null>;
      for (const [k, v] of Object.entries(cursors)) this.cursors.set(k, v);
    }
    if (existsSync(this.walPath)) {
      for (const line of readFileSync(this.walPath, "utf8").trim().split("\n")) {
        if (!line) continue;
        const ev = JSON.parse(line) as Omit<RawEvidence, "ingestionTime" | "processingOrder">;
        if (!this.seen.has(ev.evidenceId)) {
          this.queue.push(ev);
          restoredWal++;
        }
      }
    }
    return { restoredStore, restoredWal };
  }

  private persistCursors(): void {
    writeFileSync(this.cursorPath, JSON.stringify(Object.fromEntries(this.cursors), null, 2));
  }

  /** WAL 截断（已落盘事件对应的 WAL 可回收）。 */
  truncateWal(): void {
    writeFileSync(this.walPath, "");
  }

  /* ---------- 查询（按 occurrence 时间排序 —— 现实顺序，不是处理顺序） ---------- */

  storedCount(): number {
    return this.stored.length;
  }

  byOccurrence(sourceId?: string): RawEvidence[] {
    const rows = sourceId ? this.stored.filter((e) => e.sourceId === sourceId) : [...this.stored];
    return rows.sort((a, b) => a.sourceOccurrenceTime - b.sourceOccurrenceTime);
  }

  counters() {
    return {
      duplicates: this.duplicates,
      outOfOrderObserved: this.outOfOrderObserved,
      dropped: this.dropped,
      storedCount: this.stored.length,
      queueLength: this.queue.length,
      walExists: existsSync(this.walPath) && readFileSync(this.walPath, "utf8").trim().length > 0,
    };
  }
}
