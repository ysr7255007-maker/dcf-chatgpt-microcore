/**
 * DCF Surface - Voice Command Bar (Phase 4.2, Voice-first)
 *
 * Shared overlay component for all three lens views. Summoned with
 * Cmd/Ctrl+Space (plan spec) or Cmd/Ctrl+K; listens via the Web Speech API
 * when available and always offers a text input fallback so the command
 * palette works without microphone permissions.
 *
 * Command map (plan 4.2):
 *   '暂停记录'     -> Companion boundary NOT_OBSERVE (privacy pause)
 *   '查看今天对话' -> switchView('task')
 *   '标记为任务'   -> accept the first recommended item
 *   '打开探索图谱' -> switchView('exploration')
 *   '本周回顾'     -> switchView('reflection')
 *
 * Zero runtime npm dependencies; styles and DOM are self-injected.
 */

(function (global) {
  'use strict';

  var CSS = [
    '.vcb-overlay { position: fixed; inset: 0; background: rgba(15, 18, 28, 0.45);',
    '  backdrop-filter: blur(6px); z-index: 2000; display: none;',
    '  align-items: flex-start; justify-content: center; padding-top: 18vh; }',
    '.vcb-overlay.open { display: flex; }',
    '.vcb-panel { width: min(480px, 90vw); border-radius: 16px; overflow: hidden;',
    '  background: rgba(255, 255, 255, 0.96); color: #1a1a2e;',
    '  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35); animation: vcb-pop 0.18s ease; }',
    '@keyframes vcb-pop { from { opacity: 0; transform: scale(0.97) translateY(-8px); }',
    '  to { opacity: 1; transform: scale(1) translateY(0); } }',
    '.vcb-input-row { display: flex; align-items: center; gap: 10px; padding: 14px 16px;',
    '  border-bottom: 1px solid rgba(0, 0, 0, 0.08); }',
    '.vcb-mic { width: 36px; height: 36px; border-radius: 50%; border: none; cursor: pointer;',
    '  font-size: 17px; background: rgba(64, 100, 210, 0.12); transition: all 0.2s ease; }',
    '.vcb-mic.listening { background: linear-gradient(135deg, #4064d2, #8b5cf6); color: #fff;',
    '  animation: vcb-pulse 1.2s ease-in-out infinite; }',
    '@keyframes vcb-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(64, 100, 210, 0.45); }',
    '  50% { box-shadow: 0 0 0 10px rgba(64, 100, 210, 0); } }',
    '.vcb-text { flex: 1; border: none; outline: none; font-size: 15px; background: transparent;',
    '  color: inherit; font-family: inherit; }',
    '.vcb-hint { padding: 6px 16px; font-size: 12px; color: #6b7280; }',
    '.vcb-list { list-style: none; margin: 0; padding: 6px; max-height: 40vh; overflow-y: auto; }',
    '.vcb-list li { padding: 10px 12px; border-radius: 10px; font-size: 14px; cursor: pointer;',
    '  display: flex; justify-content: space-between; align-items: center; }',
    '.vcb-list li:hover, .vcb-list li.active { background: rgba(64, 100, 210, 0.1); }',
    '.vcb-list li .vcb-desc { font-size: 12px; color: #6b7280; }',
    '.vcb-status { padding: 10px 16px; font-size: 13px; color: #4064d2; min-height: 20px; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .vcb-panel { animation: none; } .vcb-mic.listening { animation: none; } }'
  ].join('\n');

  /** Registered commands: phrase -> { desc, run }. Views may extend via registerCommand. */
  var COMMANDS = [];

  function registerCommand(phrases, desc, run) {
    COMMANDS.push({ phrases: phrases, desc: desc, run: run });
  }

  function client() { return global.CompanionClient; }

  function doSwitchView(viewName) {
    if (typeof global.switchView === 'function') { global.switchView(viewName); return; }
    if (global.dcfBridge && typeof global.dcfBridge.switchView === 'function') {
      global.dcfBridge.switchView(viewName);
    } else {
      global.location.href = '../' + viewName + '/index.html';
    }
  }

  // -- Built-in command map (plan 4.2) --------------------------------------

  registerCommand(['暂停记录', 'pause recording'], '隐私边界：当前来源不再被观察', function (bar) {
    if (!client()) { bar.setStatus('Companion client 未加载'); return; }
    return client().rpc('POST', '/rpc/boundary/update', {
      source_id: 'surface-voice-command',
      boundary_state: 'NOT_OBSERVE'
    }).then(function (res) {
      bar.setStatus(res.ok ? '✅ 已暂停记录（NOT_OBSERVE）' : '⚠️ 设置失败：' + describe(res));
    });
  });

  registerCommand(['查看今天对话', '查看任务', 'show tasks'], '切换到任务视图', function (bar) {
    bar.close();
    doSwitchView('task');
  });

  registerCommand(['标记为任务', 'mark as task'], '接受最新一条推荐为任务', function (bar) {
    if (!client()) { bar.setStatus('Companion client 未加载'); return; }
    return client().getTasks({ status: 'recommended', limit: 1 }).then(function (res) {
      var items = (res.ok && res.body && (res.body.data || res.body.tasks)) || [];
      if (!items.length) { bar.setStatus('当前没有待接受的推荐'); return; }
      return client().acceptRecommendation(items[0].id).then(function (r2) {
        bar.setStatus(r2.ok ? '✅ 已标记为任务：' + (items[0].title || items[0].id)
                            : '⚠️ 接受失败：' + describe(r2));
      });
    });
  });

  registerCommand(['打开探索图谱', '探索图谱', 'open graph'], '切换到探索视图', function (bar) {
    bar.close();
    doSwitchView('exploration');
  });

  registerCommand(['本周回顾', '打开周报', 'weekly digest'], '切换到反思视图', function (bar) {
    bar.close();
    doSwitchView('reflection');
  });

  function describe(res) {
    if (!res) return 'unknown';
    if (res.body && res.body.message) return String(res.body.message);
    if (res.body && res.body.error) {
      var e = res.body.error;
      return typeof e === 'string' ? e : (e.message || JSON.stringify(e));
    }
    return 'HTTP ' + res.status;
  }

  // -- Voice Command Bar ------------------------------------------------------

  function VoiceCommandBar() {
    this.recognition = null;
    this.listening = false;
    this.activeIndex = -1;
    this.buildDom();
    this.bindKeys();
  }

  VoiceCommandBar.prototype.buildDom = function () {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.overlay = document.createElement('div');
    this.overlay.className = 'vcb-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', '语音命令');

    var panel = document.createElement('div');
    panel.className = 'vcb-panel';

    var row = document.createElement('div');
    row.className = 'vcb-input-row';

    this.micBtn = document.createElement('button');
    this.micBtn.className = 'vcb-mic';
    this.micBtn.textContent = '🎤';
    this.micBtn.setAttribute('aria-label', '开始/停止语音识别');

    this.input = document.createElement('input');
    this.input.className = 'vcb-text';
    this.input.type = 'text';
    this.input.placeholder = '说出或输入命令，如「暂停记录」…';
    this.input.setAttribute('aria-label', '命令输入');

    row.appendChild(this.micBtn);
    row.appendChild(this.input);

    var hint = document.createElement('div');
    hint.className = 'vcb-hint';
    hint.textContent = 'Enter 执行 · ↑↓ 选择 · Esc 关闭 · Cmd/Ctrl+Space 唤起';

    this.list = document.createElement('ul');
    this.list.className = 'vcb-list';
    this.list.setAttribute('role', 'listbox');

    this.status = document.createElement('div');
    this.status.className = 'vcb-status';
    this.status.setAttribute('aria-live', 'polite');

    panel.appendChild(row);
    panel.appendChild(hint);
    panel.appendChild(this.list);
    panel.appendChild(this.status);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    var self = this;
    this.overlay.addEventListener('click', function (e) {
      if (e.target === self.overlay) self.close();
    });
    this.micBtn.addEventListener('click', function () { self.toggleListening(); });
    this.input.addEventListener('input', function () { self.renderList(self.input.value); });
    this.renderList('');
  };

  VoiceCommandBar.prototype.bindKeys = function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      var meta = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl+Space (plan spec) or Cmd/Ctrl+K summons the bar.
      if (meta && (e.key === ' ' || e.code === 'Space' || e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        self.isOpen() ? self.close() : self.open();
        return;
      }
      if (!self.isOpen()) return;

      if (e.key === 'Escape') { e.preventDefault(); self.close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); self.moveActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); self.moveActive(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); self.executeActive(); }
    });
  };

  VoiceCommandBar.prototype.isOpen = function () {
    return this.overlay.classList.contains('open');
  };

  VoiceCommandBar.prototype.open = function () {
    this.overlay.classList.add('open');
    this.setStatus('');
    this.input.value = '';
    this.renderList('');
    this.input.focus();
  };

  VoiceCommandBar.prototype.close = function () {
    this.overlay.classList.remove('open');
    this.stopListening();
  };

  VoiceCommandBar.prototype.setStatus = function (text) {
    this.status.textContent = text || '';
  };

  /** Filter + render the command list; first match becomes active. */
  VoiceCommandBar.prototype.renderList = function (query) {
    var self = this;
    var q = (query || '').trim().toLowerCase();
    this.list.textContent = '';
    this.matches = COMMANDS.filter(function (cmd) {
      if (!q) return true;
      return cmd.phrases.some(function (p) { return p.toLowerCase().indexOf(q) !== -1; }) ||
             cmd.desc.toLowerCase().indexOf(q) !== -1;
    });
    this.activeIndex = this.matches.length ? 0 : -1;

    this.matches.forEach(function (cmd, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      if (i === self.activeIndex) li.classList.add('active');
      var name = document.createElement('span');
      name.textContent = '「' + cmd.phrases[0] + '」';
      var desc = document.createElement('span');
      desc.className = 'vcb-desc';
      desc.textContent = cmd.desc;
      li.appendChild(name);
      li.appendChild(desc);
      li.addEventListener('click', function () { self.execute(cmd); });
      self.list.appendChild(li);
    });
  };

  VoiceCommandBar.prototype.moveActive = function (delta) {
    if (!this.matches || !this.matches.length) return;
    this.activeIndex = (this.activeIndex + delta + this.matches.length) % this.matches.length;
    var items = this.list.children;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === this.activeIndex);
    }
  };

  VoiceCommandBar.prototype.executeActive = function () {
    if (this.activeIndex >= 0 && this.matches[this.activeIndex]) {
      this.execute(this.matches[this.activeIndex]);
    }
  };

  VoiceCommandBar.prototype.execute = function (cmd) {
    this.setStatus('⏳ 执行「' + cmd.phrases[0] + '」…');
    var result = cmd.run(this);
    if (!(result && typeof result.then === 'function')) {
      // Sync commands (view switches) report immediately.
      if (this.isOpen()) this.setStatus('✅ 已执行「' + cmd.phrases[0] + '」');
    }
  };

  /** Fuzzy-match a transcript against the command map and execute best hit. */
  VoiceCommandBar.prototype.handleTranscript = function (transcript) {
    var text = (transcript || '').trim();
    this.input.value = text;
    this.renderList(text);
    var lower = text.toLowerCase();
    var hit = null;
    COMMANDS.forEach(function (cmd) {
      if (hit) return;
      cmd.phrases.forEach(function (p) {
        if (hit) return;
        var pl = p.toLowerCase();
        if (lower.indexOf(pl) !== -1 || pl.indexOf(lower) !== -1) hit = cmd;
      });
    });
    if (hit) this.execute(hit);
    else this.setStatus('🤔 未识别命令：「' + text + '」— 可在上方列表中选择');
  };

  // -- Web Speech API (graceful degradation) --------------------------------

  VoiceCommandBar.prototype.toggleListening = function () {
    if (this.listening) { this.stopListening(); return; }
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) {
      this.setStatus('当前环境不支持语音识别 — 请直接输入命令');
      this.input.focus();
      return;
    }
    var self = this;
    this.recognition = new SR();
    this.recognition.lang = 'zh-CN';
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;
    this.recognition.onresult = function (event) {
      var transcript = event.results[0][0].transcript;
      self.stopListening();
      self.handleTranscript(transcript);
    };
    this.recognition.onerror = function (event) {
      self.stopListening();
      self.setStatus('语音识别失败：' + (event.error || 'unknown') + ' — 请直接输入命令');
    };
    this.recognition.onend = function () { self.stopListening(); };
    this.recognition.start();
    this.listening = true;
    this.micBtn.classList.add('listening');
    this.setStatus('🎧 正在聆听…');
  };

  VoiceCommandBar.prototype.stopListening = function () {
    if (this.recognition) {
      try { this.recognition.stop(); } catch (_) { /* already stopped */ }
      this.recognition = null;
    }
    this.listening = false;
    this.micBtn.classList.remove('listening');
  };

  // -- Bootstrap ---------------------------------------------------------------

  var instance = null;
  function init() {
    if (!instance) instance = new VoiceCommandBar();
    return instance;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.DCFVoiceCommandBar = {
    open: function () { init().open(); },
    close: function () { if (instance) instance.close(); },
    registerCommand: registerCommand
  };
})(typeof window !== 'undefined' ? window : this);
