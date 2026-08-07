/**
 * E5 — Reality Verifier：只从现实来源（文件/命令/Git）重新观察预期效果。
 * 绝不消费 Agent 的任何文本声明（任务书 §9 关键禁止项）。
 */
import { readFileSync, existsSync } from "node:fs";
import type { ExpectedEffect, ObservedEffect } from "./contracts.ts";

export function verifyReality(taskId: string, expected: ExpectedEffect): ObservedEffect {
  const checks: { name: string; ok: boolean; evidence: string }[] = [];

  for (const fc of expected.fileContains) {
    const exists = existsSync(fc.path);
    const content = exists ? readFileSync(fc.path, "utf8") : "";
    const ok = exists && content.includes(fc.needle);
    checks.push({
      name: `file-contains:${fc.path.split("/").pop()}`,
      ok,
      evidence: ok
        ? `found "${fc.needle}" (${content.length}B file)`
        : exists
          ? `needle absent; head=${JSON.stringify(content.slice(0, 80))}`
          : "file missing",
    });
  }

  if (expected.command) {
    const proc = Bun.spawnSync(expected.command.argv, { cwd: expected.command.cwd });
    const ok = proc.exitCode === expected.command.expectExit;
    checks.push({
      name: `command:${expected.command.argv.join(" ").slice(0, 60)}`,
      ok,
      evidence: `exit=${proc.exitCode} stdout=${proc.stdout.toString().slice(0, 120)}`,
    });
  }

  return {
    taskId,
    realityStatus: checks.length > 0 && checks.every((c) => c.ok) ? "PASS" : "FAIL",
    checks,
    observedAt: Date.now(),
  };
}
