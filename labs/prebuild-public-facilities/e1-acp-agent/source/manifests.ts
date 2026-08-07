/**
 * E1 — Agent 接入清单（纯数据）。
 * 新增 Agent = 新增一条记录；DcfAcpClient 代码零修改（任务书 §5 接缝要求）。
 */
import type { AgentManifest } from "./dcf-semantics.ts";

const here = new URL(".", import.meta.url).pathname;

export const manifests: Record<string, AgentManifest> = {
  codex: {
    agentKey: "codex",
    command: [`${here}../node_modules/.bin/codex-acp`],
    // 实验隔离 CODEX_HOME：本机默认 config 的 custom provider 使 app-server
    // model/list 为空（E0 failures F1），ChatGPT 登录态切面可正常枚举模型。
    env: {
      CODEX_HOME: `${here}../../e0-world-external-operation/scratch/codex-home-e0`,
    },
    promptFieldName: "prompt",
    notes: "@agentclientprotocol/codex-acp@1.1.13",
  },
  claude: {
    agentKey: "claude",
    command: [`${here}../node_modules/.bin/claude-agent-acp`],
    promptFieldName: "prompt",
    notes: "@agentclientprotocol/claude-agent-acp@0.65.0；Claude Code 2.1.191 oauth 登录态",
  },
};
