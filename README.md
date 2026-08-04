# dcf-chatgpt-microcore

DCF 是用户与 AI 共同维护的长期个人认知基础设施。

它的核心不是永久保存一份“绝对正确的过去”，而是让现实持续留下足以唤醒回忆的记录，让 AI 形成当前理解，让用户在复盘中补充和纠正，并把这些认知变化按时间追加保存。

> **记录负责唤醒，AI 负责起草，用户负责校准，时间负责纠错。**

## 当前权威入口

当前仓库请按以下顺序理解：

1. `docs/spec/2026-08-04-DCF-当前实施规范.md`  
   当前 DCF 架构与需求的实现权威，回答“现在什么才算 DCF”。
2. `docs/spec/2026-08-05-DCF-macOS-AI实验宿主规范.md`  
   macOS 专用实验宿主的当前专项规范，回答“机器能力已经开放到哪里、正式 DCF 应如何借用系统能力”。
3. `docs/current-state.md`  
   当前阶段、证据状态、正在进行的研究和旧实现边界。
4. `docs/adr/`  
   保存为什么这样走、曾经怎样理解、哪些路线后来被修正；ADR 不覆盖历史，只追加新的裁决。

旧愿景、旧 G1～G7 生长路线、Chrome `1.0.0-rc.3` 与 legacy `0.18.2` 继续保留为历史实现、证据和回退材料，但不再拥有当前 DCF 概念与实施权威。

## 当前阶段

2026-08-05，macOS 专用 AI 宿主的 1TR / Boot 级能力开放已经通过真实重启后的独立复核，状态为 `behavior_passed`。

当前阶段已经从“继续打开权限”切换为：

> **macOS 原生公共能力黑洞勘探。**

目标不是寻找最深的系统入口，而是寻找：

> macOS 已经替所有应用长期维护了哪些事实、索引、生命周期、动作与资源边界，可以让 DCF 少造一整层 watcher、connector、index、daemon 和状态机。

任务书：

- `docs/tasks/2026-08-05-macOS原生公共能力黑洞勘探任务书.md`
- `docs/tasks/2026-08-05-macOS原生公共能力黑洞勘探执行计划.md`

阶段 ADR：

- `docs/adr/2026-08-05-macos-native-public-capability-blackhole-exploration.md`

## 当前架构方向

基础 DCF 保护的是认知谱系：

```text
现实交互
→ 回忆锚点
→ 当前理解
→ 用户复盘
→ 新现实
→ 新理解
→ 只追加，不覆盖
```

在 macOS 上进一步坚持：

> **系统尽量拥有现实，DCF 自己拥有认知。**

因此优先研究系统已经维护好的公共能力面，例如：

- `FSEvents + Spotlight`：文件变化与当前索引；
- `NSWorkspace + CoreDuet/KnowledgeC` 候选：活动时间骨架；
- `InputMethodKit + Unified Logging` 候选：用户最终文字提交；
- `Endpoint Security / eslogger` 候选：真实机器动作与 Effect 收据；
- `launchd + XPC`：进程生命周期与 IPC；
- `App Intents / Shortcuts / Apple Events`：跨 App 高语义动作；
- Accessibility / ScreenCaptureKit：只作为结构化能力不足时的退化层。

这些都只是候选或既定方向，不因为 API 存在、一次 demo 成功或权限已经开放就自动成为正式底座。

## 旧实现

仓库仍保存 Chrome `1.0.0-rc.3`、legacy `0.18.2`、`seed/` 以及此前控制平面、Surface、Companion 等实现和证据。

它们继续用于：

- 历史追溯；
- 运行证据；
- 可构建旧基线；
- 架构经验复用；
- 必要时回退。

但当前新设计不得从旧实现当前目录结构、插件边界或 G1～G7 阶段名反推 DCF 的新事实所有权。

## 验证纪律

始终区分：

```text
observed
hypothesized
implemented_unverified
runtime_verified
behavior_passed
failed
not_tested
```

源码存在、测试通过、候选生成和现实行为通过不是同一层证据。
