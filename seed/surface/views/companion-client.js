/**
 * DCF Surface - Companion HTTP Client
 *
 * Shared client for the Three Cognitive Lens views. Talks to the Companion
 * via window.dcfBridge (Electron preload) when available, otherwise falls
 * back to direct fetch against http://127.0.0.1:8472 (plain browser mode).
 *
 * Honest failures: every method resolves to a normalized
 * { ok, status, body } envelope and never throws on network errors.
 */

(function (global) {
  'use strict';

  var COMPANION_BASE = 'http://127.0.0.1:8472';

  /**
   * Perform an RPC request against the Companion.
   * Prefers the Electron IPC bridge; falls back to fetch.
   *
   * @param {string} method - HTTP method (GET/POST).
   * @param {string} rpcPath - Path beginning with '/rpc/'.
   * @param {*} [data] - Optional JSON-serializable body (POST only).
   * @returns {Promise<{ok:boolean, status:number, body:*}>}
   */
  function rpc(method, rpcPath, data) {
    if (global.dcfBridge && typeof global.dcfBridge.rpc === 'function') {
      return global.dcfBridge.rpc(method, rpcPath, data);
    }

    var url = COMPANION_BASE + rpcPath;
    var options = { method: method, headers: { 'Accept': 'application/json' } };
    if (data !== undefined && method !== 'GET') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }

    return fetch(url, options)
      .then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .catch(function (err) {
        return {
          ok: false,
          status: 0,
          body: { error: 'companion-unreachable', message: err && err.message ? err.message : String(err) }
        };
      });
  }

  /**
   * Build a query string from a params object (skips null/undefined).
   * @param {Object} params
   * @returns {string} '' or '?a=b&c=d'
   */
  function buildQuery(params) {
    if (!params) return '';
    var parts = [];
    Object.keys(params).forEach(function (key) {
      if (params[key] === null || params[key] === undefined) return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  /** Companion client facade shared by all lens views. */
  var CompanionClient = {
    rpc: rpc,

    /** Lens 1: task projections. */
    getTasks: function (params) {
      return rpc('GET', '/rpc/projection/tasks' + buildQuery(params));
    },

    /** Lens 2: knowledge graph projection. */
    getGraph: function (params) {
      return rpc('GET', '/rpc/projection/graph' + buildQuery(params));
    },

    /** Lens 3: weekly reflection digest. */
    getWeeklyDigest: function (params) {
      return rpc('GET', '/rpc/projection/weekly-digest' + buildQuery(params));
    },

    /** Accept a recommendation (turns it into a task). */
    acceptRecommendation: function (recommendationId, bindingContext) {
      return rpc('POST', '/rpc/recommendation/accept', {
        recommendation_id: recommendationId,
        binding_context: bindingContext || undefined
      });
    },

    /** Dismiss a recommendation with an optional reason. */
    dismissRecommendation: function (recommendationId, reason) {
      return rpc('POST', '/rpc/recommendation/dismiss', {
        recommendation_id: recommendationId,
        reason: reason || undefined
      });
    },

    /** Health check for the offline banner. */
    health: function () {
      return rpc('GET', '/rpc/health');
    }
  };

  global.CompanionClient = CompanionClient;
})(typeof window !== 'undefined' ? window : this);
