from pathlib import Path
from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PNG = ROOT / "marker" / "homeeasy-ar-card.png"
PATT = ROOT / "marker" / "homeeasy-ar-card.patt"
PDF = ROOT / "marker" / "HomeEasy_AR_Card_A4.pdf"


image = Image.open(PNG).convert("RGB")
assert image.size == (1800, 1800)
assert image.getpixel((0, 0)) == (0, 0, 0)
assert image.getpixel((449, 900)) == (0, 0, 0)
assert image.getpixel((800, 600)) == (255, 255, 255)
assert image.getpixel((900, 900)) == (0, 0, 0)

blocks = PATT.read_text(encoding="ascii").strip().split("\n\n")
assert len(blocks) == 4
for block in blocks:
    rows = block.splitlines()
    assert len(rows) == 48
    assert all(len(row.split()) == 16 for row in rows)
values = [int(value) for block in blocks for value in block.split()]
assert len(values) == 4 * 3 * 16 * 16
assert min(values) == 0 and max(values) == 255

reader = PdfReader(str(PDF))
assert len(reader.pages) == 1
page = reader.pages[0]
width_mm = float(page.mediabox.width) * 25.4 / 72
height_mm = float(page.mediabox.height) * 25.4 / 72
assert abs(width_mm - 210) < 0.2
assert abs(height_mm - 297) < 0.2
text = page.extract_text()
assert "TARJETA AR HOMEEASY" in text
assert "Coloca la cruz donde irá el centro superior del riel." in text
assert "18 cm x 18 cm" in text
assert not reader.get_fields()
print("marker-assets: PASS")
