(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.page-diagnostics';
  const UNIT_VERSION = '1.0.0-rc.2-page-diagnostics.3';
  const PANEL_ID = 'dcf-panel-page-diagnostics';
  const HOST_ID = 'dcf-panel-page-diagnostics';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_PAGE_DIAGNOSTICS__';
  const SHELL_ID = 'dcf-chrome-shell-host';
  const RING_SIZE = 200;
  const TIMER_EXPECTED_MS = 1000;

  const previous = globalThis[GLOBAL_KEY];
  if (previous?.destroy) previous.destroy();

  const sendHost = (message) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return Promise.reject(new Error('host_messaging_unavailable'));
    return chrome.runtime.sendMessage(message).then((result) => {
      if (!result || result.ok === false) throw new Error(result?.error || 'DCF host rejected request');
      return result;
    });
  };

  let destroyed = false;
  let running = false;
  let panel = null;
  let notice = '';

  const ring = [];
  let timerHandle = null;
  let rafHandle = null;
  let lastTimerAt = 0;
  let rafCount = 0;
  let rafLastReport = 0;
  let domObserver = null;
  let domRoot = null;
  let lastDomGrowth = 0;
  let lastAssistantLength = 0;
  let startedAt = 0;
  let domCheckTimer = null;

  function push(type, data) {
    ring.push({ t: Date.now() - startedAt, ts: new Date().toISOString(), type, ...data });
    if (ring.length > RING_SIZE) ring.shift();
  }

  function onVisibility() {
    push('visibility', { state: document.visibilityState, hidden: document.hidden, hasFocus: document.hasFocus() });
  }
  function onFocus() { push('focus', { hasFocus: true }); }
  function onBlur() { push('blur', { hasFocus: false }); }
  function onPageShow(e) { push('pageshow', { persisted: e.persisted }); }
  function onPageHide(e) { push('pagehide', { persisted: e.persisted }); }
  function onFreeze() { push('freeze', {}); }
  function onResume() { push('resume', {}); }

  function timerTick() {
    const now = Date.now();
    if (lastTimerAt) {
      const drift = now - lastTimerAt - TIMER_EXPECTED_MS;
      if (Math.abs(drift) > 200) push('timer_drift', { expected: TIMER_EXPECTED_MS, actual: now - lastTimerAt, drift });
    }
    lastTimerAt = now;
    if (rafLastReport && now - rafLastReport >= 1000) {
      push('raf_rate', { fps: rafCount, interval_ms: now - rafLastReport });
      rafCount = 0;
      rafLastReport = now;
    }
    const dialogue = globalThis.__DCF_FIRSTPARTY_LOCAL_AGENT_DIALOGUE__;
    if (dialogue?.diagnostics) {
      const d = dialogue.diagnostics;
      push('dcf_activity', { observer_gen: d.observer_generation, last_mutation_age: d.last_mutation_at ? now - d.last_mutation_at : -1, last_consume_age: d.last_consume_at ? now - d.last_consume_at : -1, recoveries: d.recoveries, last_recovery: d.last_recovery_reason });
    }
  }

  function rafLoop() {
    if (!running) return;
    rafCount += 1;
    rafHandle = requestAnimationFrame(rafLoop);
  }

  function observeDom() {
    const root = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!root || root === domRoot) return;
    domObserver?.disconnect();
    domRoot = root;
    push('dom_rebind', { reason: domRoot ? 'root_replaced' : 'initial' });
    domObserver = new MutationObserver((records) => {
      const now = Date.now();
      lastDomGrowth = now;
      let added = 0;
      for (const r of records) added += r.addedNodes.length + (r.type === 'characterData' ? 1 : 0);
      const streaming = Boolean(document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop"]'));
      const assistantNodes = root.querySelectorAll('[data-message-author-role="assistant"]');
      const lastNode = assistantNodes[assistantNodes.length - 1];
      const currentLength = lastNode ? String(lastNode.innerText || '').length : 0;
      const growth = currentLength - lastAssistantLength;
      lastAssistantLength = currentLength;
      if (added > 0 || Math.abs(growth) > 50) push('dom_growth', { added_nodes: added, text_growth: growth, streaming, total_assistant_nodes: assistantNodes.length });
    });
    domObserver.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function analyze() {
    if (!ring.length) return { conclusion: '证据不足', detail: '环形缓冲区为空' };
    const events = ring;
    const lastVisibility = [...events].reverse().find((e) => e.type === 'visibility');
    const drifts = events.filter((e) => e.type === 'timer_drift');
    const rafRates = events.filter((e) => e.type === 'raf_rate');
    const domGrowths = events.filter((e) => e.type === 'dom_growth');
    const dcfActivities = events.filter((e) => e.type === 'dcf_activity');
    const maxDrift = drifts.length ? Math.max(...drifts.map((d) => Math.abs(d.drift))) : 0;
    const zeroRaf = rafRates.filter((r) => r.fps === 0).length;
    const lastDom = domGrowths.length ? domGrowths[domGrowths.length - 1] : null;
    const lastDcf = dcfActivities.length ? dcfActivities[dcfActivities.length - 1] : null;
    const hidden = lastVisibility && lastVisibility.state === 'hidden';
    const recentDom = domGrowths.filter((e) => e.t > (events[events.length - 1]?.t || 0) - 30000);
    const recentDcfStall = lastDcf && lastDcf.last_mutation_age > 15000;

    if (recentDom.length > 0 && recentDcfStall) {
      return { conclusion: 'DCF 自身暂停', detail: `最近 30s 内 DOM 仍增长 ${recentDom.length} 次，但 DCF observer 停滞 ${Math.round(lastDcf.last_mutation_age / 1000)}s`, key_events: { last_dom_t: lastDom?.t, dcf_mutation_age: lastDcf.last_mutation_age } };
    }
    if (hidden && zeroRaf > 2 && maxDrift > 5000) {
      return { conclusion: '页面后台节流', detail: `visibility=hidden, rAF 停止 ${zeroRaf} 次, 最大 timer drift ${maxDrift}ms`, key_events: { hidden_at: lastVisibility.ts, max_drift: maxDrift } };
    }
    if (!hidden && zeroRaf > 2 && maxDrift > 3000) {
      return { conclusion: 'macOS/Chrome occlusion 倾向', detail: `页面报告 visible 但 rAF 停止且 timer drift ${maxDrift}ms`, key_events: { max_drift: maxDrift, zero_raf_count: zeroRaf } };
    }
    if (zeroRaf > 2 && recentDom.length === 0 && maxDrift < 2000) {
      return { conclusion: '仅停止绘制', detail: `rAF 停止但 DOM 无增长且 timer 正常，可能是纯绘制暂停`, key_events: { zero_raf_count: zeroRaf } };
    }
    return { conclusion: '证据不足', detail: `drift=${maxDrift}ms, zeroRaf=${zeroRaf}, domEvents=${domGrowths.length}, dcfEvents=${dcfActivities.length}`, key_events: { max_drift: maxDrift, total_events: events.length } };
  }

  function report() {
    const analysis = analyze();
    return {
      schema: 'dcf.page-diagnostics.report.v1',
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      ring_size: ring.length,
      analysis,
      summary: {
        visibility_events: ring.filter((e) => e.type === 'visibility').length,
        timer_drifts: ring.filter((e) => e.type === 'timer_drift').length,
        raf_reports: ring.filter((e) => e.type === 'raf_rate').length,
        dom_growths: ring.filter((e) => e.type === 'dom_growth').length,
        dcf_activities: ring.filter((e) => e.type === 'dcf_activity').length
      },
      ring_tail: ring.slice(-20)
    };
  }

  function start() {
    if (running) return;
    running = true;
    startedAt = Date.now();
    ring.length = 0;
    lastTimerAt = 0;
    rafCount = 0;
    rafLastReport = Date.now();
    lastAssistantLength = 0;
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
    timerHandle = setInterval(timerTick, TIMER_EXPECTED_MS);
    domCheckTimer = setInterval(observeDom, 3000);
    rafHandle = requestAnimationFrame(rafLoop);
    observeDom();
    push('start', { visibility: document.visibilityState, hasFocus: document.hasFocus() });
    notice = '诊断运行中';
    render();
  }

  function stop() {
    if (!running) return;
    running = false;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onResume);
    clearInterval(timerHandle);
    timerHandle = null;
    clearInterval(domCheckTimer);
    domCheckTimer = null;
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
    domObserver?.disconnect();
    domObserver = null;
    push('stop', {});
    notice = '诊断已结束';
    render();
  }

  async function copyReport() {
    const result = report();
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    notice = '诊断结果已复制';
    render();
  }

  function style() {
    return `:host{display:block;font:13px/1.5 system-ui;color:inherit}.card{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fff;display:grid;gap:8px}.head{display:flex;gap:7px;align-items:center}.head b{flex:1}.muted{color:#666;font-size:12px}.buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}button{font:inherit;border:1px solid #bbb;border-radius:7px;padding:6px;background:#fff;color:inherit;cursor:pointer}.primary{background:#202124;color:#fff;border-color:#202124}.danger{color:#b42318;border-color:#b42318}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.4 monospace;background:#f6f6f6;padding:7px;border-radius:7px;max-height:200px;overflow:auto;margin:0}@media(prefers-color-scheme:dark){.card{background:#222;border-color:#444}.muted{color:#aaa}button{background:#292929;border-color:#555}.primary{background:#eee;color:#111}pre{background:#181818}}`;
  }

  function render() {
    if (!panel) return;
    const root = panel.shadowRoot;
    const analysis = running ? null : ring.length ? analyze() : null;
    root.querySelector('.content').innerHTML = `<style>${style()}</style><section class="card"><div class="head"><b>页面生命周期诊断</b><span class="muted">${running ? '运行中' : '已停止'}</span></div><div class="muted">默认关闭。记录 visibility/focus/timer drift/rAF/DOM 增长/DCF 活性，固定 ${RING_SIZE} 条环形缓冲。不记录对话正文。</div><div class="buttons"><button class="primary" data-action="start" ${running ? 'disabled' : ''}>开始诊断</button><button class="danger" data-action="stop" ${running ? '' : 'disabled'}>结束并分析</button><button data-action="copy" ${ring.length ? '' : 'disabled'}>复制诊断结果</button></div>${analysis ? `<pre>结论：${analysis.conclusion}\n${analysis.detail}</pre>` : ''}${notice ? `<div class="muted">${notice}</div>` : ''}${ring.length ? `<div class="muted">缓冲区：${ring.length}/${RING_SIZE} 条 · 时长 ${Math.round((Date.now() - startedAt) / 1000)}s</div>` : ''}</section>`;
    root.querySelector('[data-action="start"]').onclick = () => start();
    root.querySelector('[data-action="stop"]').onclick = () => { stop(); render(); };
    root.querySelector('[data-action="copy"]').onclick = () => copyReport().catch(() => {});
  }

  function create() {
    panel = document.createElement('section');
    panel.id = HOST_ID;
    panel.dataset.dcfPanelRoot = 'true';
    panel.dataset.dcfPanelId = PANEL_ID;
    panel.dataset.dcfPanelTitle = '页面诊断';
    panel.style.display = 'none';
    const root = panel.attachShadow({ mode: 'open' });
    root.innerHTML = `<div class="content"></div>`;
    document.documentElement.append(panel);
    document.dispatchEvent(new CustomEvent('dcf:panel-ready', { detail: PANEL_ID }));
    render();
  }

  function destroy() {
    destroyed = true;
    stop();
    panel?.remove();
    panel = null;
  }

  globalThis[GLOBAL_KEY] = { version: UNIT_VERSION, destroy, start, stop, report, ring };

  try {
    document.getElementById(HOST_ID)?.remove();
    create();
    sendHost({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION }).catch(() => {});
  } catch (error) {
    destroy();
    sendHost({ type: 'unit.failed', unit_id: UNIT_ID, version: UNIT_VERSION, error: String(error?.message || error) }).catch(() => {});
  }
})();
