/**
 * E0 真实执行器 A —— 通用异步 HTTP Turn 执行器。
 *
 * 刻意保持 provider 无关：URL、headers、body、结果抽取路径全部来自 spec；
 * 本文件不出现任何 provider 名称（headers 中的凭据由 harness 从环境变量注入）。
 */
import type {
  ExecutorCommand,
  ExecutorEvent,
  ExternalExecutor,
} from "../contract.ts";

export interface HttpTurnSpec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  /** 结果 JSON 的取值路径，如 "choices.0.message.content"。 */
  resultPath: string;
  timeoutMs: number;
}

function pickPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export class HttpTurnExecutor implements ExternalExecutor {
  readonly name: string;
  private aborts = new Map<string, AbortController>();

  constructor(name = "http-turn") {
    this.name = name;
  }

  onCommand(
    command: ExecutorCommand,
    pushEvent: (e: ExecutorEvent) => boolean,
  ): void {
    if (command.type === "cancel") {
      this.aborts.get(command.opId)?.abort();
      this.aborts.delete(command.opId);
      return;
    }
    const spec = JSON.parse(command.spec ?? "{}") as HttpTurnSpec;
    const controller = new AbortController();
    this.aborts.set(command.opId, controller);
    const at = Date.now();

    void (async () => {
      try {
        pushEvent({ kind: "started", opId: command.opId, at });
        const response = await fetch(spec.url, {
          method: spec.method,
          headers: spec.headers,
          body: JSON.stringify(spec.body),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(spec.timeoutMs),
          ]),
        });
        const text = await response.text();
        if (!response.ok) {
          pushEvent({
            kind: "error",
            opId: command.opId,
            message: `http ${response.status}: ${text.slice(0, 120)}`,
            at: Date.now(),
          });
          return;
        }
        const json = JSON.parse(text) as Record<string, unknown>;
        const result = pickPath(json, spec.resultPath);
        const resultRef = `http:${response.status}:${JSON.stringify(result ?? null).slice(0, 256)}`;
        pushEvent({
          kind: "result",
          opId: command.opId,
          resultRef,
          eventId: `${command.opId}:http-r1`,
          at: Date.now(),
        });
      } catch (error) {
        const aborted = controller.signal.aborted;
        pushEvent({
          kind: aborted ? "terminated" : "error",
          ...(aborted
            ? { reason: "worker_lost" as const }
            : { message: String(error).slice(0, 200) }),
          opId: command.opId,
          at: Date.now(),
        } as ExecutorEvent);
      } finally {
        this.aborts.delete(command.opId);
      }
    })();
  }
}
