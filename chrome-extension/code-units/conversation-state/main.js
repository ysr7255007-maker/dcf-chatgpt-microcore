(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.conversation-state';
  const UNIT_VERSION = '1.0.0-rc.2-conversation-state.12';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_CONVERSATION_STATE__';
  const CONTINUITY = 'http://127.0.0.1:4937/continuity/observe';
  const CONTINUITY_BASE = 'http://127.0.0.1:4937/continuity/';
  const PENDING_KEY = 'renzhi.webgpt.continuity.pending.v1';
  const DEBOUNCE_MS = 120;
  const HARD_CUTOFF_GRACE_MS = 3000;
  const RING = 40;

  const TIMEOUT_TEXT = [
    'Message delivery timed out. Please try again.',
    '消息发送超时，请重试。',
    '消息发送超时，请重试'
  ];
  const CONTEXT_LIMIT_TEXT = [
    'This conversation has reached its maximum length.',
    'Start a new chat to continue.',
    'This conversation is too long. Please start a new chat.',
    '此对话已达到长度上限',
    '当前对话已达到长度上限',
    '上下文过长',
    '对话太长',
    '开启新对话'
  ];
  const ERROR_SURFACES = [
    '[role="alert"]', '[role="status"]', '[aria-live="assertive"]',
    '[aria-live="polite"]', '[data-testid*="error"]', '[data-testid*="retry"]',
    '.text-token-text-error', '[class*="error"]'
  ].join(',');

  globalThis[GLOBAL_KEY]?.destroy?.();

  let destroyed = false;
  let observer = null;
  let debounceTimer = null;
  let busy = false;
  let lastFingerprint = '';
  let lastError = '';
  let lastState = null;
  let latchedTerminal = null;
  let cutoffTimer = null;
  let cutoffCandidateId = '';
  let evaluations = 0;
  let actions = 0;
  const ring = [];
  const clientId = globalThis.crypto?.randomUUID?.()
    || `conversation-state-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const host = (message) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return Promise.reject(new Error('host_messaging_unavailable'));
    }
    return chrome.runtime.sendMessage(message).then((result) => {
      if (!result || result.ok === false) throw new Error((result && result.error) || 'DCF host rejected request');
      return result;
    });
  };

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }

  const composer = () => document.querySelector('#prompt-textarea')
    || document.querySelector('[data-testid="composer-text-input"]')
    || document.querySelector('form textarea')
    || document.querySelector('main [contenteditable="true"]');

  function composerValue(target) {
    return String(target ? ('value' in target ? target.value || '' : target.innerText || target.textContent || '') : '');
  }

  function sendButton() {
    return document.querySelector('[data-testid="send-button"]')
      || document.querySelector('button[aria-label*="Send"]')
      || document.querySelector('button[aria-label*="发送"]')
      || document.querySelector('form button[type="submit"]');
  }

  function projectInfo(pathname = location.pathname) {
    const match = String(pathname || '').match(/^\/g\/(g-p-[^/]+)\/(project|c\/[^/?#]+)/);
    if (!match) return { slug: '', projectPath: '', inProject: false, blank: false };
    return {
      slug: match[1],
      projectPath: `/g/${match[1]}/project`,
      inProject: true,
      blank: match[2] === 'project'
    };
  }

  function allTurns() {
    return [...document.querySelectorAll('section[data-testid^="conversation-turn-"]')];
  }

  function formalUsers() {
    return [...document.querySelectorAll('[data-message-author-role="user"][data-message-id]')];
  }

  function formalAssistants() {
    return [...document.querySelectorAll('[data-message-author-role="assistant"][data-message-id]')];
  }

  function textKind(text) {
    const value = normalizeText(text);
    if (TIMEOUT_TEXT.some((needle) => value === needle || value.startsWith(needle + '\n'))) return 'delivery_timeout';
    if (CONTEXT_LIMIT_TEXT.some((needle) => value === needle || value.includes(needle))) return 'context_limit';
    return '';
  }

  function candidateFromNode(node, turns = allTurns()) {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    if (!element || typeof element.closest !== 'function') return null;
    // Transcript prose can legitimately discuss timeout/context-limit words.
    // A formal user/assistant message is content, never a terminal UI signal.
    if (element.closest('[data-message-author-role]')) return null;
    const text = normalizeText(element.innerText || element.textContent || '');
    const kind = textKind(text);
    if (!kind) return null;
    const turn = element.closest('section[data-testid^="conversation-turn-"]');
    const turnIndex = turn ? turns.indexOf(turn) : -1;
    const laterUserTurn = turnIndex >= 0 && turns.slice(turnIndex + 1).some((candidate) =>
      !!candidate.querySelector('[data-message-author-role="user"][data-message-id]'));
    if (laterUserTurn) return null;
    return {
      kind, text: text.slice(0, 240),
      turnId: turn?.getAttribute('data-turn-id') || '',
      turnTestId: turn?.getAttribute('data-testid') || ''
    };
  }

  function terminalFromMutationRecords(records) {
    const turns = allTurns();
    for (let r = records.length - 1; r >= 0; r -= 1) {
      const record = records[r];
      const roots = record.type === 'characterData' ? [record.target] : [...(record.addedNodes || [])];
      for (let index = roots.length - 1; index >= 0; index -= 1) {
        const root = roots[index];
        const direct = candidateFromNode(root, turns);
        if (direct) return direct;
        const element = root?.nodeType === 1 ? root : null;
        if (!element?.querySelectorAll) continue;
        // Inspect only this changed subtree. Cap the walk so a giant historical
        // re-render cannot turn one mutation into a full-conversation scan.
        const descendants = [...element.querySelectorAll('div,p,span,button')].slice(-80);
        for (let i = descendants.length - 1; i >= 0; i -= 1) {
          const candidate = candidateFromNode(descendants[i], turns);
          if (candidate) return candidate;
        }
      }
    }
    return null;
  }

  function tailTerminalSurface() {
    const turns = allTurns();
    const recentTurns = turns.slice(-2);
    for (let t = recentTurns.length - 1; t >= 0; t -= 1) {
      const turn = recentTurns[t];
      const candidates = [turn, ...turn.querySelectorAll('div,p,span,button')].slice(-120);
      for (let i = candidates.length - 1; i >= 0; i -= 1) {
        const candidate = candidateFromNode(candidates[i], turns);
        if (candidate) return candidate;
      }
    }
    return null;
  }

  function terminalErrorSurface() {
    const turns = allTurns();
    if (latchedTerminal) {
      const turn = latchedTerminal.turnTestId
        ? document.querySelector(`section[data-testid="${latchedTerminal.turnTestId}"]`) : null;
      const turnIndex = turn ? turns.indexOf(turn) : -1;
      const laterUserTurn = turnIndex >= 0 && turns.slice(turnIndex + 1).some((candidate) =>
        !!candidate.querySelector('[data-message-author-role="user"][data-message-id]'));
      if (!laterUserTurn) return latchedTerminal;
      latchedTerminal = null;
    }
    let nodes = [];
    try { nodes = [...document.querySelectorAll(ERROR_SURFACES)]; } catch (_) {}
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const candidate = candidateFromNode(nodes[index], turns);
      if (candidate) return candidate;
    }
    return tailTerminalSurface();
  }

  function activeRequestId(turns) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.getAttribute('data-turn') !== 'assistant') continue;
      const id = String(turn.getAttribute('data-turn-id') || '');
      if (!id.startsWith('request-')) continue;
      const formal = turn.querySelector('[data-message-author-role="assistant"][data-message-id]');
      if (!formal) return id;
      const messageId = String(formal.getAttribute('data-message-id') || '');
      if (messageId.startsWith('request-placeholder-')) return id;
      return '';
    }
    return '';
  }

  function structuralHardCutoffCandidate() {
    const turns = allTurns();
    const turn = turns.at(-1);
    if (!turn || turn.getAttribute('data-turn') !== 'assistant') return null;
    const turnId = String(turn.getAttribute('data-turn-id') || '');
    if (!turnId.startsWith('request-')) return null;
    const formal = turn.querySelector('[data-message-author-role="assistant"][data-message-id]');
    if (formal) return null;
    if (turn.querySelector('[data-message-id^="request-placeholder-"]')) return null;
    const box = composer();
    if (!box || composerValue(box).trim()) return null;
    if (document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="停止"]')) return null;
    if (!normalizeText(turn.innerText || turn.textContent || '')) return null;
    return {
      kind: 'delivery_timeout',
      text: 'structural_unclosed_request',
      turnId,
      turnTestId: turn.getAttribute('data-testid') || ''
    };
  }

  function cancelCutoffConfirmation() {
    if (cutoffTimer) clearTimeout(cutoffTimer);
    cutoffTimer = null;
    cutoffCandidateId = '';
  }

  function reconcileCutoffConfirmation(value) {
    if (value.terminal_error || value.state !== 'active_request') {
      cancelCutoffConfirmation();
      return;
    }
    const candidate = structuralHardCutoffCandidate();
    if (!candidate) {
      cancelCutoffConfirmation();
      return;
    }
    if (cutoffTimer && cutoffCandidateId === candidate.turnId) return;
    cancelCutoffConfirmation();
    cutoffCandidateId = candidate.turnId;
    cutoffTimer = setTimeout(() => {
      cutoffTimer = null;
      const fresh = structuralHardCutoffCandidate();
      if (!fresh || fresh.turnId !== cutoffCandidateId) {
        cutoffCandidateId = '';
        return;
      }
      latchedTerminal = fresh;
      cutoffCandidateId = '';
      schedule('cutoff-confirmed');
    }, HARD_CUTOFF_GRACE_MS);
  }

  function sample() {
    const turns = allTurns();
    const users = formalUsers();
    const assistants = formalAssistants();
    const box = composer();
    const project = projectInfo();
    const error = terminalErrorSurface();
    const requestId = error?.turnId || activeRequestId(turns);
    const stop = !!document.querySelector(
      '[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="停止"]'
    );
    const projectBlank = project.blank && users.length === 0 && !!box;
    let state = 'idle';
    if (error?.kind === 'delivery_timeout') state = 'delivery_timeout';
    else if (error?.kind === 'context_limit') state = 'context_limit';
    else if (projectBlank) state = 'project_blank';
    else if (requestId || stop) state = 'active_request';
    else if (!box) state = 'no_composer';
    else if (composerValue(box).trim()) state = 'draft_present';
    return {
      state,
      client_id: clientId,
      conversation_path: location.pathname,
      project_slug: project.slug,
      request_id: requestId,
      last_user_message_id: users.at(-1)?.getAttribute('data-message-id') || '',
      last_assistant_message_id: assistants.at(-1)?.getAttribute('data-message-id') || '',
      composer: !!box,
      draft_len: composerValue(box).length,
      generating: state === 'active_request',
      visible: document.visibilityState === 'visible',
      terminal_error: error
    };
  }

  function fingerprint(value) {
    return [value.state, value.conversation_path, value.project_slug, value.request_id,
      value.last_user_message_id, value.terminal_error?.kind || ''].join('|');
  }

  function mark(value) {
    try {
      const root = document.documentElement;
      if (!root) return;
      root.dataset.dcfConversationState = value.state;
      root.dataset.dcfConversationVersion = UNIT_VERSION;
      root.dataset.dcfConversationAt = new Date().toISOString();
      root.dataset.dcfConversationEvaluations = String(evaluations);
      root.dataset.dcfConversationError = lastError.slice(0, 180);
    } catch (_) {}
  }

  function pushRing(value, reason) {
    ring.push({ at: new Date().toISOString(), state: value.state, reason,
      request_id: value.request_id, last_user_message_id: value.last_user_message_id });
    while (ring.length > RING) ring.shift();
  }

  async function fetchJson(url, body, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), cache: 'no-store', credentials: 'omit',
        redirect: 'error', signal: controller.signal
      });
      if (!response.ok) throw new Error(`continuity HTTP ${response.status}`);
      return response.json();
    } finally { clearTimeout(timer); }
  }

  function readPending() {
    try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (_) { return null; }
  }
  function writePending(value) {
    try {
      if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(PENDING_KEY);
    } catch (_) {}
  }

  function lastUserProof(message, incidentId = '') {
    const users = formalUsers();
    const target = normalizeText(message);
    const marker = incidentId ? `INCIDENT_ID: ${incidentId}` : '';
    for (let index = users.length - 1; index >= 0; index -= 1) {
      const candidate = normalizeText(users[index].innerText || users[index].textContent || '');
      // Long ChatGPT user turns may append UI chrome such as “展开” to
      // innerText.  The unique incident marker is the delivery identity; it is
      // stronger and more stable than full rendered-text equality.
      if (candidate === target || (marker && candidate.includes(marker))) {
        return { visible: true, id: users[index].getAttribute('data-message-id') || '' };
      }
    }
    return { visible: false, id: '' };
  }

  async function ackPending(pending, proof) {
    const result = await fetchJson(`${CONTINUITY_BASE}${encodeURIComponent(pending.incident_id)}/ack`, {
      client_id: clientId,
      conversation_path: location.pathname,
      visible_user_message_id: proof.id,
      message_sha256: pending.message_sha256
    });
    if (result?.ok) writePending(null);
    return result;
  }

  async function verifyPending() {
    const pending = readPending();
    if (!pending?.incident_id || !pending?.message) return false;
    const proof = lastUserProof(pending.message, pending.incident_id);
    if (!proof.visible || !proof.id) return false;
    await ackPending(pending, proof);
    return true;
  }

  function dispatchComposerEvents(target, text) {
    try { target.dispatchEvent(new Event('compositionstart', { bubbles: true })); } catch (_) {}
    try { target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text })); } catch (_) {}
    try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }
    catch (_) { target.dispatchEvent(new Event('input', { bubbles: true })); }
    try { target.dispatchEvent(new Event('compositionend', { bubbles: true })); } catch (_) {}
  }

  function setComposerText(target, text) {
    target.focus();
    if ('value' in target) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value');
      if (descriptor?.set) descriptor.set.call(target, text); else target.value = text;
      if (typeof target.setSelectionRange === 'function') target.setSelectionRange(text.length, text.length);
    } else target.textContent = text;
    dispatchComposerEvents(target, text);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function clickSend() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const button = sendButton();
      if (button && !button.disabled && button.getAttribute?.('aria-disabled') !== 'true') {
        button.click(); return;
      }
      await sleep(50);
    }
    throw new Error('continuity send button unavailable');
  }

  async function releaseUnstarted(action, reason) {
    const result = await fetchJson(`${CONTINUITY_BASE}${encodeURIComponent(action.incident_id)}/release`, {
      client_id: clientId, reason: String(reason || 'pre-send condition changed')
    });
    if (!result?.ok) throw new Error('continuity pre-send release rejected');
    // Do not schedule a timer retry here.  The next real DOM change (for
    // example the composer remounting) will re-evaluate the terminal surface.
    // Clearing the fingerprint merely allows that event to re-claim the same
    // durable incident.
    lastFingerprint = '';
    return result;
  }

  async function sendAction(action) {
    const requiredState = action.kind === 'same_chat_continue' ? 'delivery_timeout' : 'project_blank';
    let target;
    let existing;
    try {
      const value = sample();
      if (value.state !== requiredState) throw new Error(`continuity state changed: ${value.state}`);
      target = composer();
      if (!target) throw new Error('continuity composer missing');
      existing = normalizeText(composerValue(target));
      if (existing && existing !== normalizeText(action.message)) throw new Error('continuity composer contains foreign draft');
    } catch (error) {
      await releaseUnstarted(action, error?.message || error);
      throw error;
    }
    const pending = { incident_id: action.incident_id, message: action.message,
      message_sha256: action.message_sha256, kind: action.kind };
    writePending(pending);
    const already = lastUserProof(action.message, action.incident_id);
    if (already.visible) return ackPending(pending, already);
    if (!existing) setComposerText(target, action.message);
    await clickSend();
    actions += 1;
  }

  async function applyAction(action) {
    if (!action?.kind) return;
    if (action.kind === 'open_project_chat') {
      const next = String(action.project_path || '');
      if (!next || !next.startsWith('/g/')) throw new Error('invalid project continuity route');
      if (location.pathname !== next) location.assign(location.origin + next);
      return;
    }
    if (action.kind === 'verify_only') {
      await verifyPending();
      return;
    }
    if (action.kind === 'same_chat_continue' || action.kind === 'send_project_handoff') {
      await sendAction(action);
      return;
    }
    throw new Error(`unknown continuity action ${action.kind}`);
  }

  async function evaluate(reason) {
    if (destroyed || busy) return;
    busy = true; evaluations += 1;
    try {
      await verifyPending();
      const value = sample();
      lastState = value; mark(value);
      reconcileCutoffConfirmation(value);
      const nextFingerprint = fingerprint(value);
      const changed = nextFingerprint !== lastFingerprint;
      if (changed) { lastFingerprint = nextFingerprint; pushRing(value, reason); }
      if (!changed || !['delivery_timeout', 'context_limit', 'project_blank'].includes(value.state)) return;
      const result = await fetchJson(CONTINUITY, value);
      await applyAction(result?.action);
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
      if (lastState) mark(lastState);
    } finally { busy = false; }
  }

  function schedule(reason) {
    if (destroyed) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; evaluate(reason).catch(() => {}); }, DEBOUNCE_MS);
  }

  function destroy() {
    destroyed = true;
    clearTimeout(debounceTimer); debounceTimer = null;
    cancelCutoffConfirmation();
    observer?.disconnect?.(); observer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('popstate', onHistory);
  }
  function onVisibility() { schedule('visibilitychange'); }
  function onHistory() { schedule('history'); }

  observer = new MutationObserver((records) => {
    const terminal = terminalFromMutationRecords(records);
    if (terminal) latchedTerminal = terminal;
    schedule('mutation');
  });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('popstate', onHistory);

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION, destroy, evaluate, sample, projectInfo,
    diagnostics: () => ({ unit_id: UNIT_ID, version: UNIT_VERSION, last_error: lastError,
      evaluations, actions, current: lastState, transitions: ring.slice(-20), pending: readPending() })
  };

  schedule('initial');
  host({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION })
    .then(() => { try { document.documentElement.dataset.dcfConversationHandshake = 'ok'; } catch (_) {} })
    .catch((error) => { lastError = String(error?.message || error); });
})();
