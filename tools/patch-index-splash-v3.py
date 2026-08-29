from pathlib import Path

p = Path('index.html')
raw = p.read_bytes()
text = raw.decode('utf-8')
newline = '\r\n' if b'\r\n' in raw else '\n'
s = text.replace('\r\n', '\n')
original = s

old_css = '''.curtain-hidden { opacity: 0 !important; visibility: hidden !important; pointer-events: none; }
.main-container { width: 100%; max-width: 420px; text-align: center; padding: 20px; }
.logo-triangulo { width:75px; margin-bottom:10px; }
.version-tag { font-size:.8rem; letter-spacing:2px; opacity:.7; margin-bottom:30px; }
.hommy-static { width:260px; margin-bottom:40px; }
'''
new_css = '''.curtain-hidden { opacity: 0 !important; visibility: hidden !important; pointer-events: none; }
.main-container { width: 100%; max-width: 420px; text-align: center; padding: 20px; }

/* HomeEasy 3.0 · marca del splash. Solo presentación; no altera el flujo de carga. */
.intro-logo-float {
    position: relative;
    width: 104px;
    height: 98px;
    margin: 0 auto 4px;
    display: grid;
    place-items: center;
    isolation: isolate;
}
.intro-logo-float::before {
    content: '';
    position: absolute;
    width: 86px;
    height: 64px;
    border-radius: 50%;
    background: radial-gradient(ellipse at center, rgba(226,190,111,.30) 0%, rgba(226,190,111,.12) 42%, rgba(226,190,111,0) 74%);
    filter: blur(8px);
    transform: translateY(5px);
    z-index: 0;
    pointer-events: none;
}
.intro-logo-float::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 7px;
    width: 54px;
    height: 10px;
    border-radius: 50%;
    background: rgba(78,25,39,.23);
    filter: blur(8px);
    transform: translateX(-50%);
    z-index: 0;
    pointer-events: none;
}
.logo-triangulo {
    position: relative;
    z-index: 1;
    width: 72px;
    height: auto;
    margin: 0;
    filter: drop-shadow(0 11px 15px rgba(91,28,44,.22)) drop-shadow(0 2px 5px rgba(226,190,111,.18));
    animation: introLogoFloat 3.8s ease-in-out infinite;
    will-change: transform;
}
@keyframes introLogoFloat {
    0%, 100% { transform: translateY(2px); }
    50% { transform: translateY(-6px); }
}
.intro-brand {
    margin: 2px 0 4px;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
    font-size: clamp(2.45rem, 9vw, 3.05rem);
    font-weight: 590;
    line-height: .98;
    letter-spacing: -.055em;
    text-shadow: 0 8px 22px rgba(93,28,45,.13);
}
.intro-home { color: #fff; }
.intro-easy { color: var(--home-yellow); }
.version-tag {
    margin: 11px 0 29px;
    color: rgba(255,255,255,.78);
    font-size: .76rem;
    font-weight: 500;
    letter-spacing: .16em;
    opacity: 1;
}
.hommy-static { width:260px; margin-bottom:40px; }

@media (prefers-reduced-motion: reduce) {
    .logo-triangulo { animation: none !important; transform: none !important; }
}
'''
if old_css not in s:
    raise SystemExit('Splash CSS marker not found')
s = s.replace(old_css, new_css, 1)

old_html = '''            <img src="triangulogold.png" class="logo-triangulo" alt="Logo" onerror="this.src='triangulo.png'">
            <h1>HomeEasy</h1>
            <div class="version-tag">Sistema Hommy 2.0</div>'''
new_html = '''            <div class="intro-logo-float" aria-hidden="true">
                <img src="triangulogold.png" class="logo-triangulo" alt="" onerror="this.src='triangulo.png'">
            </div>
            <h1 class="intro-brand" aria-label="HomeEasy"><span class="intro-home">Home</span><span class="intro-easy">Easy</span></h1>
            <div class="version-tag">Sistema Hommy 3.0</div>'''
if old_html not in s:
    raise SystemExit('Splash HTML marker not found')
s = s.replace(old_html, new_html, 1)

if s == original:
    raise SystemExit('No changes applied')

out = s if newline == '\n' else s.replace('\n', '\r\n')
p.write_bytes(out.encode('utf-8'))
print('PATCHED index.html splash only')
