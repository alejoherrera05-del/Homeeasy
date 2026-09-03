from pathlib import Path

followup = Path('hommy_backend/followup.py')
render = Path('render.yaml')
tests = Path('tests/test_hommy_whatsapp_context.py')

source = followup.read_text(encoding='utf-8')
source = source.replace('minimum_hours = 36.0', 'minimum_hours = max(12.0, min(float(os.getenv("HOMMY_FIRST_SILENCE_MIN_HOURS", "36")), 120.0))', 1)
source = source.replace('description = re.sub(r"\\\\s+", " ", _clean(quote.get("description"), 180)).strip(" .,-")\n    product_phrase = f" la propuesta de {description}" if description else " la propuesta que te enviamos"\n    message = (\n        f"Hola {first_name} 😊 Quería saber si alcanzaste a revisar{product_phrase}. "\n        "Si te quedó alguna duda sobre la tela, las medidas o algún ajuste, con gusto te ayudo a revisarlo. "\n        "¿Hay algún detalle que quieras que revisemos?"\n    )', 'description = re.sub(r"\\s+", " ", _clean(quote.get("description"), 120)).strip(" .,-")\n    product_hint = f" para tu {description.lower()}" if description and len(description.split()) <= 12 else ""\n    message = (\n        f"Hola {first_name} 😊 Quería saber si alcanzaste a revisar la propuesta que te enviamos{product_hint}. "\n        "Si te quedó alguna duda sobre la tela, las medidas o el sistema, con gusto te ayudo. "\n        "¿Hay algún detalle que quieras ajustar o comparar?"\n    )', 1)
source = source.replace('"Si te quedó alguna duda sobre la tela, las medidas o algún ajuste, con gusto te ayudo a revisarlo. "\n            "¿Hay algún detalle que quieras que revisemos?"', '"Si te quedó alguna duda sobre la tela, las medidas o el sistema, con gusto te ayudo. "\n            "¿Hay algún detalle que quieras ajustar o comparar?"', 1)
followup.write_text(source, encoding='utf-8')

render_text = render.read_text(encoding='utf-8')
needle = '      - key: HOMMY_FOLLOWUP_MAX_OUTPUT_TOKENS\n        value: "700"\n'
addition = '      - key: HOMMY_FIRST_SILENCE_MIN_HOURS\n        value: "36"\n'
if addition not in render_text:
    render_text = render_text.replace(needle, needle + addition, 1)
render.write_text(render_text, encoding='utf-8')

test_text = tests.read_text(encoding='utf-8')
if 'self.assertIn("ajustar o comparar", result["plan"]["message"])' not in test_text:
    test_text = test_text.replace('self.assertIn("propuesta", result["plan"]["message"].lower())', 'self.assertIn("propuesta", result["plan"]["message"].lower())\n        self.assertIn("ajustar o comparar", result["plan"]["message"])', 1)
tests.write_text(test_text, encoding='utf-8')

print('Hommy 10C2 polish applied')
