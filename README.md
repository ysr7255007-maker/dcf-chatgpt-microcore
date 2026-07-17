# DCF Chrome 纯底座与个人功能插件

DCF 是用户与 AI 共同维护的个人认知基础设施。它的产品目标是减少认知和操作负担，而不是把内部治理工作交给用户。

当前候选是 **DCF Chrome `1.0.0-rc.2`**：用户只安装一个 Chrome 扩展，扩展本体保持为纯底座；统一侧栏、语言弹药、长对话减负、问答性能归因、外观、备份、功能管理和诊断均由独立的第一方用户脚本插件提供。

## 用户侧结果

- 内部是独立插件，外部仍是一个完整 DCF；
- 首次启用后，底座从固定 GitHub 个人插件库自动取得默认完整组合；
- 普通插件可以独立更新、停用和回退，不需要重新安装扩展；
- 语言弹药可从固定 GitHub 便携库直接恢复和合并；
- 正常更新静默完成，失败自动恢复上一可用版本；
- 底座更新由 GitHub Actions 自动构建，并在一次性配置非公开 Chrome Web Store 后由 Chrome 自动取得；
- 静态恢复页始终独立于所有功能插件。

## 架构

```text
固定 GitHub 个人插件索引
→ 下载独立自足 JavaScript
→ ID / 版本 / SHA-256 校验
→ 本地不可变代码库
→ candidate 精确组合
→ chrome.userScripts 独立注册
→ 各插件返回启动证据
→ current + last-known-good
```

底座只理解插件工件、精确组合、注册、证据、更新和恢复。它不理解语言弹药、长对话、性能归因或侧栏业务。

## 数据接续

本轮只接续：

- Core Review 介入前的完整 DCF Next 可见数据；
- Chrome `1.0.0-rc.1` 已保存的数据。

`0.18.2` 已被 DCF Next 吸收，不再建立单独迁移和兼容路径。

## 构建与验证

```bash
npm run verify:chrome
```

生成：

- `dist/dcf-chrome-extension/`
- `dist/dcf-chrome-extension-1.0.0-rc.2.zip`
- `dist/verification-summary.json`
- `releases/chrome/official-index.json`

真实 Chrome 与 ChatGPT 行为仍以一次正常使用验收为最终事实。
