/**
 * E5 — 跨设施共享语义契约（唯一的设施间关系表面）。
 *
 * 纪律（任务书 §9）：Capability/Facility 之间只通过这些共享语义类型发生关系；
 * 不允许跨设施私有 API 调用。本文件不 import 任何设施实现。
 */

/** 任务意图（World/DCF 拥有）。 */
export interface TaskIntent {
  taskId: string;
  description: string;
  /** 预期现实效果（Reality Verifier 的验收依据，先于 Agent 执行冻结）。 */
  expected: ExpectedEffect;
}

/** 预期效果：现实侧可独立检验的断言。 */
export interface ExpectedEffect {
  fileContains: { path: string; needle: string }[];
  command?: { argv: string[]; cwd: string; expectExit: number };
}

/** Agent 执行状态（≠ 现实效果状态；两者必须可区分，负控制 2）。 */
export interface AgentExecutionStatus {
  sessionId: string;
  status: "completed" | "cancelled" | "error";
  stopReason?: string;
  detail?: string;
}

/** 现实观察效果：只能由 Reality Verifier 从现实来源产生。 */
export interface ObservedEffect {
  taskId: string;
  /** 现实判定：与 Agent 的任何声明无关。 */
  realityStatus: "PASS" | "FAIL";
  checks: { name: string; ok: boolean; evidence: string }[];
  observedAt: number;
}

/** 证据引用（Evidence Source → RawEvidence 的领域身份）。 */
export interface EvidenceRef {
  evidenceId: string;
  sourceId: string;
  occurrenceTime: number;
  payload: string;
}
