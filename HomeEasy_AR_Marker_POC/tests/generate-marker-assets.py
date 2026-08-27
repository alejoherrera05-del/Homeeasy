from pathlib import Path
from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
MARKER_DIR = ROOT / "marker"
TMP_DIR = ROOT / "tmp" / "pdfs"
PNG_PATH = MARKER_DIR / "homeeasy-ar-card.png"
PATT_PATH = MARKER_DIR / "homeeasy-ar-card.patt"
PDF_PATH = MARKER_DIR / "HomeEasy_AR_Card_A4.pdf"
PREVIEW_PATH = TMP_DIR / "HomeEasy_AR_Card_A4-preview.png"

MARKER_PX = 1800
GRID = 16
PATTERN_RATIO = 0.5
MARKER_SIZE_MM = 180


def build_inner_pattern():
    pixels = [[255 for _ in range(GRID)] for _ in range(GRID)]

    def fill(x0, y0, x1, y1, value=0):
        for y in range(y0, y1):
            for x in range(x0, x1):
                pixels[y][x] = value

    # Asymmetric orientation features. The center plus is the installation cross.
    fill(1, 1, 5, 5)
    for x in range(10, 15):
        pixels[1][x] = 0
        pixels[5][x] = 0
    for y in range(1, 6):
        pixels[y][10] = 0
        pixels[y][14] = 0
    fill(5, 7, 11, 9)
    fill(7, 5, 9, 11)
    for row in range(11, 15):
        fill(1, row, row - 8, row + 1)
    fill(11, 10, 13, 15)
    fill(14, 12, 15, 15)
    return pixels


def rotate_clockwise(matrix):
    return [list(row) for row in zip(*matrix[::-1])]


def encode_patt(inner):
    blocks = []
    oriented = inner
    for _ in range(4):
        channel_rows = []
        for _channel in range(3):  # Official AR.js writer emits B, G, R.
            channel_rows.extend(" ".join(f"{value:3d}" for value in row) for row in oriented)
        blocks.append("\n".join(channel_rows))
        oriented = rotate_clockwise(oriented)
    return "\n\n".join(blocks) + "\n"


def create_marker_png(inner):
    image = Image.new("RGB", (MARKER_PX, MARKER_PX), "black")
    draw = ImageDraw.Draw(image)
    border = int(MARKER_PX * (1 - PATTERN_RATIO) / 2)
    cell = (MARKER_PX - border * 2) // GRID
    inner_size = cell * GRID
    inner_left = (MARKER_PX - inner_size) // 2
    draw.rectangle((inner_left, inner_left, inner_left + inner_size - 1, inner_left + inner_size - 1), fill="white")
    for y, row in enumerate(inner):
        for x, value in enumerate(row):
            if value == 0:
                x0 = inner_left + x * cell
                y0 = inner_left + y * cell
                draw.rectangle((x0, y0, x0 + cell - 1, y0 + cell - 1), fill="black")
    image.save(PNG_PATH, format="PNG", optimize=True, dpi=(254, 254))
    return image


def create_pdf():
    page_w, page_h = A4
    pdf = canvas.Canvas(str(PDF_PATH), pagesize=A4, pageCompression=1)
    pdf.setTitle("Tarjeta AR HomeEasy - marcador 18 cm")
    pdf.setAuthor("HomeEasy")
    pdf.setSubject("Marcador físico para POC AR.js marker-based")

    pdf.setFillColorRGB(0.08, 0.08, 0.08)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawCentredString(page_w / 2, page_h - 18 * mm, "TARJETA AR HOMEEASY")
    pdf.setFont("Helvetica", 11)
    pdf.drawCentredString(page_w / 2, page_h - 26 * mm, "Coloca la cruz donde irá el centro superior del riel.")
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawCentredString(page_w / 2, page_h - 33 * mm, "IMPRIME AL 100% - TAMAÑO REAL - NO AJUSTAR A PÁGINA")

    marker_x = (page_w - MARKER_SIZE_MM * mm) / 2
    marker_y = 48 * mm
    pdf.drawImage(str(PNG_PATH), marker_x, marker_y, MARKER_SIZE_MM * mm, MARKER_SIZE_MM * mm, preserveAspectRatio=True, mask="auto")

    pdf.setStrokeColorRGB(0.35, 0.35, 0.35)
    pdf.setLineWidth(0.35)
    guide_y = marker_y - 7 * mm
    pdf.line(marker_x, guide_y, marker_x + MARKER_SIZE_MM * mm, guide_y)
    pdf.line(marker_x, guide_y - 2 * mm, marker_x, guide_y + 2 * mm)
    pdf.line(marker_x + MARKER_SIZE_MM * mm, guide_y - 2 * mm, marker_x + MARKER_SIZE_MM * mm, guide_y + 2 * mm)
    pdf.setFillColorRGB(0.15, 0.15, 0.15)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawCentredString(page_w / 2, guide_y - 5 * mm, "CONTROL: EL CUADRADO NEGRO DEBE MEDIR 18 cm x 18 cm")
    pdf.setFont("Helvetica", 8.5)
    pdf.drawCentredString(page_w / 2, 20 * mm, "Mantén la tarjeta plana, sin reflejos fuertes y completamente visible en cámara.")
    pdf.drawCentredString(page_w / 2, 15 * mm, "La cruz central representa el punto de instalación del producto.")
    pdf.showPage()
    pdf.save()


def main():
    MARKER_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    inner = build_inner_pattern()
    marker = create_marker_png(inner)
    PATT_PATH.write_text(encode_patt(inner), encoding="ascii", newline="\n")
    create_pdf()
    marker.resize((900, 900), Image.Resampling.NEAREST).save(PREVIEW_PATH)
    print(f"PNG={PNG_PATH}")
    print(f"PATT={PATT_PATH}")
    print(f"PDF={PDF_PATH}")
    print(f"PREVIEW={PREVIEW_PATH}")


if __name__ == "__main__":
    main()
