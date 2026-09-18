(function () {
  'use strict';

  const UNIT_ID = 'dcf.firstparty.qoder-watch';
  const UNIT_VERSION = '1.0.0-rc.2-qoder-watch.12';
  const GLOBAL_KEY = '__DCF_FIRSTPARTY_QODER_WATCH__';
  const BASE_URL = 'http://127.0.0.1:4937';
  const POLL_MS = 1500;
  const USER_NODE_SELECTOR = '[data-message-author-role="user"]';

  // Delivery confirmation is decided from transcript content, never from a
  // mounted-node census. See TRANSCRIPT CONTRACT below.
  const CONFIRM_ATTEMPTS = 30;
  const CONFIRM_INTERVAL_MS = 500;

  // Reserved `KEY: value` markers that identify one logical re-entry event
  // independently of its transport id. A retry of the same terminal event
  // reuses the same continuation id, so these values are the dedupe identity.
  const IDENTITY_KEYS = ['CONTINUATION_ID', 'CONTINUATION-ID', 'continuation_id', 'EXPERIENCE_RUN_ID', 'EXPERIENCE_REF', 'task_id', 'TASK_ID'];
  // Keys that may follow an identity key inside the same re-entry payload.
  // They bound a captured value, so ordinary prose after an identity line
  // cannot be swallowed into it. Deliberately NOT full sentence keys such as
  // NEXT_ACTION, whose lower-case value could otherwise be mistaken for a
  // second identity marker.
  const PAYLOAD_MARKERS = [
    'CONTINUATION_ID', 'CONTINUATION-ID', 'continuation_id', 'EXPERIENCE_RUN_ID', 'EXPERIENCE_REF', 'task_id', 'TASK_ID',
    'result_status', 'delivery_status', 'delivery_ref', 'narrative_debt_id',
    'narrative_checkpoint_ref', 'evidence_ref', 'final_path'
  ];
  const escapedMarkers = PAYLOAD_MARKERS
    .map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  // `CONTINUATION_ID` is the primary identity marker. Its value ends at the
  // next newline or at the start of the next recognised payload key, so a
  // transcript that lost its line structure still yields the exact value.
  const identityPattern = new RegExp(`(?:^|\\s)(${IDENTITY_KEYS.join('|')})\\s*:\\s*(.+?)(?=\\n|\\s+(?:${escapedMarkers})\\s*:|$)`);

  globalThis[GLOBAL_KEY]?.destroy?.();

  let destroyed = false;
  let timer = null;
  let busy = false;
  let visibilityListener = null;
  let lastError = '';
  const clientId = globalThis.crypto?.randomUUID?.() || `qoder-watch-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const host = (message) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return Promise.reject(new Error('host_messaging_unavailable'));
    }
    return chrome.runtime.sendMessage(message).then((result) => {
      if (!result || result.ok === false) throw new Error(result?.error || 'DCF host rejected request');
      return result;
    });
  };

  const composer = () => document.querySelector('#prompt-textarea')
    || document.querySelector('[data-testid="composer-text-input"]')
    || document.querySelector('form textarea')
    || document.querySelector('main [contenteditable="true"]');

  function composerValue(target) {
    return String(target ? ('value' in target ? target.value || '' : target.innerText || target.textContent || '') : '');
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isStreaming() {
    if (document.querySelector(
      '[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="停止"]'
    )) return true;

    // Tool/thinking phases may temporarily replace Stop with Send even though
    // the same request is still active.  A tail assistant segment without a
    // real assistant message (or with a client request placeholder) is not an
    // idle conversation and must never be interrupted by automatic re-entry.
    const assistantTurns = document.querySelectorAll(
      'section[data-turn="assistant"][data-turn-id]'
    );
    const tail = assistantTurns[assistantTurns.length - 1];
    if (!tail) return false;
    const formal = tail.querySelector('[data-message-author-role="assistant"]');
    if (!formal) return true;
    const messageId = String(formal.getAttribute?.('data-message-id') || formal.dataset?.messageId || '');
    return messageId.startsWith('request-placeholder-');
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
      if (descriptor?.set) descriptor.set.call(target, text);
      else target.value = text;
      if (typeof target.setSelectionRange === 'function') target.setSelectionRange(text.length, text.length);
      dispatchComposerEvents(target, text);
      return;
    }
    target.textContent = text;
    dispatchComposerEvents(target, text);
  }

  function sendButton() {
    return document.querySelector('[data-testid="send-button"]')
      || document.querySelector('button[aria-label*="Send"]')
      || document.querySelector('button[aria-label*="发送"]')
      || document.querySelector('form button[type="submit"]');
  }

  // Streaming is a *blocked* state, not a slow one: ChatGPT will not accept a
  // submission while a reply is generating, so waiting it out here would hold
  // the lease and hide the real fault. Fail immediately and let the adapter
  // retry once the page is eligible again.
  async function clickSend() {
    if (isStreaming()) throw new Error('ChatGPT is streaming; refusing to submit');
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const button = sendButton();
      if (!isStreaming() && button && !button.disabled && button.getAttribute?.('aria-disabled') !== 'true') {
        button.click();
        return;
      }
      await sleep(50);
    }
    throw new Error('ChatGPT send button unavailable after composer fill');
  }

  // ---------------------------------------------------------------------
  // TRANSCRIPT CONTRACT
  //
  // ChatGPT virtualizes and recycles conversation turns: an old user node is
  // unmounted and reused for the new message. The number of mounted
  // `[data-message-author-role="user"]` nodes can therefore stay exactly the
  // same while a new message is genuinely visible, and it can also rise for
  // reasons unrelated to us (the turn window revealing hidden history).
  //
  // So the mounted count is NOT evidence of delivery in either direction.
  // Delivery is decided only from transcript text:
  //   - exact match after whitespace normalization, or
  //   - a reserved identity line (`CONTINUATION_ID: ...`) of the message,
  //     which survives retries of the same logical event.
  // Both are falsifiable: if neither is present, delivery is NOT proven and
  // the event must stay unacked so a retry can still recover it.
  // ---------------------------------------------------------------------

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }

  function identityAnchors(text) {
    const normalized = normalizeText(text);
    const anchors = [];
    if (!normalized) return anchors;
    // Scan the whole text rather than line by line: ChatGPT may re-render or
    // collapse the submitted newlines, and a transcript that lost its line
    // structure must still yield the identity.
    const match = identityPattern.exec(normalized);
    if (!match) return anchors;
    const value = normalizeText(match[2]);
    if (value) anchors.push(value);
    return anchors;
  }

  function readUserTranscript() {
    let nodes;
    try {
      nodes = Array.from(document.querySelectorAll(USER_NODE_SELECTOR));
    } catch (_) {
      return { mounted: 0, texts: [], read_error: 'user_node_query_failed' };
    }
    return {
      mounted: nodes.length,
      texts: nodes.map((node) => {
        try {
          return normalizeText(node?.innerText || node?.textContent || '');
        } catch (_) {
          return '';
        }
      })
    };
  }

  function matchUserText(target, candidates) {
    if (!target || !Array.isArray(candidates)) return { matched: false, reason: 'empty_target' };
    const strictIndex = candidates.indexOf(target);
    if (strictIndex >= 0) {
      return { matched: true, level: 'exact', matched_index: strictIndex, matched_value: target };
    }
    const anchors = identityAnchors(target);
    if (!anchors.length) return { matched: false, reason: 'no_identity_anchor' };
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (!candidate) continue;
      for (const anchor of anchors) {
        if (candidate.includes(anchor)) {
          return { matched: true, level: 'identity', matched_index: index, matched_value: anchor };
        }
      }
    }
    return { matched: false, reason: 'identity_absent', anchors: anchors.length };
  }

  // Read-only probe. Never used to decide delivery on its own: a false result
  // after a click says nothing, because the reentered turn may not have mounted
  // yet. A true result IS conclusive, because the running transcript cannot
  // contain this message unless it is visible in the conversation.
  function inspectTranscript(message) {
    const snapshot = readUserTranscript();
    const target = normalizeText(message);
    const match = matchUserText(target, snapshot.texts);
    return {
      visible: match.matched === true,
      level: match.level || 'none',
      reason: match.reason || '',
      mounted: snapshot.mounted,
      read_error: snapshot.read_error || ''
    };
  }

  async function verifyDelivery(message) {
    const attempts = [];
    let last = null;
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
      // Immediate first read: when the transcript already carries the message
      // (a reclaim whose earlier send succeeded) it costs nothing to look now.
      if (attempt > 0) await sleep(CONFIRM_INTERVAL_MS);
      last = inspectTranscript(message);
      attempts.push({ attempt, mounted: last.mounted, level: last.level, matched: last.visible });
      if (last.visible) return { confirmed: true, proof: 'transcript_text', detail: last, attempts: attempts.length };
    }
    return { confirmed: false, proof: 'none', detail: last || { mounted: null, level: 'none' }, attempts: attempts.length };
  }

  // Returns the events that carry the delivery identity for this event. The
  // message text is the identity: it is byte-identical across retries of the
  // same logical re-entry event, and it is what a duplicate would duplicate.
  function deliveryIdentity(event) {
    const text = String(event?.message ?? '');
    const anchors = identityAnchors(text);
    return { event_id: String(event?.id ?? ''), text_length: text.length, identity_anchors: anchors, has_identity_anchor: anchors.length > 0 };
  }

  function guardComposer(target, text) {
    if (!target) throw new Error('ChatGPT composer not found');
    const existing = composerValue(target).trim();
    if (!existing) return { empty: true, same_event_text: false };
    if (normalizeText(existing) === normalizeText(text)) {
      return { empty: false, same_event_text: true };
    }
    throw new Error('composer contains an existing draft');
  }

  async function sendText(event) {
    const text = String(event.message);
    const identity = deliveryIdentity(event);
    const target = composer();

    // Idempotency gate, checked before anything touches the composer. The 4937
    // adapter re-claims an event whose ACK was lost, and this page may itself
    // still hold the message from an earlier attempt. Either way: if this
    // message is already visible, ACK it and never click send a second time.
    // A foreign draft is irrelevant here, because nothing is typed.
    const already = inspectTranscript(text);
    // The transport can also already know the message is visible (it observed a
    // delivery whose ACK was lost). That knowledge wins over this page's own
    // transcript reading, because ChatGPT recycles turn nodes and a missing
    // node is not proof of absence. Only the explicit flag means "already
    // visible": `deliver: false` is also used for "do not deliver yet, first
    // establish what is on the page", which the verify_visible branch handles.
    const transportSaysVisible = event.already_visible === true;
    if (already.visible || transportSaysVisible) {
      await observeTransport(event.id, 'delivery_already_visible', {
        ...identity,
        proof: already.visible ? 'transcript_text' : 'transport_lifecycle',
        level: already.level,
        mounted_user_nodes: already.mounted,
        transport_state: event.state || '',
        transport_visible_at: event.visible_at || null,
        acked_without_send: true
      });
      return;
    }

    // Re-check eligibility after claim and before mutating the composer. The
    // page can begin streaming between heartbeat/claim and delivery. Never
    // stage our text into a composer that cannot be submitted yet.
    if (isStreaming()) {
      const error = new Error('ChatGPT is streaming; refusing to stage re-entry text');
      await observeTransport(event.id, 'delivery_failed', {
        ...identity,
        error: error.message,
        composer_draft_chars: composerValue(target).trim().length,
        mounted_user_nodes: readUserTranscript().mounted
      });
      throw error;
    }

    let composerGuard;
    try {
      composerGuard = guardComposer(target, text);
    } catch (error) {
      // A page-side blocker must reach the adapter by name; leaving it in this
      // page's JS state is what made the first generation unobservable.
      await observeTransport(event.id, 'delivery_failed', {
        ...identity,
        error: String(error?.message || error),
        composer_draft_chars: composerValue(composer()).trim().length,
        mounted_user_nodes: readUserTranscript().mounted
      });
      throw error;
    }

    // The transport may ask this page to establish whether an earlier click
    // actually produced a message. Only the transcript can answer that here: a
    // true result is conclusive and must never be re-sent, a false result means
    // nothing was delivered yet and the normal send path may proceed.
    if (event.verify_visible === true) {
      const verdict = await verifyDelivery(text);
      if (verdict.confirmed) {
        await observeTransport(event.id, 'delivery_observed', {
          ...identity,
          proof: 'transcript_text',
          level: verdict.detail?.level || '',
          confirm_attempts: verdict.attempts,
          mounted_user_nodes: verdict.detail?.mounted ?? null,
          recovered_from: 'send_unconfirmed'
        });
        return;
      }
      await observeTransport(event.id, 'delivery_absent', {
        ...identity,
        mounted_user_nodes: readUserTranscript().mounted,
        confirm_attempts: verdict.attempts
      });
    }

    await observeTransport(event.id, 'send_attempt', { ...identity, mounted_user_nodes: already.mounted });
    try {
      // If a previous attempt staged this same logical message but could not
      // click Send, resume from that state. Do not rewrite the editor and do
      // not confuse harmless DOM whitespace normalization with a user draft.
      if (!composerGuard?.same_event_text) setComposerText(target, text);
      await clickSend();
      await observeTransport(event.id, 'send_clicked', { ...identity, mounted_user_nodes: readUserTranscript().mounted });
      const verdict = await verifyDelivery(text);
      if (!verdict.confirmed) {
        throw new Error(`ChatGPT delivery not confirmed (${verdict.proof})`);
      }
      await observeTransport(event.id, 'delivery_observed', {
        ...identity,
        proof: verdict.proof,
        level: verdict.detail?.level || '',
        confirm_attempts: verdict.attempts,
        mounted_user_nodes: verdict.detail?.mounted ?? null
      });
    } catch (error) {
      await observeTransport(event.id, 'delivery_failed', {
        ...identity,
        error: String(error?.message || error),
        mounted_user_nodes: readUserTranscript().mounted,
        confirmation: inspectTranscript(text)
      });
      throw error;
    }
  }
  async function request(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: options.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error'
    });
    if (!response.ok) throw new Error(`Qoder watch HTTP ${response.status}`);
    return response.json();
  }

  async function observeTransport(eventId, phase, details = {}) {
    try {
      return await request(`/events/${encodeURIComponent(eventId)}/observe`, {
        method: 'POST',
        body: { client_id: clientId, conversation_path: location.pathname || '/', phase, details }
      });
    } catch (_) {
      return null;
    }
  }

  // Page health. The adapter must be able to answer "is there an eligible
  // client, in which conversation, and is it blocked by streaming / a foreign
  // draft / a missing composer" without anyone reading this page's JS state.
  function pageHealth() {
    const target = composer();
    const streaming = isStreaming();
    return {
      conversation_path: location.pathname || '/',
      visible: document.visibilityState === 'visible',
      eligible: !!target && !streaming,
      streaming,
      composer: !!target,
      draft_chars: composerValue(target).trim().length,
      last_error: lastError
    };
  }

  async function reportHealth() {
    const health = pageHealth();
    try {
      return await request('/clients/heartbeat', {
        method: 'POST',
        body: { client_id: clientId, ...health }
      });
    } catch (_) {
      return null;
    }
  }

  async function pollNow() {
    if (destroyed || busy) return;
    busy = true;
    try {
      const health = pageHealth();
      // A streaming ChatGPT page cannot accept a new turn. Do not lease work
      // only to fail it milliseconds later; report health and wait locally.
      if (health.streaming) {
        lastError = '';
        await reportHealth();
        return;
      }
      const query = `?client_id=${encodeURIComponent(clientId)}`
        + `&visible=${health.visible ? 1 : 0}`
        + `&eligible=${health.eligible ? 1 : 0}`
        + `&conversation_path=${encodeURIComponent(health.conversation_path)}`
        + `&streaming=${health.streaming ? 1 : 0}`
        + `&composer=${health.composer ? 1 : 0}`
        + `&last_error=${encodeURIComponent(health.last_error || '')}`;
      const result = await request(`/events/claim${query}`);
      const event = result?.event;
      if (!event || event.type !== 'complete' || !event.id || !event.message) {
        lastError = '';
        return;
      }
      await observeTransport(event.id, 'claim_received', { lease_until: event.lease_until || 0 });
      await sendText(event);
      await observeTransport(event.id, 'ack_attempt');
      let ack;
      try {
        ack = await request(`/events/${encodeURIComponent(event.id)}/ack`, {
          method: 'POST',
          body: { client_id: clientId, conversation_path: location.pathname || '/' }
        });
      } catch (error) {
        await observeTransport(event.id, 'ack_failed', { error: String(error?.message || error) });
        throw error;
      }
      if (!ack?.ok) {
        await observeTransport(event.id, 'ack_failed', { error: 'Qoder watch ACK rejected' });
        throw new Error('Qoder watch ACK rejected');
      }
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
      await reportHealth();
    } finally {
      busy = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (destroyed) return;
    timer = setTimeout(async () => {
      await pollNow();
      schedule();
    }, POLL_MS);
  }

  function destroy() {
    destroyed = true;
    clearTimeout(timer);
    timer = null;
    if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
  }

  globalThis[GLOBAL_KEY] = {
    version: UNIT_VERSION,
    destroy,
    pollNow,
    diagnostics: () => ({ client_id: clientId, busy, last_error: lastError, visible: document.visibilityState === 'visible' }),
    // Pure functions over transcript text. Exposed so the delivery-identity
    // rules can be unit-tested without a live ChatGPT page.
    transcript: { normalizeText, identityAnchors, matchUserText, inspectTranscript, isStreaming }
  };

  visibilityListener = () => {
    pollNow().catch(() => {});
  };
  document.addEventListener('visibilitychange', visibilityListener);
  schedule();
  host({ type: 'unit.started', unit_id: UNIT_ID, version: UNIT_VERSION }).catch(() => {});
})();
