'use strict';

const { copyText, nowIso } = require('../core/utils');

function attributionPlugin() {
  return {
    id: 'dcf.next.attribution',
    version: '1.0.0',
    title: '问答性能归因',
    description: '从下一次发送到回复完成的有界浏览器性能样本。',
    async start(ctx) {
      const shell = ctx.plugins.get('dcf.next.shell');
      const host = ctx.plugins.get('dcf.next.chatgpt');
      if (!shell || !host) throw new Error('shell_and_chatgpt_required');
      let state = 'idle';
      let session = null;
      let report = null;
      let observers = [];
      let timeout = null;

      function clearObservers() { for (const observer of observers) try { observer.disconnect(); } catch (_error) {} observers = []; clearTimeout(timeout); }
      function addObserver(type, handler) {
        try {
          const observer = new PerformanceObserver((list) => handler(list.getEntries()));
          observer.observe({ type, buffered: false }); observers.push(observer);
        } catch (_error) {}
      }
      function startSampling(sendEvent) {
        if (state !== 'armed') return;
        state = 'running';
        session = {
          started_at_wall: nowIso(),
          send_at: sendEvent.at,
          first_activity_at: null,
          completion_at: null,
          entries: { loaf: [], longtask: [], event: [], layout_shift: [] },
          dcf_self_start: ctx.plugins.get('dcf.next.conversation-performance')?.selfTiming?.() || null
        };
        addObserver('long-animation-frame', (entries) => session.entries.loaf.push(...entries.map((entry) => ({ startTime: entry.startTime, duration: entry.duration, blockingDuration: entry.blockingDuration || null, renderStart: entry.renderStart || null, styleAndLayoutStart: entry.styleAndLayoutStart || null }))));
        addObserver('longtask', (entries) => session.entries.longtask.push(...entries.map((entry) => ({ startTime: entry.startTime, duration: entry.duration }))));
        addObserver('event', (entries) => session.entries.event.push(...entries.filter((entry) => entry.duration >= 16).slice(0, 80).map((entry) => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration, processingStart: entry.processingStart, processingEnd: entry.processingEnd }))));
        addObserver('layout-shift', (entries) => session.entries.layout_shift.push(...entries.filter((entry) => !entry.hadRecentInput).map((entry) => ({ startTime: entry.startTime, value: entry.value }))));
        timeout = setTimeout(() => finish('timeout'), 10 * 60 * 1000);
        shell.refresh('attribution');
      }
      function finish(reason = 'completed') {
        if (state !== 'running' || !session) return;
        clearObservers();
        session.completion_at = session.completion_at || performance.now();
        const first = session.first_activity_at;
        const end = session.completion_at;
        report = {
          schema: 'dcf.next.conversation-turn-attribution.v1',
          generated_at: nowIso(),
          reason,
          route_kind: location.pathname,
          send_to_first_reply_activity_ms: first ? Math.round(first - session.send_at) : null,
          first_reply_activity_to_completion_ms: first ? Math.round(end - first) : null,
          total_ms: Math.round(end - session.send_at),
          completion_quiet_window_ms: 1100,
          browser_observation: {
            loaf_count: session.entries.loaf.length,
            loaf_total_duration_ms: Math.round(session.entries.loaf.reduce((sum, item) => sum + item.duration, 0)),
            longtask_count: session.entries.longtask.length,
            longtask_total_duration_ms: Math.round(session.entries.longtask.reduce((sum, item) => sum + item.duration, 0)),
            slow_event_count: session.entries.event.length,
            layout_shift_value: Math.round(session.entries.layout_shift.reduce((sum, item) => sum + item.value, 0) * 10000) / 10000,
            loaf: session.entries.loaf.slice(0, 80),
            longtasks: session.entries.longtask.slice(0, 80),
            events: session.entries.event.slice(0, 80),
            layout_shifts: session.entries.layout_shift.slice(0, 80)
          },
          dcf_self: {
            before: session.dcf_self_start,
            after: ctx.plugins.get('dcf.next.conversation-performance')?.selfTiming?.() || null
          },
          limits: [
            '等待阶段同时包含服务端、网络、页面调度和浏览器工作，不能仅凭耗时归因给前端。',
            'Long Animation Frames 和 Long Tasks 只能描述浏览器可观察工作；扩展隔离世界、跨域与未知来源可能缺失。',
            '报告不包含提示词、回复正文、DOM 文本、事件目标、完整 URL、调用栈或认证信息。'
          ]
        };
        state = 'completed'; session = null; shell.refresh('attribution'); shell.notify('本轮问答归因已完成');
      }
      function arm() { clearObservers(); state = 'armed'; report = null; session = null; shell.refresh('attribution'); }
      function cancel() { clearObservers(); state = 'idle'; report = null; session = null; shell.refresh('attribution'); }

      host.onSend(startSampling);
      host.onReplyFirstActivity(({ at }) => { if (state === 'running' && session && !session.first_activity_at) { session.first_activity_at = at; shell.refresh('attribution'); } });
      host.onReplyCompleted(({ at }) => { if (state === 'running' && session) { session.completion_at = at; finish('completed'); } });

      function render(container) {
        container.replaceChildren();
        const root = document.createElement('div'); root.className = 'dcf-stack';
        const card = document.createElement('section'); card.className = 'dcf-card dcf-stack';
        const status = document.createElement('div'); status.className = 'dcf-title';
        status.textContent = ({ idle: '未启动', armed: '等待下一次发送', running: '记录中', completed: '已完成，可复制' })[state]; card.append(status);
        const actions = document.createElement('div'); actions.className = 'dcf-row';
        const armButton = document.createElement('button'); armButton.className = 'dcf-btn primary'; armButton.textContent = '记录下一轮问答'; armButton.disabled = state === 'running'; armButton.onclick = arm;
        const finishButton = document.createElement('button'); finishButton.className = 'dcf-btn'; finishButton.textContent = '手动结束'; finishButton.disabled = state !== 'running'; finishButton.onclick = () => finish('manual');
        const copyButton = document.createElement('button'); copyButton.className = 'dcf-btn'; copyButton.textContent = '复制本轮归因报告'; copyButton.disabled = !report; copyButton.onclick = () => copyText(JSON.stringify(report, null, 2)).then(() => shell.notify('归因报告已复制'));
        const cancelButton = document.createElement('button'); cancelButton.className = 'dcf-btn'; cancelButton.textContent = '清除'; cancelButton.onclick = cancel;
        actions.append(armButton, finishButton, copyButton, cancelButton); card.append(actions);
        if (report) { const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = JSON.stringify({ total_ms: report.total_ms, send_to_first_reply_activity_ms: report.send_to_first_reply_activity_ms, first_reply_activity_to_completion_ms: report.first_reply_activity_to_completion_ms, browser_observation: report.browser_observation }, null, 2); card.append(pre); }
        root.append(card); container.append(root);
      }

      shell.registerPanel({ id: 'attribution', title: '归因', render });
      return { arm, cancel, finish, state: () => state, report: () => report };
    }
  };
}

module.exports = { attributionPlugin };
