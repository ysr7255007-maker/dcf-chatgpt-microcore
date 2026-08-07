/**
 * E0 — World × ExternalOperation 契约层。
 *
 * 核心立场（任务书 §4）：
 *   - 实际执行可以发生在 World 外；运行身份、生命周期、结果由 World 统一管理；
 *   - 外部执行位置不等于运行权威；
 *   - 本文件不出现任何 provider 名称或业务分支。
 */

/** Operation 生命周期状态。World 是唯一状态权威。 */
export const OPERATION_STATES = [
  "created",
  "running",
  "requires_action",
  "completed",
  "error",
  "cancelled",
  /** World 重建后发现的非终态 operation：需要显式 reattach 或显式失败，禁止伪装 running。 */
  "orphaned",
] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

export const TERMINAL_STATES: readonly OperationState[] = [
  "completed",
  "error",
  "cancelled",
];

/** 外部执行器 → World 的事件类型（全部经有界队列进入 Drain）。 */
export type ExecutorEvent =
  | { kind: "started"; opId: string; at: number }
  | { kind: "progress"; opId: string; note: string; at: number }
  | { kind: "requires_action"; opId: string; request: string; at: number }
  | {
      kind: "result";
      opId: string;
      resultRef: string;
      eventId: string;
      at: number;
    }
  | { kind: "error"; opId: string; message: string; at: number }
  | {
      kind: "terminated";
      opId: string;
      reason: "worker_lost" | "crash";
      at: number;
    };

export const EVENT_KINDS = [
  "started",
  "progress",
  "requires_action",
  "result",
  "error",
  "terminated",
] as const;

/** 事件被拒绝/忽略的原因（可观察指标）。 */
export type GuardReason =
  | "ignored_unknown_op"
  | "ignored_late_after_terminal"
  | "ignored_result_after_cancel_intent"
  | "ignored_duplicate_result"
  | "ignored_out_of_order";

/**
 * World → 外部执行器的命令。执行器只收到"做什么"，不拥有生命周期语义。
 */
export interface ExecutorCommand {
  type: "start" | "cancel";
  opId: string;
  /** 仅 start 携带；JSON 编码的执行规格（执行器自行解释）。 */
  spec?: string;
}

/**
 * 外部执行器唯一接口。
 * AI HTTP Turn、ACP Agent、数据库任务、Probe 全部实现同一接口：
 * 不存在平行的第二套生命周期。
 */
export interface ExternalExecutor {
  readonly name: string;
  /** 收到 start 命令；执行结果只能经 pushEvent 回传。 */
  onCommand(command: ExecutorCommand, pushEvent: (e: ExecutorEvent) => boolean): void;
  /** 可选：每个 harness tick 被调用（synthetic worker 用它推进剧本）。 */
  tick?(): void;
  /** 可选：执行器自身存活探测（缺省视为存活）。 */
  alive?(): boolean;
  dispose?(): void;
}

/** Operation 启动请求（调用方 → World）。 */
export interface StartRequest {
  opId: string;
  kind: string;
  executor: string;
  owner: string;
  spec: unknown;
}
