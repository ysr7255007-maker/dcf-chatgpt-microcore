# ADR: 语言弹药便携库与 AI 代上传

Date: 2026-07-15  
Status: accepted

## Context

语言弹药已经不只是当前 ChatGPT userscript 内的局部数据。它承载可以长期复用、跨对话、跨 AI 平台和跨系统迁移的高密度认知表达。旧版将弹药保存在单个 userscript 的 GM storage 中，新版若继续只保存本地副本，就会把核心认知资产再次绑定到浏览器和宿主平台。

当前真实需求仍然很小：把现有弹药安全地导出，由用户交给 AI；AI 使用已授权的 GitHub 工具上传；其他 AI 或平台读取同一份文件并加载。此时没有必要让 userscript 持有 GitHub Token，也没有必要建设后台服务、实时同步、目录索引、冲突事务或加密系统。

## Decision

1. 语言弹药采用平台中立的便携库协议 `dcf.language-ammo.library.v1`。
2. 首版 canonical store 是仓库 `ysr7255007-maker/dcf-chatgpt-microcore` 的独立分支 `language-ammo-library`，固定路径为 `data/language-ammo/library.json`。
3. 便携库首版是一份 JSON 文件，包含 `schema`、导出时间、数量和按稳定 ID 排序的完整弹药数组。Git 提交历史承担版本记录。
4. DCF 只负责两端适配：
   - 将本地弹药复制为便携库 JSON；
   - 从固定 GitHub 文件读取并按稳定 ID 加载。
5. 上传由用户把便携库粘贴给具备 GitHub 工具的 AI，再由 AI 写入固定路径。userscript 不保存 GitHub Token，也不直接承担 GitHub 写入。
6. 从 GitHub 加载是显式操作，不做后台同步。远端同 ID 内容不同视为更新，覆盖本地该 ID；远端不存在的本地弹药不删除。
7. 旧版 GM storage 通过一次性导出桥转换为同一便携库协议，不再依赖新版跨 userscript 读取旧 GM storage。
8. 首版明文保存。公开性是当前已知边界；加密、私有仓库、密钥托管和敏感级别以后单独决策。
9. 单枚 `DCF_AMMO` 工件继续用于对话内创建和更新；便携库用于成批迁移、备份和跨平台装载，两者不互相取代。

## Consequences

- 语言弹药从某个浏览器插件的内部状态，变成其他 AI 可以直接理解和加载的稳定资产。
- GitHub 写权限留在 AI 工具和用户授权侧，不进入 userscript。
- 首版只有一份文件和一次显式加载动作，维护面很小。
- 明文进入公开 GitHub 后可以被公开读取，且删除文件不等于清除 Git 历史。
- 多端同时编辑、精细冲突合并、选择性下载和加密仍未解决；真实需求出现后再扩展。

## Reconsideration conditions

- 弹药数量或文件体积使单文件读写明显不便；
- 多个平台需要同时修改并产生频繁冲突；
- 弹药中开始出现不适合公开保存的内容；
- 需要部分加载、权限分区或离线编辑；
- AI 代上传成为高频负担，值得引入受控写入适配器。
