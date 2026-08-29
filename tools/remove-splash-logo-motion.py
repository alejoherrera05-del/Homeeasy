from pathlib import Path

p = Path('index.html')
raw = p.read_bytes()
text = raw.decode('utf-8')
newline = '\r\n' if b'\r\n' in raw else '\n'
s = text.replace('\r\n', '\n')
original = s

motion = '''    animation: introLogoFloat 3.8s ease-in-out infinite;
    will-change: transform;
}
@keyframes introLogoFloat {
    0%, 100% { transform: translateY(2px); }
    50% { transform: translateY(-6px); }
}
'''
static = '''}
'''
if motion not in s:
    raise SystemExit('Splash logo motion block not found')
s = s.replace(motion, static, 1)

reduce_motion = '''
@media (prefers-reduced-motion: reduce) {
    .logo-triangulo { animation: none !important; transform: none !important; }
}
'''
if reduce_motion not in s:
    raise SystemExit('Splash reduced-motion block not found')
s = s.replace(reduce_motion, '\n', 1)

if s == original:
    raise SystemExit('No changes applied')
if 'introLogoFloat' in s:
    raise SystemExit('Motion reference still present')
if 'drop-shadow(0 11px 15px' not in s:
    raise SystemExit('Logo depth effect was unexpectedly removed')

out = s if newline == '\n' else s.replace('\n', '\r\n')
p.write_bytes(out.encode('utf-8'))
print('Removed splash logo motion only')
