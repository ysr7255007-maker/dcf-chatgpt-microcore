#!/bin/bash
# G2 Companion — launchd LaunchAgent uninstaller (per-user, no sudo).
#
# Boots the agent out of the user's GUI domain (modern launchctl syntax)
# and removes the rendered plist. Does NOT touch ~/.dcf data or logs.
#
# Usage:
#   ./uninstall.sh [--label com.dcf.companion]
set -euo pipefail

LABEL="com.dcf.companion"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --label) LABEL="$2"; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

PLIST_DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null; then
    echo "✓ booted out: ${LABEL}"
else
    echo "· not loaded (nothing to boot out): ${LABEL}"
fi

if [[ -f "$PLIST_DST" ]]; then
    rm "$PLIST_DST"
    echo "✓ removed: ${PLIST_DST}"
else
    echo "· plist not present: ${PLIST_DST}"
fi

echo "· data kept: ~/.dcf (remove manually if desired)"
