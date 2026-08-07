/**
 * E0 — 核心桥接：Gateway（World 外薄通道）+ Becsy Component/System。
 *
 * 硬门禁对应（任务书 §4）：
 *   - World 主循环不被外部 I/O 阻塞：System 只处理内存队列，外部 I/O 全部在 harness/executor；
 *   - 取消后迟到结果不能复活已结束操作：terminal guard；
 *   - 重复事件不会产生重复业务结果：result eventId 去重 + resultApplyCount 计数；
 *   - Worker/Provider 死亡进入可观察状态：terminated 事件 + lease 超时双路径；
 *   - 不依赖 ECS Entity ID 作为长期身份：一切以领域稳定 opId 索引；
 *   - 核心桥接不出现 provider 业务分支：本文件不 import、不引用任何 provider 名称。
 */
import { System, Type } from "@lastolivegames/becsy";
import {
  OPERATION_STATES,
  TERMINAL_STATES,
  type ExecutorCommand,
  type ExecutorEvent,
  type GuardReason,
  type OperationState,
  type StartRequest,
} from "./contract.ts";

/* ---------------- Gateway：World 内外的唯一薄通道 ---------------- */

export interface ObservedSnapshot {
  frame: number;
  ops: { opId: string; state: string; resultApplyCount: number }[];
}

export interface BridgeCounters {
  eventsPushed: number;
  eventsRejectedBackpressure: number;
  guardIgnores: Record<GuardReason, number>;
  resultApplyCountTotal: number;
  leaseTimeouts: number;
}

export interface RestoreEntry {
  opId: string;
  kind: string;
  executor: string;
  owner: string;
  state: OperationState;
  resultRef: string;
}

/**
 * 有界事件队列 + 命令 outbox + 可观察计数。
 * 背压语义：队列满时 push 返回 false，执行器必须自行稍后重试（不丢事件）。
 */
export class OperationGateway {
  readonly eventQueue: ExecutorEvent[] = [];
  readonly outbox: ExecutorCommand[] = [];
  readonly intake: StartRequest[] = [];
  readonly cancelQueue: string[] = [];
  readonly actionQueue: string[] = [];
  readonly restore: RestoreEntry[] = [];
  readonly observed: ObservedSnapshot[] = [];
  readonly counters: BridgeCounters = {
    eventsPushed: 0,
    eventsRejectedBackpressure: 0,
    guardIgnores: {
      ignored_unknown_op: 0,
      ignored_late_after_terminal: 0,
      ignored_result_after_cancel_intent: 0,
      ignored_duplicate_result: 0,
      ignored_out_of_order: 0,
    },
    resultApplyCountTotal: 0,
    leaseTimeouts: 0,
  };

  constructor(public readonly eventQueueCapacity: number) {}

  pushEvent(event: ExecutorEvent): boolean {
    if (this.eventQueue.length >= this.eventQueueCapacity) {
      this.counters.eventsRejectedBackpressure++;
      return false;
    }
    this.eventQueue.push(event);
    this.counters.eventsPushed++;
    return true;
  }
}

/* ---------------- Component ---------------- */

/**
 * 一个外部操作在世界内的运行身份与生命周期状态。
 * opId 是领域稳定身份；entity 身份只在世界生命周期内有效。
 */
export class ExternalOperation {
  opId!: string;
  kind!: string;
  executor!: string;
  owner!: string;
  state!: OperationState;
  createdAt!: number;
  startedAt!: number;
  lastActivityAt!: number;
  leaseDeadline!: number;
  cancelIntent!: boolean;
  cancelNotified!: boolean;
  error!: string;
  resultRef!: string;
  actionRequest!: string;
  /** 业务结果被 World 应用的次数；>1 即为严重事故。 */
  resultApplyCount!: number;
  static schema = {
    opId: Type.dynamicString(96),
    kind: Type.dynamicString(64),
    executor: Type.dynamicString(64),
    owner: Type.dynamicString(64),
    state: Type.staticString(OPERATION_STATES),
    createdAt: Type.float64,
    startedAt: Type.float64,
    lastActivityAt: Type.float64,
    leaseDeadline: Type.float64,
    cancelIntent: Type.boolean,
    cancelNotified: Type.boolean,
    error: Type.dynamicString(256),
    resultRef: Type.dynamicString(512),
    actionRequest: Type.dynamicString(256),
    resultApplyCount: Type.float64,
  };
}

