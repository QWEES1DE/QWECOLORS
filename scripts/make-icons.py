"""Генерирует иконки QWECOLORS из аватарки (assets-src/avatar.jpeg).
Запуск: python scripts/make-icons.py  (нужен Pillow)"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-src" / "avatar.jpeg"

def rounded(img, radius_ratio=0.22):
    size = img.size[0]
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1), radius=int(size * scale * radius_ratio), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out

def main():
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    side = min(w, h)
    src = src.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
    big = rounded(src.resize((512, 512), Image.LANCZOS))
    (ROOT / "resources").mkdir(exist_ok=True)
    (ROOT / "src" / "assets").mkdir(parents=True, exist_ok=True)
    big.resize((256, 256), Image.LANCZOS).save(ROOT / "resources" / "icon.png")
    big.save(ROOT / "resources" / "icon-512.png")
    big.save(ROOT / "resources" / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
    big.resize((256, 256), Image.LANCZOS).save(ROOT / "src" / "assets" / "icon.png")
    big.resize((128, 128), Image.LANCZOS).save(ROOT / "src" / "renderer" / "assets" / "logo.png")
    # Иконки трея: обычная и «выключено» (обесцвеченная)
    tray = big.resize((32, 32), Image.LANCZOS)
    tray.save(ROOT / "src" / "assets" / "tray.png")
    gray = tray.convert("LA").convert("RGBA")
    gray.putalpha(tray.getchannel("A").point(lambda a: int(a * 0.7)))
    gray.save(ROOT / "src" / "assets" / "tray-off.png")
    print("icons ok")

if __name__ == "__main__":
    main()
