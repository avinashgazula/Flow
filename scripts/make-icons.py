#!/usr/bin/env python3
"""Renders every icon image Marquee ships from one drawing: the website's mark (web/public/icon.svg).

Usage: scripts/make-icons.py   (run from the repo root; needs Pillow and numpy)

The mark is a blue square, a white condensed M and one red bulb with a white rim. It is drawn in the
SVG's 512-unit space and rendered at 4x, then downsampled with LANCZOS, so edges are crisp at every size.
The Top Shelf wordmark is set in the bundled IBM Plex Sans Condensed Bold (Flow/Resources/Fonts).

Outputs, all under Flow/Resources/Assets.xcassets (same file names and pixel sizes as before, so every
Contents.json stays valid; the tvOS image stacks gain a middle layer):
  AppIcon.appiconset                         iOS 1024 (full bleed, no alpha) and the Mac sizes
                                             (824pt squircle body on a 1024 canvas, soft shadow)
  AppIcon-Light.appiconset                   the alternate icon: white ground, blue M
  IconPreviewDark / IconPreviewLight         the same two icons as plain images for Settings
  FlowMark.imageset                          the About screen's mark
  App Icon & Top Shelf Image.brandassets     tvOS layers (400x240, 800x480, 1280x768): blue back, the M
                                             in the middle, the bulb in front; Top Shelf 1920x720 and wide
                                             2320x720, each at 2x: the MARQUEE wordmark over seven bulbs
Also writes shots/icon-preview.png, a contact sheet for review (shots/ is git-ignored).
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "Flow/Resources/Assets.xcassets"
BRAND = CATALOG / "App Icon & Top Shelf Image.brandassets"
PREVIEW = ROOT / "shots/icon-preview.png"
FONT = ROOT / "Flow/Resources/Fonts/IBMPlexSansCondensed-Bold.ttf"

BLUE, WHITE, RED, INK = (0x1A, 0x3D, 0xFF), (255, 255, 255), (0xC9, 0x12, 0x0A), (0x0A, 0x0A, 0x0A)
SS = 4  # supersampling factor for everything with an edge

# The M and the bulb, in the SVG's 512 space (web/public/icon.svg).
M_POINTS = [(146, 100), (216, 100), (256, 218), (296, 100), (366, 100), (366, 340), (310, 340), (310, 204),
            (280, 292), (232, 292), (202, 204), (202, 340), (146, 340)]
BULB = (256, 402)  # centre; radius 20 red, rimmed 8 wide (16 to 24 from the centre)
M_BOX = (146, 100, 366, 340)


def canvas(w, h, fill, alpha=False):
    return Image.new("RGBA" if alpha else "RGB", (w * SS, h * SS), fill if not alpha else (0, 0, 0, 0))


def finish(img: Image.Image, w, h) -> Image.Image:
    return img.resize((w, h), Image.LANCZOS)


def draw_m(d: ImageDraw.ImageDraw, ox, oy, k, fill):
    """The M with its 512-space origin at (ox, oy) and k pixels per unit, all in supersampled pixels."""
    d.polygon([(ox + x * k, oy + y * k) for x, y in M_POINTS], fill=fill)


def draw_bulb(d: ImageDraw.ImageDraw, cx, cy, r, rim=WHITE, fill=RED):
    """A bulb of radius r (the red part) with a rim of 0.4r around it, centred on cx, cy."""
    ro = r * 1.2
    d.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], fill=rim)
    ri = r * 0.8
    d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=fill)


def square_mark(side: int, ground, ink) -> Image.Image:
    """The mark filling a square: full bleed, as iOS wants it."""
    n = side * SS
    img = Image.new("RGB", (n, n), ground)
    d = ImageDraw.Draw(img)
    k = n / 512
    draw_m(d, 0, 0, k, ink)
    draw_bulb(d, BULB[0] * k, BULB[1] * k, 20 * k, rim=WHITE if ground != WHITE else ink)
    return finish(img, side, side)


def mac_icon(art: Image.Image) -> Image.Image:
    """The artwork as an 824pt superellipse body centred on a 1024 canvas with a soft shadow, as macOS icons are."""
    n = 1024 * SS
    t = (np.arange(n, dtype=np.float32) + 0.5) / SS - 512.0
    X, Y = np.meshgrid(t, t)
    half = 412.0
    edge = (1.0 - ((np.abs(X) / half) ** 5 + (np.abs(Y) / half) ** 5) ** 0.2) * half
    body = np.clip(edge * SS + 0.5, 0.0, 1.0).astype(np.float32)
    del X, Y, edge
    body_s = np.asarray(Image.fromarray(body, "F").resize((1024, 1024), Image.LANCZOS)).clip(0, 1)
    # Soft drop shadow: the body shifted down and blurred (a box blur stack is plenty at this size).
    sh = Image.fromarray((np.roll(body_s, 14, axis=0) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(16))
    shadow = np.asarray(sh, np.float32) / 255 * 0.5
    icon = np.zeros((1024, 1024, 3), np.float32)
    icon[100:924, 100:924] = np.asarray(art.resize((824, 824), Image.LANCZOS), np.float32) / 255
    a = body_s + shadow * (1 - body_s)
    rgb = icon * body_s[..., None] / np.maximum(a[..., None], 1e-4)
    out = np.concatenate([np.clip(rgb * 255 + 0.5, 0, 255), np.clip(a[..., None] * 255 + 0.5, 0, 255)], -1)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


# --- tvOS ------------------------------------------------------------------------------------
def tv_layers(w: int, h: int):
    """(back, middle, front) of a parallax icon. The M is 62% of the height, the bulb sits in the
    M's own foot position so the three layers line up as the mark when the icon is at rest."""
    back = Image.new("RGB", (w, h), BLUE)
    k = h * 0.62 / (M_BOX[3] - M_BOX[1]) * SS  # supersampled pixels per unit
    # Place the unit box (146..366 x 100..432) centred, with the bulb included in the height.
    unit_w, unit_h = 220, 432 - 100
    ox = (w * SS - unit_w * k) / 2 - 146 * k
    oy = (h * SS - unit_h * k) / 2 - 100 * k
    mid = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    draw_m(ImageDraw.Draw(mid), ox, oy, k, WHITE)
    front = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    draw_bulb(ImageDraw.Draw(front), ox + BULB[0] * k, oy + BULB[1] * k, 20 * k)
    return back, finish(mid, w, h), finish(front, w, h)


