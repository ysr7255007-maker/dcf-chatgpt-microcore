# DCF Chrome

DCF 是用户与 AI 共同维护的个人认知基础设施。它的目标是减少用户的认知与操作负担，而不是把内部插件、状态、恢复和诊断工作交给用户。

当前开发候选是 **DCF Chrome `1.0.0-rc.3`**，活动分支为 `rebuild/chrome-native-host-v2`。用户仍只安装一个 Chrome 扩展；静态扩展是最小生存底座，Shell、语言弹药、长对话减负、问答归因、外观、本机 Agent、对话闭环、备份、功能管理和诊断均为独立第一方 CodeUnit。

## 控制模式

底座采用：

```text
Desired → Observed → Committed → Reconcile
```

- **Desired**：宿主持久保存的目标 Snapshot，不从当前页面、标签页或历史步骤猜测；
- **Observed**：Canary、现有页面和注册表实际观察到的运行事实；
- **Committed**：宿主原子承诺的 Current、LKG 与 Stable；
- **Reconcile**：依据三者差异执行下一项最小、幂等、可验证动作。

插件更新的主链路是：

```text
源码 + 声明元数据
→ 构建生成 content hash / release ledger / official index
→ 保存 ContentAddressedCodeUnit（unit_id + content_hash）
→ 声明 DesiredSnapshot
→ 专用非活动 Canary 页面证明最低 loaded 承诺
→ 注册精确组合
→ 原子提交 Current + LKG
→ 独立迁移现有 PageRuntime
```

现有页面热迁移失败只产生 `reload_required`，不回滚已被 Canary 证明的 Current。`Stable` 是真实验收后的显式承诺，不再由 Current 或 LKG 自动推断。

## 工件身份与发布门禁

CodeUnit 的真实身份是：

```text
unit_id + sha256(content)
```

语义版本用于人类理解和兼容声明，不再承担内容身份。`releases/chrome/code-unit-version-ledger.json` 记录已经发布的 `unit_id + semantic_version → content_hash`；相同语义版本出现不同内容时，构建在发布前失败。历史上 `shell.9` 的同版本不同内容被保留为迁移证据，不再覆盖或伪装成同一工件。

## 状态与证据

宿主状态 v3 持久保存：

- Content-addressed CodeUnit 库；
- DesiredSnapshot；
- Committed Current / LKG / Stable；
- Canary；
- PageRuntime；
- ActivationRecord；
- ReconcileRecord；
- 有界结构化 evidence。

运行状态区分 `loaded / ready / degraded / failed`。现有插件的 `unit.started` 继续作为 `ready` 兼容信号；宿主在 CodeUnit 同步执行完成后记录精确 hash 的 `loaded`。旧信号无法唯一映射到内容身份时，宿主保留为不可路由证据，不猜测成功或失败。

## 构建与验证

```bash
npm run verify:chrome
npm run verify
```

Chrome 构建生成：

- `dist/dcf-chrome-extension/`；
- `dist/dcf-chrome-extension-1.0.0-rc.3.zip`；
- `dist/verification-summary.json`；
- `releases/chrome/official-index.json`；
- `releases/chrome/code-unit-version-ledger.json`；
- `releases/chrome/build-manifest.json`。

自动测试证明实现和状态转换；Chrome、ChatGPT 与外部服务相关结论仍必须由真实浏览器证据确认。

当前事实见 `docs/current-state.md`，架构见 `docs/architecture-current.md`，维护约束见 `docs/dcf-maintenance-skill.md`，ADR 状态见 `docs/adr/status-index.md`。
