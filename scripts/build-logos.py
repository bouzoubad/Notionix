"""Derive app logos from branding/notionix-brand-sheet.png.

Outputs:
  src/renderer/src/assets/logo-wordmark-{light,dark}.png  transparent banner (dark text / white text)
  src/renderer/src/assets/logo-tile-{light,dark}.png      app tile, white (left) and dark (second)
  docs/brand/notionix-{light,dark}.png                    copies of the banners for the README
  build/icon.png, resources/icon.png                      app icon (dark tile)
Then `iconutil`/PIL produce build/icon.icns and build/icon.ico.

Run: python3 -I scripts/build-logos.py   (needs Pillow, numpy; macOS iconutil for .icns)
"""
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / 'branding' / 'notionix-brand-sheet.png'
ASSETS = ROOT / 'src' / 'renderer' / 'src' / 'assets'

# Pixel boxes in the 1254x1254 brand sheet: (left, top, right, bottom)
WORDMARK_BOX = (215, 145, 1055, 355)
TILE_LIGHT_BOX = (109, 535, 313, 738)  # white tile, leftmost
TILE_DARK_BOX = (413, 533, 622, 739)  # dark tile, second from left
TILE_RADIUS_RATIO = 0.22

sheet = Image.open(SHEET).convert('RGB')
px = np.asarray(sheet).astype(float)

NAVY = np.array([18.0, 20.0, 23.0])
PURPLE = np.array([109.0, 111.0, 248.0])
WHITE_INK = np.array([246.0, 246.0, 250.0])


def wordmark(ink: np.ndarray) -> Image.Image:
    """Transparent banner: each pixel is a mix of background and navy/purple ink."""
    l, t, r, b = WORDMARK_BOX
    region = px[t:b, l:r]
    bg = np.median(px[20:60, 20:60].reshape(-1, 3), axis=0)
    out = np.zeros(region.shape[:2] + (4,))
    best_alpha = np.zeros(region.shape[:2])
    best_color = np.zeros(region.shape)
    best_err = np.full(region.shape[:2], np.inf)
    for solid, color in ((NAVY, ink), (PURPLE, PURPLE)):
        d = solid - bg
        tt = np.clip(((region - bg) @ d) / (d @ d), 0, 1)
        err = np.linalg.norm(region - (bg + tt[..., None] * d), axis=2)
        better = err < best_err
        best_err = np.where(better, err, best_err)
        best_alpha = np.where(better, tt, best_alpha)
        best_color = np.where(better[..., None], color, best_color)
    out[..., :3] = best_color
    out[..., 3] = np.where(best_alpha < 0.03, 0, best_alpha) * 255
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def tile(box: tuple[int, int, int, int]) -> Image.Image:
    img = sheet.crop(box).convert('RGBA')
    scale = 4
    w, h = img.size
    big = img.resize((w * scale, h * scale), Image.LANCZOS)
    mask = Image.new('L', big.size, 0)
    inset = 3 * scale
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, big.width - inset - 1, big.height - inset - 1),
        radius=int(min(w, h) * scale * TILE_RADIUS_RATIO),
        fill=255,
    )
    big.putalpha(mask)
    return big


def trimmed(img: Image.Image, pad: int = 0) -> Image.Image:
    box = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    img = img.crop(box)
    if pad:
        canvas = Image.new('RGBA', (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
        canvas.paste(img, (pad, pad))
        img = canvas
    return img


def square(img: Image.Image, size: int) -> Image.Image:
    img = img.resize((size, size), Image.LANCZOS)
    return img


ASSETS.mkdir(parents=True, exist_ok=True)
trimmed(wordmark(NAVY), 8).save(ASSETS / 'logo-wordmark-light.png', optimize=True)
trimmed(wordmark(WHITE_INK), 8).save(ASSETS / 'logo-wordmark-dark.png', optimize=True)

# Copies for the README header (GitHub serves them next to the docs).
brand = ROOT / 'docs' / 'brand'
brand.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ASSETS / 'logo-wordmark-light.png', brand / 'notionix-light.png')
shutil.copyfile(ASSETS / 'logo-wordmark-dark.png', brand / 'notionix-dark.png')

tile_light = tile(TILE_LIGHT_BOX)
tile_dark = tile(TILE_DARK_BOX)
square(tile_light, 256).save(ASSETS / 'logo-tile-light.png', optimize=True)
square(tile_dark, 256).save(ASSETS / 'logo-tile-dark.png', optimize=True)

icon = square(tile_dark, 1024)
icon.save(ROOT / 'build' / 'icon.png', optimize=True)
square(tile_dark, 512).save(ROOT / 'resources' / 'icon.png', optimize=True)

with tempfile.TemporaryDirectory() as tmp:
    iconset = Path(tmp) / 'icon.iconset'
    iconset.mkdir()
    for base in (16, 32, 128, 256, 512):
        square(tile_dark, base).save(iconset / f'icon_{base}x{base}.png')
        square(tile_dark, base * 2).save(iconset / f'icon_{base}x{base}@2x.png')
    if shutil.which('iconutil'):
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(ROOT / 'build' / 'icon.icns')], check=True)
icon.save(ROOT / 'build' / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('ok')
