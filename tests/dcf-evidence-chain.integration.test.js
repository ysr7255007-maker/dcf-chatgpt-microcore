const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'dcf-chatgpt-microcore.user.js'), 'utf8');

function registry({ css = '.sh{width:500px!important;bottom:44px!important;}' } = {}) {
  return {
    appearance: {
      side: 'right',
      css,
      vars: { w: '340px', h: '800px', top: '12px', bottom: '112px', anchor: 'bottom' }
    },
    contentTypes: { ammo: { id: 'ammo', marker: 'DCF_AMMO', title: '语言弹药', body_field: 'body', actions: ['fire', 'copy'] } },
    content: { ammo: {} }, surfaces: {}, settings: {}, seenBlocks: {}, badBlocks: {}, installedPacks: {},
    moduleDisplay: { 'dcf.shell_adjuster': { area: 'maintenance', order: 10 } },
    modules: [{
      id: 'dcf.shell_adjuster', title: '壳体调节', version: 'test-v1', area: 'maintenance', commands: [],
      blocks: [{
        id: 'test', title: '测试', commands: [
          { id: 'width_increase', label: '宽度＋20', steps: [{ call: 'appearance.adjust', with: { w: 20 } }] },
          { id: 'secret_text', label: '秘密文本', steps: [{ call: 'composer.replace', with: { text: 'TOP-SECRET-PAYLOAD' } }] }
        ]
      }]
    }]
  };
}

function createRuntime({ brokenSessionWrites = false, renderFollowsVars = false, appearanceCss } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><textarea id="prompt-textarea"></textarea><button data-testid="send-button">send</button></body></html>', {
    url: 'https://chatgpt.com/c/dcf-evidence-test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const width = this.classList?.contains('sh') ? (renderFollowsVars ? (parseFloat(this.style.getPropertyValue('--w')) || 340) : 500) : 340;
    return { x: 0, y: 0, width, height: 800, top: 0, right: width, bottom: 800, left: 0 };
  };
  let clipboard = '';
  let sendClicks = 0;
  window.GM_setClipboard = (text) => { clipboard = String(text); };
  window.GM_registerMenuCommand = () => {};
  window.confirm = () => true;
  Object.defineProperty(window.document.body, 'innerText', { get() { return this.textContent; } });
  window.document.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sendClicks += 1; });
  window.localStorage.setItem('dcf.kernel.registry.v1', JSON.stringify(registry({ css: appearanceCss })));
  window.localStorage.setItem('dcf.kernel.state.v1', JSON.stringify({ tab: 'maint', pick: 'module:dcf.shell_adjuster', notice: '', pack: '', mt: {} }));
  window.localStorage.setItem('dcf.kernel.log.v1', JSON.stringify([{ type: 'stale', text: 'MUST-NOT-LEAK' }]));
  window.eval(source);
  if (brokenSessionWrites) {
    const proto = Object.getPrototypeOf(window.sessionStorage);
    const originalSetItem = proto.setItem;
    proto.setItem = function (key, value) {
      if (this === window.sessionStorage) throw new Error('quota-test');
      return originalSetItem.call(this, key, value);
    };
  }
  return {
    dom, window,
    host: () => window.document.getElementById('dcf-chatgpt-microcore-host'),
    clipboard: () => clipboard,
    sendClicks: () => sendClicks
  };
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function button(host, text) { return [...host.shadowRoot.querySelectorAll('button')].find((b) => b.textContent === text); }

