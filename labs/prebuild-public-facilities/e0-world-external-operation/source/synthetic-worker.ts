/**
 * E0 — Synthetic Slow Worker：E0 全部确定性场景的执行器。
 * 不接任何真实 AI；行为完全由 per-op 剧本驱动，支持故障注入。
 */
import type {
  ExecutorCommand,
  ExecutorEvent,
  ExternalExecutor,
} from "./contract.ts";

export type WorkerScript =
  | { type: "complete"; startDelay: number; workTicks: number; result: string }
  | { type: "crash-after-start"; startDelay: number; crashTicks: number }
  | { type: "silent-death"; startDelay: number }
  | { type: "requires-action"; startDelay: number; request: string; afterResolveTicks: number; result: string }
  | { type: "burst"; startDelay: number; progressCount: number; result: string }
  | { type: "duplicate-result"; startDelay: number; result: string; eventId: string }
  | { type: "never-starts" };

type PushFn = (e: ExecutorEvent) => boolean;

interface ActiveOp {
  opId: string;
  script: WorkerScript;
  ticksSinceStart: number;
  started: boolean;
  actionResolved: boolean;
  pendingEvents: ExecutorEvent[];
  cancelled: boolean;
  /** 剧本已演完；仍需继续 flush 滞留事件（背压时），清空后才移除。 */
  done?: boolean;
}

export class SyntheticWorker implements ExternalExecutor {
  readonly name: string;
  private scripts = new Map<string, WorkerScript>();
  private active = new Map<string, ActiveOp>();
  private push!: PushFn;
  private dead = false;
  private clock = 0;

  constructor(name = "synthetic-worker") {
    this.name = name;
  }

  setScript(opId: string, script: WorkerScript): void {
    this.scripts.set(opId, script);
  }

  kill(): void {
    this.dead = true;
    this.active.clear();
  }

  restart(): void {
    this.dead = false;
  }

  alive(): boolean {
    return !this.dead;
  }

  onCommand(command: ExecutorCommand, pushEvent: PushFn): void {
    this.push = pushEvent;
    if (this.dead) return; // 执行器不可用：命令被吞掉，World 侧由 lease/观察发现
    if (command.type === "start") {
      const script = this.scripts.get(command.opId) ?? { type: "never-starts" };
      this.active.set(command.opId, {
        opId: command.opId,
        script,
        ticksSinceStart: 0,
        started: false,
        actionResolved: false,
        pendingEvents: [],
        cancelled: false,
      });
    } else if (command.type === "cancel") {
      const op = this.active.get(command.opId);
      if (op) {
        op.cancelled = true;
        // 故意不清空 pendingEvents：制造"取消后迟到结果"的压力
      }
    }
  }

  /** 剧本外部干预：模拟人工已回应 action（与 World 的 resolveAction 并行发生）。 */
  markResolved(opId: string): void {
    const op = this.active.get(opId);
    if (op) {
      op.actionResolved = true;
      op.ticksSinceStart = 0; // 从回应后重新计 tick
    }
  }

  /** 剧本外部干预：让某 op 在取消后仍投递迟到结果。 */
  injectLateResult(opId: string, eventId: string, resultRef: string): void {
    this.queuePush({ kind: "result", opId, resultRef, eventId, at: this.clock });
  }

  injectDuplicateResult(opId: string, eventId: string, resultRef: string): void {
    this.queuePush({ kind: "result", opId, resultRef, eventId, at: this.clock });
    this.queuePush({ kind: "result", opId, resultRef, eventId, at: this.clock });
  }

  private queuePush(event: ExecutorEvent): void {
    const op = this.active.get(event.opId);
    if (op) op.pendingEvents.push(event);
    else if (this.push) this.push(event); // 未知 op 的事件也直接尝试投递（测 guard）
  }

  tick(): void {
    this.clock++;
    if (this.dead) return;
    for (const op of [...this.active.values()]) {
      if (op.cancelled && op.script.type !== "complete") continue;
      if (!op.done) this.advance(op);
      this.flush(op);
      if (op.done && op.pendingEvents.length === 0) this.active.delete(op.opId);
    }
  }

  private advance(op: ActiveOp): void {
    const script = op.script;
    op.ticksSinceStart++;
    const t = op.ticksSinceStart;
    switch (script.type) {
      case "complete":
        if (!op.started && t >= script.startDelay) {
          op.started = true;
          this.queuePush({ kind: "started", opId: op.opId, at: this.clock });
        } else if (op.started && t >= script.startDelay + script.workTicks) {
          this.queuePush({
            kind: "result",
            opId: op.opId,
            resultRef: script.result,
            eventId: `${op.opId}:r1`,
            at: this.clock,
          });
          op.done = true;
        }
        break;
      case "crash-after-start":
        if (!op.started && t >= script.startDelay) {
          op.started = true;
          this.queuePush({ kind: "started", opId: op.opId, at: this.clock });
        } else if (op.started && t >= script.startDelay + script.crashTicks) {
          this.queuePush({
            kind: "terminated",
            opId: op.opId,
            reason: "crash",
            at: this.clock,
          });
          op.done = true;
        }
        break;
      case "silent-death":
        if (!op.started && t >= script.startDelay) {
          op.started = true;
          this.queuePush({ kind: "started", opId: op.opId, at: this.clock });
        }
        // 之后永久沉默：不发任何事件，测试 lease 超时路径
        break;
      case "requires-action":
        if (!op.started && t >= script.startDelay) {
          op.started = true;
          this.queuePush({ kind: "started", opId: op.opId, at: this.clock });
          this.queuePush({
            kind: "requires_action",
            opId: op.opId,
            request: script.request,
            at: this.clock,
          });
        } else if (op.started && op.actionResolved && t >= script.afterResolveTicks) {
          this.queuePush({
            kind: "result",
            opId: op.opId,
            resultRef: script.result,
            eventId: `${op.opId}:r1`,
            at: this.clock,
          });
          op.done = true;
        }
        break;
      case "burst":
        if (!op.started && t >= script.startDelay) {
          op.started = true;
          this.queuePush({ kind: "started", opId: op.opId, at: this.clock });
          for (let i = 0; i < script.progressCount; i++) {
            this.queuePush({
              kind: "progress",
              opId: op.opId,
              note: `burst-${i}`,
              at: this.clock,
            });
          }
          this.queuePush({
            kind: "result",
            opId: op.opId,
            resultRef: script.result,
            eventId: `${op.opId}:r1`,
            at: this.clock,
          });
          op.done = true;
        }
        break;
      case "duplicate-result":
        if (!op.started && t >= script.startDelay) {
          op.started = true;
          this.queuePush({ kind: "started", opId: op.opId, at: this.clock });
          this.queuePush({
            kind: "result",
            opId: op.opId,
            resultRef: script.result,
            eventId: script.eventId,
            at: this.clock,
          });
          this.queuePush({
            kind: "result",
            opId: op.opId,
            resultRef: script.result,
            eventId: script.eventId,
            at: this.clock,
          });
          op.done = true;
        }
        break;
      case "never-starts":
        break;
    }
  }

  /** 背压处理：队列满则保留 pendingEvents，下一 tick 重试（不丢事件）。 */
  private flush(op: ActiveOp): void {
    while (op.pendingEvents.length > 0) {
      const ok = this.push(op.pendingEvents[0]);
      if (!ok) return;
      op.pendingEvents.shift();
    }
  }
}
