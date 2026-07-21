# ADR: DCF 控制平面采用声明—观察—承诺—调和

Date: 2026-07-21  
Status: accepted for `1.0.0-rc.3`; implementation candidate complete; GitHub and real-browser acceptance pending

## Context

候选激活停滞、Shell 启动证明、S6 结果回传和 F2f 工作区绑定表面上位于不同模块，但共同依赖一个更基础的问题：DCF 通过易失页面、共享插件数据、外部程序当前状态和历史执行步骤推断权威事实。

旧 Activation Controller 把以下事情压进同一事务：

- 保存候选代码；
- 更新全局 registrations；
- 在所有已打开 ChatGPT 页面热执行；
- 等待每个插件完成包含状态恢复在内的 `unit.started`；
- 提交 Current/LKG；
- 把超时或任意 `unit.failed` 解释为整个候选失败。

这使页面数量、状态存储延迟、消息 ACK 和现有页面迁移获得了否定候选的权力。`d67d070` 修改 `shell.9` 内容但没有改变不可变版本标签，则证明发布身份也依赖人工纪律而非生成工具。

## Decision

### 1. 控制模式

正式采用：

```text
Desired → Observed → Committed → Reconcile
```

Desired 由正式入口显式声明并持久化；Observed 只提供当前证据；Committed 只由宿主在不变量成立后原子产生；Reconciler 依据差异选择下一项最小幂等动作。

### 2. 事实所有权

宿主拥有：

- DesiredSnapshot；
- ContentAddressedCodeUnit；
- Current、LKG、Stable；
- Canary；
- PageRuntime；
- ActivationRecord 与 ReconcileRecord。

页面插件只能报告运行观察和请求语义操作，不能通过 `plugin.data.set` 或页面当前状态修改这些事实。

### 3. 内容身份

```text
CodeUnitIdentity = unit_id + sha256(content)
```

Snapshot 引用 hash。语义版本保留为标签。发布构建维护版本 ledger，发现已发布语义版本对应不同内容时失败。历史 `shell.9` 冲突作为两个 hash 的证据保留，不覆盖旧内容，也不伪造版本升级历史。

### 4. Canary 证明

候选不再依赖用户全部现有页面。宿主创建或复用一个专用非活动 ChatGPT Canary，在其中执行精确 hash 的 CodeUnit。必要单元满足声明的最低 `loaded` 或 `ready` 承诺后，宿主才协调正式 registrations 并提交 Current/LKG。

Canary 自身是观察面，不是权威事实。刷新、关闭或 Service Worker 重启后，Reconciler 依据持久 Desired 和已有观察继续或重建。

### 5. 启动分层

- `loaded`：同步 CodeUnit 已执行完成，宿主记录了精确 content hash；
- `ready`：模块声明的核心用户能力已建立；
- `degraded`：核心能力仍可用，但非必要恢复或增强不可用；
- `failed`：运行实例不能满足模块承诺。

现有 `unit.started` 映射为 `ready`。同版本多 hash 后，旧信号必须由该标签页的精确 PageRuntime 或唯一身份解析；歧义不猜测。

### 6. 提交与迁移解耦

```text
Canary proof
→ registration verification
→ atomic Current/LKG commit
→ close Canary
→ migrate existing pages
```

现有页面迁移失败产生 `reload_required`，不改变 Current/LKG。停用时 isolated-world 实例无法由宿主通用销毁，相关页面明确标记需要重载，而不是伪装成已迁移。

### 7. Stable

Current 是最新 Canary 已证明组合，LKG 是自动恢复点，Stable 是真实行为验收后的长期可信检查点。Stable 必须由精确 snapshot 和 evidence reference 显式推进；状态归一化不得从 Current/LKG 推断 Stable。

### 8. 兼容投影

宿主写入 state v3，但读取旧 state v1/v2。`host.status.code_units` 保留旧版本数组投影，新增 `code_unit_inventory` 承载 hash 级库存。诊断继续提供旧 candidate/current/LKG 字段，同时增加 Desired、Committed、Canary 和 PageRuntime。

## Invariants

- 未明确声明的目标不能从环境猜测；
- Observed 不得直接成为 Committed；
- required failed 不提交；
- optional failed 不绑架整个 Snapshot；
- 重复 observation 和 reconcile 不重复提交；
- Current 提交后，页面迁移失败不回滚；
- 同一 hash 的内容不可变；
- 同一语义版本的新内容不能通过构建；
- Stable 不自动推进；
- 无法唯一路由的旧信号保留为不可路由证据。

## Consequences

- candidate、页面热更新和状态恢复不再共享一个失败平面；
- Service Worker 重启不需要专门恢复流程；
- 版本复用在进入浏览器前被阻断；
- 状态结构更明确，但底座只增加控制事实，不吸收业务数据；
- 真实浏览器仍需证明 Chrome `userScripts.execute`、Canary 页面和现有插件在 rc.3 下的行为；
- S6 Artifact、WorkspaceBinding、permission lifecycle 尚未迁移，它们必须以独立垂直闭环接入相同模式。

## Rejected

- 继续增加 shell/dialogue 版本号和局部超时；
- 用用户当前页面承担 candidate 证明；
- 将页面迁移失败解释为 candidate 失败；
- 仅靠运行时 immutable conflict 发现版本复用；
- 一次性把 RESULT、Workspace、权限和所有业务状态并入通用控制对象；
- 为刷新、重启、迟到消息分别维护恢复流程。
