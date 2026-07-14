'use strict';

const { debounce } = require('../core/utils');

const TURN_SELECTORS = ['[data-testid^="conversation-turn-"]', 'article[data-testid*="conversation-turn"]', 'main article'];

function collectTurns(root) {
  for (const selector of TURN_SELECTORS) {
    const nodes = Array.from(root?.querySelectorAll?.(selector) || []);
    if (nodes.length) return nodes;
  }
  return [];
}

function conversationPerformancePlugin() {
  return {
    id: 'dcf.next.conversation-performance',
    version: '1.0.0',
    title: '长对话减负',
    description: '可逆的 content-visibility 与显式历史窗口模式。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      const host = ctx.plugins.get('dcf.next.chatgpt');
      if (!shell || !host) throw new Error('shell_and_chatgpt_required');
      let settings = { mode: 'safe', threshold: 24, window_size: 40, batch_size: 20, ...ctx.storage.get('settings', {}) };
      const original = new Map();
      let root = null;
      let observer = null;
      let hiddenCount = 0;
      let lastApplyDuration = 0;
      let applyCount = 0;
      let applyTotal = 0;
      let lastReason = 'startup';

      function persist() { ctx.storage.set('settings', settings); }
      function conversationRoot() { return document.querySelector('main') || document.querySelector('[role="main"]'); }
      function isStreaming() { return host.status().streaming; }
      function remember(node) {
        if (!original.has(node)) original.set(node, { contentVisibility: node.style.contentVisibility, containIntrinsicSize: node.style.containIntrinsicSize, display: node.style.display });
      }
      function restoreNode(node) {
        const previous = original.get(node);
        if (!previous) return;
        node.style.contentVisibility = previous.contentVisibility;
        node.style.containIntrinsicSize = previous.containIntrinsicSize;
        node.style.display = previous.display;
        node.removeAttribute('data-dcf-next-performance');
        original.delete(node);
      }
      function restoreAll() { for (const node of Array.from(original.keys())) restoreNode(node); hiddenCount = 0; }

      function apply(reason = 'mutation') {
        const started = performance.now();
        lastReason = reason;
        if (isStreaming()) return;
        const nextRoot = conversationRoot();
        if (!nextRoot) return;
        root = nextRoot;
        const turns = collectTurns(root);
        for (const node of Array.from(original.keys())) if (!node.isConnected) original.delete(node);
        hiddenCount = 0;
        if (settings.mode === 'off' || turns.length < settings.threshold) {
          restoreAll();
        } else if (settings.mode === 'safe') {
          for (const node of turns) {
            remember(node);
            node.style.display = original.get(node).display;
            node.style.contentVisibility = 'auto';
            node.style.containIntrinsicSize = 'auto 320px';
            node.dataset.dcfNextPerformance = 'safe';
          }
        } else {
          const cutoff = Math.max(0, turns.length - settings.window_size);
          turns.forEach((node, index) => {
            remember(node);
            if (index < cutoff) {
              node.style.display = 'none';
              node.style.contentVisibility = original.get(node).contentVisibility;
              node.style.containIntrinsicSize = original.get(node).containIntrinsicSize;
              node.dataset.dcfNextPerformance = 'hidden';
              hiddenCount += 1;
            } else {
              node.style.display = original.get(node).display;
              node.style.contentVisibility = 'auto';
              node.style.containIntrinsicSize = 'auto 320px';
              node.dataset.dcfNextPerformance = 'window';
            }
          });
        }
        lastApplyDuration = performance.now() - started;
        applyCount += 1; applyTotal += lastApplyDuration;
        shell.refresh('performance');
      }

      const scheduleApply = debounce((reason) => apply(reason), 240);
      function attach() {
        const next = conversationRoot();
        if (!next || next === root) return;
        observer?.disconnect(); root = next;
        observer = new MutationObserver(() => scheduleApply('mutation'));
        observer.observe(root, { childList: true, subtree: true });
        apply('root-change');
      }
      attach();
      const attachTimer = setInterval(() => {
        if (!root?.isConnected) attach();
      }, 1800);
      host.onReplyCompleted(() => scheduleApply('reply-completed'));
      host.onNavigation(() => { root = null; attach(); });
      const scrollListener = () => {
        if (settings.mode !== 'window' || window.scrollY > 180 || isStreaming()) return;
        settings.window_size += settings.batch_size; persist(); apply('top-expand');
      };
      window.addEventListener('scroll', scrollListener, { passive: true });

      function report() {
        const turns = collectTurns(conversationRoot());
        return {
          schema: 'dcf.next.conversation-performance.runtime.v1',
          route_kind: location.pathname,
          mode: settings.mode,
          turn_count: turns.length,
          optimized_count: turns.filter((node) => node.dataset.dcfNextPerformance).length,
          hidden_count: hiddenCount,
          content_visibility_supported: CSS?.supports?.('content-visibility', 'auto') || false,
          apply_count: applyCount,
          last_apply_duration_ms: Math.round(lastApplyDuration * 100) / 100,
          total_apply_duration_ms: Math.round(applyTotal * 100) / 100,
          last_reason: lastReason
        };
      }

      function render(container) {
        container.replaceChildren();
        const rootNode = document.createElement('div'); rootNode.className = 'dcf-stack';
        const card = document.createElement('section'); card.className = 'dcf-card dcf-stack';
        const mode = document.createElement('select');
        for (const [value, label] of [['off', '关闭'], ['safe', '透明减负'], ['window', '历史窗口']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = settings.mode === value; mode.append(option); }
        mode.onchange = () => { settings.mode = mode.value; if (settings.mode === 'off') restoreAll(); persist(); apply('mode-change'); };
        const windowSize = document.createElement('select');
        for (const value of [20, 40, 80]) { const option = document.createElement('option'); option.value = String(value); option.textContent = `保留最近 ${value} 条`; option.selected = settings.window_size === value; windowSize.append(option); }
        windowSize.onchange = () => { settings.window_size = Number(windowSize.value); persist(); apply('window-size'); };
        const row = document.createElement('div'); row.className = 'dcf-row'; row.append(mode, windowSize); card.append(row);
        const summary = document.createElement('pre'); summary.style.whiteSpace = 'pre-wrap'; summary.textContent = JSON.stringify(report(), null, 2); card.append(summary);
        const actions = document.createElement('div'); actions.className = 'dcf-row';
        const expand = document.createElement('button'); expand.className = 'dcf-btn'; expand.textContent = '展开上一批'; expand.onclick = () => { settings.window_size += settings.batch_size; persist(); apply('manual-expand'); };
        const restore = document.createElement('button'); restore.className = 'dcf-btn'; restore.textContent = '恢复全部并关闭'; restore.onclick = () => { settings.mode = 'off'; persist(); restoreAll(); shell.refresh('performance'); };
        actions.append(expand, restore); card.append(actions); rootNode.append(card); container.append(rootNode);
      }

      shell.registerPanel({ id: 'performance', title: '性能', render });
      return { report, apply, restoreAll, selfTiming: () => ({ apply_count: applyCount, total_ms: applyTotal, max_or_last_ms: lastApplyDuration }), destroy() { clearInterval(attachTimer); observer?.disconnect(); window.removeEventListener('scroll', scrollListener); restoreAll(); } };
    }
  };
}

module.exports = { conversationPerformancePlugin, collectTurns };
