# ADR: DCF 以期望对话环境为统一架构对象

Date: 2026-07-13
Status: accepted

## Context

0.12.0 已把完整包与 GitHub 引用统一为能力重协调，但弹药、设置、页面、包管理、维护、Profile 与恢复仍容易被理解为并列子系统。整体高维概念内联表明，它们共同描述并维护“未来对话发生时的条件”。

## Decision

1. `dcf.state.root.v1` 继续是唯一权威状态；`dcf.environment.snapshot.v1` 只是只读 Facade。
2. 持久变化统一表达为有限的 `dcf.intent.v1` Environment Intent；即时 Action/Effect 保持独立失败语义。
3. Artifact 先编译为 Intent，再由 Environment Reconciler 形成候选、验证、原子提交和 Runtime 重投影。
4. content、action、view、style、policy 进入统一资源图，保留各自编译和观察契约。
5. 弹药、功能、构成、维护四页均由包声明的 `ui-view:*` 资源拥有；Core 只提供安全宿主和回退渲染。
6. Environment Profile 保存包选择、政策和产品组织，不复制用户弹药正文；Profile 激活和快照恢复都是环境迁移。

## Consequences

- 同一意图不再因来自对话、按钮、菜单或手动 JSON 而拥有不同语义。
- 包只是不可变交付容器，资源才是进入环境的能力单位。
- 页面成为同一期望环境的内容、行动、构成和观察投影。
- Runtime 体检继续独立比较期望投影与真实浏览器现场。
- 不建立第二权威状态，不执行远程 JavaScript。
