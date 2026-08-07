/**
 * E5 — fixture 任务仓库初始化（独立 Git repo，任务书 §9 最小闭环要求）。
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

export const VERIFY_SCRIPT = `#!/usr/bin/env bash
set -e
grep -q "MAGIC-E5-" task.txt
echo "verify-ok"
`;

export const BASELINE_TASK = "# E5 task file\nstatus: pending\n";

export async function initTaskRepo(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "task.txt"), BASELINE_TASK);
  await writeFile(join(dir, "verify.sh"), VERIFY_SCRIPT, { mode: 0o755 });
  await writeFile(join(dir, "README.md"), "E5 fixture task repo. Agent works here.\n");
  const git = (args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd: dir, env: { ...process.env } });
  git(["init", "-q"]);
  git(["config", "user.email", "e5-experiment@dcf.local"]);
  git(["config", "user.name", "E5 Experiment"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "baseline: task pending"]);
}

/** 为负控制把文件预置为"现实已成立"。 */
export async function presetReality(dir: string, magic: string): Promise<void> {
  await writeFile(join(dir, "task.txt"), `# E5 task file\nstatus: done\n${magic}\n`);
  const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: dir });
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "reality preset"]);
}
