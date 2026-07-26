# ADR: DCF Chrome 本机 AI 桥梁插件计划

Date: 2026-07-17  
Status: accepted as pure plugin implementation; live acceptance pending

## Context

DCF Next 已经形成过一版 Local Agent 方案与原型，包括网页插件、本机 Bridge、任务协议、配对流程和结果回填。当前 Chrome `rc.2` 使用静态纯底座和独立第一方插件。用户要求 Local Agent 继续遵守这一边界：插件本身是完整、自由的功能组件，不能因为当前实现运行在 ChatGPT 页面中，就未经批准把 OpenCode 通讯、权限或密码管理下沉到 DCF 底座。

OpenCode 提供 `opencode serve`，允许浏览器来源通过 `--cors` 直接访问其 HTTP API，并提供 Basic Auth、会话、异步提示、状态、消息、todo、diff、终止、Agent、模型、权限和提问接口。因此第一版没有证据证明必须修改 DCF 底座。

曾创建过一条 `rc.3` 底座适配器临时分支和 PR #29。该方案因为越过插件边界且未事先获得用户批准而被关闭，不能进入候选分支或 `main`。

## Decision

1. 新能力作为第一方独立插件存在，ID 为 `dcf.firstparty.local-agent`。
2. DCF Chrome 底座、Manifest、后台消息路由、Host API 和底座版本保持不变。
3. Local Agent 插件直接以浏览器客户端身份连接 `opencode serve`，不经过 DCF 后台代理。
4. 插件自行负责 OpenCode 地址、Basic Auth、Agent/模型选择、session、任务、状态、消息、todo、diff、终止、权限回复、提问回复和结果回填。
5. OpenCode 连接地址必须是 loopback；默认 `http://127.0.0.1:4096`，也允许用户配置其他 localhost/127.0.0.1/::1 端口。
6. OpenCode 必须由用户显式配置 ChatGPT 来源的 CORS。插件提供可复制的启动命令，不替用户修改 OpenCode 配置。
7. 用户名、地址、Agent、模型、轮询设置、任务草稿和会话选择可以写入该插件自己的通用插件数据。
8. OpenCode 密码只保留在当前页面的插件运行时内存；不写 `plugin.data`、DCF 备份、Manifest、底座存储或诊断正文。页面刷新或插件重载后密码自动消失。
9. OpenCode 离线、CORS 错误或认证失败是 Local Agent 插件自己的普通状态，不能触发 DCF 整体回滚。
10. 第一版结果只填入当前 ChatGPT 输入框供用户检查，不自动发送。
11. 第一次实现尽量覆盖完整小产品功能，不人为拆成只有健康检查或 Echo 的玩具版本；完成后以真实浏览器和真实 OpenCode 服务集中查错。
12. 只有纯插件方案经过真实验证后出现插件内部无法解决的硬阻塞，才可以重新提出公共底座能力；任何底座修改都必须先单独说明并获得用户明确批准。

## First-version workflow

```text
ChatGPT 页面中的 Local Agent 插件
→ 直接 fetch 本机 OpenCode HTTP API
→ http://127.0.0.1:4096
→ 创建或选择 OpenCode session
→ 异步提交自然语言任务
→ 轮询状态、消息、todo、权限、提问与 diff
→ 在插件面板展示
→ 用户确认后回填 ChatGPT 输入框
```

建议启动形式：

```text
OPENCODE_SERVER_PASSWORD=<密码> opencode serve \
  --hostname 127.0.0.1 \
  --port 4096 \
  --cors https://chatgpt.com \
  --cors https://chat.openai.com
```

## Full first-version scope

- 本机地址、用户名和本页密码；
- 连接检测与项目、路径、VCS 信息；
- Agent 与模型列表和选择；
- session 列表、新建、继续、重命名、分叉和删除；
- 从 ChatGPT 输入框读取任务；
- 新会话执行与继续当前会话；
- 自动或手动刷新状态；
- 消息、最新 Assistant 结果和结果回填；
- todo 展示；
- 文件 diff 展示与复制；
- 终止任务；
- 权限请求的允许一次、始终允许与拒绝；
- Agent 提问的回答与拒绝；
- 隐私受限诊断和启动命令复制。

## Acceptance boundary

自动化测试只能证明：

- 插件自包含；
- OpenCode 请求直接发生在插件源码中；
- 底座文件和 Manifest 没有 OpenCode 或 localhost 改动；
- 密码没有进入通用插件数据；
- 第九插件进入现有哈希、独立 world、启动证据和回滚事务。

真实验收仍需确认：

- Chrome 中 USER_SCRIPT world 对 loopback HTTP 的实际行为；
- OpenCode CORS 与 Basic Auth 预检；
- 当前 OpenCode 版本的权限与提问端点形状；
- ChatGPT 页面中的完整面板交互和结果回填。
