/**
 * E5 — Reality Loop 组合层（World 视角的极薄编排）。
 *
 * 纪律核查对象：本文件是唯一允许同时认识各设施公开接口的地方；
 * 即便如此，它也不做业务转换，只按固定管线移动共享语义对象：
 *
 *   TaskIntent → AgentSession(公开客户端) → AgentExecutionStatus
 *   现实侧独立观察 → ObservedEffect → FactAuthority（事实权威，非认知权威）
 *   EvidenceSource(公开 Provider) → EvidenceRef → FactAuthority
 *
 * Agent 的任何声明都不进入 ObservedEffect。
 */
import { DcfAcpClient } from "../../e1-acp-agent/source/acp-client.ts";
import { GitProvider } from "../../e4-evidence-intake/source/providers.ts";
import { ThinIntake } from "../../e4-evidence-intake/source/intake.ts";
import type { AgentExecutionStatus, TaskIntent } from "./contracts.ts";
import { verifyReality } from "./reality-verifier.ts";
import type { FactAuthority } from "./fact-authority.ts";
import type { AgentManifest } from "../../e1-acp-agent/source/dcf-semantics.ts";

export interface LoopResult {
  execution: AgentExecutionStatus;
  realityStatus: "PASS" | "FAIL";
  evidenceCount: number;
}

export class RealityLoop {
  constructor(
    private manifest: AgentManifest,
    private facts: FactAuthority,
    private intakeDataDir: string,
  ) {}

  /** 闭环执行：Agent 执行与 Effect 判定完全分离。 */
  async run(intent: TaskIntent, repoDir: string): Promise<LoopResult> {
    // 1) Agent 设施：只做执行，产出执行状态（不产出效果）
    const client = new DcfAcpClient(this.manifest, {
      permissionPolicy: (request) => {
        const allow = request.options.find((o) => /allow|proceed|approve/i.test(o.kind));
        return allow ? { selectOptionId: allow.optionId } : { cancel: true };
      },
    });
    let execution: AgentExecutionStatus;
    try {
      await client.connect();
      const session = await client.newSession(repoDir);
      const result = await client.prompt(session.sessionId, intent.description, 300000);
      execution = {
        sessionId: session.sessionId,
        status: result.stopReason === "cancelled" ? "cancelled" : "completed",
        stopReason: result.stopReason,
      };
    } catch (error) {
      execution = { sessionId: "none", status: "error", detail: String(error).slice(0, 200) };
    } finally {
      client.dispose();
    }

    // 2) 现实观察：与 Agent 声明无关（关键禁止项）
    const effect = verifyReality(intent.taskId, intent.expected);
    this.facts.recordEffect(effect);

    // 3) Evidence 设施：从 Git 现实来源采集证据（不认识 Agent 品牌）
    const intake = new ThinIntake({ dataDir: this.intakeDataDir });
    const git = new GitProvider(`git:${intent.taskId}`, repoDir);
    intake.discover(git.identity, "git", "loop");
    intake.attach(git.identity, git);
    intake.configure(git.identity);
    intake.start(git.identity);
    intake.pump();
    const evidence = intake.byOccurrence(git.identity).map((e) => ({
      evidenceId: e.evidenceId,
      sourceId: e.sourceId,
      occurrenceTime: e.sourceOccurrenceTime,
      payload: e.payload,
    }));
    for (const ref of evidence) this.facts.recordEvidence(intent.taskId, ref);
    intake.stop(git.identity);

    return { execution, realityStatus: effect.realityStatus, evidenceCount: evidence.length };
  }
}
