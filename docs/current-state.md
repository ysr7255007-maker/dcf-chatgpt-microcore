# DCF Current State

Updated: 2026-07-21

## 当前开发线

- Repository: `ysr7255007-maker/dcf-chatgpt-microcore`
- Branch: `rebuild/chrome-native-host-v2`
- Candidate: `1.0.0-rc.3`
- Parent evidence commit: `d67d070491f9997bc940735be2506f104a912082`
- Stable before this candidate: `7f9674b41b23598aa07e754ded83808500add2ce`
- Status of this candidate: `implemented_unverified` until GitHub verification and real-browser Canary acceptance complete

## 为什么进入控制平面改造

Issue #70 的 candidate 启动停滞、Shell 启动证明、S6 结果回传和 F2f 工作区问题不是三个应继续连号修补的孤立故障。它们共同暴露出：系统通过页面、外部程序当前状态和执行步骤推断权威事实。

`d67d070` 又修改了 `shell.9` 内容而只更新 hash，没有改变不可变版本标签。这一事实已被保留到 release ledger 的历史冲突证据中；后续版本复用在构建期直接失败。

## 本候选已经实现

### Activation Controller

- 宿主状态升级为 `dcf.chrome.host.state.v3`；
- CodeUnit 改为 `unit_id + content_hash` 身份；
- 旧 v2 code store、candidate/current/LKG 自动迁移；
- DesiredSnapshot 与 Committed Current/LKG/Stable 分离；
- 专用非活动 Canary 证明候选；
- `loaded / ready / degraded / failed` 分层；
- 必要单元阻塞、可选单元失败不绑架整个组合；
- 幂等 Reconcile 支持 Service Worker 重启后从持久事实继续；
- candidate 提交与现有页面迁移解耦；
- 页面迁移失败保留 `reload_required`，不回滚 Current；
- ActivationRecord、ReconcileRecord 与 PageRuntime 进入宿主持久状态；
- Stable 改为真实验收后的显式承诺。

### 发布链

- official index 升级为 `dcf.plugin_index.v2`；
- 每个条目生成 `content_id`；
- 新增 `code-unit-version-ledger.json`；
- 新增 `build-manifest.json`；
- 相同 `unit_id + semantic_version` 内容变化时构建失败；
- 构建摘要包含控制平面和 source-tree digest。

### 兼容

- 现有十一项第一方插件源码和业务数据未重写；
- `unit.started` / `unit.failed` 保留，但必须被精确页面观察或唯一身份解析；
- `host.status.code_units` 保留旧读模型，功能管理和恢复页无需同步升级；
- v1/v2 backup 与 plugin index 继续可读。

## 当前确定性证据

本候选本地隔离测试已证明：

- v1/v2 → v3 状态迁移；
- 内容寻址工件和旧同版本冲突共存；
- Stable 不再由 Current/LKG 自动推断；
- 语义版本复用在构建期被拒绝；
- Canary 首装、必要失败保留 LKG、可选失败非阻塞；
- 重复 Reconcile 与 Service Worker 重启幂等；
- 非 ChatGPT 标签页不参与证明；
- 同版本新 hash 可以形成新 Snapshot；
- 页面热迁移失败不回滚 Current；
- degraded 观察不否定 Committed；
- 旧状态接口保持兼容。

这些状态属于 `behavior_passed` 的隔离宿主测试，不等于真实 Chrome/ChatGPT 已通过。

## 冻结边界

- S6 诊断追踪线继续冻结；
- F2f 仍为 `implemented_unverified`；
- 不再创建 dialogue/shell 连号式局部补丁；
- Stable 不因本提交自动推进。

## 下一条垂直闭环

本候选完成 GitHub 验证与真实 Canary 激活后，再按优先级进入：

1. 宿主持久 Artifact + ConversationBinding，完成 S6；
2. 显式 WorkspaceBinding 和 session 前后双重验证，完成 F2f；
3. durable permission 与长任务生命周期；
4. AcceptanceRecord 投影。

每条闭环复用 Desired / Observed / Committed / Reconcile，但不把业务事实塞回通用 plugin data。