/* ---------------- Systems ---------------- */

/**
 * 唯一写者：创建 operation、处理取消/人工动作请求、消费外部事件、执行 lease 监管。
 * 所有守卫在此集中，保证 AI/ACP/DB/Probe 共用同一套生命周期裁决。
 */
export class OperationDrain extends System {
  /** defs 注入。 */
  gateway!: OperationGateway;
  leaseFrames = 8;

  ops = this.query((q) => q.current.with(ExternalOperation).write);
  createOps = this.query((q) => q.using(ExternalOperation).create);

  private byOpId = new Map<string, ReturnType<typeof this.entityOf>>();
  private appliedResultIds = new Set<string>();

  private entityOf(entity: unknown) {
    return entity as {
      read(c: unknown): ExternalOperation;
      write(c: unknown): ExternalOperation;
    };
  }

  execute(): void {
    const gw = this.gateway;
    const now = this.time as number;

    // 0) 每帧重建 opId → entity 索引：Becsy entity 句柄不保证跨帧有效，
    //    且长期身份只允许是领域稳定 opId（硬门禁 G6）。
    this.byOpId.clear();
    for (const entity of this.ops.current) {
      this.byOpId.set(entity.read(ExternalOperation).opId, this.entityOf(entity));
    }

    // 1) World 重建恢复：非终态一律 orphaned（禁止伪装 running）。
    while (gw.restore.length > 0) {
      const entry = gw.restore.shift()!;
      const state: OperationState = TERMINAL_STATES.includes(entry.state)
        ? entry.state
        : "orphaned";
      const entity = this.createEntity(ExternalOperation, {
        opId: entry.opId,
        kind: entry.kind,
        executor: entry.executor,
        owner: entry.owner,
        state,
        createdAt: now,
        startedAt: -1,
        lastActivityAt: now,
        leaseDeadline: state === "orphaned" ? now + this.leaseFrames : Infinity,
        cancelIntent: false,
        cancelNotified: false,
        error: state === "orphaned" ? "world_rebuild_pending_reattach" : "",
        resultRef: entry.resultRef,
        actionRequest: "",
        resultApplyCount: 0,
      });
      this.byOpId.set(entry.opId, this.entityOf(entity));
    }

    // 2) 启动请求 → 实体 + outbox start 命令（外部 I/O 由 harness 在帧外执行）。
    while (gw.intake.length > 0) {
      const req = gw.intake.shift()!;
      const entity = this.createEntity(ExternalOperation, {
        opId: req.opId,
        kind: req.kind,
        executor: req.executor,
        owner: req.owner,
        state: "created",
        createdAt: now,
        startedAt: -1,
        lastActivityAt: now,
        leaseDeadline: Infinity,
        cancelIntent: false,
        cancelNotified: false,
        error: "",
        resultRef: "",
        actionRequest: "",
        resultApplyCount: 0,
      });
      this.byOpId.set(req.opId, this.entityOf(entity));
      gw.outbox.push({
        type: "start",
        opId: req.opId,
        spec: JSON.stringify(req.spec),
      });
    }

    // 3) 取消意图：World 立即判 cancelled（取消是 World 的权威决定）。
    while (gw.cancelQueue.length > 0) {
      const opId = gw.cancelQueue.shift()!;
      const handle = this.byOpId.get(opId);
      if (!handle) continue;
      const op = handle.write(ExternalOperation);
      if (TERMINAL_STATES.includes(op.state)) continue;
      op.state = "cancelled";
      op.lastActivityAt = now;
      if (!op.cancelNotified) {
        op.cancelNotified = true;
        gw.outbox.push({ type: "cancel", opId });
      }
    }

    // 4) 人工动作回应：requires_action → running。
    while (gw.actionQueue.length > 0) {
      const opId = gw.actionQueue.shift()!;
      const handle = this.byOpId.get(opId);
      if (!handle) continue;
      const op = handle.write(ExternalOperation);
      if (op.state === "requires_action") {
        op.state = "running";
        op.actionRequest = "";
        op.lastActivityAt = now;
        op.leaseDeadline = now + this.leaseFrames;
      }
    }

    // 5) 消费外部事件（有界队列，背压在 push 端）。
    while (gw.eventQueue.length > 0) {
      const event = gw.eventQueue.shift()!;
      this.applyEvent(event, now);
    }

    // 6) lease 监管：running/requires_action 长期无活动 → error(worker_lost)。
    for (const entity of this.ops.current) {
      const op = entity.write(ExternalOperation);
      if (
        (op.state === "running" || op.state === "requires_action") &&
        now >= op.leaseDeadline
      ) {
        op.state = "error";
        op.error = "worker_lost";
        op.lastActivityAt = now;
        gw.counters.leaseTimeouts++;
      }
    }
  }

