# E5 — 跨设施 Reality Loop 实验

任务书：《DCF 正式功能施工前：公共能力架构消歧实验任务书 v1》§9 + 计划 [修订1]。

## 最小闭环（真实执行）

```text
TaskIntent
  → AgentSession（DcfAcpClient，复用 E1 公开客户端）
  → 真实 Codex Agent 修改 fixture Git repo + 提交 + 运行 verify.sh
  → Reality Verifier（独立重察文件与命令，不读 Agent 声明）
  → ObservedEffect
  → FactAuthority（Action/Evidence 事实权威，bun:sqlite）
  → Structured/Exact 查询重新查出这次真实结果
Evidence Source（E4 GitProvider 公开接口）→ EvidenceRef → FactAuthority
```

## 事实/认知分层（计划 [修订1] 落点）

- `ObservedEffect` 只落 `observed_effects`（事实权威）；
- 事实权威 schema 中**不存在** cognition/object/revision 表；
- `layer_boundary.cognition_promotion_path = 'none'`（测试断言）；
- 若未来需要进入长期认知，必须经过明确的认知形成/确认过程——本实验显式不实现。

## 运行

```bash
bun test tests/    # 5 tests：正闭环 / 谎报负控制 / 会话异常负控制 / 边界扫描 / Glue 度量
```

## 关键结果（两次独立复跑 5/5）

- T1 正闭环：Codex 真实修改 `task.txt`（MAGIC-E5-42）+ commit + verify.sh；
  Effect=PASS 由现实重察产生；事实权威可查询；Git 证据 ≥2 条入库。
- T2 Agent 声称完成但未修改 → execution=completed 而 Effect=FAIL（声明 ≠ 事实）。
- T3 现实成立但会话被 kill → agent execution status=error 而 reality effect=PASS（两状态可区分）。
- T4/T5 结构证据：SQLite 事实权威/Evidence 设施零 Agent 品牌；组合层 60 非空 LOC、
  7 个跨设施公开 import、0 provider 分支、0 重复权威。

结果数据：results/e5-results.json。裁决见 [decision.md](./decision.md)。
