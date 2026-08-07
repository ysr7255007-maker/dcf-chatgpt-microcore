/**
 * E0 — WorldHost：把 Becsy World、Gateway 与外部执行器接起来的极薄宿主。
 *
 * 帧循环纪律：
 *   1. world.execute(frame, 1) 内只有内存队列操作，永远不等外部 I/O；
 *   2. 外部 I/O 命令（start/cancel）在帧之间由 harness 交付给执行器；
 *   3. 执行器经 gateway.pushEvent 回传事件，背压时保留事件稍后重试。
 */
import { World } from "@lastolivegames/becsy";
import { ExternalOperation, OperationDrain, OperationGateway, OperationReadback } from "./bridge.ts";
import type {
  ExecutorCommand,
  ExecutorEvent,
  ExternalExecutor,
  StartRequest,
} from "./contract.ts";

export interface HostOptions {
  executors: ExternalExecutor[];
  eventQueueCapacity?: number;
  leaseFrames?: number;
  maxEntities?: number;
  /** 刻意乱序测试用：反转 defs 顺序。 */
  reverseDefs?: boolean;
  /** World 重建恢复条目。 */
  restore?: {
    opId: string;
    kind: string;
    executor: string;
    owner: string;
    state: "completed" | "error" | "cancelled" | "running" | "created";
    resultRef: string;
  }[];
}

export class WorldHost {
  readonly gateway: OperationGateway;
  private world!: Awaited<ReturnType<typeof World.create>>;
  private frame = 0;
  private executorsByName = new Map<string, ExternalExecutor>();
  private options: HostOptions;

  constructor(options: HostOptions) {
    this.options = options;
    this.gateway = new OperationGateway(options.eventQueueCapacity ?? 8);
    for (const executor of options.executors) {
      this.executorsByName.set(executor.name, executor);
    }
  }

  async start(): Promise<void> {
    if (this.options.restore) {
      this.gateway.restore.push(...this.options.restore);
    }
    const drainEntry = [
      OperationDrain,
      { gateway: this.gateway, leaseFrames: this.options.leaseFrames ?? 8 },
    ];
    const readbackEntry = [OperationReadback, { gateway: this.gateway }];
    const defs = this.options.reverseDefs
      ? [readbackEntry, drainEntry, ExternalOperation]
      : [ExternalOperation, drainEntry, readbackEntry];
    this.world = await World.create({
      defs: defs as never[],
      maxEntities: this.options.maxEntities ?? 512,
    });
  }

  /**
   * 推进一帧：交付 outbox 命令 → 执行器 tick → World 执行。
   * 返回本帧 world.execute 的耗时（硬门禁 G1 的测量点）。
   */
  async step(): Promise<number> {
    this.drainOutbox();
    for (const executor of this.options.executors) {
      executor.tick?.();
    }
    // 让 microtask（真实异步执行器的回传）有机会进入队列
    await Promise.resolve();
    const t0 = performance.now();
    await this.world!.execute(this.frame, 1);
    const dt = performance.now() - t0;
    this.frame++;
    return dt;
  }

  async steps(n: number): Promise<number> {
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, await this.step());
    return max;
  }

  private drainOutbox(): void {
    while (this.gateway.outbox.length > 0) {
      const command: ExecutorCommand = this.gateway.outbox.shift()!;
      const executor = this.executorsByName.get(
        this.executorRegistry.get(command.opId) ?? "",
      );
      executor?.onCommand(command, (e: ExecutorEvent) => this.gateway.pushEvent(e));
    }
  }

  private executorRegistry = new Map<string, string>();
  private intakeMeta = new Map<string, { kind: string; executor: string; owner: string }>();

  requestStart(request: StartRequest): string {
    this.executorRegistry.set(request.opId, request.executor);
    this.intakeMeta.set(request.opId, {
      kind: request.kind,
      executor: request.executor,
      owner: request.owner,
    });
    this.gateway.intake.push(request);
    return request.opId;
  }

  requestCancel(opId: string): void {
    // 取消意图先登记：防止取消帧与迟到结果帧之间的竞态由 Drain 统一裁决
    this.gateway.cancelQueue.push(opId);
  }

  resolveAction(opId: string): void {
    this.gateway.actionQueue.push(opId);
  }

  latestState(opId: string): string | undefined {
    for (let i = this.gateway.observed.length - 1; i >= 0; i--) {
      const snapshot = this.gateway.observed[i];
      const found = snapshot.ops.find((o) => o.opId === opId);
      if (found) return found.state;
    }
    return undefined;
  }

  /** 导出运行台账（World 重建恢复用）：只含领域身份与状态，不含 entity 身份。 */
  ledgerSnapshot(): {
    opId: string;
    kind: string;
    executor: string;
    owner: string;
    state: "completed" | "error" | "cancelled" | "running" | "created";
    resultRef: string;
  }[] {
    const last = this.gateway.observed[this.gateway.observed.length - 1];
    const states = new Map(last?.ops.map((o) => [o.opId, o.state]) ?? []);
    return [...this.executorRegistry.keys()].map((opId) => {
      const meta = this.intakeMeta.get(opId) ?? {
        kind: "unknown",
        executor: this.executorRegistry.get(opId) ?? "",
        owner: "",
      };
      return {
        opId,
        kind: meta.kind,
        executor: meta.executor,
        owner: meta.owner,
        state: (states.get(opId) ?? "created") as never,
        resultRef: "",
      };
    });
  }
  async terminate(): Promise<void> {
    for (const executor of this.options.executors) executor.dispose?.();
    await this.world?.terminate();
  }
}
