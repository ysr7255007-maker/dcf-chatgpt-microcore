#!/usr/bin/env node
/**
 * install-push-guard.js — Install the DCF git push guard into the user's shell.
 * Appends a source line to ~/.zshrc or ~/.bashrc (idempotent).
 * Run via: npm run install:guard
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const guardPath = path.resolve(__dirname, "git-push-guard.sh");
const sourceLine = `source "${guardPath}"`;
const marker = "# DCF git push guard";

// Detect shell rc file
const shell = process.env.SHELL || "/bin/zsh";
const rcFile =
  shell.includes("zsh")
    ? path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc");

// Idempotent: skip if already installed
if (fs.existsSync(rcFile)) {
  const content = fs.readFileSync(rcFile, "utf8");
  if (content.includes("git-push-guard.sh")) {
    console.log(`[dcf push-guard] Already installed in ${rcFile}`);
    process.exit(0);
  }
}

// Append
const entry = `\n${marker}\n${sourceLine}\n`;
fs.appendFileSync(rcFile, entry, "utf8");
console.log(`[dcf push-guard] ✅ Installed into ${rcFile}`);
console.log(`[dcf push-guard] Restart your shell or run: source ${rcFile}`);
