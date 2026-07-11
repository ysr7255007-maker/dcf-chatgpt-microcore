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

仓库代码是当前内核能力的事实来源；浏览器 registry 是已安装模块和用户偏好的事实来源，两者不能混为一谈。

## 当前仓库版本

当前仓库发布版本为 `0.9.13`。

`0.9.12` 已建立相关联命令证据链，包括一次点击的命令解析、能力调用、registry 前后状态、持久化、壳体计算样式、真实矩形、CSS 来源、隐私过滤、维护授权和交付状态。

`0.9.13` 在此基础上新增统一的可视区围栏：

- 使用 `window.visualViewport`，并以文档视口为回退；
- 每次渲染后读取壳体真实 `getBoundingClientRect()`；
- 把实际宽高限制在带 12px 安全边距的可视区内；
- 通过统一 x/y correction 把越界壳体移回安全区；
- 不区分贴顶、贴底、左右侧或触发命令；
- 监听 window resize、visualViewport resize 和 scroll；
- registry 保留用户期望尺寸，围栏只约束实际可见结果；
- 新的宽高步进目标同时以当前安全可视区为动态上限；
- runtime appearance 和 diagnostics 输出围栏状态。

根目录 `.user.js` 与 `.meta.js` 仍是权威发布文件。

## 最近完成事项

### 壳体调节 CSS 覆盖已修复

浏览器现场曾确认：

- 页面内核为 `0.9.12`；
- `dcf.shell_adjuster` version `2.1` 的命令解析、能力调用、registry 更新、持久化和恢复点都正常；
- 旧 appearance CSS 使用 `!important` 把 `.sh` 固定为 `340px × 540px`，并错误使用 `--b` 作为底部变量；
- 命令证据因此分类为 `state_changed_but_render_overridden`。

修复包 `dcf.shell_geometry.vars_source_repair@2026-07-12.1` 已在浏览器安装成功，用户现场确认宽高、贴顶贴底和距离调节均正常。成功测试不要求发送维护证据；只有失败或异常时才发送。

对应 ADR：

- `docs/adr/2026-07-12-dcf-shell-geometry-single-source.md`

### 可视区围栏已进入 `0.9.13`

用户否定了“为每个锚点、距离和按钮分别计算上限”的方案。当前方案只比较实际可视区矩形与实际壳体矩形，用一个统一运行时围栏处理所有越界来源。

对应 ADR：

- `docs/adr/2026-07-12-dcf-viewport-containment-fence.md`

新增测试：

- `tests/dcf-viewport-fence.unit.test.js`

本地已完成：

- `node --check dcf-chatgpt-microcore.user.js`；
- 独立围栏单元测试通过，覆盖超大壳体、双轴越界、visualViewport 偏移、期望 registry 保留和锚点无关性；
- 仓库 userscript 上传后按 Git blob SHA 逐字节回读一致；
- user/meta 版本均为 `0.9.13`。

完整 `npm test` 在当前执行容器中未运行，因为容器没有 `jsdom` 且无法解析外部 npm/GitHub 网络；这不是测试失败。仓库测试命令已包含原证据链集成测试和新围栏单元测试。

## 当前未完成事项

### 浏览器更新与现场验证

浏览器当前最后确认版本仍是 `0.9.12`。下一步：

1. 在 Tampermonkey 中更新到 `0.9.13`；
2. 刷新 ChatGPT 页面；
3. 把壳体宽高或贴边距离持续增大，确认壳体不会有任何边冲出当前可视区；
4. 缩小和放大浏览器窗口，确认壳体自动保持完整可点击；
5. 成功则无需发送证据；仅失败或异常时使用“发送证据”。

registry 中已安装的外观修复和 `dcf.shell_adjuster 2.1` 不应因 userscript 更新被替换。

## 壳体目标行为

- registry appearance vars 表示用户期望几何；
- 内核围栏表示不可突破的实际可见安全包络；
- 壳体本身不因内容自动改变尺寸；
- Surface 标签高度按文字长度自适应；
- 侧边栏在固定壳体内部独立滚动，不得撑大壳体；
- 贴顶和贴底是锚点切换；
- 所有位置和尺寸来源最终都必须经过同一个实际矩形围栏。

## 继续维护时不可违背的边界

- 默认冷热更新，只有当前内核能力不可达时才更新 userscript；
- 外观偏好属于 registry，不属于 userscript 默认设计；
- 可调壳体几何只能由 appearance vars 和内核锚点解释路径拥有，appearance CSS 不得建立第二套静态几何来源；
- 可视区限制不能散落在各按钮或锚点公式中，必须由统一实际矩形围栏承担；
- 不用枚举预设冒充连续调节；
- 成功测试不要求上传证据，证据用于失败和异常诊断；
- 输出完整安装块前确认当前页面确实需要安装。