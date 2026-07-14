from pathlib import Path

path = Path(__file__).with_name('apply-runtime-performance-attribution-integration.py')
if path.exists():
    text = path.read_text(encoding='utf-8')
    old = '''    controller = replace_once(controller, "    if (!attribution || attribution.status !== 'running') return;\\n    const start = Number(entry.startTime || 0);", "    if (!acceptsAttributionEntry(entry)) return;\\n    const start = Number(entry.startTime || 0);", 'loaf session boundary')
    controller = replace_once(controller, "    if (!attribution || attribution.status !== 'running') return;\\n    const start = Number(entry.startTime || 0);", "    if (!acceptsAttributionEntry(entry)) return;\\n    const start = Number(entry.startTime || 0);", 'event session boundary')'''
    new = '''    old_entry_boundary = "    if (!attribution || attribution.status !== 'running') return;\\n    const start = Number(entry.startTime || 0);"
    new_entry_boundary = "    if (!acceptsAttributionEntry(entry)) return;\\n    const start = Number(entry.startTime || 0);"
    if controller.count(old_entry_boundary) != 2:
        raise RuntimeError(f'ordered entry boundaries: expected two matches, found {controller.count(old_entry_boundary)}')
    controller = controller.replace(old_entry_boundary, new_entry_boundary, 1)
    controller = controller.replace(old_entry_boundary, new_entry_boundary, 1)'''
    if old in text:
        path.write_text(text.replace(old, new, 1), encoding='utf-8')
