# DCF 维护技能

本文件维护 DCF 的操作技能，用于约束实际改动步骤。它应保持短小、可执行，不承担长篇架构治理。

处理任何 DCF 需求时，先做分流：

1. 现有热更新能表达的，必须用模块包、ui_policy、styles、module_display、surfaces、views、content、settings 等热更新完成。
2. 现有热更新表达不了的，先定位缺少的通用解释器或渲染原语。
3. userscript 只补通用底座能力，不把当前 UI 偏好写进默认行为。
4. 补完底座后，用热更新包应用用户偏好。

允许改 userscript 的少数例外：启动链路、运行模型边界、宿主桥、通用解释器或渲染原语、存储迁移、诊断链路。

禁止把“需要渲染真实按钮”“需要改变外壳结构”“需要改 DOM”当作改本体理由。真正理由只能是：现有 manifest 无法声明某种通用结构。

改源码前必须能说清楚新增的是哪个通用字段或原语。字段示例：chrome_mode、notice_mode、surface_rail_controls、surface_rail_scrollbar、shell_bottom_anchor、surface body node。

默认值保持中立。用户偏好必须落在热更新包里。热更新包可以设置顶栏、固定底部、隐藏滚动条、箭头按钮、宽度、间距、Surface 排序等。

写 UI 偏好包时要区分字段位置：会改变渲染结构或行为的字段放在 ui_policy，例如 chrome_mode、notice_mode、surface_rail_controls、surface_rail_scrollbar、shell_bottom_anchor；纯 CSS 尺寸或间距放在 styles，例如 shell_bottom_css、topbar_height_css、panel_width_css、surface_rail_width_css、spacing。

内容库动作也按同一规则处理。若内容库缺少更新、删除、批量、角标等交互，userscript 只能补通用 content item action renderer 和 capability；具体哪个内容类型显示哪些动作，必须由 content_types.actions 等热更新配置决定。

删除类动作要远离常用动作，优先作为角标或独立危险区，并保留确认，避免和发射、复制、更新并列造成误删。

更新类动作应生成“基于当前对话更新原资产”的请求，提供原内容、当前话题/新洞见的更新意图，并要求输出完整可重新摄取的内容块；若输入框非空，应复制请求而不是覆盖用户草稿。

Surface 侧边标签也按同一规则处理。若现有 renderer 无法声明标签完整显示、按文字长度自适应、去掉 area 前缀、用颜色或标记区分 area，userscript 只能补通用 surface label renderer 字段；具体偏好必须由 ui_policy 设置，例如 surface_label_mode、surface_label_fit、surface_label_strip_area_prefix、surface_label_area_marker。

看到 DCF_FEEDBACK 后先看 kernel_version。若用户仍在旧内核，新的解释字段可能只是被保存而不会立即生效；需要说明哪些字段会在当前内核生效，哪些要等更新后才解释。

输出安装块时要注意 DCF 会扫描可见文本。只有确实要让当前页面安装时，才输出完整安装块标记。说明示例时拆开标记或改用文字描述。

每次仓库改动后至少做这些检查：确认版本号、确认 meta 与 user 一致、检索是否回到旧失败路线关键词、拉取关键行引用。若创建或更新共识，应同步更新本提示词文档或技能文档。
