# ADR: DCF 控制平面采用声明—观察—承诺—调和模式

Date: 2026-07-21  
Status: accepted architecture; Activation Controller and release identity implemented, real-browser acceptance pending

## Context

在 `rebuild/chrome-native-host-v2` 上，candidate、Local Agent RESULT 回传 S6 和工作区 F2f 连续表现为不同故障：

- candidate 能下载并执行代码，但 Shell 启动证明可能未被宿主在期限内确认；
- `d67d070` 修改 `shell.9` 内容后只更新 hash，没有升级不可变语义版本；
- S6 把 RESULT 是否存在、页面是否可路由、是否点击发送和是否真实送达混在页面 outbox；
- F2f 从 OpenCode 当前目录推测目标工作区。

这些故障共同依赖一个旧前提：系统根据易失执行步骤、页面状态和外部程序当前状态推断权威事实。步骤迟到、重复、丢失或顺序变化后，只能继续增加 timeout、恢复分支和临时插件版本。

## Decision

DCF 控制平面正式采用：

```text
Desired → Observed → Committed → Reconcile
```

### 1. Desired

宿主持久保存明确目标。目标身份必须显式声明，不能从当前页面、外部进程目录、旧内存或历史执行步骤猜测。

本 ADR 首先实现 `DesiredSnapshot`。Artifact、ConversationBinding、WorkspaceBinding 和 PermissionDecision 在后续各自的垂直闭环中实现。

### 2. Observed

Chrome 注册、Canary、PageRuntime 和外部运行时只提供观察。观察允许缺失、迟到、重复、过期或互相矛盾，不能直接成为 Current、LKG、Stable 或 delivered。

运行状态分为：

```text
loaded
ready
degraded
failed
```

`chrome.userScripts.execute()` 对精确内容寻址工件成功返回，构成最低 `loaded` 观察。插件的显式 `runtime.observe` 可继续报告 `ready / degraded / failed`；旧 `unit.started` 在迁移期映射为 `ready`。

### 3. Committed

Current、LKG 和 Stable 由静态宿主持有。

- Current：通过当前 Activation 不变量的目标 Snapshot；
- LKG：最近一次可恢复的已提交 Snapshot；
- Stable：通过明确真实行为验收后提升的 Snapshot；
- Stable 不因源码存在、CI 通过、构建成功或 Canary loaded 自动变化。

### 4. Reconcile

Reconciler 读取 Desired、Committed 和当前 Observed，执行一个最小幂等动作，再次观察并在满足不变量时提交。

浏览器重启、Service Worker 重启、页面刷新和重复调用不建立独立恢复流程；它们重新触发同一个 Reconciler。

## Content-addressed CodeUnit

CodeUnit 的真实身份是：

```text
unit_id + SHA-256
artifact_id = sha256:<hash>
```

Snapshot 引用精确 hash。语义版本只作为阅读和兼容声明。

浏览器工件库允许保留历史上已经发布的同版本多 hash，以吸收 `shell.9` 等既成污染且不覆盖旧内容；主动发布链从 `rc.3` 起拒绝任何新增的同 `unit_id + semantic_version` 不同 hash。

## Canary activation

Activation Controller 执行：

```text
保存工件
→ 声明 DesiredSnapshot
→ 计算相对 Current 的 changed_refs / proof_refs
→ 创建宿主控制的非活动 Canary ChatGPT 页面
→ 执行发生变化且启用的精确工件
→ 观察 loaded
→ 原子提交 Current 与 LKG
→ 调和持久注册
→ 尝试迁移现有页面
→ 关闭宿主 Canary
```

未变化工件沿用其已提交证明。仅停用工件不引入新代码，因此无需 Canary 代码证明。

## Commit and migration boundary

Current/LKG 提交只依赖 Canary 证明，不依赖用户当前打开的所有页面。

提交后的注册和 PageRuntime 迁移是独立调和任务：

- 注册失败形成 registration Observed 偏差；
- 页面失败形成 `stale / reload_required / migration_failed`；
- 两者都不得回滚已经提交的 Current；
- Reconciler 可在后续启动、刷新或显式触发时继续。

## Migration from host state v2

- 旧 Current → Committed Current；
- 旧 LKG → Committed LKG，并作为迁移时的初始 Stable；
- 旧 history → Committed history；
- 旧 candidate 被丢弃，不导入 Desired；
- 旧 CodeUnit 转为 hash 键控工件；
- `plugin_data`、DCF Next 和 rc.1 数据接续保持不变。

旧 candidate 只说明旧流程停在何处，不能证明它仍是用户目标。

## Records

宿主长期保存：

- `dcf.activation.record.v1`
- `dcf.reconcile.record.v1`
- `dcf.page.runtime.v1`
- `dcf.control.event.v1`

事件包含 operation、entity、snapshot、page、writer 和 revision 边界。Issue、诊断和验收结论应由这些记录投影，不再靠临时埋点版本推断。

## Consequences

- candidate 不再等待所有现有页面；
- 同一 Desired 在刷新、重启和重复调用后收敛到同一 Current；
- 历史同版本不同内容不会互相覆盖；
- 发布者忘记升级语义版本会在构建阶段失败；
- 页面迁移失败不再破坏控制平面；
- Stable 的含义从“最近成功代码”变为“明确行为通过”；
- 恢复面可以分别展示 Desired、Current、LKG、Stable 和 Observed 偏差。

## Deferred vertical closures

本 ADR 不把所有业务状态强行统一为一种结构。

后续按领域继续：

1. durable RESULT Artifact + ConversationBinding，解决 S6；
2. explicit WorkspaceBinding + session 前后验证，解决 F2f；
3. durable Permission lifecycle；
4. AcceptanceRecord 投影和 Issue #70 完整矩阵。

在这些闭环完成前，不继续创建 dialogue/shell 连号临时诊断补丁。

## Reconsideration conditions

重新评估本 ADR，仅当：

- Chrome 无法可靠创建、执行或关闭 Canary 页面；
- `userScripts.execute` 成功不能提供足够的最低 loaded 语义，且无法用通用宿主探针补足；
- Stable 的显式提升造成不可接受的恢复摩擦；
- 内容寻址工件在 Chrome 存储规模下出现实际不可承受成本；
- 真实浏览器证据表明提交后注册调和会破坏已提交组合的可恢复性。
