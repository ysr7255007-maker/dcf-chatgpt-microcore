# DCF Surface - Installation & Quick Start Guide

## 🎯 What is DCF Surface?

DCF (Dialog Control Framework) Surface is an **independent desktop application** that serves as your personal cognitive sidebar:

- **Floating window** over any application (ChatGPT, IDE, Notes, etc.)
- **Read conversations** from target windows via Chrome Extension adapter
- **Send cards** back to target windows (AI responses, recommendations, notes)
- **Persistent companion** backend that stores all conversation history and metadata

---

## 📦 Installation

### Step 1: Install Dependencies

```bash
cd /Users/looy/Documents/dcf

# Node.js version check (>= 18 required)
node --version

# Verify npm works
npm --version
```

### Step 2: Launch Companion Server (Backend)

```bash
./quick-start-electron.sh
```

**What this does:**
- Starts Companion HTTP server on port `8472`
- Creates SQLite database at `~/dcf/dcf-electron-test.db`
- Runs G2 doctor self-check
- Waits for all components to be ready

**Expected output:**
```
✅ Companion started (PID: 56074)
✓ HTTP server running at http://127.0.0.1:8472
```

**Keep this terminal open** while testing. Press `Ctrl+C` to stop when done.

---

### Step 3: Launch Electron Surface (Desktop App)

Open a **new terminal** (keep Companion running):

```bash
cd /Users/looy/Documents/dcf/packages/desktop-electron
npm start
```

**Expected behavior:**
- A **400×600 pixel floating window** appears
- **Transparent background**, **always on top**
- No frame/border (custom title bar)
- Loads `g2-dashboard.html` from `seed/surface/`

**Note:** This requires a macOS GUI session (cannot run in headless/SSH mode).

---

### Step 4: Load Chrome Extension (Target Adapter)

In **Chrome browser**:

1. Navigate to `chrome://extensions`
2. Enable **"Developer mode"** (top-right toggle)
3. Click **"Load unpacked"** button
4. Select directory: `/Users/looy/Documents/dcf/packages/target-adapter-chrome`
5. Extension icon appears in Chrome toolbar

**Extension features:**
- Shows current tab URL in popup
- "Test Read" button: reads conversation from active tab
- "Test Send" button: sends test card to input box

---

## ✅ Verification Checklist

After completing all steps above, verify:

### Check 1: Companion Health
```bash
curl http://127.0.0.1:8472/rpc/health
```

**Expected response:**
```json
{
    "jsonrpc": "2.0",
    "result": {
        "status": "healthy",
        "database": "real",
        "event_count": 0
    }
}
```

### Check 2: Electron Window Display
- [ ] Floating window visible on screen
- [ ] Transparent background (can see underlying apps)
- [ ] Always on top (not covered by other windows)
- [ ] Dashboard UI renders correctly (no white screen)

### Check 3: Extension Functionality
- [ ] Extension icon shows in toolbar
- [ ] Clicking icon opens popup with current URL
- [ ] "Test Read" button doesn't crash
- [ ] No console errors in `chrome://extensions` → Inspect Views → Service Worker

---

## 🔬 BrowserClaw E2E Testing (Phase 4)

**Requirements:**
- BrowserClaw browser installed and signed into ChatGPT
- All three components running (Companion + Electron + Extension)

**Manual testing steps:**

1. **Open ChatGPT in BrowserClaw:**
   ```
   Navigate to https://chatgpt.com/
   ```

2. **Verify real conversation exists:**
   - Confirm you have at least 3 messages in the chat history
   - Take screenshot as evidence

3. **Trigger DCF Surface read action:**
   - Click floating DCF Surface window
   - Look for "Read from Current Tab" button or similar trigger
   - Note: Exact button labels may vary based on dashboard implementation

4. **Verify conversation data flow:**
   - Open BrowserClaw DevTools (`Cmd+Option+I`)
   - Check Network tab for RPC calls to `http://127.0.0.1:8472`
   - Confirm `POST /rpc/events/ingest` called successfully

5. **Send card back to ChatGPT:**
   - In DCF Surface, select a card or recommendation
   - Click "Send to ChatGPT" or similar button
   - Verify text appears in ChatGPT input box

6. **Screenshot evidence:**
   - Capture the complete flow: ChatGPT page + DCF Surface overlay
   - Save as `e2e-screenshot.png`

---

## 🐛 Troubleshooting

### Issue 1: Companion won't start on port 8472
```bash
# Check if port is already in use
lsof -i :8472

# Kill existing process
kill -9 $(lsof -ti:8472)

# Try alternative port
node seed/companion/index.js --port=8473
```

### Issue 2: Electron window doesn't appear
- **Cause:** Running in headless/SSH environment without X11 forwarding
- **Solution:** Switch to physical macOS Desktop session or enable VNC remote desktop

### Issue 3: Chrome Extension won't load
- **Cause:** Manifest V3 syntax error or invalid file paths
- **Check:** `chrome://extensions` → Reload extension → View Console errors
- **Fix:** Re-run `ls -la packages/target-adapter-chrome/` to verify files exist

### Issue 4: "RPC method not found" error
- **Cause:** Companion version mismatch or incorrect endpoint path
- **Fix:** Restart Companion server, ensure `seed/companion/index.js` is latest version

---

## 📚 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     DCF System Stack                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────┐    ┌──────────────────────────┐   │
│  │  Electron       │◄──►│  Companion Core          │   │
│  │  Surface        │    │  (HTTP JSON-RPC)         │   │
│  │  (Desktop App)  │    │  • SQLite storage        │   │
│  └────────┬────────┘    │  • Event log             │   │
│           │             │  • Projection tables     │   │
│           │             └──────────┬───────────────┘   │
│           │                        │                   │
│           ▼                        ▼                   │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Target Adapter Layer                              │ │
│  │  • Chrome Extension (first adapter)               │ │
│  │  • Content Script: DOM reading                    │ │
│  │  • Service Worker: Message routing                │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Target Application (BrowserClaw Chrome)          │ │
│  │  • https://chatgpt.com/                           │ │
│  │  • Real conversation history                      │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 Next Steps

### Immediate (Today):
- [ ] Complete manual verification checklist
- [ ] Take screenshots of each component working
- [ ] Document any issues encountered

### Short-term (This Week):
- [ ] Implement T1-T5 BrowserClaw E2E tests
- [ ] Add more Target Adapters (Safari, VS Code)
- [ ] Build DMG distribution package

### Long-term (Next Sprint):
- [ ] Migrate to Tauri (smaller bundle size)
- [ ] Add macOS Accessibility permissions for advanced features
- [ ] Implement real-time sync across multiple devices

---

## 📞 Support & Feedback

Found a bug? Have a suggestion?

1. **Quick diagnostic:** Run `./doctor` script
2. **Full logs:** Check `~/Library/Logs/dcf-companion.log`
3. **GitHub Issues:** Create issue with "bug" label

---

*Last updated: 2026-07-26*  
*Version: 0.1.0-alpha (Electron MVP)*
