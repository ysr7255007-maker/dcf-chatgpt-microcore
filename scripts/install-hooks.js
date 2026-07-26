#!/usr/bin/env node
/**
 * install-hooks.js — Configure git to use version-controlled hooks from scripts/.
 * Runs automatically via "prepare" in package.json (npm install / npm ci).
 * Idempotent: safe to run multiple times.
 */
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

try {
  // Point git hooks path to the scripts directory (which contains pre-push).
  execFileSync("git", ["config", "core.hooksPath", "scripts"], { cwd: root, stdio: "inherit" });
  console.log("[dcf hooks] core.hooksPath → scripts/");
} catch {
  // Not a git repo (e.g. npm pack) — skip silently.
  console.log("[dcf hooks] Not a git repository, skipping hook installation.");
}
