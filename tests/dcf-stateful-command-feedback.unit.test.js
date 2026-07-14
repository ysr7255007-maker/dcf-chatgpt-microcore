'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveUiStateSpec } = require('../src/ui/app');
const { STANDARD_PACKS } = require('../src/modules/standard-packages');

let state = resolveUiStateSpec(
  { source: 'runtime', path: ['performance'], matches: { mode: 'window', keep_recent: 40 }, state: 'selected', label: '最近 40 条 · 已开启' },
  { runtime: { performance: { mode: 'window', keep_recent: 40 } } }
);
assert.strictEqual(state.active, true);
assert.strictEqual(state.state, 'selected');
assert.strictEqual(state.label, '最近 40 条 · 已开启');

state = resolveUiStateSpec(
  { source: 'runtime', path: ['turn', 'status'], cases: { armed: { state: 'armed', label: '等待发送' }, running: { state: 'running', label: '记录中' } } },
  { runtime: { turn: { status: 'armed' } } }
);
assert.strictEqual(state.state, 'armed');
assert.strictEqual(state.label, '等待发送');

state = resolveUiStateSpec(
  { source: 'runtime', path: ['turn', 'status'], cases: { complete: { state: 'complete', label: '可复制' } } },
  { runtime: { turn: { status: 'running' } } }
);
assert.strictEqual(state.active, false);
assert.strictEqual(state.state, '');

const pack = STANDARD_PACKS.find((item) => item.pack_id === 'dcf.standard.conversation-performance');
assert.strictEqual(pack.revision, '1.3.0');
const commands = pack.modules[0].blocks.flatMap((block) => block.commands);
for (const id of ['safe', 'window40', 'window20', 'off', 'turn_attribution_arm', 'turn_attribution_copy']) {
  const command = commands.find((item) => item.id === id);
  assert(command && command.ui_state, `missing declarative ui_state for ${id}`);
}

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
for (const marker of ['state-selected', 'state-armed', 'state-running', 'state-complete', 'aria-pressed', 'refreshCommandStates']) {
  assert(appSource.includes(marker), `missing UI state marker ${marker}`);
}
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
assert(indexSource.includes('getRuntimeUiState'));
assert(indexSource.includes('app.refreshCommandStates()'));

console.log(JSON.stringify({
  ok: true,
  declarative_state_contract: true,
  selected_mode_feedback: true,
  armed_running_complete_feedback: true,
  text_and_color_feedback: true,
  live_turn_refresh: true,
  unrelated_actions_unstyled: true
}, null, 2));
