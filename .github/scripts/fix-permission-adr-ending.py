from pathlib import Path

path = Path('docs/adr/2026-07-19-dcf-dialogue-activity-timeout-permission-delegation.md')
path.write_text(path.read_text().rstrip() + '\n')
