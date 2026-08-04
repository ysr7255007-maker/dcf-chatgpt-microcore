/**
 * DCF Surface - Reflection View (Lens 3) Weekly Digest Feed
 *
 * Spotify-Wrapped-style weekly reflection: stats, topic distribution,
 * key decisions, sentiment trend and highlight snippets, fetched from
 * the Companion weekly digest projection (/rpc/projection/weekly-digest).
 *
 * Zero runtime npm dependencies; topic distribution is rendered as
 * animated horizontal bars (no chart library required).
 */

(function (global) {
  'use strict';

  var SENTIMENT_EMOJI = { positive: '😊 积极', neutral: '😐 平稳', negative: '😟 低落' };

  /**
   * @param {Object} client - CompanionClient facade.
   */
  function ReflectionFeed(client) {
    this.client = client;
    this.currentWeek = getISOWeek(new Date());
  }

  /** Load and render the digest for the given ISO week (e.g. "2024-W30"). */
  ReflectionFeed.prototype.loadWeeklyDigest = function (week) {
    var self = this;
    this.currentWeek = week || this.currentWeek;
    this.updateWeekLabel();
    this.renderLoading();

    return this.client.getWeeklyDigest({ week: this.currentWeek }).then(function (res) {
      if (!res.ok || !res.body || res.body.ok === false) {
        self.renderEmpty('📡', 'Companion 未连接：' + describeError(res));
        return;
      }
      var digest = res.body.data || res.body;
      if (!digest || !digest.week) {
        self.renderEmpty('🌙', '这一周还没有周报 — 继续对话，周日凌晨自动生成');
        return;
      }
      self.render(digest);
    });
  };

  ReflectionFeed.prototype.updateWeekLabel = function () {
    var label = document.getElementById('current-week-label');
    if (label) label.textContent = this.currentWeek;
  };

  ReflectionFeed.prototype.renderLoading = function () {
    var root = document.getElementById('digest-root');
    root.textContent = '';
    root.appendChild(buildEmptyState('⏳', '正在生成回顾…'));
  };

  ReflectionFeed.prototype.renderEmpty = function (icon, text) {
    var root = document.getElementById('digest-root');
    root.textContent = '';
    root.appendChild(buildEmptyState(icon, text));
  };

  /** Render the full digest feed. */
  ReflectionFeed.prototype.render = function (digest) {
    var root = document.getElementById('digest-root');
    root.textContent = '';

    root.appendChild(this.buildHeaderCard(digest));
    if (digest.topics && digest.topics.length) {
      root.appendChild(this.buildTopicsCard(digest.topics));
    }
    if (digest.keyDecisions && digest.keyDecisions.length) {
      root.appendChild(this.buildDecisionsCard(digest.keyDecisions));
    }
    if (digest.highlights && digest.highlights.length) {
      root.appendChild(this.buildHighlightsCard(digest.highlights));
    }
    root.appendChild(this.buildActionsCard(digest));
  };

  /** Header card: title + stat chips (messages / top topic / sentiment). */
  ReflectionFeed.prototype.buildHeaderCard = function (digest) {
    var card = el('div', 'card');
    card.appendChild(el('div', 'digest-title', '📅 本周回顾'));
    card.appendChild(el('div', 'digest-week', digest.week));

    var stats = el('div', 'stats-row');
    var topTopic = (digest.topics && digest.topics[0] && digest.topics[0].name) || '—';
    stats.appendChild(buildStatChip(String(digest.totalMessages || 0), '轮消息'));
    stats.appendChild(buildStatChip(topTopic, '主要话题'));
    stats.appendChild(buildStatChip(SENTIMENT_EMOJI[digest.sentimentTrend] || '—', '情感趋势'));
    card.appendChild(stats);
    return card;
  };

  /** Topic distribution card with animated percentage bars. */
  ReflectionFeed.prototype.buildTopicsCard = function (topics) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, '🧩 话题分布'));

    topics.forEach(function (topic) {
      var bar = el('div', 'topic-bar');
      var row = el('div', 'row');
      row.appendChild(el('span', null, topic.name));
      row.appendChild(el('span', null, Math.round(topic.percentage || 0) + '%'));
      bar.appendChild(row);

      var track = el('div', 'track');
      var fill = el('div', 'fill');
      track.appendChild(fill);
      bar.appendChild(track);
      card.appendChild(bar);

      // Animate after insertion so the CSS transition fires.
      global.requestAnimationFrame(function () {
        global.requestAnimationFrame(function () {
          fill.style.width = Math.min(100, Math.max(0, topic.percentage || 0)) + '%';
        });
      });
    });
    return card;
  };

  /** Key decisions extracted by the Companion. */
  ReflectionFeed.prototype.buildDecisionsCard = function (decisions) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, '🎯 关键决策'));
    var list = el('ul', 'decision-list');
    decisions.forEach(function (d) {
      list.appendChild(el('li', null, String(d)));
    });
    card.appendChild(list);
    return card;
  };

  /** Highlight snippets with context. */
  ReflectionFeed.prototype.buildHighlightsCard = function (highlights) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, '✨ 高光时刻'));
    highlights.forEach(function (h) {
      var item = el('div', 'highlight-item');
      item.appendChild(el('div', 'snippet', '「' + String(h.snippet || '') + '」'));
      if (h.context) item.appendChild(el('div', 'context', String(h.context)));
      card.appendChild(item);
    });
    return card;
  };

  /** Footer actions: full report + share. */
  ReflectionFeed.prototype.buildActionsCard = function (digest) {
    var self = this;
    var card = el('div', 'card digest-actions');

    var fullBtn = el('button', 'btn-primary', '查看完整报告');
    fullBtn.addEventListener('click', function () { self.openFullReport(digest); });

    var shareBtn = el('button', 'btn-secondary', '复制分享文本');
    shareBtn.addEventListener('click', function () { self.shareDigest(digest); });

    card.appendChild(fullBtn);
    card.appendChild(shareBtn);
    return card;
  };

  /** Export the digest as a local text file (local-first; no upload). */
  ReflectionFeed.prototype.openFullReport = function (digest) {
    var text = buildShareText(digest, true);
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'dcf-weekly-digest-' + digest.week + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showFeedback('已导出完整周报');
  };

  /** Copy a share-friendly summary to the clipboard. */
  ReflectionFeed.prototype.shareDigest = function (digest) {
    var text = buildShareText(digest, false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showFeedback('分享文本已复制到剪贴板');
      }, function () {
        showFeedback('复制失败，请手动选择文本');
      });
    } else {
      showFeedback('当前环境不支持剪贴板');
    }
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildStatChip(value, label) {
    var chip = el('div', 'stat-chip');
    chip.appendChild(el('div', 'value', value));
    chip.appendChild(el('div', 'label', label));
    return chip;
  }

  function buildEmptyState(icon, text) {
    var wrap = el('div', 'card');
    var state = el('div', 'empty-state');
    state.appendChild(el('div', 'icon', icon));
    state.appendChild(el('div', 'text', text));
    wrap.appendChild(state);
    return wrap;
  }

  function buildShareText(digest, full) {
    var lines = [
      '📅 DCF 本周回顾（' + digest.week + '）',
      '共 ' + (digest.totalMessages || 0) + ' 轮消息 · 情感趋势：' +
        (SENTIMENT_EMOJI[digest.sentimentTrend] || '—')
    ];
    if (digest.topics && digest.topics.length) {
      lines.push('话题分布：' + digest.topics.map(function (t) {
        return t.name + ' ' + Math.round(t.percentage || 0) + '%';
      }).join(' / '));
    }
    if (digest.keyDecisions && digest.keyDecisions.length) {
      lines.push('关键决策：');
      digest.keyDecisions.forEach(function (d) { lines.push('  · ' + d); });
    }
    if (full && digest.highlights && digest.highlights.length) {
      lines.push('高光时刻：');
      digest.highlights.forEach(function (h) {
        lines.push('  「' + (h.snippet || '') + '」' + (h.context ? ' — ' + h.context : ''));
      });
    }
    return lines.join('\n');
  }

  function showFeedback(message) {
    var bubble = el('div', 'feedback-bubble', message);
    document.body.appendChild(bubble);
    setTimeout(function () { bubble.remove(); }, 2000);
  }

  function describeError(res) {
    if (!res) return 'unknown';
    if (res.body && res.body.message) return String(res.body.message);
    if (res.body && res.body.error) return String(res.body.error);
    return 'HTTP ' + res.status;
  }

  /**
   * ISO-8601 week string for a date, e.g. "2024-W30".
   * @param {Date} date
   * @returns {string}
   */
  function getISOWeek(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
  }

  /**
   * Shift an ISO week string by +-1 week.
   * @param {string} week - e.g. "2024-W30"
   * @param {number} delta - +1 or -1
   * @returns {string}
   */
  function shiftWeek(week, delta) {
    var m = /^(\d{4})-W(\d{2})$/.exec(week);
    if (!m) return week;
    // Monday of that ISO week:
    var year = Number(m[1]), num = Number(m[2]);
    var simple = new Date(Date.UTC(year, 0, 1 + (num - 1) * 7));
    var dow = simple.getUTCDay();
    var monday = new Date(simple);
    monday.setUTCDate(simple.getUTCDate() - ((dow + 6) % 7) + (dow <= 4 ? 0 : 7));
    monday.setUTCDate(monday.getUTCDate() + delta * 7);
    return getISOWeek(monday);
  }

  // -------------------------------------------------------------------------
  // Global functions referenced by index.html
  // -------------------------------------------------------------------------

  var feed = null;

  global.switchView = function (viewName) {
    if (global.dcfBridge && typeof global.dcfBridge.switchView === 'function') {
      global.dcfBridge.switchView(viewName);
      return;
    }
    global.location.href = '../' + viewName + '/index.html';
  };

  global.prevWeek = function () {
    if (feed) feed.loadWeeklyDigest(shiftWeek(feed.currentWeek, -1));
  };

  global.nextWeek = function () {
    if (feed) feed.loadWeeklyDigest(shiftWeek(feed.currentWeek, 1));
  };

  // Keyboard shortcuts: Cmd/Ctrl+1/2/3 switch lens views.
  document.addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === '1') { e.preventDefault(); global.switchView('task'); }
    if (e.key === '2') { e.preventDefault(); global.switchView('exploration'); }
    if (e.key === '3') { e.preventDefault(); global.switchView('reflection'); }
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (!global.CompanionClient) {
      console.error('CompanionClient not loaded; reflection view cannot start.');
      return;
    }
    feed = new ReflectionFeed(global.CompanionClient);
    feed.loadWeeklyDigest();
  });

  global.ReflectionFeed = ReflectionFeed;
})(typeof window !== 'undefined' ? window : this);
