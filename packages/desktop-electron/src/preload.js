/**
 * DCF Surface - Electron Preload Script
 *
 * Safely exposes a minimal IPC surface to the renderer (g2-dashboard.html) via
 * contextBridge. The renderer never touches Node directly; all capabilities are
 * routed through main-process IPC handlers defined in main.js.
 *
 * Exposed as `window.dcfBridge`.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Bridge object exposed to the renderer as `window.dcfBridge`.
 */
const dcfBridge = {
  /**
   * Forward an RPC call to the DCF Companion HTTP server.
   * @param {string} method - HTTP method (GET/POST/PUT/DELETE).
   * @param {string} rpcPath - Path portion beginning with '/'.
   * @param {*} [data] - Optional request body.
   * @returns {Promise<{ok:boolean, status:number, body:*}>}
   */
  rpc: (method, path, data) => ipcRenderer.invoke('dcf-rpc', method, path, data),

  /**
   * Request a read snapshot of the active conversation via the companion
   * durable command queue (read-conversation).
   * @param {{limit?:number, timeout_ms?:number}} [options]
   * @returns {Promise<{ok:boolean, result?:*, error?:string}>}
   */
  requestRead: (options) => ipcRenderer.invoke('dcf-request-read', options),

  /**
   * Push a card payload into the active conversation surface via the
   * companion durable command queue (send-card; inject-only unless
   * cardData.auto_send === true).
   * @param {{text:string, auto_send?:boolean, timeout_ms?:number}} cardData
   * @returns {Promise<{ok:boolean, result?:*, error?:string}>}
   */
  sendCard: (cardData) => ipcRenderer.invoke('dcf-send-card', cardData),

  /** Collapse the 340x1200 panel into the floating ball. */
  collapsePanel: () => ipcRenderer.send('dcf-collapse-panel'),

  /** Expand the floating ball back into the panel. */
  expandPanel: () => ipcRenderer.send('dcf-expand-panel'),

  /**
   * Switch between the three cognitive lens views.
   * @param {'task'|'exploration'|'reflection'} viewName
   */
  switchView: (viewName) => ipcRenderer.send('dcf-switch-view', viewName),

  /**
   * Subscribe to read-result events pushed from the main process.
   * @param {(data:*)=>void} callback
   */
  onReadResult: (callback) => ipcRenderer.on('dcf-read-response', (event, data) => callback(data))
};

contextBridge.exposeInMainWorld('dcfBridge', dcfBridge);
