'use strict';

const { VERSION } = require('../src-next/survival/constants');
const { loadOfficialPack, buildUserscriptArtifact } = require('./build-next-userscript');

const PROFILE_ORDER = ['minimal', 'standard', 'complete'];

function profileVersion(name) {
  return `${VERSION}-${name}`;
}

function buildNextSnapshotUserscripts() {
  const pack = loadOfficialPack();
  const results = [];
  for (const profile of PROFILE_ORDER) {
    const selectedKeys = pack.recommended_snapshots?.[profile];
    if (!Array.isArray(selectedKeys) || !selectedKeys.length) throw new Error(`snapshot_profile_missing:${profile}`);
    const outputBase = `dcf-chatgpt-next-snapshot-${profile}`;
    results.push(buildUserscriptArtifact({
      pack,
      profile,
      selectedKeys,
      outputBase,
      name: 'DCF ChatGPT Next Snapshot Review',
      version: profileVersion(profile),
      description: `Compiled DCF boot snapshot (${profile}); plugin code is selected before installation and executed by Tampermonkey.`,
      updateURL: `https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/${outputBase}.meta.js`,
      downloadURL: `https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/rewrite-v2-survival-box/${outputBase}.user.js`
    }));
  }
  return results;
}

if (require.main === module) console.log(JSON.stringify(buildNextSnapshotUserscripts(), null, 2));

module.exports = { PROFILE_ORDER, profileVersion, buildNextSnapshotUserscripts };
