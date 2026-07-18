# ADR: `/session/status` 缺少会话条目不是失败证据

## 决策

OpenCode 的 `/session/status` 只表达当前活动状态。接口成功但没有目标 session 条目时，DCF 不得推断任务未执行。

诊断应结合消息证据解释：已有 Assistant 输出表示执行证据存在，状态解释为 `inactive-with-assistant-output`；只有同时没有状态条目、没有消息或没有 Assistant 输出时，才形成待调查假设。

## 原因

现场诊断中目标 session 的状态条目为空，但已有 11 条消息和 10 条 Assistant 输出。旧规则把状态缺项直接描述为执行失败，与同一报告中的消息证据矛盾。
