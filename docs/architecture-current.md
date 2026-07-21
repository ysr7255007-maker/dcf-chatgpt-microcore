# DCF 当前架构：纯底座上的声明—观察—承诺—调和

Updated: 2026-07-21  
Candidate: `1.0.0-rc.3`

## 1. 价值约束

DCF 必须替用户吸收内部复杂度。插件独立、状态分层和证据完备只有在它们减少安装、判断、恢复、日志搬运和多轮验收负担时才有价值。

## 2. 最小生存底座

静态扩展只拥有：

- 内容寻址 CodeUnit 的保存与校验；
- DesiredSnapshot；
- Committed Current / LKG / Stable；
- Canary 证明与注册协调；
- PageRuntime 观察和迁移状态；
- ActivationRecord、ReconcileRecord 与有界证据；
- 通用插件数据命名空间；
- 固定 GitHub 个人索引更新；
- DCF Next / Chrome rc.1 数据接续；
- 不依赖动态插件的恢复页面。

底座不理解语言弹药、本机 Agent、对话投递或其他业务语义。

## 3. 事实所有权

```text
DesiredSnapshot
  用户或正式更新入口声明目标，宿主持久化

ObservedRuntime
  Canary、PageRuntime、chrome.userScripts 和外部运行面提供观察

CommittedActivation
  只有宿主在不变量成立后原子产生

Reconciler
  计算差异并执行最小幂等动作
```

Observed 可以延迟、重复、缺失或失败，但不能直接覆盖 Committed。页面插件只能上报观察和请求语义操作，不能声明 Current、LKG 或 Stable。

## 4. 内容寻址 CodeUnit

```text
CodeUnitIdentity = unit_id + content_hash
```

宿主按 hash 保存不可变内容，同一语义版本的历史冲突可以作为两个不同 hash 的工件被保留，不再互相覆盖。Snapshot 始终引用 hash；版本只是标签。构建期 release ledger 阻止新的语义版本复用进入运行时。

## 5. 激活闭环

```text
保存工件
→ 声明 DesiredSnapshot
→ 创建或复用专用非活动 Canary
→ 在 Canary 执行精确 CodeUnit
→ 收集 loaded / ready / degraded / failed
→ 必要单元满足最低承诺
→ 调和正式 registrations
→ 原子提交 Current 与 LKG
→ 关闭 Canary
→ 独立迁移现有页面
```

`loaded` 表示 CodeUnit 的同步代码已经执行完毕且精确身份已由宿主观察；`ready` 来自模块更强的启动承诺；`degraded` 表示核心能力仍可用但存在非必要缺失；`failed` 表示该运行实例无法满足模块承诺。

必要单元失败阻止提交。可选单元失败被记录但不绑架整个 Snapshot。现有页面迁移失败只使对应 PageRuntime 成为 `reload_required`。

## 6. Current、LKG 与 Stable

- **Current**：最新一次由 Canary 证明并原子提交的目标组合；
- **LKG**：宿主可自动恢复的最近一次已提交组合；
- **Stable**：经过明确真实验收后显式晋升的长期可信检查点。

三者不再互相推断。新候选提交不会自动把 Stable 推到未经真实验收的状态。

## 7. PageRuntime

PageRuntime 至少包含：

```text
page_instance_id
tab_id
conversation_id
observed_snapshot
units[id] = { content_hash, version, state, detail }
migration_status
last_seen_at
```

页面刷新会产生新的 page instance；宿主观察重新建立，不从旧 DOM 或旧内存推测当前运行状态。启停配置已经提交但无法通用销毁旧 isolated-world 实例时，页面被明确标记为 `reload_required`。

## 8. 兼容边界

现有插件仍可发送 `unit.started` / `unit.failed`。宿主优先使用该标签页已经记录的 snapshot 和 content hash 解析旧信号；只有唯一映射时才接受。`host.status.code_units` 保留旧数组投影供功能管理和恢复页使用，详细内容寻址库存由 `code_unit_inventory` 提供。

## 9. 本轮未纳入底座的领域

宿主持久 RESULT Artifact、ConversationBinding、WorkspaceBinding、权限状态和长任务生命周期将在各自垂直闭环中接入同一控制模式。本轮不以激活改造为名把这些业务状态混入一个不可验收的大事务。
