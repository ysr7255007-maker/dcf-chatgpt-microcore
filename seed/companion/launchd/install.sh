#!/bin/bash
# G2 Companion — launchd LaunchAgent installer (per-user, no sudo).
#
# Renders seed/companion/launchd/com.dcf.companion.plist into
# ~/Library/LaunchAgents/ and bootstraps it into the user's GUI domain
# using the modern launchctl syntax (bootstrap, not the legacy `load`).
#
# Usage:
#   ./install.sh [--bin /path/to/dcf-companion] [--port 8472] \
#                [--dcf-dir "$HOME/.dcf"] [--label com.dcf.companion]
#
# Idempotent: re-running bootout's any existing instance first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

BIN="${REPO_ROOT}/dist/dcf-companion"
PORT="8472"
DCF_DIR="${HOME}/.dcf"
LABEL="com.dcf.companion"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bin)     BIN="$2"; shift 2 ;;
        --port)    PORT="$2"; shift 2 ;;
        --dcf-dir) DCF_DIR="$2"; shift 2 ;;
        --label)   LABEL="$2"; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

TEMPLATE="${SCRIPT_DIR}/com.dcf.companion.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

[[ -x "$BIN" ]] || { echo "✗ companion binary not found/executable: $BIN" >&2; echo "  build it first: node scripts/build-companion-sea.js" >&2; exit 1; }
[[ -f "$TEMPLATE" ]] || { echo "✗ template missing: $TEMPLATE" >&2; exit 1; }

mkdir -p "${DCF_DIR}/logs" "${DCF_DIR}/bin" "${HOME}/Library/LaunchAgents"

# Copy the binary into ${DCF_DIR}/bin: launchd cannot execute binaries that
# live inside TCC-protected folders (~/Documents, ~/Desktop, ~/Downloads) —
# dyld hangs during load (verified on this machine, macOS 26.5).
INSTALLED_BIN="${DCF_DIR}/bin/dcf-companion"
cp "$BIN" "$INSTALLED_BIN"
chmod 755 "$INSTALLED_BIN"

# Render template (sed with | delimiter: paths contain /)
sed -e "s|__COMPANION_BIN__|${INSTALLED_BIN}|g" \
    -e "s|__DCF_DIR__|${DCF_DIR}|g" \
    -e "s|__PORT__|${PORT}|g" \
    -e "s|__LABEL__|${LABEL}|g" \
    "$TEMPLATE" > "$PLIST_DST"

plutil -lint "$PLIST_DST"

# Modern syntax: bootout any existing instance, then bootstrap
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "✓ installed + bootstrapped: ${LABEL}"
echo "  plist:  ${PLIST_DST}"
echo "  binary: ${INSTALLED_BIN} (copied from ${BIN})"
echo "  logs:   ${DCF_DIR}/logs/companion.launchd.{out,err}.log"
echo "  status: launchctl print gui/$(id -u)/${LABEL} | head -20"
