from pathlib import Path

path = Path('seguimiento-hommy.js')
source = path.read_text(encoding='utf-8')
old = "    window.setTimeout(warmRadar, BACKGROUND_WARMUP_DELAY_MS);\n    scheduleBackgroundRefresh();\n    document.addEventListener('visibilitychange', () => {\n"
new = "    if (typeof window.IntersectionObserver === 'function') {\n      window.setTimeout(warmRadar, BACKGROUND_WARMUP_DELAY_MS);\n      scheduleBackgroundRefresh();\n    }\n    document.addEventListener('visibilitychange', () => {\n"
if source.count(old) != 1:
    raise SystemExit(f'background warmup/timer anchor mismatch: {source.count(old)}')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
