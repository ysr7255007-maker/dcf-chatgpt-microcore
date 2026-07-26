# DCF Current State

Updated: 2026-07-26

## Repository truth after P0 unification

当前主线保存：

- `docs/vision/2026-07-26-dcf-from-zero-vision-adr.md`：当前有效愿景；
- `docs/adr/2026-07-26-dcf-minimal-live-loop-growth-blueprint.md`：已接受、可直接执行的生长路线；
- DCF Chrome `1.0.0-rc.3` 与 legacy `0.18.2`：可运行旧世界；
- `seed/`：新系统唯一生长空间。

旧世界最后代码提交是 `bdaaad474880667f927c0affc22755db36f712c3`。`rebuild/chrome-native-host-v2@2fa7fc0` 在它之后只增加一份探索期愿景记录。`work/control-plane-reconcile-rc3@fc186df` 作为替代架构路线保留而不合入。`stable@4f1f9a2` 未移动。

新系统按以下顺序生长：

```text
P0 → G1 授权/收回/保存/回看
   → G2 搜索/取用/发射
   → G3 材料代谢
   → G4 推荐/任务/执行/回灌
   → G5 跨执行者
   → G6 个人软件修改
   → G7 高级观察与因果诊断
```

P0 的远端仓库归一已具备无冲突 merge tree 和两条全绿旧测试线。另一台本地 checkout 报告的 3 个修改文件与 8 个未跟踪基础设施脚本不在任何远端 Git 对象中，本执行环境也无法读取，因此其收编状态是 `blocked_unavailable`，不得伪装成已经保存。完整证据见 `seed/docs/p0-unification-evidence.md`。

以下内容是保留的旧世界运行边界，不是 `seed` 的预设架构。

## Retained old-world product position

DCF 是用户与 AI 共同维护的个人认知基础设施。当前产品仍是一个 Chrome 扩展和一组独立第一方插件；用户只面对一个完整 DCF。

- Chrome source candidate: `1.0.0-rc.3`
- Preserved source lineage: `rebuild/chrome-native-host-v2`
- Pre-change problem-evidence HEAD: `d67d070491f9997bc940735be2506f104a912082`
- Runtime Stable/Current/LKG: 保持本次控制平面改造前最后可信基线；本源码提交不自动推进
- Product-semantic baseline: Core Review 前完整 DCF Next
- Data continuity: DCF Next + Chrome rc.1

## Source review result

`candidate`、S6 和 F2f 不是三个独立根因。

旧宿主把以下事实混在一个流程里：

- 目标组合；
- 当前注册；
- 所有打开页面的启动回执；
- 页面热迁移；
- Current/LKG 提交；
- 插件语义版本身份。

因此页面延迟、消息丢失、同版本内容变化或外部工作区不匹配都会迫使系统继续增加 timeout、连号插件和恢复分支。

`d67d070` 已确认修改 `shell.9` 内容但只更新 hash，没有升级不可变语义版本；它保留为问题证据，不再作为正确发布方式。

## rc.3 implemented boundary

源码已改为：

```text
Desired → Observed → Committed → Reconcile
```

实现包括：

- `dcf.chrome.host.state.v3`；
- hash 键控 CodeUnit 工件库；
- 精确 hash Snapshot；
- 持久 DesiredSnapshot；
- Current / LKG / Stable 分离；
- legacy candidate 丢弃迁移；
- 宿主创建的 Canary 页面；
- 仅对相对 Current 发生变化的启用工件做最低 loaded 证明；
- Canary 证明后的 Current/LKG 原子提交；
- 注册调和与页面迁移解耦；
- 页面迁移失败不回滚 Current；
- ActivationRecord、ReconcileRecord 和统一结构化事件；
- 构建生成 artifact_id、default snapshot、release manifest；
- 已发布语义版本复用的构建门禁。

## Evidence status

当前证据等级：

- source implementation: `implemented_unverified`；
- Node syntax: passed；
- control-plane unit/integration behavior: passed；
- repository full verification: pending GitHub Actions for the resulting commit；
- real Chrome Canary activation: `not_tested`；
- Current/LKG runtime advancement: not performed；
- Stable promotion: not performed。

不得将源码存在、局部测试通过或 CI 通过写成真实浏览器行为通过。

## Frozen lanes

- **S6 / RESULT delivery**：冻结旧页面 outbox 局部修补；下一阶段改为宿主 durable Artifact + ConversationBinding。
- **F2f / workspace**：冻结从 `/path` 或 `/project/current` 推测目标；下一阶段实现显式 WorkspaceBinding 和 session 前后双重验证。
- **Diagnostics S6 line**：保持冻结，不再通过 diagnostics/dialogue 连号版本寻找控制平面事实。

## Deferred old-world acceptance

本地 AI 在限定的 Activation Controller 接口内执行一次真实浏览器验收：

1. 从准确 commit 加载 `rc.3`；
2. 保持旧 Stable 不变；
3. 声明一个精确 DesiredSnapshot；
4. 观察宿主 Canary 创建、loaded 证明和关闭；
5. 确认 Current/LKG 原子推进，Stable 未自动推进；
6. 注入必要工件失败，确认 Current/LKG 不变；
7. 制造一个现有页面迁移失败，确认只产生 PageRuntime 偏差；
8. 输出结构化证据包，不让用户搬运日志。

该旧候选不再作为新系统开工前置。只有其自身行为通过时，才可按旧语义显式提升 Stable；新系统不能借用旧候选的测试或 Stable 声明自己的行为通过。
