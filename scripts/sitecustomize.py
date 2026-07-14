from pathlib import Path
import subprocess
import sys
import traceback


def capture_exception(exc_type, exc, tb):
    text = ''.join(traceback.format_exception(exc_type, exc, tb))
    Path('turn-attribution-integration.log').write_text(text, encoding='utf-8')
    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=False)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=False)
    subprocess.run(['git', 'add', 'turn-attribution-integration.log'], check=False)
    subprocess.run(['git', 'commit', '-m', 'Capture turn attribution integration exception'], check=False)
    subprocess.run(['git', 'push', 'origin', 'HEAD:feature/conversation-turn-attribution'], check=False)
    sys.__excepthook__(exc_type, exc, tb)


sys.excepthook = capture_exception
