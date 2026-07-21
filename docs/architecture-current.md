# DCF 当前架构：Chrome 最小生存底座与可调和控制平面

Updated: 2026-07-21  
Candidate: `1.0.0-rc.3`

## 1. 价值约束

DCF 必须替用户吸收复杂度。内部独立插件不能变成逐项安装、版本选择、日志搬运、反复刷新或多轮人工验收。

## 2. 最小生存底座

静态扩展只负责：

- 内容寻址 CodeUnit 保存与校验；
- DesiredSnapshot；
- Committed Current / LKG / Stable；
- Canary 证明；
- `chrome.userScripts` 注册调和；
- PageRuntime 观察与提交后迁移；
- ActivationRecord、ReconcileRecord 和结构化证据；
- GitHub 插件索引更新；
- DCF Next / Chrome rc.1 数据接续；
- 静态恢复面与通用插件数据命名空间。

它不理解语言弹药、OpenCode 任务、性能归因或 Shell 业务。

## 3. 事实所有权

```text
Desired
  宿主拥有；表达目标，不从页面或外部目录猜测

Observed
  页面、Chrome 注册和外部运行时提供；允许缺失、迟到、重复或过期

Committed
  宿主拥有；只在不变量满足后原子产生

Reconcile
  比较三者并执行最小幂等动作
```

业务插件可以报告观察，不能直接改写 Current、LKG、Stable 或其他 Committed 事实。

## 4. 内容寻址 CodeUnit

```text
CodeUnitIdentity = unit_id + content_hash
artifact_id = sha256:<hash>
```

Snapshot 始终引用精确 hash。语义版本保留为展示和兼容声明。

浏览器状态允许保留历史上已经出现的同版本多 hash，以避免旧工件被覆盖；构建发布链从 `rc.3` 起拒绝新增同 `unit_id + semantic_version` 不同内容。

## 5. Snapshot 语义

- **DesiredSnapshot**：当前明确目标，持久存在；
- **Current**：已经通过最低 Canary 证明并被宿主提交的运行目标；
- **LKG**：最近一次可恢复的已提交 Snapshot；
- **Stable**：经过明确行为验收后提升的 Snapshot，不自动跟随 Current；
- **history**：有限保存的旧 Current，用于证据和恢复判断。

v2 迁移保留旧 Current/LKG；旧 candidate 不被继承为新 Desired，因为它只代表旧流程中断位置，不是明确目标。

## 6. Canary 激活

```text
保存工件
→ 声明 Desired
→ 计算相对 Current 的 proof_refs
→ 创建或复用宿主 Canary 页面
→ 精确执行发生变化且启用的工件
→ 记录 loaded / ready / degraded / failed
→ proof_refs 至少 loaded
→ 原子提交 Current + LKG
```

未变化工件复用其已提交证明。仅停用工件时没有新增代码需要证明，可以直接提交精确组合。

`chrome.userScripts.execute()` 对精确 hash 工件成功返回，构成最低 `loaded` 证据；插件后续事件继续把观察细化为 `ready / degraded / failed`。旧 `unit.started` 在迁移期映射为 `ready`。

## 7. 注册与页面迁移

Canary 提交和现有页面迁移是两个事务：

```text
Current 已提交
→ 调和持久注册
→ 逐页观察
→ 尝试迁移发生变化的工件
```

注册或页面迁移暂时失败会形成 Observed 偏差，Reconciler 可在重启、刷新或后续触发时继续；它们不能反向伪造或撤销已提交事实。

## 8. 第一方插件

当前默认组合包含十一项独立插件：

- Shell；
- 语言弹药；
- 长对话减负；
- 问答性能归因；
- 外观；
- Local Agent；
- Local Agent 对话闭环；
- 备份；
- 功能管理；
- Local Agent 诊断；
- 页面诊断。

每个插件仍是自足 JavaScript、独立 USER_SCRIPT world、独立数据命名空间和独立清理边界。

## 9. 本次明确边界

`rc.3` 先完成 Activation Controller 与发布身份链。

以下仍未进入宿主权威服务：

- durable RESULT Artifact 与 ConversationBinding；
- 显式 WorkspaceBinding；
- durable 权限生命周期。

S6 与 F2f 保持冻结，后续分别以 Artifact 和 Workspace 的垂直闭环实现，不继续堆 dialogue/shell 临时版本。