  private applyEvent(event: ExecutorEvent, now: number): void {
    const gw = this.gateway;
    const handle = this.byOpId.get(event.opId);
    if (!handle) {
      gw.counters.guardIgnores.ignored_unknown_op++;
      return;
    }
    const op = handle.write(ExternalOperation);
    const terminal = TERMINAL_STATES.includes(op.state);

    switch (event.kind) {
      case "started":
        if (terminal || op.state !== "created") {
          gw.counters.guardIgnores[
            terminal ? "ignored_late_after_terminal" : "ignored_out_of_order"
          ]++;
          return;
        }
        op.state = "running";
        op.startedAt = now;
        op.lastActivityAt = now;
        op.leaseDeadline = now + this.leaseFrames;
        return;

      case "progress":
        if (terminal || op.state !== "running") {
          gw.counters.guardIgnores[
            terminal ? "ignored_late_after_terminal" : "ignored_out_of_order"
          ]++;
          return;
        }
        op.lastActivityAt = now;
        op.leaseDeadline = now + this.leaseFrames;
        return;

      case "requires_action":
        if (terminal || op.state !== "running") {
          gw.counters.guardIgnores[
            terminal ? "ignored_late_after_terminal" : "ignored_out_of_order"
          ]++;
          return;
        }
        op.state = "requires_action";
        op.actionRequest = event.request;
        op.lastActivityAt = now;
        op.leaseDeadline = Infinity; // 等待人工输入不受 lease 约束
        return;

      case "result":
        if (op.cancelIntent || op.state === "cancelled") {
          gw.counters.guardIgnores.ignored_result_after_cancel_intent++;
          return;
        }
        // 幂等投递去重优先于 terminal 判定：同一 eventId 重放属于重复事件，
        // 不是"迟到新结果"，两者在诊断上必须区分。
        if (this.appliedResultIds.has(event.eventId)) {
          gw.counters.guardIgnores.ignored_duplicate_result++;
          return;
        }
        if (terminal) {
          gw.counters.guardIgnores.ignored_late_after_terminal++;
          return;
        }
        this.appliedResultIds.add(event.eventId);
        op.state = "completed";
        op.resultRef = event.resultRef;
        op.resultApplyCount += 1;
        op.lastActivityAt = now;
        gw.counters.resultApplyCountTotal++;
        return;

      case "error":
        if (terminal) {
          gw.counters.guardIgnores.ignored_late_after_terminal++;
          return;
        }
        op.state = "error";
        op.error = event.message;
        op.lastActivityAt = now;
        return;

      case "terminated":
        if (terminal) {
          gw.counters.guardIgnores.ignored_late_after_terminal++;
          return;
        }
        op.state = "error";
        op.error = event.reason;
        op.lastActivityAt = now;
        return;
    }
  }
}

/**
 * 只读快照系统：把每帧的可观察状态写入 gateway.observed。
 * read ExternalOperation → 自动排在写者之后（Becsy entitlement 推导）。
 */
export class OperationReadback extends System {
  gateway!: OperationGateway;
  ops = this.query((q) => q.current.with(ExternalOperation).read);

  execute(): void {
    this.gateway.observed.push({
      frame: this.time as number,
      ops: this.ops.current.map((entity) => {
        const op = entity.read(ExternalOperation);
        return {
          opId: op.opId,
          state: op.state as string,
          resultApplyCount: op.resultApplyCount,
        };
      }),
    });
  }
}
