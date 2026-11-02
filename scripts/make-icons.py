"""Regenerates every NitroScribe icon from build/icon-source.png with smooth rounded (squircle) corners.

Requires Pillow:  python -m pip install pillow
Usage:            python scripts/make-icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'build' / 'icon-source.png'
SUPERSAMPLE = 4
# Superellipse exponent: 2 is an ellipse, higher is boxier. ~5 gives continuous, iOS-like corners.
SQUIRCLE_N = 5.0


def squircle_mask(size: int) -> Image.Image:
    """Anti-aliased squircle alpha mask of size x size."""
    big = size * SUPERSAMPLE
    points = []
    for i in range(4096):
        t = 2 * math.pi * i / 4096
        c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** (2 / SQUIRCLE_N), c)
        y = math.copysign(abs(s) ** (2 / SQUIRCLE_N), s)
        points.append(((x + 1) / 2 * big, (y + 1) / 2 * big))
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def disc(size: int, box: tuple[float, float, float, float], color: tuple[int, int, int]) -> Image.Image:
    """A solid-color layer whose alpha is an anti-aliased circle inside box (in output pixels)."""
    big = size * SUPERSAMPLE
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).ellipse([v * SUPERSAMPLE for v in box], fill=255)
    layer = Image.new('RGBA', (size, size), (*color, 255))
    layer.putalpha(mask.resize((size, size), Image.LANCZOS))
    return layer


def icon(src: Image.Image, size: int, margin: float = 0.0) -> Image.Image:
    """The artwork as a squircle tile, centered on a transparent canvas with the given margin per side."""
    inner = round(size * (1 - 2 * margin))
    tile = src.resize((inner, inner), Image.LANCZOS)
    tile.putalpha(squircle_mask(inner))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    offset = (size - inner) // 2
    canvas.alpha_composite(tile, (offset, offset))
    return canvas


def main() -> None:
    src = Image.open(SOURCE).convert('RGB')
    # App icon (exe, installer, taskbar, Start menu): a little breathing room around the tile.
    icon(src, 1024, margin=0.04).save(ROOT / 'build' / 'icon.png', optimize=True)
    icon(src, 256, margin=0.04).save(ROOT / 'resources' / 'icon.png', optimize=True)
    # In-app logo and tray: full-bleed, since they are shown small.
    icon(src, 128).save(ROOT / 'src' / 'renderer' / 'src' / 'assets' / 'logo.png', optimize=True)
    tray = icon(src, 32)
    tray.save(ROOT / 'resources' / 'tray.png', optimize=True)
    # Recording: a red dot with a white ring in the top-right corner.
    recording = tray.copy()
    recording.alpha_composite(disc(32, (17.0, 0.5, 31.5, 15.0), (255, 255, 255)))
    recording.alpha_composite(disc(32, (18.5, 2.0, 30.0, 13.5), (239, 68, 68)))
    recording.save(ROOT / 'resources' / 'tray-recording.png', optimize=True)
    print('icons written')


if __name__ == '__main__':
    main()
