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
   * Request a read snapshot from the active surface (Phase 3 placeholder).
   * @returns {Promise<*>}
   */
  requestRead: () => ipcRenderer.invoke('dcf-request-read'),

  /**
   * Push a card payload into the active conversation surface (Phase 3 placeholder).
   * @param {*} cardData - Card payload to send.
   * @returns {Promise<*>}
   */
  sendCard: (cardData) => ipcRenderer.invoke('dcf-send-card', cardData),

  /**
   * Subscribe to read-result events pushed from the main process.
   * @param {(data:*)=>void} callback
   */
  onReadResult: (callback) => ipcRenderer.on('dcf-read-response', (event, data) => callback(data))
};

contextBridge.exposeInMainWorld('dcfBridge', dcfBridge);
