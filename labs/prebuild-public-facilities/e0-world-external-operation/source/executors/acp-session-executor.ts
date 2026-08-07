/**
 * E0 真实执行器 B —— 最小 ACP（Agent Client Protocol）会话执行器。
 *
 * 协议编解码使用 @agentclientprotocol/sdk（exact pin）；本执行器只实现 E0 所需
 * 的最小协议面：initialize / session/new / session/prompt / session/cancel。
 * Agent 进程经 spec.agentCommand 指定（本文件不认识任何具体 Agent 品牌）。
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
  ExecutorCommand,
  ExecutorEvent,
  ExternalExecutor,
} from "../contract.ts";

export interface AcpSessionSpec {
  agentCommand: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  /** 子进程环境覆盖（如实验隔离的 CODEX_HOME）；缺省继承。 */
  env?: Record<string, string>;
}

interface ActiveSession {
  connection: ClientSideConnection;
  sessionId: string;
  proc: Subprocess;
  updateCount: number;
}

export class AcpSessionExecutor implements ExternalExecutor {
  readonly name: string;
  private sessions = new Map<string, ActiveSession>();

  constructor(name = "acp-session") {
    this.name = name;
  }

  onCommand(
    command: ExecutorCommand,
    pushEvent: (e: ExecutorEvent) => boolean,
  ): void {
    if (command.type === "cancel") {
      const session = this.sessions.get(command.opId);
      if (session) {
        void session.connection
          .cancel({ sessionId: session.sessionId })
          .catch(() => {});
      }
      return;
    }
    const spec = JSON.parse(command.spec ?? "{}") as AcpSessionSpec;
    void this.runSession(command.opId, spec, pushEvent);
  }

  private async runSession(
    opId: string,
    spec: AcpSessionSpec,
    pushEvent: (e: ExecutorEvent) => boolean,
  ): Promise<void> {
    let proc: Subprocess;
    try {
      proc = spawn(spec.agentCommand, {
        cwd: spec.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...(spec.env ?? {}) },
      });
    } catch (error) {
      pushEvent({
        kind: "error",
        opId,
        message: `spawn failed: ${String(error).slice(0, 160)}`,
        at: Date.now(),
      });
      return;
    }

    let updateCount = 0;

    // E0 最小 Client：权限请求一律取消（保持确定性），session/update 只计数。
    const clientImpl: Client = {
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      sessionUpdate: async () => {
        updateCount++;
      },
    };

    const stdinSink = proc.stdin;
    const stdinStream = new WritableStream<Uint8Array>({
      write(chunk) {
        stdinSink.write(chunk);
        stdinSink.flush();
      },
    });
    const stdoutStream = proc.stdout as ReadableStream<Uint8Array>;

    const connection = new ClientSideConnection(
      (_agent: Agent) => clientImpl,
      ndJsonStream(stdinStream, stdoutStream),
    );

    pushEvent({ kind: "started", opId, at: Date.now() });

    const timeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(new Error(`${label} timeout after ${spec.timeoutMs}ms`)),
            spec.timeoutMs,
          ),
        ),
      ]);

    try {
      await timeout(
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        }),
        "initialize",
      );
      const session = await timeout(
        connection.newSession({ cwd: spec.cwd, mcpServers: [] }),
        "session/new",
      );
      this.sessions.set(opId, {
        connection,
        sessionId: session.sessionId,
        proc,
        updateCount,
      });
      const result = await timeout(
        connection.prompt({
          sessionId: session.sessionId,
          // codex-acp@1.1.13 的 PromptRequest 字段名为 prompt（数组）；
          // SDK 类型定义仍用 content，此处以运行时 schema 为准（已记入 failures.md）。
          ...({ prompt: [{ type: "text", text: spec.prompt }] } as unknown as { content: never }),
        }),
        "session/prompt",
      );
      pushEvent({
        kind: "result",
        opId,
        resultRef: `acp:${session.sessionId}:${result.stopReason}:updates=${updateCount}`,
        eventId: `${opId}:acp-r1`,
        at: Date.now(),
      });
    } catch (error) {
      pushEvent({
        kind: "error",
        opId,
        message: String(error).slice(0, 240),
        at: Date.now(),
      });
    } finally {
      this.sessions.delete(opId);
      try {
        proc.kill();
      } catch {
        // 进程可能已退出
      }
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      try {
        session.proc.kill();
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }
}
