'use strict';

var $ = function (sel) { return document.querySelector(sel); };

function getActiveTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

async function refreshUrl() {
  var tab = await getActiveTab();
  $('#url').textContent = tab ? tab.url : '无活跃标签';
}

function show(obj) {
  $('#result').textContent = JSON.stringify(obj, null, 2);
}

$('#read').addEventListener('click', async function () {
  $('#result').textContent = '读取中…';
  try {
    var res = await chrome.runtime.sendMessage({ type: 'dcf-read-request' });
    show(res);
  } catch (e) {
    show({ success: false, error: String(e && e.message || e) });
  }
});

$('#send').addEventListener('click', async function () {
  $('#result').textContent = '发送中…';
  try {
    var res = await chrome.runtime.sendMessage({
      type: 'dcf-send-card-request',
      text: '[DCF Card] 测试卡片内容 ' + new Date().toLocaleTimeString()
    });
    show(res);
  } catch (e) {
    show({ success: false, error: String(e && e.message || e) });
  }
});

$('#ping').addEventListener('click', async function () {
  $('#result').textContent = 'Ping…';
  try {
    var res = await chrome.runtime.sendMessage({ type: 'dcf-ping' });
    show(res);
  } catch (e) {
    show({ success: false, error: String(e && e.message || e) });
  }
});

refreshUrl();
