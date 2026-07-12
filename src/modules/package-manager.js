'use strict';

const { decodeArtifacts } = require('../core/artifacts');
const { REQUIRED_PRODUCT_PACKAGES } = require('./standard-packages');

function createPackageManager(engine, catalog) {
  function packages() {
    return Object.values(engine.getRoot().packages.packages || {}).sort((a, b) => String(a.package_id).localeCompare(String(b.package_id)));
  }
  function installJson(text) {
    const parsed = JSON.parse(String(text || '{}'));
    const wrapper = `<<<DCF_MODULE_PACK\n${JSON.stringify(parsed)}\nDCF_MODULE_PACK>>>`;
    const decoded = decodeArtifacts(wrapper);
    if (decoded.errors.length || decoded.artifacts.length !== 1) throw new Error(decoded.errors[0] && decoded.errors[0].error || 'invalid package');
    return engine.applyArtifact(decoded.artifacts[0], { kind: 'manual-json' });
  }
  function assertMutable(id) {
    if (REQUIRED_PRODUCT_PACKAGES.includes(String(id))) throw new Error(`${id} is required by the DCF product value loop`);
  }
  return {
    packages,
    installJson,
    setEnabled: (id, enabled) => { if (!enabled) assertMutable(id); return engine.setPackageEnabled(id, enabled); },
    uninstall: (id) => { assertMutable(id); return engine.uninstallPackage(id); },
    switchRevision: (id, revision) => engine.switchPackageRevision(id, revision),
    checkUpdates: (force) => catalog.check({ force: !!force }),
    isRequired: (id) => REQUIRED_PRODUCT_PACKAGES.includes(String(id))
  };
}

module.exports = { createPackageManager };
