from pathlib import Path
import hashlib
import json

root = Path('.')
source_path = root / 'chrome-extension/code-units/local-agent-dialogue/main.js'
source = source_path.read_text()

old_version = "const UNIT_VERSION = '1.0.0-rc.2-local-agent-dialogue.11';"
new_version = "const UNIT_VERSION = '1.0.0-rc.2-local-agent-dialogue.12';"
if old_version not in source:
    raise SystemExit('unexpected dialogue version')
source = source.replace(old_version, new_version, 1)

old_return = """  async function returnPermissionRequest(job, permission, snap) {
    const id = permissionId(permission);
    if (!id || job.notified_permissions.has(id)) return;
    job.notified_permissions.add(id);
    job.awaiting_permission_id = id;
"""
new_return = """  async function returnPermissionRequest(job, permission, snap) {
    const id = permissionId(permission);
    if (!id) return;
    job.awaiting_permission_id = id;
    if (job.notified_permissions.has(id)) return;
    job.notified_permissions.add(id);
"""
if old_return not in source:
    raise SystemExit('permission request block not found')
source = source.replace(old_return, new_return, 1)

old_clear = "        if (job.awaiting_permission_id) job.awaiting_permission_id = '';\n"
if source.count(old_clear) != 1:
    raise SystemExit(f'unexpected transient clear count: {source.count(old_clear)}')
source = source.replace(old_clear, '', 1)
source_path.write_text(source)

for test_path in [
    root / 'tests/chrome-build.integration.test.js',
    root / 'tests/chrome-workspace-ui.test.js',
    root / 'tests/chrome-local-agent-dialogue.test.js',
]:
    text = test_path.read_text()
    text = text.replace('1.0.0-rc.2-local-agent-dialogue.11', '1.0.0-rc.2-local-agent-dialogue.12')
    test_path.write_text(text)

dialogue_test = root / 'tests/chrome-local-agent-dialogue.test.js'
test = dialogue_test.read_text()
anchor = "assert.match(code, /replyPermissionNative\\(job, decision\\)/);\n"
insert = """assert.match(code, /const id = permissionId\\(permission\\);[\\s\\S]*job\\.awaiting_permission_id = id;[\\s\\S]*if \\(job\\.notified_permissions\\.has\\(id\\)\\) return;/);
assert(!code.includes("if (job.awaiting_permission_id) job.awaiting_permission_id = '';"));
"""
if insert not in test:
    if anchor not in test:
        raise SystemExit('dialogue permission test anchor not found')
    test = test.replace(anchor, anchor + insert, 1)
summary_anchor = "  permission_decision_returns_to_same_session: true,\n"
summary_insert = "  permission_wait_survives_transient_missing_snapshot: true,\n"
if summary_insert not in test:
    if summary_anchor not in test:
        raise SystemExit('dialogue summary anchor not found')
    test = test.replace(summary_anchor, summary_anchor + summary_insert, 1)
dialogue_test.write_text(test)

index_path = root / 'releases/chrome/official-index.json'
index = json.loads(index_path.read_text())
unit = next((item for item in index['units'] if item['id'] == 'dcf.firstparty.local-agent-dialogue'), None)
if not unit:
    raise SystemExit('dialogue unit missing from official index')
unit['version'] = '1.0.0-rc.2-local-agent-dialogue.12'
unit['hash'] = hashlib.sha256(source.encode()).hexdigest()
index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')

adr_path = root / 'docs/adr/2026-07-19-dcf-dialogue-activity-timeout-permission-delegation.md'
adr = adr_path.read_text()
section = """

## Permission-wait identity retention correction

A returned permission request remains the active permission identity until its native reply succeeds or the delegated job ends. A polling snapshot that temporarily omits the permission must not clear `awaiting_permission_id`. The permission request path refreshes that identity before duplicate-return suppression, so the same OpenCode permission is not resent to ChatGPT but remains eligible to receive the matching decision. This prevents a transient permission-endpoint gap from turning a valid decision into a request/session/permission mismatch.
"""
if '## Permission-wait identity retention correction' not in adr:
    adr = adr.rstrip() + section + '\n'
adr_path.write_text(adr)

current_path = root / 'docs/current-state.md'
current = current_path.read_text()
line = "- dialogue `.12` retains the notified permission identity across transient snapshots that omit the permission; only a successful native permission reply or job teardown clears it, preventing valid conversation decisions from being rejected as request/session mismatches;\n"
if line not in current:
    marker = "- permission requests are intermediate events and do not create a second final result;\n"
    if marker not in current:
        raise SystemExit('current-state permission marker not found')
    current = current.replace(marker, marker + line, 1)
current_path.write_text(current)
