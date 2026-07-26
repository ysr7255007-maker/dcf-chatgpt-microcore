#!/usr/bin/env node
/**
 * doctor.js — Environment self-diagnosis for DCF development.
 * Checks: Node version, git hooks installation, dist build state.
 * Exits non-zero when any check fails.
 */
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const MIN_NODE = 18;

let failures = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}

// --- 1. Node version ---
console.log("[doctor] Node version");
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor >= MIN_NODE) {
  ok(`Node ${process.versions.node} (>= ${MIN_NODE} required)`);
} else {
  fail(`Node ${process.versions.node} found, >= ${MIN_NODE} required`);
}

// --- 2. Git hooks installation ---
console.log("[doctor] Git hooks");
try {
  const hooksPath = execFileSync("git", ["config", "core.hooksPath"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (hooksPath === "scripts") {
    ok(`core.hooksPath = scripts`);
  } else {
    fail(`core.hooksPath = "${hooksPath || "(unset)"}", expected "scripts". Run: npm run prepare`);
  }
} catch {
  fail("Not a git repository or git unavailable. Run: npm run prepare");
}

// Verify pre-push hook file exists
const prePush = path.join(root, "scripts", "pre-push");
if (fs.existsSync(prePush)) {
  ok("scripts/pre-push exists");
} else {
  fail("scripts/pre-push missing");
}

// --- 3. Dist state ---
console.log("[doctor] Dist state");
const distDir = path.join(root, "dist");
const chromeExt = path.join(distDir, "dcf-chrome-extension");
const releaseManifest = path.join(distDir, "release-manifest.json");

if (fs.existsSync(distDir)) {
  ok("dist/ exists");
} else {
  fail("dist/ missing. Run: npm run build");
}

if (fs.existsSync(chromeExt)) {
  ok("dist/dcf-chrome-extension/ exists");
} else {
  fail("dist/dcf-chrome-extension/ missing. Run: npm run build:chrome");
}

if (fs.existsSync(releaseManifest)) {
  ok("dist/release-manifest.json exists");
} else {
  fail("dist/release-manifest.json missing. Run: npm run build:chrome");
}

// --- Summary ---
console.log("");
if (failures > 0) {
  console.error(`[doctor] ${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("[doctor] All checks passed.");
}
