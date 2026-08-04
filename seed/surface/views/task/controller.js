/**
 * DCF Surface - Task View Controller (Lens 1)
 *
 * Fetches task projections from the Companion via CompanionClient,
 * groups them by priority into the Bento Grid sections, and wires up
 * accept / dismiss / refresh microinteractions.
 *
 * Honest failures: renders an offline/empty state instead of throwing.
 */

(function (global) {
  'use strict';

  /** Cache TTL for the in-memory task list (5 minutes, per plan). */
  var CACHE_MAX_AGE_MS = 5 * 60 * 1000;

  /** Priority section container ids in the Bento Grid. */
  var SECTION_IDS = {
    high: 'high-priority-tasks',
    medium: 'medium-priority-tasks',
    low: 'low-priority-tasks'
  };

  var PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };

  /**
   * Task View front-end controller.
   * @param {Object} client - CompanionClient facade.
   */
  function TaskViewController(client) {
    this.client = client;
    this.cachedTasks = null;
    this.lastFetchTs = 0;
  }

  /** Initialize: fetch tasks and render all sections. */
  TaskViewController.prototype.init = function () {
    var self = this;
    return this.fetchTasks().then(function (tasks) {
      self.renderTasks(tasks);
      return tasks;
    });
  };

  /**
   * Fetch task projections (in-memory cache, 5 min TTL).
   * @param {boolean} [force] - Bypass the cache.
   * @returns {Promise<Array>} Task projection list ([] on failure).
   */
  TaskViewController.prototype.fetchTasks = function (force) {
    var self = this;
    var now = Date.now();

    if (!force && this.cachedTasks && (now - this.lastFetchTs) < CACHE_MAX_AGE_MS) {
      return Promise.resolve(this.cachedTasks);
    }

    return this.client.getTasks({ status: 'recommended,accepted', limit: 50 })
      .then(function (res) {
        if (res.ok && res.body && res.body.ok !== false) {
          var tasks = (res.body.data || res.body.tasks || []);
          self.cachedTasks = tasks;
          self.lastFetchTs = now;
          return tasks;
        }
        self.showOfflineState(res);
        return self.cachedTasks || [];
      });
  };

  /**
   * Group tasks by priority and render each Bento section.
   * @param {Array} tasks
   */
  TaskViewController.prototype.renderTasks = function (tasks) {
    var groups = { high: [], medium: [], low: [] };
    (tasks || []).forEach(function (task) {
      var p = task.priority === 'high' || task.priority === 'medium' ? task.priority : 'low';
      groups[p].push(task);
    });

    var self = this;
    Object.keys(SECTION_IDS).forEach(function (priority) {
      self.renderSection(SECTION_IDS[priority], groups[priority]);
    });
  };

  /**
   * Render one priority section; shows an empty state when no tasks.
   * @param {string} elementId
   * @param {Array} tasks
   */
  TaskViewController.prototype.renderSection = function (elementId, tasks) {
    var container = document.getElementById(elementId);
    if (!container) return;
    container.innerHTML = '';

    if (!tasks.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML =
        '<div class="empty-state-icon">🌱</div>' +
        '<div class="empty-state-text">暂无任务</div>';
      container.appendChild(empty);
      return;
    }

    var self = this;
    tasks.forEach(function (task) {
      container.appendChild(self.createTaskCard(task));
    });
  };

  /**
   * Build a single task card element. All dynamic values from the network
   * are inserted via textContent (never innerHTML) to avoid injection.
   * @param {Object} task
   * @returns {HTMLElement}
   */
  TaskViewController.prototype.createTaskCard = function (task) {
    var div = document.createElement('div');
    div.className = 'task-card';
    div.setAttribute('data-task-id', String(task.id || ''));

    var priority = PRIORITY_LABELS[task.priority] ? task.priority : 'low';
    var maturity = Number(task.maturityScore != null ? task.maturityScore : task.maturity_score) || 0;
    var summary = String(task.summary || task.description || '');
    if (summary.length > 100) summary = summary.substring(0, 100) + '…';

    var header = document.createElement('div');
    header.className = 'task-header';

    var tag = document.createElement('span');
    tag.className = 'priority-tag ' + priority;
    tag.textContent = PRIORITY_LABELS[priority] + '优先级';

    var score = document.createElement('span');
    score.className = 'maturity-score';
    score.textContent = '成熟度 ' + maturity + '%';

    header.appendChild(tag);
    header.appendChild(score);

    var title = document.createElement('h4');
    title.className = 'task-title';
    title.textContent = task.title || '（无标题）';

    var body = document.createElement('p');
    body.className = 'task-summary';
    body.textContent = summary;

    var actions = document.createElement('div');
    actions.className = 'task-actions';

    var self = this;
    var acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn-accept';
    acceptBtn.textContent = '✓ 接受';
    acceptBtn.addEventListener('click', function () { self.acceptTask(task.id); });

    var dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn-dismiss';
    dismissBtn.textContent = '✕ 忽略';
    dismissBtn.addEventListener('click', function () { self.dismissTask(task.id); });

    actions.appendChild(acceptBtn);
    actions.appendChild(dismissBtn);

    div.appendChild(header);
    div.appendChild(title);
    div.appendChild(body);
    div.appendChild(actions);
    return div;
  };

  /** Accept a recommendation, then refresh the list. */
  TaskViewController.prototype.acceptTask = function (taskId) {
    var self = this;
    return this.client.acceptRecommendation(taskId).then(function (res) {
      if (res.ok && res.body && res.body.ok !== false) {
        self.showFeedback('✓ 已接受任务');
        return self.refresh();
      }
      self.showFeedback('接受失败：' + self.describeError(res));
    });
  };

  /** Dismiss a recommendation, then refresh the list. */
  TaskViewController.prototype.dismissTask = function (taskId) {
    var self = this;
    return this.client.dismissRecommendation(taskId, 'not_relevant').then(function (res) {
      if (res.ok && res.body && res.body.ok !== false) {
        self.showFeedback('已忽略该推荐');
        return self.refresh();
      }
      self.showFeedback('忽略失败：' + self.describeError(res));
    });
  };

  /** Force refresh (bypass cache) and re-render. */
  TaskViewController.prototype.refresh = function () {
    var self = this;
    return this.fetchTasks(true).then(function (tasks) {
      self.renderTasks(tasks);
      return tasks;
    });
  };

  /**
   * Show a transient feedback bubble (microinteraction).
   * @param {string} message
   */
  TaskViewController.prototype.showFeedback = function (message) {
    var bubble = document.createElement('div');
    bubble.className = 'feedback-bubble';
    bubble.textContent = message;
    document.body.appendChild(bubble);
    setTimeout(function () { bubble.remove(); }, 2000);
  };

  /** Render offline state into every section when Companion is unreachable. */
  TaskViewController.prototype.showOfflineState = function (res) {
    Object.keys(SECTION_IDS).forEach(function (priority) {
      var container = document.getElementById(SECTION_IDS[priority]);
      if (!container) return;
      container.innerHTML =
        '<div class="empty-state">' +
        '<div class="empty-state-icon">📡</div>' +
        '<div class="empty-state-text">Companion 未连接</div>' +
        '</div>';
    });
    this.showFeedback('无法连接 Companion：' + this.describeError(res));
  };

  /** Extract a human-readable error from a normalized envelope. */
  TaskViewController.prototype.describeError = function (res) {
    if (!res) return 'unknown';
    if (res.body && res.body.message) return String(res.body.message);
    if (res.body && res.body.error) return String(res.body.error);
    return 'HTTP ' + res.status;
  };

  // -------------------------------------------------------------------------
  // Global functions referenced by index.html inline handlers
  // -------------------------------------------------------------------------

  var controller = null;

  /** Switch to another cognitive lens view (via Electron IPC when present). */
  global.switchView = function (viewName) {
    if (global.dcfBridge && typeof global.dcfBridge.switchView === 'function') {
      global.dcfBridge.switchView(viewName);
      return;
    }
    // Plain-browser fallback: navigate between sibling view directories.
    global.location.href = '../' + viewName + '/index.html';
  };

  /** Placeholder for manual task creation (Phase 4 scope). */
  global.createNewTask = function () {
    if (controller) controller.showFeedback('手动新建任务将在后续版本提供');
  };

  /** Refresh button handler. */
  global.refreshTasks = function () {
    if (!controller) return;
    controller.refresh().then(function () {
      controller.showFeedback('已刷新');
    });
  };

  global.acceptTask = function (taskId) {
    if (controller) controller.acceptTask(taskId);
  };

  global.dismissTask = function (taskId) {
    if (controller) controller.dismissTask(taskId);
  };

  // Keyboard shortcuts: Cmd/Ctrl+1/2/3 switch lens views (per plan 1.2).
  document.addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === '1') { e.preventDefault(); global.switchView('task'); }
    if (e.key === '2') { e.preventDefault(); global.switchView('exploration'); }
    if (e.key === '3') { e.preventDefault(); global.switchView('reflection'); }
  });

  // Bootstrap once DOM and CompanionClient are ready.
  document.addEventListener('DOMContentLoaded', function () {
    if (!global.CompanionClient) {
      console.error('CompanionClient not loaded; task view cannot start.');
      return;
    }
    controller = new TaskViewController(global.CompanionClient);
    controller.init();
  });

  global.TaskViewController = TaskViewController;
})(typeof window !== 'undefined' ? window : this);
