#!/bin/bash
# Quick Start Script for DCF Surface + Target Adapter Validation
# Usage: ./quick-start.sh

set -e

DCF_DIR="$HOME/Documents/dcf"
COMPANION_PORT=8472
COMPANION_DB="$HOME/.dcf/dcf-electron-test.db"

echo "🚀 Starting DCF Surface Validation Environment..."
echo ""

# Step 1: Check if Companion is running
if lsof -i :$COMPANION_PORT > /dev/null 2>&1; then
    echo "✅ Companion already running on port $COMPANION_PORT"
else
    echo "⚠️  Starting Companion server on port $COMPANION_PORT..."
    cd "$DCF_DIR"
    node seed/companion/index.js --port=$COMPANION_PORT --db=$COMPANION_DB &
    COMPANION_PID=$!
    sleep 3
    
    # Wait for companion to be ready
    for i in {1..10}; do
        if curl -s http://127.0.0.1:$COMPANION_PORT/rpc/health > /dev/null 2>&1; then
            echo "✅ Companion started (PID: $COMPANION_PID)"
            break
        fi
        echo "Waiting for companion... ($i/10)"
        sleep 1
    done
fi

echo ""
echo "📋 Next Steps:"
echo ""
echo "1️⃣  Launch Electron Surface (in macOS GUI session):"
echo "   cd $DCF_DIR/packages/desktop-electron"
echo "   npm start"
echo ""
echo "2️⃣  Load Chrome Extension (in Chrome browser):"
echo "   - Open chrome://extensions"
echo "   - Enable 'Developer mode'"
echo "   - Click 'Load unpacked'"
echo "   - Select: $DCF_DIR/packages/target-adapter-chrome"
echo ""
echo "3️⃣  Test with BrowserClaw:"
echo "   - Open https://chatgpt.com/ in BrowserClaw browser"
echo "   - Use BrowserClaw MCP tools to interact with DCF Surface"
echo ""
echo "💡 Tips:"
echo "   - Electron window: 400x600, transparent, always-on-top"
echo "   - Extension popup: Shows current URL + 'Test Read' button"
echo "   - Companion DB: $COMPANION_DB"
echo ""
echo "Press Ctrl+C to stop Companion when done."

# Keep script running
wait $COMPANION_PID