def wordmark(w: int, h: int, word_h_frac: float) -> Image.Image:
    """The wordmark lockup on the blue ground: MARQUEE in condensed capitals over seven rimmed bulbs,
    as the website's logo cell sets it (0.22em gap, bulbs 0.2em with a 0.07em rim, 0.03em tracking)."""
    img = Image.new("RGB", (w * SS, h * SS), BLUE)
    d = ImageDraw.Draw(img)
    em = h * word_h_frac * SS / 0.7                # cap height of Plex is about 0.7em
    font = ImageFont.truetype(str(FONT), int(round(em)))
    track = 0.03 * em
    word = "MARQUEE"
    widths = [font.getlength(c) for c in word]
    total = sum(widths) + track * (len(word) - 1)
    x0 = (w * SS - total) / 2
    cap = em * 0.7
    top = (h * SS - (cap + 0.22 * em + 0.2 * em)) / 2
    asc = font.getmetrics()[0]
    x = x0
    for c, cw in zip(word, widths):
        d.text((x, top - (asc - cap)), c, font=font, fill=WHITE)
        x += cw + track
    # Seven bulbs spread edge to edge of the word, centres inset by half a bulb.
    r = 0.1 * em
    y = top + cap + 0.22 * em + r
    left, right = x0 + 0.1 * em + r, x0 + total - 0.1 * em - r
    for i in range(7):
        draw_bulb(d, left + (right - left) * i / 6, y, r * 0.95)
    return finish(img, w, h)


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}")


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


TV_STACKS = [("App Icon.imagestack", 400, 240, "@1x"), ("App Icon.imagestack", 800, 480, "@2x"),
             ("App Icon - App Store.imagestack", 1280, 768, "@1x")]
TV_SHELVES = [("Top Shelf Image.imageset", 1920, 720, "@1x"), ("Top Shelf Image.imageset", 3840, 1440, "@2x"),
              ("Top Shelf Image Wide.imageset", 2320, 720, "@1x"), ("Top Shelf Image Wide.imageset", 4640, 1440, "@2x")]
