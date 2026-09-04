from pathlib import Path

path = Path('seguimiento-hommy.js')
source = path.read_text(encoding='utf-8')
old = "    scheduleBackgroundRefresh();\n    document.addEventListener('visibilitychange', () => {\n"
new = "    if (typeof window.IntersectionObserver === 'function') scheduleBackgroundRefresh();\n    document.addEventListener('visibilitychange', () => {\n"
if source.count(old) != 1:
    raise SystemExit(f'background timer anchor mismatch: {source.count(old)}')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
