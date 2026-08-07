/**
 * E1 — DCF ACP Client prototype（单一客户端，驱动所有 Agent）。
 *
 * 纪律（任务书 §5）：
 *   - 缺失 capability 通过能力发现自然降级，不写 Agent 名称判断；
 *   - DCF 语义（dcf-semantics.ts）保持自有，ACP 只停在边界；
 *   - 接入新 Agent = 新增一份 AgentManifest 数据，不改本文件。
 */
import { spawn, type Subprocess } from "bun";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type Client,
} from "@agentclientprotocol/sdk";
import type {
  Activity,
  AgentManifest,
  AgentSessionHandle,
  CapabilityProfile,
  PermissionPolicy,
  PermissionRequest,
  TaskState,
  TurnResult,
} from "./dcf-semantics.ts";

/** SDK session/update 载荷是宽松类型；此处按运行时结构读取。 */
type UpdatePayload = {
  sessionId?: string;
  update?: Record<string, unknown> & { sessionUpdate?: string };
};

export interface ClientOptions {
  permissionPolicy: PermissionPolicy;
  /** 观察钩子：归一化活动事件（含跨会话统计）。 */
  onActivity?: (agentKey: string, sessionId: string, activity: Activity) => void;
  onStateChange?: (agentKey: string, sessionId: string, state: TaskState) => void;
}

export class DcfAcpClient {
  private proc: Subprocess | null = null;
  private connection: ClientSideConnection | null = null;
  private profile: CapabilityProfile | null = null;
  private seq = 0;
  private sessionStates = new Map<string, TaskState>();
  private permissionWaiters = 0;

  constructor(
    private manifest: AgentManifest,
    private options: ClientOptions,
  ) {}

  get agentKey(): string {
    return this.manifest.agentKey;
  }

  get capabilities(): CapabilityProfile | null {
    return this.profile;
  }

