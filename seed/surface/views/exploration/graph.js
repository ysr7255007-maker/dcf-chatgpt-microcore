/**
 * DCF Surface - Exploration View (Lens 2) Knowledge Graph Explorer
 *
 * Obsidian-Graph-style force-directed visualization of the Companion
 * knowledge graph projection (/rpc/projection/graph).
 *
 * Zero runtime npm dependencies (project principle): instead of bundling
 * D3, this ships a small self-contained force simulation implementing the
 * same model d3-force uses (many-body repulsion + link springs + centering
 * force, velocity Verlet integration with alpha decay). Rendering is SVG.
 */

(function (global) {
  'use strict';

  var CLUSTER_COLORS = [
    '#4c8dff', '#8b5cf6', '#22c55e', '#f59e0b',
    '#ef4444', '#06b6d4', '#ec4899', '#a3e635'
  ];

  // -------------------------------------------------------------------------
  // Minimal force simulation (d3-force compatible model)
  // -------------------------------------------------------------------------

  /**
   * @param {Array} nodes - [{id, x?, y?, vx?, vy?, fx?, fy?}]
   * @param {Array} links - [{source, target, weight}] (ids resolved to refs)
   * @param {number} width
   * @param {number} height
   */
  function ForceSimulation(nodes, links, width, height) {
    this.nodes = nodes;
    this.links = links;
    this.width = width;
    this.height = height;
    this.alpha = 1;
    this.alphaMin = 0.001;
    this.alphaDecay = 0.0228; // matches d3 default: 1 - pow(alphaMin, 1/300)
    this.alphaTarget = 0;
    this.velocityDecay = 0.6;
    this.linkDistance = 100;
    this.chargeStrength = -300;
    this.tickHandlers = [];
    this._running = false;

    // Seed initial positions in a phyllotaxis spiral (like d3) for stability.
    var initialRadius = 10, initialAngle = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach(function (n, i) {
      if (n.x == null) {
        var radius = initialRadius * Math.sqrt(0.5 + i);
        var angle = i * initialAngle;
        n.x = width / 2 + radius * Math.cos(angle);
        n.y = height / 2 + radius * Math.sin(angle);
      }
      n.vx = 0;
      n.vy = 0;
    });
  }

  ForceSimulation.prototype.on = function (event, handler) {
    if (event === 'tick') this.tickHandlers.push(handler);
    return this;
  };

  ForceSimulation.prototype.alphaTargetSet = function (t) {
    this.alphaTarget = t;
    return this;
  };

  ForceSimulation.prototype.restart = function () {
    if (this._running) return this;
    this._running = true;
    var self = this;
    function frame() {
      if (!self._running) return;
      self.tick();
      self.tickHandlers.forEach(function (h) { h(); });
      if (self.alpha < self.alphaMin && self.alphaTarget < self.alphaMin) {
        self._running = false;
        return;
      }
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);
    return this;
  };

  ForceSimulation.prototype.stop = function () {
    this._running = false;
    return this;
  };

  /** One integration step: springs, charge, centering, then position update. */
  ForceSimulation.prototype.tick = function () {
    var alpha = this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
    var nodes = this.nodes;
    var i, j, n, m;

    // Link springs.
    for (i = 0; i < this.links.length; i++) {
      var link = this.links[i];
      var s = link.source, t = link.target;
      var dx = t.x - s.x, dy = t.y - s.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var strength = 0.7 * alpha * (dist - this.linkDistance) / dist;
      dx *= strength; dy *= strength;
      t.vx -= dx; t.vy -= dy;
      s.vx += dx; s.vy += dy;
    }

    // Many-body repulsion (O(n^2); fine for MVP graph sizes < ~500 nodes).
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        m = nodes[j];
        var rx = m.x - n.x, ry = m.y - n.y;
        var d2 = rx * rx + ry * ry;
        if (d2 < 1) d2 = 1;
        var f = this.chargeStrength * alpha / d2;
        var fx = rx * f, fy = ry * f;
        n.vx += fx; n.vy += fy;
        m.vx -= fx; m.vy -= fy;
      }
    }

    // Centering force.
    var cx = this.width / 2, cy = this.height / 2;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      n.vx += (cx - n.x) * 0.05 * alpha;
      n.vy += (cy - n.y) * 0.05 * alpha;
    }

    // Integrate positions (honoring fixed positions from dragging).
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.fx != null) { n.x = n.fx; n.vx = 0; }
      else { n.vx *= this.velocityDecay; n.x += n.vx; }
      if (n.fy != null) { n.y = n.fy; n.vy = 0; }
      else { n.vy *= this.velocityDecay; n.y += n.vy; }
    }
  };

  // -------------------------------------------------------------------------
  // Knowledge Graph Explorer
  // -------------------------------------------------------------------------

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * @param {HTMLElement} container - #graph-container element.
   * @param {Object} client - CompanionClient facade.
   */
  function KnowledgeGraphExplorer(container, client) {
    this.container = container;
    this.client = client;
    this.graph = null;
    this.simulation = null;
    this.selectedNode = null;
    this.nodeElements = {};
    this.linkElements = [];
    this.clusterColorMap = {};

    this.svg = document.createElementNS(SVG_NS, 'svg');
    container.appendChild(this.svg);
    this.linkLayer = document.createElementNS(SVG_NS, 'g');
    this.nodeLayer = document.createElementNS(SVG_NS, 'g');
    this.svg.appendChild(this.linkLayer);
    this.svg.appendChild(this.nodeLayer);
  }

  /** Fetch the graph projection and render it; honest offline state. */
  KnowledgeGraphExplorer.prototype.loadGraph = function (depth) {
    var self = this;
    this.setStatus('正在加载图谱…');

    return this.client.getGraph({ depth: depth || 2 }).then(function (res) {
      if (!res.ok || !res.body || res.body.ok === false) {
        self.setStatus('📡 Companion 未连接：' + describeError(res));
        return;
      }
      var graph = res.body.data || res.body;
      if (!graph.nodes || !graph.nodes.length) {
        self.setStatus('🌱 暂无图谱数据 — 继续对话来积累知识节点');
        return;
      }
      self.hideStatus();
      self.renderGraph(graph);
    });
  };

  KnowledgeGraphExplorer.prototype.setStatus = function (text) {
    var status = document.getElementById('graph-status');
    var textEl = document.getElementById('graph-status-text');
    if (textEl) textEl.textContent = text;
    if (status) status.classList.add('visible');
  };

  KnowledgeGraphExplorer.prototype.hideStatus = function () {
    var status = document.getElementById('graph-status');
    if (status) status.classList.remove('visible');
  };

  /** Build SVG elements and start the force simulation. */
  KnowledgeGraphExplorer.prototype.renderGraph = function (graph) {
    var self = this;
    var width = this.container.clientWidth || 340;
    var height = this.container.clientHeight || 800;

    // Reset previous render.
    if (this.simulation) this.simulation.stop();
    this.linkLayer.textContent = '';
    this.nodeLayer.textContent = '';
    this.nodeElements = {};
    this.linkElements = [];

    // Assign cluster colors.
    this.clusterColorMap = {};
    (graph.clusters || []).forEach(function (cluster, i) {
      var color = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
      (cluster.nodes || []).forEach(function (nodeId) {
        self.clusterColorMap[nodeId] = color;
      });
    });
    this.renderLegend(graph.clusters || []);

    // Resolve edge endpoints to node references.
    var nodeById = {};
    graph.nodes.forEach(function (n) { nodeById[n.id] = n; });
    var links = (graph.edges || [])
      .filter(function (e) { return nodeById[e.source] && nodeById[e.target]; })
      .map(function (e) {
        return {
          source: nodeById[e.source],
          target: nodeById[e.target],
          relation: e.relation,
          weight: e.weight || 1
        };
      });

    this.graph = { nodes: graph.nodes, links: links, clusters: graph.clusters || [] };

    // Links.
    links.forEach(function (link) {
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'link');
      line.setAttribute('stroke-width', String(Math.max(1, Math.sqrt(link.weight))));
      self.linkLayer.appendChild(line);
      self.linkElements.push({ el: line, link: link });
    });

    // Nodes (circle + label group).
    graph.nodes.forEach(function (node) {
      var g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'node');

      var circle = document.createElementNS(SVG_NS, 'circle');
      var r = node.type === 'topic' ? 12 : 8;
      circle.setAttribute('r', String(r + Math.min(6, (node.importance || 0) * 6)));
      circle.setAttribute('fill', self.clusterColorMap[node.id] || '#4c8dff');
      g.appendChild(circle);

      var text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('dx', '14');
      text.setAttribute('dy', '4');
      text.textContent = node.label || node.id;
      g.appendChild(text);

      g.addEventListener('click', function (e) {
        e.stopPropagation();
        self.selectNode(node, g);
      });
      self.attachDrag(g, node);

      self.nodeLayer.appendChild(g);
      self.nodeElements[node.id] = g;
    });

    // Start simulation.
    this.simulation = new ForceSimulation(graph.nodes, links, width, height);
    this.simulation.on('tick', function () { self.updatePositions(); });
    this.simulation.restart();

    // Click on empty canvas closes the sidebar.
    this.svg.addEventListener('click', function () { global.closeSidebar(); });
  };

  /** Sync SVG element positions from the simulation state. */
  KnowledgeGraphExplorer.prototype.updatePositions = function () {
    var self = this;
    this.graph.nodes.forEach(function (node) {
      var g = self.nodeElements[node.id];
      if (g) g.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');
    });
    this.linkElements.forEach(function (item) {
      item.el.setAttribute('x1', String(item.link.source.x));
      item.el.setAttribute('y1', String(item.link.source.y));
      item.el.setAttribute('x2', String(item.link.target.x));
      item.el.setAttribute('y2', String(item.link.target.y));
    });
  };

  /** Pointer-based dragging (fixes node position while dragging, like d3.drag). */
  KnowledgeGraphExplorer.prototype.attachDrag = function (element, node) {
    var self = this;
    element.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      element.setPointerCapture(e.pointerId);
      self.simulation.alphaTargetSet(0.3).restart();
      node.fx = node.x;
      node.fy = node.y;

      function onMove(ev) {
        var rect = self.svg.getBoundingClientRect();
        node.fx = ev.clientX - rect.left;
        node.fy = ev.clientY - rect.top;
      }
      function onUp(ev) {
        element.releasePointerCapture(ev.pointerId);
        self.simulation.alphaTargetSet(0);
        node.fx = null;
        node.fy = null;
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerup', onUp);
      }
      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerup', onUp);
    });
  };

  /** Show the detail sidebar for a clicked node (plan 2.3). */
  KnowledgeGraphExplorer.prototype.selectNode = function (node, element) {
    var prev = this.selectedNode;
    if (prev && this.nodeElements[prev.id]) {
      this.nodeElements[prev.id].classList.remove('selected');
    }
    this.selectedNode = node;
    element.classList.add('selected');

    document.getElementById('node-label').textContent = node.label || node.id;
    var tsText = node.ts ? new Date(node.ts).toLocaleDateString('zh-CN') : '—';
    document.getElementById('node-meta').textContent =
      '类型：' + (node.type || 'topic') +
      ' | 重要度：' + Math.round((node.importance || 0) * 100) + '%' +
      ' | 时间：' + tsText;

    // Related topics = direct neighbors.
    var relatedList = document.getElementById('related-nodes');
    relatedList.textContent = '';
    var self = this;
    this.graph.links.forEach(function (link) {
      var neighbor = null;
      if (link.source.id === node.id) neighbor = link.target;
      else if (link.target.id === node.id) neighbor = link.source;
      if (!neighbor) return;
      var li = document.createElement('li');
      li.textContent = (neighbor.label || neighbor.id) + '（' + (link.relation || 'related_to') + '）';
      li.addEventListener('click', function () {
        var g = self.nodeElements[neighbor.id];
        if (g) self.selectNode(neighbor, g);
      });
      relatedList.appendChild(li);
    });

    var sidebar = document.getElementById('node-details-panel');
    sidebar.classList.add('open');
    sidebar.setAttribute('aria-hidden', 'false');
  };

  /** Re-heat the simulation centered on the selected node. */
  KnowledgeGraphExplorer.prototype.focusOnSelected = function () {
    if (!this.selectedNode || !this.simulation) return;
    var node = this.selectedNode;
    node.fx = this.simulation.width / 2;
    node.fy = this.simulation.height / 2;
    this.simulation.alpha = 0.8;
    this.simulation.restart();
    setTimeout(function () { node.fx = null; node.fy = null; }, 1200);
  };

  KnowledgeGraphExplorer.prototype.renderLegend = function (clusters) {
    var legend = document.getElementById('cluster-legend');
    if (!legend) return;
    if (!clusters.length) { legend.hidden = true; return; }
    legend.hidden = false;
    legend.textContent = '';
    clusters.forEach(function (cluster, i) {
      var item = document.createElement('div');
      item.className = 'item';
      var swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.backgroundColor = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
      var label = document.createElement('span');
      label.textContent = cluster.theme || cluster.id;
      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    });
  };

  function describeError(res) {
    if (!res) return 'unknown';
    if (res.body && res.body.message) return String(res.body.message);
    if (res.body && res.body.error) return String(res.body.error);
    return 'HTTP ' + res.status;
  }

  // -------------------------------------------------------------------------
  // Global functions referenced by index.html
  // -------------------------------------------------------------------------

  var explorer = null;

  global.switchView = function (viewName) {
    if (global.dcfBridge && typeof global.dcfBridge.switchView === 'function') {
      global.dcfBridge.switchView(viewName);
      return;
    }
    global.location.href = '../' + viewName + '/index.html';
  };

  global.focusOnNode = function () {
    if (explorer) explorer.focusOnSelected();
  };

  global.closeSidebar = function () {
    var sidebar = document.getElementById('node-details-panel');
    if (!sidebar) return;
    sidebar.classList.remove('open');
    sidebar.setAttribute('aria-hidden', 'true');
  };

  // Keyboard shortcuts: Cmd/Ctrl+1/2/3 switch lens views.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { global.closeSidebar(); return; }
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === '1') { e.preventDefault(); global.switchView('task'); }
    if (e.key === '2') { e.preventDefault(); global.switchView('exploration'); }
    if (e.key === '3') { e.preventDefault(); global.switchView('reflection'); }
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (!global.CompanionClient) {
      console.error('CompanionClient not loaded; exploration view cannot start.');
      return;
    }
    var container = document.getElementById('graph-container');
    explorer = new KnowledgeGraphExplorer(container, global.CompanionClient);
    explorer.loadGraph(2);
  });

  global.KnowledgeGraphExplorer = KnowledgeGraphExplorer;
})(typeof window !== 'undefined' ? window : this);
