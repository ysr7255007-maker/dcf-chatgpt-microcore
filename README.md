# dcf-chatgpt-microcore

DCF 是用户与 AI 共同维护的个人认知基础设施。它的产品目标是减少用户的认知与操作负担；内部插件、证据、恢复和发布复杂度不能转嫁给用户。

当前候选是 **DCF Chrome `1.0.0-rc.3`**。用户只安装一个 Chrome 扩展；扩展本体是最小生存底座，统一侧栏、语言弹药、长对话减负、问答性能归因、外观、本机 Agent、对话闭环、备份、功能管理和诊断仍是独立第一方插件。

## 控制平面

`rc.3` 将插件激活从依赖历史步骤完整成功的 candidate 流程，改为：

```text
Desired
→ Observed
→ Committed
→ Reconcile
```

- **Desired**：宿主持久保存明确目标 Snapshot；
- **Observed**：注册、Canary 和页面运行事实，只作为证据；
- **Committed**：宿主满足不变量后原子提交的 Current / LKG / Stable；
- **Reconcile**：根据差异执行最小、幂等、可重复的动作。

CodeUnit 的真实身份是 `unit_id + SHA-256`。语义版本只用于阅读和兼容声明；构建器会拒绝已发布语义版本对应不同内容。历史上已经发生的同版本多 hash 不再互相覆盖，而是作为不同内容寻址工件保留。

## 激活与页面迁移

```text
下载并校验内容寻址工件
→ 声明 DesiredSnapshot
→ 在宿主创建的 Canary ChatGPT 页面加载变更工件
→ 观察最低 loaded 证明
→ 原子提交 Current 与 LKG
→ 调和持久注册
→ 独立迁移现有页面
```

现有页面热迁移失败只会被记录为 `stale / reload_required / migration_failed`，不会回滚已经由 Canary 证明的 Current。Stable 只通过明确的验收提升，不会因代码存在、CI 通过或 Canary loaded 自动推进。

## 用户侧结果

- 内部独立插件，外部仍是一个完整 DCF；
- 首次启用后自动取得默认完整组合；
- 普通插件可独立更新、停用和恢复；
- 失败保留 Current/LKG 与结构化证据；
- 页面刷新、Worker 重启或消息迟到后，Reconciler 从持久事实继续；
- 静态恢复页始终独立于 Shell 和其他动态插件。

## 构建与验证

```bash
npm run verify:chrome
```

构建生成：

- `dist/dcf-chrome-extension/`
- `dist/dcf-chrome-extension-1.0.0-rc.3.zip`
- `dist/verification-summary.json`
- `dist/release-manifest.json`
- `releases/chrome/official-index.json`
- `releases/chrome/build-manifest.json`
- `releases/chrome/code-unit-version-ledger.json`

自动测试证明实现与状态转换；Chrome、ChatGPT、Canary 页面和外部服务相关结论仍必须由真实浏览器证据确认。
