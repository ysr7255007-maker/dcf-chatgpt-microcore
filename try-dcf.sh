#!/bin/bash
# DCF Companion - One-Click Startup Script
# Usage: ./try-dcf.sh

set -e

DCF_DIR="$HOME/Documents/dcf"
DB_PATH="$HOME/.dcf/dcf-trial.db"
PORT=8472

echo "🚀 Starting DCF Companion..."
echo ""

# Check if port already in use
if lsof -i :$PORT > /dev/null 2>&1; then
    echo "⚠️  Port $PORT is already in use."
    echo "   Stopping existing process..."
    lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Create database directory
mkdir -p "$(dirname $DB_PATH)"

# Start companion
cd "$DCF_DIR"
node seed/companion/index.js --port=$PORT --db=$DB_PATH &
COMPANION_PID=$!

echo "✅ Companion started (PID: $COMPANION_PID)"
echo "📍 Database: $DB_PATH"
echo ""
echo "🌟 Now you can:"
echo ""
echo "   1️⃣  Open http://localhost:$PORT/rpc/health to verify"
echo "   2️⃣  Try G6 patch management at file://$DCF_DIR/seed/surface/g6-patches.html"
echo "   3️⃣  Run quick test:"
echo ""
echo "      curl http://localhost:$PORT/rpc/patch/query"
echo ""
echo "   Press Ctrl+C to stop when done."
echo ""

# Wait for companion
wait $COMPANION_PID
