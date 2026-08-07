/**
 * E1 — DCF 自有语义层（任务书 §5 关键检查项）。
 *
 * 立场：TaskState / AgentSession / PermissionRequest / Activity / Result
 * 必须保持 DCF 自己的语义；ACP 只停在边界。本文件不 import 任何 ACP SDK 类型。
 */

/** DCF 任务状态（World/DCF 拥有；与 ACP TaskState 在边界处映射，不共用）。 */
export const TASK_STATES = [
  "connecting",
  "idle",
  "working",
  "waiting_permission",
  "done",
  "cancelled",
  "error",
  "closed",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** 归一化活动事件（所有 Agent 的流式输出都被压进这一套类型）。 */
export type Activity =
  | { type: "agent_message"; text: string; seq: number }
  | { type: "agent_thought"; text: string; seq: number }
  | { type: "tool_call"; toolName: string; status: string; seq: number }
  | { type: "file_change"; path: string; kind: string; seq: number }
  | { type: "plan"; entries: number; seq: number }
  | { type: "usage"; tokens: number; seq: number }
  | { type: "raw_update"; updateType: string; seq: number };

/** DCF 权限请求（由 ACP requestPermission 在边界转换而来）。 */
export interface PermissionRequest {
  toolCallSummary: string;
  options: { optionId: string; kind: string; name: string }[];
}

/** DCF 权限决策策略：输入请求，输出选择（或取消）。不允许按 Agent 名称分支。 */
export type PermissionPolicy = (
  request: PermissionRequest,
) => { selectOptionId: string } | { cancel: true };

/** 从 initialize 能力发现派生的能力档案（数据，不是行为分支）。 */
export interface CapabilityProfile {
  protocolVersion: number;
  agentName: string;
  agentVersion: string;
  sessionList: boolean;
  sessionResume: boolean;
  sessionClose: boolean;
  sessionDelete: boolean;
  loadSession: boolean;
  promptEmbeddedContext: boolean;
  promptImage: boolean;
  authMethods: string[];
  /** 原始能力对象留档（证据）。 */
  rawCapabilities: unknown;
}

/** DCF 会话句柄。 */
export interface AgentSessionHandle {
  sessionId: string;
  cwd: string;
  state: TaskState;
  capabilities: CapabilityProfile;
}

/** 一次 prompt 的 DCF 结果。 */
export interface TurnResult {
  stopReason: string;
  activities: Activity[];
  usageTokens: number;
}

/** Agent 接入清单（纯数据：接入新 Agent 只新增一份 manifest，不改 client 代码）。 */
export interface AgentManifest {
  /** 仅用于指标与报告识别，禁止进入行为分支。 */
  agentKey: string;
  command: string[];
  env?: Record<string, string>;
  /**
   * PromptRequest 消息体字段名。协议生态实测存在漂移（E0 failures F2）：
   * 以各 Agent 运行时 schema 为准，作为数据登记而不是代码分支。
   */
  promptFieldName: "prompt" | "content";
  notes?: string;
}