async function main() {
  const rt = createRuntime();
  const { window } = rt;
  await wait(30);
  const host = rt.host();
  if (!host?.shadowRoot) throw new Error('DCF host missing');

  button(host, '宽度＋20').click();
  await wait(30);
  let store = JSON.parse(window.sessionStorage.getItem('dcf.command.traces.v2'));
  if (store.schema !== 'dcf.command_trace_store.v2' || store.traces.length !== 1) throw new Error('trace store invalid');
  const widthTrace = store.traces[0];
  if (widthTrace.schema !== 'dcf.command_trace.v2' || !widthTrace.trace_id || widthTrace.resolution.module_fingerprint == null) throw new Error('trace identity incomplete');
  const step = widthTrace.steps[0];
  if (step.input.w !== 20 || step.before.registry.vars.w !== '340px' || step.after.registry.vars.w !== '360px') throw new Error('before/after state evidence missing');
  if (!step.effect.registry_changed || !step.effect.persisted_changed || !step.effect.persisted_matches_memory) throw new Error('state persistence evidence missing');
  if (step.effect.interpretation !== 'state_changed_but_render_overridden') throw new Error(`unexpected effect classification: ${step.effect.interpretation}`);
  if (!step.before.shell.matched_rules.some((rule) => rule.source === 'appearance' && rule.style.includes('width: 500px'))) throw new Error('CSS override provenance missing');
  if (window.localStorage.getItem('dcf.command.traces.v2') !== null) throw new Error('trace leaked into cross-tab localStorage');

  button(host, '秘密文本').click();
  await wait(30);
  if (window.document.getElementById('prompt-textarea').value !== 'TOP-SECRET-PAYLOAD') throw new Error('secret command did not execute');
  store = JSON.parse(window.sessionStorage.getItem('dcf.command.traces.v2'));
  if (store.traces.length !== 2 || store.traces[0].trace_id === store.traces[1].trace_id) throw new Error('trace correlation failed');
  const serializedTraces = JSON.stringify(store.traces);
  if (serializedTraces.includes('TOP-SECRET-PAYLOAD') || serializedTraces.includes('MUST-NOT-LEAK')) throw new Error('trace privacy boundary failed');

  window.document.getElementById('prompt-textarea').value = '';
  const request = window.document.createElement('div');
  request.textContent = '<<<DCF_MAINT_REQUEST\n{"schema":"dcf.maintenance.request.v1","request_id":"audit-test","actions":["recent_command_traces","runtime_appearance","shell_adjuster_summary","diagnostics","registry_export"]}\nDCF_MAINT_REQUEST>>>';
  window.document.body.appendChild(request);

  button(host, '维护').click();
  await wait(10);
  button(host, '状态').click();
  await wait(10);
  button(host, '安全扫描').click();
  await wait(30);
  if (rt.sendClicks() !== 0) throw new Error('maintenance request bypassed local consent');
  let maint = JSON.parse(window.sessionStorage.getItem('dcf.maintenance.session.v2'));
  if (!Object.values(maint.requests).some((entry) => entry.status === 'pending')) throw new Error('pending maintenance request missing');

  button(host, '开启一次维护回传').click();
  await wait(80);
  if (rt.sendClicks() !== 1) throw new Error('consented maintenance response not delivered exactly once');
  const feedbackText = window.document.getElementById('prompt-textarea').value;
  if (!feedbackText.includes('"schema": "dcf.maintenance.response.v2"') || !feedbackText.includes('"request_id": "audit-test"')) throw new Error('maintenance response incomplete');
  if (feedbackText.includes('registry_export')) throw new Error('maintenance action allowlist failed');
  if (feedbackText.includes('TOP-SECRET-PAYLOAD') || feedbackText.includes('MUST-NOT-LEAK')) throw new Error('maintenance response leaked sensitive text');
  maint = JSON.parse(window.sessionStorage.getItem('dcf.maintenance.session.v2'));
  if (!Object.values(maint.requests).some((entry) => entry.status === 'delivered')) throw new Error('delivery status not recorded');

  button(host, '安全扫描').click();
  await wait(30);
  if (rt.sendClicks() !== 1) throw new Error('handled maintenance request replayed');
  rt.dom.window.close();

  const fallback = createRuntime({ brokenSessionWrites: true });
  await wait(30);
  const fallbackHost = fallback.host();
  button(fallbackHost, '宽度＋20').click();
  await wait(30);
  const fallbackRegistry = JSON.parse(fallback.window.localStorage.getItem('dcf.kernel.registry.v1'));
  if (fallbackRegistry.appearance.vars.w !== '360px') throw new Error('trace storage failure blocked real command');
  button(fallbackHost, '维护').click();
  await wait(10);
  button(fallbackHost, '状态').click();
  await wait(10);
  button(fallbackHost, '复制证据').click();
  const copied = JSON.parse(fallback.clipboard());
  if (copied.diagnostics.trace_storage.storage !== 'memory' || copied.recent_command_traces.length !== 1) throw new Error('memory fallback evidence unavailable');
  fallback.dom.window.close();

  const normal = createRuntime({ renderFollowsVars: true, appearanceCss: '' });
  await wait(30);
  button(normal.host(), '宽度＋20').click();
  await wait(30);
  const normalTrace = JSON.parse(normal.window.sessionStorage.getItem('dcf.command.traces.v2')).traces[0];
  if (normalTrace.steps[0].effect.interpretation !== 'state_and_render_changed') throw new Error('normal visible mutation was not classified');
  normal.dom.window.close();

  console.log(JSON.stringify({
    ok: true,
    version: '0.9.12',
    trace_correlation: true,
    before_after_and_persistence: true,
    override_classification: step.effect.interpretation,
    visible_change_classification: normalTrace.steps[0].effect.interpretation,
    css_override_provenance: true,
    privacy_redaction: true,
    consent_gate: true,
    maintenance_action_allowlist: true,
    delivery_receipt: true,
    storage_failure_non_interference: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
