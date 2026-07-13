'use strict';

const LEGACY_DAILY_MODULE_IDS = new Set([
  'dcf.ammo_workbench',
  'dcf.ammo_workspace.unified',
  'dcf.language_ammo'
]);

const LEGACY_MAINTENANCE_MODULE_IDS = new Set([
  'dcf.ammo_library.dcf_kernel_maintenance',
  'dcf.block_scanner',
  'dcf.capability_gap_probe',
  'dcf.command_runtime_probe',
  'dcf.feedback_safety_probe',
  'dcf.kernel_acceptance',
  'dcf.maintenance_feedback',
  'dcf.module_authoring',
  'dcf.runtime_inspector',
  'dcf.shell_adjuster',
  'dcf.standard.shell-adjuster',
  'dcf.store_probe',
  'dcf.ui_siderail_control',
  'dcf.ui_visual_control'
]);

function userDisplay(root, moduleId) {
  return root && root.user && root.user.moduleDisplay && root.user.moduleDisplay[moduleId] || null;
}

function projectedDisplay(registry, moduleId) {
  return registry && registry.moduleDisplay && registry.moduleDisplay[moduleId] || {};
}

function declaredRole(module, display) {
  const role = display.role || module.role || null;
  if (role === 'daily' || role === 'maintenance') return role;
  const area = display.area || module.area || null;
  if (area === 'maintenance') return 'maintenance';
  if (area === 'work' || area === 'primary') return 'daily';
  return null;
}

function classifyModule(root, registry, module) {
  const id = String(module && module.id || '');
  if (module && module.kind === 'ammo') return { placement: 'ammo', source: 'module-kind' };

  const user = userDisplay(root, id);
  if (user) {
    if (user.hidden === true) return { placement: 'hidden', source: 'user' };
    const userRole = declaredRole(module, user);
    if (userRole) return { placement: userRole, source: 'user' };
  }

  if (LEGACY_MAINTENANCE_MODULE_IDS.has(id)) return { placement: 'maintenance', source: 'legacy-product-map' };
  if (LEGACY_DAILY_MODULE_IDS.has(id)) return { placement: 'daily', source: 'legacy-product-map' };

  const display = projectedDisplay(registry, id);
  if (display.hidden === true) return { placement: 'hidden', source: 'declaration' };
  const declared = declaredRole(module, display);
  if (declared) return { placement: declared, source: 'declaration' };
  return { placement: 'daily', source: 'default' };
}

function modulesByPlacement(root, registry) {
  const result = { ammo: [], daily: [], maintenance: [], hidden: [] };
  for (const module of registry && registry.modules || []) {
    const classification = classifyModule(root, registry, module);
    result[classification.placement].push(module);
  }
  for (const modules of Object.values(result)) modules.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return result;
}

module.exports = {
  LEGACY_DAILY_MODULE_IDS,
  LEGACY_MAINTENANCE_MODULE_IDS,
  classifyModule,
  modulesByPlacement
};
