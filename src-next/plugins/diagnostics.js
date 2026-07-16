'use strict';

const { copyText, nowIso } = require('../core/utils');

function diagnosticsPlugin() {
  return {
    id: 'dcf.next.diagnostics',
    version: '1.0.0',
    title: '维护诊断',
    description: '最小、隐私安全的启动与 Runtime 观察。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      if (!shell) throw new Error('shell_plugin_required');
      function report() {
        const host = ctx.plugins.get('dcf.next.chatgpt');
        const localAgent = ctx.plugins.get('dcf.next.local-agent');
        const performancePlugin = ctx.plugins.get('dcf.next.conversation-performance');
        return {
          schema: 'dcf.next.runtime.diagnostics.v1',
          generated_at: nowIso(),
          survival_version: ctx.survival.version,
          route_kind: location.pathname,
          current_manifest: ctx.survival.currentManifest(),
          last_known_good_manifest: ctx.survival.lastKnownGoodManifest(),
          started_plugins: ctx.plugins.list(),
          shell: {
            connected: Boolean(shell.host?.isConnected),
            geometry: shell.getGeometry?.() || null
          },
          chatgpt: host?.status?.() || { available: false },
          local_agent: localAgent?.diagnostics?.() || { available: false },
          conversation_performance: performancePlugin?.report?.() || { available: false },
          privacy: {
            message_text: false,
            prompt_text: false,
            ammo_bodies: false,
            dom_dump: false,
            authentication: false,
            local_agent_session_token: false
          }
        };
      }
      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const card = document.createElement('section'); card.className = 'dcf-card dcf-stack';
        const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = JSON.stringify(report(), null, 2);
        const copy = document.createElement('button'); copy.className = 'dcf-btn'; copy.textContent = '复制诊断'; copy.onclick = () => copyText(JSON.stringify(report(), null, 2)).then(() => shell.notify('诊断已复制'));
        const safe = document.createElement('button'); safe.className = 'dcf-btn danger'; safe.textContent = '下次进入安全模式'; safe.onclick = () => ctx.survival.enterSafeMode('manual_diagnostics_request');
        const actions = document.createElement('div'); actions.className = 'dcf-row'; actions.append(copy, safe);
        card.append(pre, actions); root.append(card); container.append(root);
      }
      shell.registerPanel({ id: 'diagnostics', title: '维护', render });
      return { report };
    }
  };
}

module.exports = { diagnosticsPlugin };
