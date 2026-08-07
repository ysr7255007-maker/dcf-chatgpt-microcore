/**
 * E4 — 三个 Evidence Source Provider（任务书 §8.2）。
 *   Synthetic：脚本化故障注入（延迟/乱序/重复）
 *   Git：可重放来源（cursor = commit SHA → 不需要 WAL）
 *   External Probe：真独立进程（NDJSON stdout），可 kill/重启
 */
import { spawn, type Subprocess } from "bun";
import type { EvidenceSource, RawEvidence } from "./intake.ts";

type Deliver = (ev: Omit<RawEvidence, "ingestionTime" | "processingOrder">) => boolean;

/* ---------------- Synthetic ---------------- */

export interface SyntheticEvent {
  seq: number;
  occurrenceTime: number;
  payload: string;
  /** 交付延迟（tick 数）：制造乱序/延迟到达。 */
  delayTicks: number;
  /** 重复交付次数（含首次）。 */
  times: number;
}

export class SyntheticProvider implements EvidenceSource {
  identity: string;
  kind = "synthetic";
  private script: SyntheticEvent[] = [];
  private tick = 0;
  private pending: { ev: SyntheticEvent; at: number; left: number }[] = [];
  private deliver!: Deliver;
  private running = false;

  constructor(identity = "synthetic-1") {
    this.identity = identity;
  }

  setScript(script: SyntheticEvent[]): void {
    this.script = script;
    // 允许运行中换剧本：重建待发事件（tick 基准保持，delayTicks 相对当前 tick）
    if (this.running) {
      this.pending = this.script.map((ev) => ({
        ev,
        at: this.tick + ev.delayTicks,
        left: ev.times,
      }));
    }
  }

  start(deliver: Deliver): void {
    this.deliver = deliver;
    this.running = true;
    this.tick = 0;
    this.pending = this.script.map((ev) => ({ ev, at: ev.delayTicks, left: ev.times }));
  }

  /** 由测试循环驱动的时钟。 */
  advance(ticks = 1): void {
    if (!this.running) return;
    for (let i = 0; i < ticks; i++) {
      this.tick++;
      for (const item of [...this.pending]) {
        if (this.tick >= item.at && item.left > 0) {
          const ok = this.deliver({
            evidenceId: `${this.identity}:${item.ev.seq}`,
            sourceId: this.identity,
            sourceOccurrenceTime: item.ev.occurrenceTime,
            sourceSequence: item.ev.seq,
            kind: "synthetic",
            payload: item.ev.payload,
          });
          if (ok) item.left--;
          // 背压时保留，下一 tick 重试（ack 语义）
        }
      }
      this.pending = this.pending.filter((p) => p.left > 0);
    }
  }

  stop(): void {
    this.running = false;
  }

  alive(): boolean {
    return this.running;
  }
}

/* ---------------- Git（可重放，cursor = commit SHA） ---------------- */

export class GitProvider implements EvidenceSource {
  identity: string;
  kind = "git";
  private repoPath: string;
  private commits: { sha: string; time: number; subject: string }[] = [];
  private cursorIndex = -1;
  private deliver!: Deliver;
  private running = false;

  constructor(identity: string, repoPath: string) {
    this.identity = identity;
    this.repoPath = repoPath;
  }

  /** 同步读取 git log（实验规模足够；生产应异步）。 */
  private readLog(): void {
    const proc = Bun.spawnSync(
      ["git", "log", "--format=%H%x00%ct%x00%s", "-n", "30"],
      { cwd: this.repoPath },
    );
    this.commits = proc.stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ct, ...rest] = line.split("\u0000");
        return { sha, time: Number(ct) * 1000, subject: rest.join("\u0000") };
      })
      .reverse(); // 旧 → 新
  }

  replayable(cursor: string | null): void {
    this.readLog();
    this.cursorIndex = cursor ? this.commits.findIndex((c) => c.sha === cursor) : -1;
  }

  start(deliver: Deliver): void {
    this.deliver = deliver;
    this.running = true;
    if (this.commits.length === 0) this.readLog();
    // 从 cursor 之后重放（新事件 + 崩溃后恢复共用一条路径）
    for (let i = this.cursorIndex + 1; i < this.commits.length; i++) {
      const c = this.commits[i];
      const ok = deliver({
        evidenceId: `${this.identity}:${c.sha}`,
        sourceId: this.identity,
        sourceOccurrenceTime: c.time,
        sourceSequence: i,
        kind: "git-commit",
        payload: c.subject.slice(0, 200),
      });
      if (!ok) break; // 背压：下次重放再试（无丢失，因为可重放）
      this.cursorIndex = i;
    }
  }

  cursor(): string | null {
    return this.cursorIndex >= 0 ? this.commits[this.cursorIndex].sha : null;
  }

  stop(): void {
    this.running = false;
  }

  alive(): boolean {
    return this.running;
  }
}

/* ---------------- External Probe（真独立进程） ---------------- */

/**
 * Probe 子进程脚本：按行输出 NDJSON 事件；可被 kill 模拟崩溃。
 */
export const PROBE_SCRIPT = `
const n = Number(process.env.PROBE_COUNT ?? 5);
const interval = Number(process.env.PROBE_INTERVAL_MS ?? 30);
let i = 0;
const timer = setInterval(() => {
  if (i >= n) { clearInterval(timer); return; }
  const t = Date.now();
  process.stdout.write(JSON.stringify({ seq: i, occurrence: t, payload: "probe-" + i }) + "\\n");
  i++;
}, interval);
`;

export class ProbeProvider implements EvidenceSource {
  identity: string;
  kind = "external-probe";
  private proc: Subprocess | null = null;
  private deliver!: Deliver;
  private seqSeen = 0;
  private env: Record<string, string>;

  constructor(identity: string, env: Record<string, string> = {}) {
    this.identity = identity;
    this.env = env;
  }

  spawnProcess(): void {
    this.proc = spawn(["bun", "-e", PROBE_SCRIPT], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...this.env },
    });
    const decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      if (!this.proc) return;
      for await (const chunk of this.proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as { seq: number; occurrence: number; payload: string };
            // 生产者持有直到 ack：交付失败时保留在 retryBuffer
            this.enqueueWithRetry({
              evidenceId: `${this.identity}:${ev.seq}`,
              sourceId: this.identity,
              sourceOccurrenceTime: ev.occurrence,
              sourceSequence: ev.seq,
              kind: "probe-event",
              payload: ev.payload,
            });
          } catch {
            // 噪音行忽略
          }
        }
      }
    })();
  }

  private retryBuffer: Omit<RawEvidence, "ingestionTime" | "processingOrder">[] = [];

  private enqueueWithRetry(ev: Omit<RawEvidence, "ingestionTime" | "processingOrder">): void {
    if (this.deliver(ev)) return;
    this.retryBuffer.push(ev);
  }

  /** 重试背压滞留事件（由测试循环调用）。 */
  flushRetries(): void {
    while (this.retryBuffer.length > 0) {
      if (!this.deliver(this.retryBuffer[0])) return;
      this.retryBuffer.shift();
    }
  }

  start(deliver: Deliver): void {
    this.deliver = deliver;
    if (!this.proc || this.proc.exitCode !== null) this.spawnProcess();
  }

  kill(): void {
    try {
      this.proc?.kill();
    } catch {
      // already dead
    }
    this.proc = null;
  }

  stop(): void {
    this.kill();
  }

  alive(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }
}
