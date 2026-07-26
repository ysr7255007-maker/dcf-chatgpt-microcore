'use strict';
const fs = require('fs');

const required = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID'];
for (const name of required) if (!process.env[name]) throw new Error(`missing environment variable ${name}`);
const zipPath = process.env.CWS_ZIP_PATH || 'dist/dcf-chrome-extension-1.0.0-rc.2.zip';
if (!fs.existsSync(zipPath)) throw new Error(`Chrome ZIP not found: ${zipPath}`);

async function json(response, label) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}
async function main() {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.CWS_CLIENT_ID, client_secret: process.env.CWS_CLIENT_SECRET, refresh_token: process.env.CWS_REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  const token = await json(tokenResponse, 'OAuth refresh');
  const itemPath = `publishers/${encodeURIComponent(process.env.CWS_PUBLISHER_ID)}/items/${encodeURIComponent(process.env.CWS_EXTENSION_ID)}`;
  const base = `https://chromewebstore.googleapis.com/v2/${itemPath}`;
  const headers = { authorization: `Bearer ${token.access_token}` };
  let upload = await json(await fetch(`https://chromewebstore.googleapis.com/upload/v2/${itemPath}:upload`, { method: 'POST', headers: { ...headers, 'content-type': 'application/zip' }, body: fs.readFileSync(zipPath) }), 'Chrome Web Store upload');
  for (let attempt = 0; upload.uploadState === 'UPLOAD_IN_PROGRESS' && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    upload = await json(await fetch(`${base}:fetchStatus`, { method: 'GET', headers }), 'Chrome Web Store upload status');
  }
  if (!['SUCCEEDED', 'SUCCESS'].includes(String(upload.uploadState || upload.upload_state || '').replace(/^UPLOAD_/, ''))) {
    const state = upload.uploadState || upload.upload_state;
    if (state && state !== 'UPLOAD_SUCCEEDED') throw new Error(`Chrome Web Store upload did not succeed: ${JSON.stringify(upload)}`);
  }
  const publish = await json(await fetch(`${base}:publish`, { method: 'POST', headers }), 'Chrome Web Store publish');
  console.log(JSON.stringify({ ok: true, item: process.env.CWS_EXTENSION_ID, upload_state: upload.uploadState || upload.upload_state || 'unknown', publish_status: publish.status || publish }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
