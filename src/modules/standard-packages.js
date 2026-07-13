'use strict';

const REQUIRED_PRODUCT_PACKAGES = ['dcf.standard.ammo', 'dcf.ui.package-management'];

const STANDARD_PACKS = [
  {
    schema: 'dcf.module_pack.v1',
    pack_id: 'dcf.standard.ammo',
    revision: '1.0.0',
    title: '语言弹药核心',
    description: '提供语言弹药内容、主入口和低摩擦发射能力。',
    contributes: {
      content_types: [{ id: 'ammo', marker: 'DCF_AMMO', title: '语言弹药', body_field: 'body', actions: ['fire', 'copy', 'update', 'delete'] }],
      surfaces: [{ id: 'dcf.ammo', title: '弹药', area: 'primary', order: 10, kind: 'content-list', content_type: 'ammo' }],
      appearance: { side: 'right', vars: { w: '340px', h: '800px', top: '12px', bottom: '112px', anchor: 'bottom' } }
    },
    modules: [{ id: 'dcf.ammo.module', title: '语言弹药', version: '1.0.0', kind: 'ammo' }]
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
        tab_label: '包管理',
        title: '安装包管理',
        description: '中文名称和功能说明用于日常识别；英文 ID 仅保留为技术标识。',
        density: 'compact',
        show_technical_id: true,
        manual_install: 'folded',
        control_order: ['revision', 'switch', 'toggle', 'uninstall'],
        labels: {
          check_updates: '检查更新',
          manual_install: '手动安装包',
          install_json: '安装 JSON',
          package_json_placeholder: '粘贴 DCF_MODULE_PACK JSON',
          switch_revision: '切换',
          enable: '启用',
          disable: '停用',
          uninstall: '卸载'
        },
        state_labels: { required: '核心', enabled: '已启用', disabled: '已停用' }
      }],
      styles: [{ id: 'package-management-compact', css: '.package-list.density-compact .package-card{padding:7px 0}.package-list.density-compact .package-description{line-height:1.3}' }]
    },
    modules: []
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
