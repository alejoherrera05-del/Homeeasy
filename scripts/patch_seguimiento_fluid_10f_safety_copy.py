from pathlib import Path

path = Path('seguimiento-hommy.js')
source = path.read_text(encoding='utf-8')
old = "    safety.textContent = 'El radar se actualiza en segundo plano; el análisis completo solo se recalcula cuando hace falta.';\n"
new = "    safety.textContent = 'El radar se actualiza en segundo plano · no envía mensajes ni modifica la cotización. El análisis completo solo se recalcula cuando hace falta.';\n"
if source.count(old) != 1:
    raise SystemExit(f'10F safety copy anchor mismatch: {source.count(old)}')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
