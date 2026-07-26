# Target Adapter Plugin 接口规范

## 核心结论

DCF Surface (Electron) 通过 Chrome Extension MV3 作为第一个 Target Adapter，使用 `chrome.runtime.onMessageExternal` 实现跨进程通信。插件只负责静默观察和动作翻译，不持有权威事实。

---

## 1. Manifest V3 Content Script 注入机制

### 1.1 注入配置

```json
{
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["cpaste.js", "content.js"],
    "run_at": "document_idle"
  }]
}
```

**选择 `document_idle` 而非 `document_end` 的原因**：
- `document_idle` 在 DOM 完全解析 + 资源加载后注入，避免 ChatGPT 的 React 水合过程被干扰
- `document_end` 可能在 React 尚未挂载时执行，导致选择器找不到元素

### 1.2 `<all_urls>` 性能影响

- Chrome MV3 对 `<all_urls>` 有惰性注入优化，仅在标签页激活时加载
- Content script 体积 < 8KB，不影响页面加载性能
- 可通过 `chrome.scripting.executeScript` 按需注入替代全局匹配

---

## 2. postMessage 协议设计

### 2.1 DCF Surface → Chrome Extension

DCF Surface (Electron 主进程) 通过 `chrome.runtime.sendMessage` 向 Extension 发送消息：

```javascript
// Electron 主进程 → Chrome Extension
const EXTENSION_ID = 'phbcioepnnpkdebnedkjpemndjghncob';

chrome.runtime.sendMessage(EXTENSION_ID, {
  action: 'dcf-read-request',
  timestamp: Date.now()
}, (response) => {
  // response = { success: boolean, messages: Array, url: string }
});
```

### 2.2 Chrome Extension → DCF Surface

Extension 通过 `chrome.runtime.onMessageExternal` 接收消息，处理后将结果回传：

```javascript
// background.js (Service Worker)
chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.action === 'dcf-read-request') {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        chrome.tabs.sendMessage(tab.id, { action: 'read-conversation' }, (result) => {
          sendResponse(result);
        });
      });
      return true; // 保持消息通道开放
    }
  }
);
```

### 2.3 消息协议 Schema

| 动作 | 方向 | Payload | 响应 |
|------|------|---------|------|
| `dcf-read-request` | Surface → Extension | `{ action, timestamp }` | `{ success, messages, url, title }` |
| `dcf-send-card-request` | Surface → Extension | `{ action, cardText, cardId }` | `{ success, method, message }` |
| `read-conversation` | Background → Content | `{ action }` | `{ success, messages, selector }` |
| `send-card` | Background → Content | `{ action, text }` | `{ success, method }` |

---

## 3. 剪贴板边界

### 3.1 Chrome 138 移除 `clipboard-unrestricted-read-write` 后的影响

- `navigator.clipboard.writeText()` 仍然可用，但需要页面聚焦
- `navigator.clipboard.readText()` 需要用户手势（click/tap）触发
- `document.execCommand('copy')` 已废弃但仍可工作（降级方案）

### 3.2 权限降级策略

```javascript
// cpaste.js - 剪贴板写入降级链
async function writeToClipboard(text) {
  // 方案 A: Clipboard API (需页面聚焦)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { status: 'copied', method: 'clipboard-api' };
    } catch (e) {
      // 降级到方案 B
    }
  }

  // 方案 B: execCommand (已废弃但兼容)
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
  return { status: 'pasted', method: 'exec-command' };
}
```

### 3.3 用户授权点

1. **Clipboard write**: Chrome 138+ 需要页面聚焦，无需额外权限弹窗
2. **Active tab access**: `activeTab` 权限在用户点击扩展图标时自动授予
3. **Script injection**: `scripting` 权限允许动态注入脚本，无需 content_scripts 声明

---

## 4. 卡片发送方案

### 4.1 方案对比

| 方案 | 可靠性 | 兼容性 | 用户感知 |
|------|--------|--------|---------|
| A. Clipboard API + 模拟 Cmd+V | 中 | Chrome 138+ 需聚焦 | 需要用户手动粘贴 |
| B. 直接创建 textarea 填充 | 高 | 全兼容 | 无感知 |
| C. AppleScript (仅 macOS) | 高 | 仅 macOS | 无感知 |

### 4.2 推荐方案：B（直接填充）

```javascript
// content.js - 卡片发送实现
function sendCardToInput(cardText) {
  // 查找 ChatGPT 输入框
  const input = document.querySelector('[contenteditable="true"]')
    || document.querySelector('textarea#prompt-textarea')
    || document.querySelector('[data-testid="prompt-textarea"]');

  if (!input) {
    return { success: false, error: 'Input box not found' };
  }

  // React 兼容：触发 native setter
  if (input.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    setter.call(input, cardText);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // contenteditable 元素
    input.focus();
    document.execCommand('insertText', false, cardText);
  }

  return { success: true, method: input.tagName === 'TEXTAREA' ? 'native-setter' : 'execCommand' };
}
```

---

## 5. 待验证项

1. `chrome.runtime.onMessageExternal` 在 Service Worker 休眠后是否自动恢复监听
2. ChatGPT 页面 DOM 结构变化对选择器的影响（需多选择器容错）
3. Electron 主进程通过 CDP 连接 Chrome Extension 的延迟（预期 < 5ms）

---

## 6. 已知限制

- ❌ 无法读取跨域 iframe 内容（ChatGPT 嵌入的第三方组件）
- ❌ 无法在 Service Worker 休眠期间接收消息（MV3 限制，最多 30 秒）
- ⚠️ `document.execCommand('copy')` 已废弃，未来 Chrome 版本可能移除

---

*最后更新：2026-07-26*
*版本：v0.1 (Phase 1 Recon)*
