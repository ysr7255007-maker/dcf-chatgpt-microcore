/**
 * E3 — 语料加载（任务书 §7.1：复用真实 DCF 语料，不造过度简单语料）。
 *
 * 语料 = 本 worktree 的真实认知文档：docs/spec（冻结规范）+ docs/current-state
 * + 两份架构骨干 ADR。它们就是 DCF 未来的正式认知对象原型。
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { IngestDoc } from "./authority.ts";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname; // worktree 根

export async function loadCorpus(): Promise<IngestDoc[]> {
  const docs: IngestDoc[] = [];
  const specDir = join(REPO_ROOT, "docs/spec");
  for (const name of (await readdir(specDir)).filter((f) => f.endsWith(".md")).sort()) {
    const path = join(specDir, name);
    docs.push(await toDoc(path, "spec"));
  }
  docs.push(await toDoc(join(REPO_ROOT, "docs/current-state.md"), "state"));
  const adrDir = join(REPO_ROOT, "docs/adr");
  for (const name of [
    "2026-08-04-dcf-design-evolution-and-implementation-closure.md",
    "2026-08-07-capability-world-composition-runtime-seam-absorption.md",
  ]) {
    docs.push(await toDoc(join(adrDir, name), "adr"));
  }
  return docs;
}

async function toDoc(path: string, kind: string): Promise<IngestDoc> {
  const text = await readFile(path, "utf8");
  const st = await stat(path);
  return {
    objectId: `doc:${path.split("/docs/")[1]}`,
    kind,
    source: "repo:docs",
    time: Math.floor(st.mtimeMs),
    text,
  };
}
