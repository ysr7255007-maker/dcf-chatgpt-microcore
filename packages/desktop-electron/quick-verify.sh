#!/usr/bin/env bash

# DCF Surface Electron - Quick GUI Verification
# Run this script in a macOS Desktop session (not SSH/tmux) to test the window.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DCF_ROOT="$(realpath "$SCRIPT_DIR/../../..")"

echo "DCF Surface Electron - Quick Verification"
echo "========================================="
echo ""

cd "$SCRIPT_DIR"

# Check if electron is installed
if [ ! -d "node_modules/electron" ]; then
    echo "⚠️  Running 'npm install' first..."
    npm install
    echo ""
fi

# Check surface page exists
HTML_PATH="$DCF_ROOT/seed/surface/g2-dashboard.html"
if [ ! -f "$HTML_PATH" ]; then
    echo "❌ ERROR: g2-dashboard.html not found at $HTML_PATH"
    exit 1
fi
echo "✓ Found Surface page: $(wc -l < "$HTML_PATH") lines"

# Verify Companion HTTP server
COMPANION_HOST="http://127.0.0.1:8472"
echo ""
echo "📡 Testing Companion HTTP connectivity..."
RESPONSE=$(curl -s --max-time 2 "$COMPANION_HOST/rpc/status" 2>/dev/null || echo "UNREACHABLE")
if [[ "$RESPONSE" == *"UNREACHABLE"* ]]; then
    echo "⚠️  Companion server unreachable. Start it with:"
    echo "   node ../../seed/companion/index.js"
else
    echo "✓ Companion server reachable"
fi

# Launch Electron window
echo ""
echo "🖥️  Starting DCF Surface (close with Cmd+W or Ctrl+C)..."
echo "   Window config:"
echo "     • Always on top: yes"
echo "     • Frameless: yes"
echo "     • Transparent: yes"
echo "     • Size: 400×600"
echo ""
read -p "Press Enter to launch or Ctrl+C to cancel..." 2>/dev/null || true

timeout 30 npm start 2>&1 | tee /tmp/dcf-surface-log.txt || {
    EXIT_CODE=${PIPESTATUS[0]}
    if [ $EXIT_CODE -eq 124 ]; then
        echo ""
        echo "✓ Manual timeout after 30s (expected for testing)"
    else
        echo ""
        echo "ℹ️  Process exited with code: $EXIT_CODE"
        # Show error if any
        grep -i "error\|failed\|cannot" /tmp/dcf-surface-log.txt | tail -5 || true
    fi
}

echo ""
echo "Verification complete."
