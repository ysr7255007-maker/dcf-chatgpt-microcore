from pathlib import Path
import re
import subprocess
import traceback

ROOT = Path(__file__).resolve().parents[1]
SOURCE_COMMIT = '589386dac87c501a9a004edc37122fd70ade4811'
SOURCE_PATH = 'scripts/apply-conversation-turn-attribution.py'


def load_original():
    subprocess.run(['git', 'fetch', '--depth=40', 'origin', 'feature/conversation-turn-attribution'], cwd=ROOT, check=True)
    return subprocess.check_output(['git', 'show', f'{SOURCE_COMMIT}:{SOURCE_PATH}'], cwd=ROOT, text=True)


def make_whitespace_tolerant(source):
    source = source.replace('from pathlib import Path\n', 'from pathlib import Path\nimport re\n', 1)
    old = '''def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)
'''
    new = '''def replace_once(text, old, new, label):
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    parts = re.split(r'(\\s+)', old)
    pattern = ''.join(r'\\s+' if part.isspace() else re.escape(part) for part in parts if part)
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise RuntimeError(f'{label}: expected one match, found exact={count}, whitespace={len(matches)}')
    match = matches[0]
    return text[:match.start()] + new + text[match.end():]
'''
    if old not in source:
        raise RuntimeError('original replace_once definition missing')
    return source.replace(old, new, 1)


def capture_failure(error):
    log = ''.join(traceback.format_exception(type(error), error, error.__traceback__))
    (ROOT / 'turn-attribution-integration.log').write_text(log, encoding='utf-8')
    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], cwd=ROOT, check=False)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd=ROOT, check=False)
    subprocess.run(['git', 'add', 'turn-attribution-integration.log'], cwd=ROOT, check=False)
    subprocess.run(['git', 'commit', '-m', 'Capture turn attribution integration exception'], cwd=ROOT, check=False)
    subprocess.run(['git', 'push', 'origin', 'HEAD:feature/conversation-turn-attribution'], cwd=ROOT, check=False)


try:
    source = make_whitespace_tolerant(load_original())
    namespace = {'__file__': str(Path(__file__).resolve()), '__name__': '__main__'}
    exec(compile(source, SOURCE_PATH, 'exec'), namespace, namespace)
except Exception as error:
    capture_failure(error)
    raise
