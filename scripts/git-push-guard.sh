#!/bin/sh
# DCF git push guard — blocks `git push --no-verify` bypass.
#
# The pre-push hook cannot intercept --no-verify (git skips it entirely).
# This shell function is the smallest owned guardrail at the correct layer.
#
# Install:
#   npm run install:guard
# Or manually add to ~/.zshrc / ~/.bashrc:
#   source /path/to/dcf/scripts/git-push-guard.sh

git() {
  if [ "$1" = "push" ]; then
    for _dcf_arg in "$@"; do
      case "$_dcf_arg" in
        --no-verify)
          echo "[dcf push-guard] ❌ git push --no-verify is blocked." >&2
          echo "[dcf push-guard] The pre-push verification gate must pass before pushing." >&2
          echo "[dcf push-guard] Run 'git push' without --no-verify." >&2
          unset _dcf_arg
          return 1
          ;;
      esac
    done
    unset _dcf_arg
  fi
  command git "$@"
}
