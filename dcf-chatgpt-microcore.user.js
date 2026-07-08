// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.7.0
// @description  DCF GitHub bootloader for the Dialogue Control Framework engine.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.user.js
// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  "use strict";

  const MANIFEST_URL = "https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/engine/0.7.0/manifest.json";
  const CACHE_KEY = "dcf.github.engine.cache.v1";

  boot();

  async function boot() {
    try {
      const manifest = JSON.parse(await request(MANIFEST_URL + "?t=" + Date.now()));
      let encoded = "";
      for (const url of manifest.chunks || []) encoded += await request(url + "?t=" + Date.now());
      const source = decodeBase64(encoded);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ version: manifest.version, source, at: new Date().toISOString() }));
      run(source, manifest.version || "latest");
    } catch (error) {
      const cached = readCache();
      if (cached && cached.source) {
        console.warn("DCF GitHub engine load failed; using cached engine.", error);
        run(cached.source, cached.version || "cached");
        return;
      }
      console.error("DCF GitHub engine load failed and no cache is available.", error);
      alert("DCF GitHub engine load failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  function request(url) {
    return new Promise((resolve, reject) => {
      const requestImpl = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null;
      if (requestImpl) {
        requestImpl({
          method: "GET",
          url,
          onload: (response) => {
            if (response.status >= 200 && response.status < 300) resolve(response.responseText);
            else reject(new Error("HTTP " + response.status + " loading " + url));
          },
          onerror: () => reject(new Error("Network error loading " + url)),
        });
        return;
      }
      fetch(url).then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status + " loading " + url);
        return response.text();
      }).then(resolve, reject);
    });
  }

  function decodeBase64(value) {
    const binary = atob(String(value).replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function run(source, version) {
    Function(source + "\n//# sourceURL=dcf-github-engine-" + String(version).replace(/[^a-z0-9_.-]/gi, "_") + ".user.js")();
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch {
      return null;
    }
  }
})();
