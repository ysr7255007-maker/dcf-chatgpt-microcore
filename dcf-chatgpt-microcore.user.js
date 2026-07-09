// ==UserScript==
// @name         DCF ChatGPT Microcore
// @namespace    https://chatgpt.com/
// @version      0.7.2
// @description  DCF GitHub bootloader for the Dialogue Control Framework engine.
// @updateURL    https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.meta.js
// @downloadURL  https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/dcf-chatgpt-microcore.user.js
// @supportURL   https://github.com/ysr7255007-maker/dcf-chatgpt-microcore
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const MANIFEST_URLS = [
    "https://raw.githubusercontent.com/ysr7255007-maker/dcf-chatgpt-microcore/main/engine/0.7.1/manifest.json",
    "https://cdn.jsdelivr.net/gh/ysr7255007-maker/dcf-chatgpt-microcore@main/engine/0.7.1/manifest.json",
  ];
  const CACHE_KEY = "dcf.github.engine.cache.v1";
  const CHECK_KEY = "dcf.github.engine.lastCheck.v1";
  const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const LEGACY_LOCAL_ENGINE_BOOT_FLAG = "__DCF_LOCAL_ENGINE_BOOTING__";

  boot();

  async function boot() {
    const cached = readCache();
    if (cached && cached.source) {
      try {
        run(cached.source, cached.version || "cached");
        checkRemoteInBackground(cached.version || "cached");
        return;
      } catch (error) {
        console.warn("DCF cached engine failed; clearing cache and trying remote engine.", error);
        localStorage.removeItem(CACHE_KEY);
      }
    }

    try {
      const loaded = await loadRemoteEngine();
      saveCache(loaded);
      run(loaded.source, loaded.version || "latest");
    } catch (error) {
      console.error("DCF GitHub engine load failed and no usable cache is available.", error);
      alert("DCF GitHub engine load failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  function checkRemoteInBackground(currentVersion) {
    const lastCheck = Number(localStorage.getItem(CHECK_KEY) || 0);
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
    localStorage.setItem(CHECK_KEY, String(Date.now()));
    loadRemoteEngine()
      .then((loaded) => {
        const cached = readCache();
        if (!cached || cached.version !== loaded.version || cached.manifestUrl !== loaded.manifestUrl) {
          saveCache(loaded);
          console.info("DCF engine cache refreshed.", { previous: currentVersion, next: loaded.version });
        }
      })
      .catch((error) => console.warn("DCF background engine check failed; cached engine remains active.", error));
  }

  async function loadRemoteEngine() {
    const manifestResult = await requestFirst(MANIFEST_URLS);
    const manifest = JSON.parse(manifestResult.text);
    if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
      throw new Error("Engine manifest does not contain chunks.");
    }
    let encoded = "";
    for (const url of manifest.chunks) encoded += await request(url);
    const source = decodeBase64(encoded);
    Function(source);
    return {
      version: manifest.version || "latest",
      source,
      manifestUrl: manifestResult.url,
      loadedAt: new Date().toISOString(),
    };
  }

  async function requestFirst(urls) {
    const errors = [];
    for (const url of urls) {
      try {
        return { url, text: await request(url) };
      } catch (error) {
        errors.push((error instanceof Error ? error.message : String(error)) + " @ " + url);
      }
    }
    throw new Error(errors.join("; "));
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
      fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status + " loading " + url);
          return response.text();
        })
        .then(resolve, reject);
    });
  }

  function decodeBase64(value) {
    const binary = atob(String(value).replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function saveCache(loaded) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(loaded));
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function run(source, version) {
    const hadOwnFlag = Object.prototype.hasOwnProperty.call(window, LEGACY_LOCAL_ENGINE_BOOT_FLAG);
    const previousFlag = window[LEGACY_LOCAL_ENGINE_BOOT_FLAG];
    window[LEGACY_LOCAL_ENGINE_BOOT_FLAG] = true;
    try {
      Function(source + "\n//# sourceURL=dcf-github-engine-" + String(version).replace(/[^a-z0-9_.-]/gi, "_") + ".user.js")();
    } finally {
      if (hadOwnFlag) window[LEGACY_LOCAL_ENGINE_BOOT_FLAG] = previousFlag;
      else delete window[LEGACY_LOCAL_ENGINE_BOOT_FLAG];
    }
  }
})();
