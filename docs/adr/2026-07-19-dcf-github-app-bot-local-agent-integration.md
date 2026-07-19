# ADR: DCF GitHub App Bot 本地 Agent 集成接口

Date: 2026-07-19  
Status: automated verification complete, real GitHub App creation and installation pending user acceptance

## Context

GitHub App Bot 初始化完成后，本地 Agent 需要一个稳定的接口来使用 Bot 身份执行 Git 操作（创建分支、提交、创建 PR）。

Bot 凭据保存在本机用户配置目录（`~/Library/Application Support/DCF/github-bot/`），包含私钥和机器可读的配置文件。本地 Agent 需要读取这些文件来生成 JWT 和 installation token。

## Decision

1. **接口文件**：`bot-config.json` 是本地 Agent 的入口点，位于凭据目录。它包含：
   - schema: `dcf.github-app-bot.config.v1`
   - app_id
   - app_slug
   - installation_id
   - repository
   - private_key_path
   - created_at
   - verified_at
   - permission_verification

2. **调用模式**：
   - Agent 从 `bot-config.json` 读取 app_id 和 private_key_path；
   - 从私钥路径读取 PEM；
   - 生成一个 10 分钟有效期的 JWT（`RS256`，iss = app_id）；
   - 使用 JWT POST 到 `/app/installations/{installation_id}/access_tokens` 并传入 `repositories: ["dcf-chatgpt-microcore"]` 获取 installation token；
   - 使用 installation token 执行 GitHub API 调用。

3. **安全约束**：
   - Installation token 仅在当前操作期间使用，不保存到磁盘；
   - JWT 有效期不超过 10 分钟，每次操作重新生成；
- Agent 不持久化任何 GitHub 凭据，只保存 App ID、Installation ID 和私钥路径等非敏感标识。
   - 引导会核对 JWT 调用的 `/app` 为当前 App、JWT 调用的 `/app/installations/{id}` 返回的 account.login、repository_selection 和 permissions 符合预期、installation token 调用的 `/installation/repositories` 范围仅含目标仓库、仓库 owner 与精确候选 ref/SHA；App 的安装范围可能更大，但本次验证 token 不会更大。

4. **浏览器插件不直接持有私钥**：
   - 插件不读取私钥文件；
   - 插件通过本地服务（如 OpenCode）间接发起 Git 操作；
   - 私钥仅供本地 Agent 进程和 CLI 使用。

5. **本次不实现**：
   - GitHub API 调用的完整 Agent 封装；
   - PR 创建 / 分支管理的通用接口；
   - CI 状态轮询和等待逻辑；
   - 这些在后续的 Bot Git 操作阶段实现。

## Consequences

- 本次只建立接口层，不修改 Local Agent 插件或 OpenCode 服务；
- 未来可以基于此接口实现统一的 `DCF Git` 能力包；
- Agent 可以读取 `bot-config.json` 决定是否允许执行 Git 操作。