MAC_SIZES = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]


def main():
    ios_dark = square_mark(1024, BLUE, WHITE)
    ios_light = square_mark(1024, WHITE, BLUE)
    icon_dir = CATALOG / "AppIcon.appiconset"

    print("iOS")
    save(ios_dark, icon_dir / "icon-1024.png")
    save(ios_light, CATALOG / "AppIcon-Light.appiconset/icon-1024.png")
    save(ios_dark, CATALOG / "IconPreviewDark.imageset/icon.png")
    save(ios_light, CATALOG / "IconPreviewLight.imageset/icon.png")
    save(ios_dark.resize((360, 360), Image.LANCZOS), CATALOG / "FlowMark.imageset/flowmark.png")

    print("macOS")
    mac = mac_icon(ios_dark)
    for point, scale in MAC_SIZES:
        px = point * scale
        save(mac if px == 1024 else mac.resize((px, px), Image.LANCZOS), icon_dir / f"mac-{point}@{scale}x.png")

    print("tvOS")
    layer_info = {"info": {"author": "xcode", "version": 1}}
    for folder, w, h, suffix in TV_STACKS:
        back, mid, front = tv_layers(w, h)
        stack = BRAND / folder
        for name, img in (("Back", back), ("Middle", mid), ("Front", front)):
            layer = stack / f"{name}.imagestacklayer"
            write_json(layer / "Contents.json", layer_info)
            save(img, layer / f"Content.imageset/{name.lower()}{suffix}.png")
        write_json(stack / "Contents.json", {"layers": [{"filename": f"{n}.imagestacklayer"} for n in ("Front", "Middle", "Back")],
                                              **layer_info})
    for folder, w, h, suffix in TV_SHELVES:
        save(wordmark(w, h, 0.26), BRAND / folder / f"shelf{suffix}.png")
    # Image set manifests list every file in a layer, so write them from what exists.
    for stack in ("App Icon.imagestack", "App Icon - App Store.imagestack"):
        for name in ("Back", "Middle", "Front"):
            d = BRAND / stack / f"{name}.imagestacklayer/Content.imageset"
            files = sorted(p.name for p in d.glob("*.png"))
            write_json(d / "Contents.json", {"images": [{"idiom": "tv", "filename": f, "scale": f.split("@")[1][:2]} for f in files],
                                             "info": {"author": "xcode", "version": 1}})

    contact_sheet(ios_dark, ios_light, mac)


def squircle_mask(size: int) -> Image.Image:
    """The iOS icon mask, approximated, for previews only (the system applies the real one)."""
    n = size * 4
    t = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(t, t)
    f = (np.abs(X) ** 5 + np.abs(Y) ** 5) ** 0.2
    m = np.clip((1.0 - f) * (n / 2) + 0.5, 0, 1)
    return Image.fromarray((m * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)


def contact_sheet(ios_dark, ios_light, mac):
    W, H = 2400, 1700
    sheet = Image.new("RGB", (W, H), (38, 38, 42))
    x = 30
    for img in (ios_dark, ios_light):
        t = img.resize((640, 640), Image.LANCZOS)
        sheet.paste(t, (x, 50), squircle_mask(640))
        x += 670
    plate = Image.new("RGB", (640, 640), (218, 218, 224))
    m = mac.resize((640, 640), Image.LANCZOS)
    plate.paste(m, (0, 0), m)
    sheet.paste(plate, (x, 50))
    y = 740
    xx = 30
    for size in (120, 87, 58, 40, 29):
        sheet.paste(ios_dark.resize((size, size), Image.LANCZOS), (xx, y), squircle_mask(size))
        xx += size + 14
    back, mid, front = tv_layers(800, 480)
    tv = back.convert("RGBA")
    tv.alpha_composite(mid)
    tv.alpha_composite(front)
    sheet.paste(tv.convert("RGB"), (1060, y))
    sheet.paste(wordmark(1920, 720, 0.26).resize((960, 360), Image.LANCZOS), (1060, y + 520))
    sheet.paste(wordmark(2320, 720, 0.26).resize((1160, 360), Image.LANCZOS), (30, y + 520))
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(PREVIEW)
    print(f"  {PREVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
