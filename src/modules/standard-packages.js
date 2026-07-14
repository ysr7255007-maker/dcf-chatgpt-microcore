'use strict';

const REQUIRED_PRODUCT_PACKAGES = ['dcf.standard.ammo', 'dcf.ui.package-management', 'dcf.ui.runtime-workspace', 'dcf.standard.conversation-performance'];

const STANDARD_PACKS = [
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.ammo',
    revision: '1.3.0',
    title: '语言弹药工作台',
    description: '统一提供语言弹药的提取、新建、编辑、查找、语境化调用、实质更新与管理。',
    contributes: {
      content_types: [{ id: 'ammo', marker: 'DCF_AMMO', title: '语言弹药', body_field: 'body', actions: ['fire', 'copy', 'update', 'delete'] }],
      surfaces: [{ id: 'dcf.ammo', title: '弹药', area: 'primary', order: 10, kind: 'content-list', content_type: 'ammo' }],
      ui_views: [{ id: 'ammo', kind: 'content', projection: 'content:ammo', tab_label: '弹药', title: '语言弹药工作台', description: '在一个入口中提取、新建、编辑、查找、调用、更新和管理语言弹药。', order: 10, labels: { extract: '从当前对话提取', new_item: '新建弹药', search_placeholder: '查找标题、用途、标签或 ID', fire_mode: '发射', fire: '发射', copy: '复制', update: '更新', edit: '编辑', remove: '删除', save: '保存', cancel: '取消' } }],
      policies: {
        ammo_protocol: {
          invocation_marker: '〔DCF·语言弹药〕',
          update_marker: '〔DCF·弹药更新〕',
          update_intro: '下面是一枚已经存在的 DCF 语言弹药。请把当前对话作为本次修订的语境和依据，先重新理解它的核心意图，再判断哪些部分需要保留、修正、补充或删除。',
          update_rules: [
            '保留仍然成立的核心意图和适用边界；不要因为当前一句修正就机械重写整枚弹药。',
            '吸收当前对话中已经形成的稳定变化；不要只做措辞润色，也不要把当前对话机械摘要进正文。',
            '这是对同一枚长期弹药的更新，不要另建一枚相似弹药；必须保留原有 id。'
          ],
          output_instruction: '完成后返回且只返回一份完整的 DCF_AMMO 工件，字段至少包含 id、title、purpose、body；DCF 会在回复完成后自动装填。'
        }
      },
      appearance: { side: 'right', vars: { w: '340px', h: '800px', top: '12px', bottom: '112px', anchor: 'bottom' } }
    },
    modules: [{ id: 'dcf.ammo.module', title: '语言弹药工作台', version: '1.3.0', kind: 'ammo', supersedes: ['dcf.ammo_workbench', 'dcf.ammo_workspace.unified', 'dcf.language_ammo'] }]
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.ui.runtime-workspace',
    revision: '1.0.0',
    title: '对话环境工作区',
    description: '把日常功能和维护观察呈现为同一期望对话环境的行动与观察视图。',
    contributes: {
      ui_views: [
        { id: 'functions', kind: 'actions', projection: 'actions:daily', tab_label: '功能', title: '日常功能', description: '主力能力始终保留入口；点击模块标题展开或收起具体操作。', order: 20 },
        { id: 'maintenance', kind: 'observation', projection: 'runtime:observation', tab_label: '维护', title: '环境观察与恢复', description: '观察期望环境在真实浏览器 Runtime 中是否成立，并提供恢复入口。', order: 40 }
      ],
      policies: { activation_mode: 'live-when-safe' }
    },
    modules: []
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.ui.package-management',
    revision: '1.0.0',
    title: '包管理界面',
    description: '提供可自更新的中文包总览、版本控制和安装入口。',
    contributes: {
      ui_views: [{
        id: 'packages',
        kind: 'package-management',
        projection: 'environment:capabilities',
        tab_label: '包管理',
        title: '安装包管理',
        description: '中文名称和功能说明用于日常识别；英文 ID 仅保留为技术标识。',
        order: 30,
        density: 'compact',
        show_technical_id: true,
        manual_install: 'folded',
        control_order: ['revision', 'switch', 'toggle', 'uninstall'],
        labels: { check_updates: '检查更新', manual_install: '手动安装能力包', install_json: '安装 JSON', package_json_placeholder: '粘贴 DCF_MODULE_PACK JSON', switch_revision: '切换', enable: '启用', disable: '停用', uninstall: '卸载' },
        state_labels: { required: '核心', enabled: '已启用', disabled: '已停用' }
      }],
      styles: [{ id: 'package-management-compact', css: '.package-list.density-compact .package-card{padding:7px 0}.package-list.density-compact .package-description{line-height:1.3}' }]
    },
    modules: []
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.conversation-performance',
    revision: '1.2.0',
    title: '长对话减负',
    description: '降低 ChatGPT 长对话的浏览器渲染负担，并按一次完整问答归因主线程阻塞。',
    contributes: {
      policies: {
        conversation_performance: {
          mode: 'safe', activation_turns: 24, keep_recent: 40, reveal_batch: 20,
          settle_ms: 1000, top_reveal_px: 220, intrinsic_block_px: 480
        }
      },
      module_display: { 'dcf.standard.conversation-performance': { area: 'work', role: 'daily', order: 40 } }
    },
    modules: [{
      id: 'dcf.standard.conversation-performance', title: '长对话减负', version: '1.2.0', kind: 'conversation-performance',
      blocks: [
        { id: 'mode', title: '减负模式', commands: [
          { id: 'safe', label: '透明减负（推荐）', steps: [{ call: 'conversation.performance.configure', with: { mode: 'safe' } }] },
          { id: 'window40', label: '窗口化：最近 40 条', steps: [{ call: 'conversation.performance.configure', with: { mode: 'window', keep_recent: 40 } }] },
          { id: 'window20', label: '窗口化：最近 20 条', steps: [{ call: 'conversation.performance.configure', with: { mode: 'window', keep_recent: 20 } }] },
          { id: 'off', label: '恢复全部并关闭', steps: [{ call: 'conversation.performance.configure', with: { mode: 'off' } }] }
        ] },
        { id: 'history', title: '历史消息与观察', commands: [
          { id: 'reveal', label: '展开上一批', steps: [{ call: 'conversation.performance.reveal' }] },
          { id: 'report', label: '复制性能摘要', steps: [{ call: 'conversation.performance.report' }] }
        ] },
        { id: 'attribution', title: '问答轮次归因', commands: [
          { id: 'turn_attribution_arm', label: '记录下一轮问答', steps: [{ call: 'conversation.performance.turn.arm' }] },
          { id: 'turn_attribution_copy', label: '结束并复制本轮报告', steps: [{ call: 'conversation.performance.turn.report', with: { finish: true } }] }
        ] }
      ]
    }]
  },
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.shell-adjuster',
    revision: '1.0.0',
    title: '壳体调节',
    description: '调整侧栏宽度、高度、边距和停靠方向。',
    modules: [{ id: 'dcf.standard.shell-adjuster', title: '壳体调节', version: '1.0.0', kind: 'shell-adjuster', blocks: [{ id: 'geometry', title: '壳体几何', commands: [
      { id: 'width_minus', label: '窄', steps: [{ call: 'appearance.adjust', with: { w: -20 } }] },
      { id: 'width_plus', label: '宽', steps: [{ call: 'appearance.adjust', with: { w: 20 } }] },
      { id: 'height_minus', label: '矮', steps: [{ call: 'appearance.adjust', with: { h: -40 } }] },
      { id: 'height_plus', label: '高', steps: [{ call: 'appearance.adjust', with: { h: 40 } }] },
      { id: 'offset_minus', label: '靠近边缘', steps: [{ call: 'appearance.adjust', with: { offset: -10 } }] },
      { id: 'offset_plus', label: '远离边缘', steps: [{ call: 'appearance.adjust', with: { offset: 10 } }] },
      { id: 'top', label: '贴顶', steps: [{ call: 'appearance.adjust', with: { anchor: 'top' } }] },
      { id: 'bottom', label: '贴底', steps: [{ call: 'appearance.adjust', with: { anchor: 'bottom' } }] },
      { id: 'side', label: '换边', steps: [{ call: 'appearance.adjust', with: { side: 'toggle' } }] }
    ]}] }],
    contributes: { module_display: { 'dcf.standard.shell-adjuster': { area: 'maintenance', order: 20 } } }
  }
];

module.exports = { STANDARD_PACKS, REQUIRED_PRODUCT_PACKAGES };