  get alive(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /** 故障注入/诊断：直接杀死 ACP 子进程。 */
  killAgentProcess(): void {
    try {
      this.proc?.kill();
    } catch {
      // already dead
    }
  }

  /** 故障注入：向 Agent stdin 注入异常 JSON（协议健壮性测试）。 */
  injectMalformedJson(payload: string): void {
    try {
      this.proc?.stdin.write(payload + "\n");
      this.proc?.stdin.flush();
    } catch {
      // ignore
    }
  }

  async connect(): Promise<CapabilityProfile> {
    this.proc = spawn(this.manifest.command, {
      cwd: process.cwd(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...(this.manifest.env ?? {}) },
    });

    const clientImpl: Client = {
      requestPermission: async (params) => {
        this.permissionWaiters++;
        const request = this.toPermissionRequest(params);
        const decision = this.options.permissionPolicy(request);
        this.permissionWaiters--;
        if ("cancel" in decision) return { outcome: { outcome: "cancelled" } };
        return {
          outcome: { outcome: "selected", optionId: decision.selectOptionId },
        };
      },
      sessionUpdate: async (params) => {
        this.handleSessionUpdate(params as UpdatePayload);
      },
    };

    const stdinSink = this.proc.stdin;
    this.connection = new ClientSideConnection(
      (_agent: Agent) => clientImpl,
      ndJsonStream(
        new WritableStream<Uint8Array>({
          write(chunk) {
            stdinSink.write(chunk);
            stdinSink.flush();
          },
        }),
        this.proc.stdout as ReadableStream<Uint8Array>,
      ),
    );

    const init = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    this.profile = this.deriveProfile(init);
    return this.profile;
  }

  /** 能力档案完全由 initialize 响应派生（能力发现），零 Agent 名称分支。 */
  private deriveProfile(init: {
    protocolVersion: number;
    agentInfo?: { name?: string; version?: string };
    agentCapabilities?: Record<string, unknown>;
    authMethods?: unknown[];
  }): CapabilityProfile {
    const caps = (init.agentCapabilities ?? {}) as Record<string, any>;
    const sessionCaps = (caps.sessionCapabilities ?? {}) as Record<string, unknown>;
    const promptCaps = (caps.promptCapabilities ?? {}) as Record<string, unknown>;
    return {
      protocolVersion: init.protocolVersion,
      agentName: init.agentInfo?.name ?? "unknown",
      agentVersion: init.agentInfo?.version ?? "unknown",
      sessionList: "list" in sessionCaps,
      sessionResume: "resume" in sessionCaps,
      sessionClose: "close" in sessionCaps,
      sessionDelete: "delete" in sessionCaps,
      loadSession: Boolean(caps.loadSession),
      promptEmbeddedContext: Boolean(promptCaps.embeddedContext),
      promptImage: Boolean(promptCaps.image),
      authMethods: (init.authMethods ?? []).map(
        (m) => (m as { id?: string }).id ?? "unknown",
      ),
      rawCapabilities: init.agentCapabilities,
    };
  }

  async newSession(cwd: string): Promise<AgentSessionHandle> {
    const response = await this.connection!.newSession({ cwd, mcpServers: [] });
    this.setState(response.sessionId, "idle");
    return {
      sessionId: response.sessionId,
      cwd,
      state: "idle",
      capabilities: this.profile!,
    };
  }

  /** 能力发现降级：不支持的可选能力返回 supported:false，而不是抛异常或分支。 */
  async listSessions(): Promise<{ supported: boolean; sessions: unknown[] }> {
    if (!this.profile?.sessionList) return { supported: false, sessions: [] };
    const conn = this.connection as unknown as {
      listSessions?(p: unknown): Promise<{ sessions?: unknown[] }>;
    };
    if (!conn.listSessions) return { supported: false, sessions: [] };
    const response = await conn.listSessions({});
    return { supported: true, sessions: response.sessions ?? [] };
  }

  async resumeSession(
    sessionId: string,
    cwd: string,
  ): Promise<{ supported: boolean; sessionId?: string }> {
    if (!this.profile?.sessionResume) return { supported: false };
    const conn = this.connection as unknown as {
      resumeSession?(p: unknown): Promise<{ sessionId?: string }>;
    };
    if (!conn.resumeSession) return { supported: false };
    const response = await conn.resumeSession({ sessionId, cwd, mcpServers: [] });
    this.setState(response.sessionId ?? sessionId, "idle");
    return { supported: true, sessionId: response.sessionId ?? sessionId };
  }

  async closeSession(sessionId: string): Promise<{ supported: boolean }> {
    if (!this.profile?.sessionClose) return { supported: false };
    const conn = this.connection as unknown as {
      closeSession?(p: unknown): Promise<unknown>;
    };
    if (!conn.closeSession) return { supported: false };
    await conn.closeSession({ sessionId });
    this.setState(sessionId, "closed");
    return { supported: true };
  }

  async prompt(
    sessionId: string,
    text: string,
    timeoutMs: number,
  ): Promise<TurnResult> {
    const activities: Activity[] = [];
    this.activeTurns.set(sessionId, activities);
    this.setState(sessionId, "working");

    // 协议生态字段漂移（E0 F2）：字段名来自 manifest 数据，不是代码分支。
    const params: Record<string, unknown> = {
      sessionId,
      [this.manifest.promptFieldName]: [{ type: "text", text }],
    };

    const conn = this.connection as unknown as {
      prompt(p: unknown): Promise<{ stopReason?: string }>;
    };
    try {
      const result = await this.withTimeout(
        conn.prompt(params),
        timeoutMs,
        "session/prompt",
      );
      const stopReason = result.stopReason ?? "unknown";
      this.setState(sessionId, stopReason === "cancelled" ? "cancelled" : "done");
      const usageTokens = activities
        .filter((a): a is Extract<Activity, { type: "usage" }> => a.type === "usage")
        .reduce((sum, a) => sum + a.tokens, 0);
      return { stopReason, activities, usageTokens };
    } catch (error) {
      this.setState(sessionId, "error");
      throw error;
    } finally {
      this.activeTurns.delete(sessionId);
    }
  }

  cancel(sessionId: string): void {
    this.setState(sessionId, "cancelled");
    void this.connection!.cancel({ sessionId }).catch(() => {});
  }

  dispose(): void {
    this.killAgentProcess();
    this.connection = null;
    this.proc = null;
  }

  /* ---------------- 内部 ---------------- */

  private activeTurns = new Map<string, Activity[]>();

  private setState(sessionId: string, state: TaskState): void {
    this.sessionStates.set(sessionId, state);
    this.options.onStateChange?.(this.manifest.agentKey, sessionId, state);
  }

  stateOf(sessionId: string): TaskState | undefined {
    return this.sessionStates.get(sessionId);
  }

  private emit(sessionId: string | undefined, activity: Activity): void {
    if (!sessionId) return;
    this.activeTurns.get(sessionId)?.push(activity);
    this.options.onActivity?.(this.manifest.agentKey, sessionId, activity);
  }

  private handleSessionUpdate(payload: UpdatePayload): void {
    const update = payload.update;
    if (!update) return;
    const sessionId = payload.sessionId;
    const kind = update.sessionUpdate;
    const seq = this.seq++;
    switch (kind) {
      case "agent_message_chunk": {
        const text = extractText(update.content);
        if (text) this.emit(sessionId, { type: "agent_message", text, seq });
        return;
      }
      case "agent_thought_chunk": {
        const text = extractText(update.content);
        if (text) this.emit(sessionId, { type: "agent_thought", text, seq });
        return;
      }
      case "tool_call":
      case "tool_call_update": {
        const toolName = String(update.title ?? update.toolName ?? "tool");
        const status = String(update.status ?? "unknown");
        this.emit(sessionId, { type: "tool_call", toolName, status, seq });
        // file-change 语义从 tool_call 的路径字段派生（边界转换，非业务分支）
        const path = update.path ?? update.location?.path;
        if (typeof path === "string") {
          this.emit(sessionId, {
            type: "file_change",
            path,
            kind: kind === "tool_call" ? "call" : "update",
            seq,
          });
        }
        return;
      }
      case "plan": {
        const entries = Array.isArray(update.entries) ? update.entries.length : 0;
        this.emit(sessionId, { type: "plan", entries, seq });
        return;
      }
      case "usage": {
        const tokens = Number(update.tokens ?? update.totalTokens ?? 0);
        this.emit(sessionId, { type: "usage", tokens, seq });
        return;
      }
      default:
        this.emit(sessionId, {
          type: "raw_update",
          updateType: String(kind ?? "unknown"),
          seq,
        });
    }
  }

  private toPermissionRequest(params: unknown): PermissionRequest {
    const p = params as {
      toolCall?: { title?: string; rawInput?: unknown };
      options?: { optionId?: string; kind?: string; name?: string }[];
    };
    return {
      toolCallSummary: String(p.toolCall?.title ?? JSON.stringify(p.toolCall?.rawInput ?? {}).slice(0, 120)),
      options: (p.options ?? []).map((o) => ({
        optionId: String(o.optionId ?? ""),
        kind: String(o.kind ?? "unknown"),
        name: String(o.name ?? ""),
      })),
    };
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }
}

function extractText(content: unknown): string {
  const c = content as { type?: string; text?: string };
  return c?.type === "text" ? c.text ?? "" : "";
}
