# E5 失败路径与坑清单

## F1 — Git 作为 Evidence Source 要求现实变化必须被提交

- 现象：首版正闭环中 Agent 只修改文件不提交，Evidence 采集只有 baseline 1 条，
  "证据链覆盖真实变化"断言失败。
- 解决：任务定义包含 commit（现实变化进入 Git 现实来源的必要形态）。
- 教训：Evidence Source 的可观测性依赖来源自身的持久化语义；
  未被来源记录的变化对 Evidence 设施不可见，必须由 Verifier（文件系统层）补足。
  两类观察通道（Evidence vs Verifier）都不可省。

## F2 — Agent "完成"文本天然存在，必须在结构上不可触达 Effect

- 观察：T2 中 Agent 最终文本包含 "done"（可被误读为完成声明），
  但 verifyReality 的输入签名里根本不存在 Agent 输出字段。
- 教训：防谎报不能靠"记得不去读"，要靠类型边界——
  Reality Verifier 的参数只有 ExpectedEffect，结构上拒绝 Agent 声明进入。

## F3 — 会话异常与任务失败的语义必须在契约层分离

- 现象：若把 prompt 抛错直接当作任务失败，T3 的现实成立就会被误判。
- 解决：AgentExecutionStatus 与 ObservedEffect 是两个独立共享语义类型，
  分别落库、分别查询。
- 教训：这条分离应继承到正式 ExternalOperation 语义（E0 的 error 状态
  只描述执行层，不描述现实层）。

## F4 — fixture 仓库必须独立于实验 worktree 的 Git 历史

- 现象：若 fixture 与主 worktree 同 repo，Evidence 采集会混入实验自身的提交。
- 解决：`initTaskRepo` 每次 `git init` 全新独立 repo（rm 后重建，保证 clean state）。
