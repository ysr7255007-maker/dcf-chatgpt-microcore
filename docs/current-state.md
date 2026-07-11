# DCF 当前状态与新会话交接

Updated: 2026-07-12

本文件只记录当前工作断点。项目原则、维护规则和长期决策分别以共识、维护 skill 和 ADR 为准。

## 新会话读取顺序

1. `README.md`
2. `dcf-chatgpt-microcore.user.js`
3. `dcf-chatgpt-microcore.meta.js`
4. `docs/dcf-basic-consensus-prompt.md`
5. `docs/dcf-maintenance-skill.md`
6. `docs/adr/` 下全部 ADR
7. 本文件

## 当前仓库版本

当前发布版本为 `0.10.0`。

`0.9.12` 建立相关联命令证据链。`0.9.13` 新增统一可视区围栏。`0.10.0` 将包系统从“安装包直接修改 registry”改为“不可变包源 + 用户状态 -> 确定性候选构建 -> 运行 registry 缓存”。

根目录 `.user.js` 与 `.meta.js` 是权威发布文件。

## `0.10.0` 已完成

### 权威状态分离

新增本地权威源：

- `dcf.package.sources.v1`：不可变包 revision、启用状态和 active revision；
- `dcf.user.state.v1`：用户 appearance、settings、content 和 moduleDisplay 覆盖；
- `dcf.kernel.ops.v2`：seenBlocks、badBlocks 和迁移记录。

`dcf.kernel.registry.v1` 继续存在，但只作为派生运行缓存和兼容诊断输出，不再是包安装与用户状态的事实来源。

### 确定性构建

- 每次安装、更新、启用、停用、卸载或 revision 切换都先在内存构建完整候选；
- 候选失败时旧权威源和旧运行界面不变；
- 成功后只提交新的权威源，并生成新的运行 registry；
- 相同输入生成稳定 build id；
- 包生命周期操作不再维护反向补丁。

### 精确包生命周期

包管理面板现在支持：

- 安装新的不可变 revision；
- 启用或停用包；
- 精确卸载包；
- 在本地保留的 revisions 之间切换。

同一 `package_id + revision` 若内容不同会被拒绝。包停用或卸载只移除自己的定义、默认资产和样式，不删除用户状态。

### 资源与样式边界

- 模块、Surface、内容类型、module display、包内容和设置默认值被规范化为稳定资源地址；
- 不同包声明同一独占地址时构建失败，不再隐式 deepMerge；
- 核心资源替换必须显式声明；
- 每个包样式保留独立 source id，运行 CSS 只是派生拼接；
- 包样式若重新声明 `.sh` 自身几何会在候选阶段被拒绝；
- `.sh` 的后代元素可以正常声明自己的宽高，不会被误判。

### 用户状态边界

- 壳体宽高、锚点、距离和左右侧写入用户状态；
- settings.set 写入用户状态；
- DCF_AMMO 等摄取内容写入用户内容；
- 用户内容覆盖同 ID 包默认内容；
- 卸载壳体调节模块不会撤销用户已经选择的壳体尺寸。

### 旧 registry 迁移

首次运行 `0.10.0` 且尚无新权威源时：

- 每个旧模块转成独立 synthetic package；
- Surface、非核心内容类型和有效 appearance CSS 转成独立来源；
- appearance vars、settings 和内容资产转成用户状态；
- 违反壳体几何所有权的旧 CSS 被隔离，不会阻塞启动；
- 新恢复点保存包源、用户状态和 ops；旧 registry-only 恢复点仍可迁移恢复。

### 既有能力保留

- 命令解释器和 `dcf.command_trace.v2`；
- 隐私过滤、维护授权和交付回执；
- 坏块隔离与防反馈风暴；
- 可视区围栏；
- registry 恢复点与回滚；
- `dcf.shell_adjuster 2.1` 可通过首次迁移保留为独立包；
- 当前有效 appearance CSS 可迁移为独立 appearance 包。

## 测试状态

已在当前容器实际通过：

- `node --check dcf-chatgpt-microcore.user.js`；
- `tests/dcf-package-engine.unit.test.js`；
- `tests/dcf-viewport-fence.unit.test.js`。

包引擎测试覆盖确定性构建、停用与精确移除、用户状态保留、资源冲突、显式核心替换、样式几何边界、旧 registry 迁移和坏 CSS 隔离。

`tests/dcf-evidence-chain.integration.test.js` 已更新为直接使用新包源和用户状态模型，但当前容器没有 `jsdom` 且无法访问外部 npm 网络，因此本轮未实际执行完整集成测试。这不是测试失败。仓库 `npm test` 会依次运行包引擎、证据链和可视区围栏测试。

## 当前未完成事项

### 浏览器升级和现场验证

浏览器最后确认版本为 `0.9.13`。下一步：

1. 在 Tampermonkey 更新到 `0.10.0`；
2. 刷新 ChatGPT 页面；
3. 确认原有壳体调节模块、appearance 样式、用户尺寸和弹药仍在；
4. 打开维护区的“包管理”，确认迁移后的独立包；
5. 选择一个非关键包执行停用再启用，确认用户状态不变；
6. 成功无需发送证据，失败或迁移异常时发送证据。

### GitHub 私人模块库

远程 catalog 和直接下载界面尚未实现。本轮先完成其根基：不可变包源、精确生命周期和确定性构建。下一步只需增加 GitHub catalog 读取、hash 校验和下载写入本地包源，不得重新引入直接修改 registry 的安装路线。

## 继续维护时不可违背的边界

- 包不得直接修改运行 registry；
- registry 是派生缓存，不是事实来源；
- 包定义、用户状态和 ops 分开；
- 生命周期操作统一为改变输入集合后重建；
- 候选构建失败时旧状态保持不变；
- 不同包不得依靠安装顺序隐式覆盖独占资源；
- 包样式保持来源片段，不能拥有 `.sh` 几何；
- 用户操作结果不随包卸载反向删除；
- 可视区限制继续由统一实际矩形围栏承担；
- 成功测试不要求上传证据；
- 远程模块库只做发现、下载和选择输入，不参与运行时合并。
