(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.conversation-state';
  const UNIT_VERSION = '1.0.0-rc.2-conversation-state.6';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_CONVERSATION_STATE__';
  const COMPANION = 'http://127.0.0.1:8472/rpc/events/ingest';
  const POLL_MS = 2000;
  const HEARTBEAT_MS = 60000;
  const RING = 60;

  // A page state report is only useful if it can be read by the person watching
  // and by the local executor. This unit therefore does two things and nothing
  // else: it classifies what the conversation page is doing, and it publishes
  // transitions to the DCF companion as durable events.
  const SIGNALS = [
    ['interrupted', ['已中断', '正在等待完整回复', '回复已中断']],
    ['context_limit', ['上下文过长', '对话太长', '达到长度上限', '开启新对话', '内容过长']],
    ['loading', ['请稍候', '正在加载']]
  ];

  globalThis[GLOBAL_KEY]?.destroy?.();

  function clearStaleMarkers() {
    try {
      const root = document.documentElement;
      if (!root) return;
      for (const key of Object.keys(root.dataset)) {
        if (key.startsWith('dcfConversation')) delete root.dataset[key];
      }
    } catch (_) {}
  }

  function mark(fields) {
    // Cross-world observability: the unit's own world is not inspectable from
    // the page, so it must leave a marker any world (and any operator) can read.
    try {
      const root = document.documentElement;
      if (!root) return;
      for (const [key, value] of Object.entries(fields)) {
        root.dataset[key] = String(value);
      }
    } catch (_) {}
  }


  const host = (message) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return Promise.reject(new Error('host_messaging_unavailable'));
    }
    return chrome.runtime.sendMessage(message).then((result) => {
      if (!result || result.ok === false) throw new Error((result && result.error) || 'DCF host rejected request');
      return result;
    });
  };

  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function ulid() {
    let time = Date.now();
    const timePart = new Array(10);
    for (let i = 9; i >= 0; i -= 1) {
      timePart[i] = CROCKFORD[time % 32];
      time = Math.floor(time / 32);
    }
    let randomPart = '';
    const bytes = new Uint8Array(16);
    (globalThis.crypto || {}).getRandomValues?.(bytes);
    for (let i = 0; i < 16; i += 1) randomPart += CROCKFORD[bytes[i] % 32];
    return timePart.join('') + randomPart;
  }

  let destroyed = false;
  let timer = null;
  let busy = false;
  let lastPublishedAt = 0;
  let lastFingerprint = '';
  let lastError = '';
  let lastState = null;
  let ticks = 0;
  let lastReported = 0;
  let lastPublished = 0;
  const ring = [];

  const composer = () => document.querySelector('#prompt-textarea');
  const assistantNodes = () => [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const userNodes = () => [...document.querySelectorAll('[data-message-author-role="user"]')];
  const isGenerating = () => !!document.querySelector('[data-testid="stop-button"]')
    || !!document.querySelector('button[aria-label*="停止"]');

  function bodyText() {
    return (document.body && document.body.innerText) || '';
  }

  function matchedSignals(text) {
    const hits = [];
    for (const [name, needles] of SIGNALS) {
      for (const needle of needles) {
        if (text.includes(needle)) {
          hits.push(name);
          break;
        }
      }
    }
    return hits;
  }

  function classify(sample) {
    if (sample.signals.includes('interrupted')) return 'interrupted_waiting';
    if (sample.signals.includes('context_limit')) return 'context_limit';
    if (!sample.composer) return sample.signals.includes('loading') ? 'loading' : 'no_composer';
    if (sample.generating) return 'generating';
    if (sample.draftLen) return 'draft_present';
    return 'idle';
  }

  function sample() {
    const box = composer();
    const assistants = assistantNodes();
    const users = userNodes();
    const last = assistants.length ? (assistants[assistants.length - 1].innerText || '') : '';
    const text = bodyText();
    const result = {
      url: location.href,
      title: document.title,
      visible: document.visibilityState === 'visible',
      composer: !!box,
      draftLen: (box && (box.innerText || '').length) || 0,
      generating: isGenerating(),
      users: users.length,
      assistants: assistants.length,
      lastLen: last.length,
      lastTail: last.slice(-120),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => (n.innerText || '').trim()).filter(Boolean).slice(0, 4),
      bodyLen: text.length,
      signals: matchedSignals(text)
    };
    result.state = classify(result);
    return result;
  }

  function fingerprint(value) {
    return [value.state, value.generating, value.users, value.assistants,
            Math.floor(value.lastLen / 40), value.draftLen ? 1 : 0].join('|');
  }

  function pushRing(entry) {
    ring.push(entry);
    while (ring.length > RING) ring.shift();
  }

  async function publish(value, reason) {
    const event = {
      event_id: ulid(),
      source_id: ulid(),
      event_type: 'conversation.state.observed',
      created_at: new Date().toISOString(),
      payload_json: {
        title: '对话状态 · ' + value.state,
        body_text: `state=${value.state} generating=${value.generating} users=${value.users} assistants=${value.assistants} draft=${value.draftLen}`,
        reason,
        state: value.state,
        generating: value.generating,
        draft_len: value.draftLen,
        users: value.users,
        assistants: value.assistants,
        last_len: value.lastLen,
        signals: value.signals,
        alerts: value.alerts,
        url: value.url,
        title: value.title,
        visible: value.visible,
        unit: UNIT_ID,
        unit_version: UNIT_VERSION,
        observed_at: new Date().toISOString()
      }
    };
    const response = await fetch(COMPANION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error'
    });
    if (!response.ok) throw new Error(`companion HTTP ${response.status}`);
    return response.json();
  }

  async function tick() {
    if (destroyed || busy) return;
    busy = true;
    ticks += 1;
    try {
      const value = sample();
      const stateMark = fingerprint(value);
      const now = Date.now();
      const changed = stateMark !== lastFingerprint;
      lastState = value;
      if (changed) {
        pushRing({ at: new Date().toISOString(), state: value.state, generating: value.generating,
                   last_len: value.lastLen, draft_len: value.draftLen, signals: value.signals });
        lastFingerprint = stateMark;
      }
      mark({ dcfConversationState: value.state, dcfConversationAt: new Date().toISOString(),
             dcfConversationTicks: ticks });
      if (changed || now - lastPublishedAt > HEARTBEAT_MS) {
        await publish(value, changed ? 'transition' : 'heartbeat');
        lastPublishedAt = now;
        lastPublished += 1;
        lastError = '';
        mark({ dcfConversationReported: lastReported, dcfConversationError: '' });
      }
    } catch (error) {
      lastError = String((error && error.message) || error);
      mark({ dcfConversationError: lastError.slice(0, 180) });
    } finally {
      busy = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (destroyed) return;
    timer = setTimeout(async () => {
      try {
        await tick();
      } catch (error) {
        lastError = 'scheduler: ' + String((error && error.message) || error);
        mark({ dcfConversationError: lastError.slice(0, 180) });
      }
      schedule();
    }, POLL_MS);
  }

  function destroy() {
    destroyed = true;
    clearTimeout(timer);
    timer = null;
  }

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION,
    destroy,
    tick,
    diagnostics: () => ({
      unit_id: UNIT_ID,
      version: UNIT_VERSION,
      last_error: lastError,
      last_published_at: lastPublishedAt ? new Date(lastPublishedAt).toISOString() : null,
      ticks,
      reported: lastReported,
      current: lastState,
      transitions: ring.slice(-20)
    })
  };

  clearStaleMarkers();
  mark({ dcfConversationState: 'loaded', dcfConversationVersion: UNIT_VERSION,
         dcfConversationAt: new Date().toISOString(), dcfConversationTicks: 0 });
  schedule();
  host({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION })
    .then(() => mark({ dcfConversationHandshake: 'ok' }))
    .catch((error) => mark({ dcfConversationHandshake: 'failed: ' + String((error && error.message) || error).slice(0, 120) }));
})();
