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

function roleFrom(value) {
  if (!value) return null;
  if (value.role === 'daily' || value.role === 'maintenance') return value.role;
  if (value.area === 'maintenance') return 'maintenance';
  if (value.area === 'work' || value.area === 'primary') return 'daily';
  return null;
}

function classifyModule(root, registry, module) {
  const id = String(module && module.id || '');
  if (module && module.kind === 'ammo') return { role: 'ammo', source: 'module-kind' };

  const userRole = roleFrom(userDisplay(root, id));
  if (userRole) return { role: userRole, source: 'user' };

  if (LEGACY_MAINTENANCE_MODULE_IDS.has(id)) return { role: 'maintenance', source: 'legacy-product-map' };
  if (LEGACY_DAILY_MODULE_IDS.has(id)) return { role: 'daily', source: 'legacy-product-map' };

  const displayRole = roleFrom(projectedDisplay(registry, id));
  if (displayRole) return { role: displayRole, source: 'declaration' };

  const moduleRole = roleFrom(module);
  if (moduleRole) return { role: moduleRole, source: 'module' };

  return { role: 'daily', source: 'default' };
}

function modulesByRole(root, registry) {
  const result = { ammo: [], daily: [], maintenance: [] };
  for (const module of registry && registry.modules || []) {
    const classification = classifyModule(root, registry, module);
    result[classification.role].push(module);
  }
  for (const modules of Object.values(result)) modules.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return result;
}

module.exports = {
  LEGACY_DAILY_MODULE_IDS,
  LEGACY_MAINTENANCE_MODULE_IDS,
  classifyModule,
  modulesByRole
};
