#!/usr/bin/env python3
"""Renders every icon image Flow ships, procedurally, from one drawing.

Usage: scripts/make-icons.py [--preview-only]   (run from the repo root; needs Pillow and numpy)

The mark is a rounded play triangle woven from three translucent ribbons of light. Each ribbon
enters from the left edge flat, like a stream, and bends in to meet the others at the tip, so the
silhouette stays a clean play button while the inside reads as layered glass. The overlaps are
where it glows: depth comes from light, not from bevels or drop shadows.

Everything is drawn in a 1024-unit design space and rendered at 4x, then downsampled with
LANCZOS, so edges are crisp at every size. Smooth gradients are dithered before 8-bit
quantisation, so the dark background doesn't band.

Outputs, all under Flow/Resources/Assets.xcassets (same file names and pixel sizes as before,
so every Contents.json stays valid):
  AppIcon.appiconset                         iOS 1024 (full bleed, no alpha) and the Mac sizes
                                             (824pt rounded body on a 1024 canvas, soft shadow)
  AppIcon-Light.appiconset                   the alternate icon: light background, dark mark
  IconPreviewDark / IconPreviewLight         the same two icons as plain images for Settings
  FlowMark.imageset                          the About screen's mark
  App Icon & Top Shelf Image.brandassets     tvOS back/front layers (400x240, 800x480, 1280x768),
                                             Top Shelf 1920x720 and wide 2320x720, each at 2x
Also writes shots/icon-preview.png, a contact sheet for review (shots/ is git-ignored).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "Flow/Resources/Assets.xcassets"
BRAND = CATALOG / "App Icon & Top Shelf Image.brandassets"
PREVIEW = ROOT / "shots/icon-preview.png"

SS = 4  # supersampling factor for everything with an edge
UNITS = 1024.0  # the design space: one icon canvas


def hexc(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


# --- palettes --------------------------------------------------------------------------------
# Midnight to near-black ground; one cool and one warm light behind the mark. The ribbons carry
# the same two lights, so the mark looks lit by what is behind it.
DARK = {
    "sky": hexc("#0E1540"), "floor": hexc("#04050B"),
    "cool": hexc("#2F55FF"), "warm": hexc("#FF6A3D"),
    "cool_glow": 0.66, "warm_glow": 0.52,
    # (left colour, tip colour, alpha at left, alpha at tip). The glass is white: it is lit by
    # the glows behind it, so it takes their colour. Drawn back to front, the first being the
    # whole triangle.
    "ribbons": [
        (hexc("#E4EBFF"), hexc("#FFFFFF"), 0.12, 0.34),
        (hexc("#DCE6FF"), hexc("#FFFFFF"), 0.20, 0.66),
        (hexc("#FFE9DA"), hexc("#FFFFFF"), 0.20, 0.66),
        (hexc("#F4F1FF"), hexc("#FFFFFF"), 0.20, 0.85),
    ],
    "blend": "screen",
    "rim": 0.62, "bounce": 0.30, "bloom": 0.26,
}
LIGHT = {
    "sky": hexc("#F7F5F1"), "floor": hexc("#DAD6CE"),
    "cool": hexc("#7C97FF"), "warm": hexc("#FF9E78"),
    "cool_glow": 0.75, "warm_glow": 0.75,
    "ribbons": [
        (hexc("#27358F"), hexc("#18215F"), 0.62, 0.80),
        (hexc("#27358F"), hexc("#18215F"), 0.30, 0.75),
        (hexc("#27358F"), hexc("#18215F"), 0.30, 0.75),
        (hexc("#1B2670"), hexc("#090D2E"), 0.28, 0.90),
    ],
    "blend": "multiply",
    "rim": 0.45, "bounce": 0.0, "bloom": 0.0,
}


# --- small numeric helpers -------------------------------------------------------------------
def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(u):
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


def gaussian_blur(img: np.ndarray, sigma: float) -> np.ndarray:
    """Blur (h, w) or (h, w, c) float images with an FFT; sigma is in pixels."""
    if sigma <= 0.01:
        return img
    if img.ndim == 3:
        return np.stack([gaussian_blur(img[:, :, c], sigma) for c in range(img.shape[2])], -1)
    h, w = img.shape
    pad = int(sigma * 3)
    padded = np.pad(img, pad, mode="edge")
    fy = np.fft.fftfreq(padded.shape[0])[:, None]
    fx = np.fft.rfftfreq(padded.shape[1])[None, :]
    kernel = np.exp(-2.0 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    out = np.fft.irfft2(np.fft.rfft2(padded) * kernel, s=padded.shape)
    return out[pad:pad + h, pad:pad + w].astype(np.float32)


def resize_float(img: np.ndarray, size) -> np.ndarray:
    """LANCZOS resize of a float (h, w, c) image, one channel at a time so nothing is quantised."""
    w, h = size
    chans = [np.asarray(Image.fromarray(np.ascontiguousarray(img[:, :, c], dtype=np.float32), "F").resize((w, h), Image.LANCZOS))
             for c in range(img.shape[2])]
    return np.stack(chans, -1)


def to_image(rgb: np.ndarray, alpha: np.ndarray | None = None, seed: int = 7) -> Image.Image:
    """Quantise to 8 bits with triangular dither (stops banding in the dark gradients)."""
    rng = np.random.default_rng(seed)
    noise = (rng.random(rgb.shape, dtype=np.float32) + rng.random(rgb.shape, dtype=np.float32) - 1.0)
    out = np.clip(np.floor(rgb * 255.0 + 0.5 + noise * 0.75), 0, 255).astype(np.uint8)
    if alpha is None:
        return Image.fromarray(out, "RGB")
    a = np.clip(alpha * 255.0 + 0.5, 0, 255).astype(np.uint8)[:, :, None]
    return Image.fromarray(np.concatenate([out, a], -1), "RGBA")


# --- geometry --------------------------------------------------------------------------------
def seg_dist(X, Y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = np.clip(((X - a[0]) * dx + (Y - a[1]) * dy) / (dx * dx + dy * dy), 0.0, 1.0)
    return np.hypot(X - (a[0] + t * dx), Y - (a[1] + t * dy))


def sdf_triangle(X, Y, verts):
    """Signed distance to a triangle (negative inside); vertices wind so that inside is cross > 0."""
    d = None
    inside = None
    for i in range(3):
        a, b = verts[i], verts[(i + 1) % 3]
        s = seg_dist(X, Y, a, b)
        d = s if d is None else np.minimum(d, s)
        cross = (b[0] - a[0]) * (Y - a[1]) - (b[1] - a[1]) * (X - a[0])
        inside = (cross > 0) if inside is None else (inside & (cross > 0))
    return np.where(inside, -d, d)


class Mark:
    """The play triangle's geometry, in design units. Right-pointing, equilateral, corners rounded."""

    def __init__(self, half_height=360.0, corner=90.0, centre=(512.0, 512.0)):
        self.h = half_height                                  # half the left edge
        self.R = half_height / np.sin(np.radians(60.0))       # circumradius
        self.r = corner
        # Centre the mark on its bounding box nudged a little right: a play triangle looks
        # centred when its weight (nearer the left edge) sits slightly right of the middle.
        self.cx = centre[0] + 18.0 - self.R / 4.0 + self.r / 2.0
        self.cy = centre[1]
        self.xl = self.cx - self.R / 2.0                      # left edge
        self.xt = self.cx + self.R                            # un-rounded tip

    def sdf(self, X, Y):
        R = self.R - 2.0 * self.r
        v = [(self.cx + R * np.cos(k * 2 * np.pi / 3), self.cy + R * np.sin(k * 2 * np.pi / 3)) for k in range(3)]
        return sdf_triangle(X, Y, v) - self.r

    def u(self, X):
        # 0 at the left edge, 1 at the triangle's sharp tip, where every streamline meets.
        return (X - self.xl) / (self.xt - self.xl)


# Each ribbon is the band between two streamlines. A streamline leaves the left edge flat at
# some height and glides to the tip; the bands overlap, and where they do the light adds up.
RIBBONS = [
    # (upper streamline, lower streamline), as fractions of the half height; negative is up.
    (None, None),
    (-1.40, 0.18),
    (-0.18, 1.40),
    (-0.56, 0.56),
]
STREAM_GAIN = 1.2
FOLD = 0.45  # opacity at a ribbon's lower edge, relative to its upper edge


def streamline(mark: Mark, X, frac, px):
    """y(x) of a streamline, and its slope, as arrays."""
    s = smoothstep(mark.u(X))
    y = mark.cy + mark.h * STREAM_GAIN * frac * (1.0 - s)
    slope = np.gradient(y, axis=1) / px
    return y, slope


# --- the mark --------------------------------------------------------------------------------
LIGHT_DIR = np.array([-0.42, -0.91], np.float32)  # towards the light, y down


class Layers:
    """The mark as separately rendered sheets, each (premultiplied rgb, alpha) at output size.
    Kept apart because the dark icon adds them as light and the light icon multiplies them as ink."""

    def __init__(self, sheets, rim, bounce, tint):
        self.sheets = sheets
        self.rim = rim        # (h, w) 0...1 highlight along edges facing the light
        self.bounce = bounce  # the same, faint and tinted, along the edges facing away
        self.tint = tint

    def flatten(self, blend: str) -> np.ndarray:
        """Premultiplied RGBA of the mark on transparency (for tvOS layers and bloom)."""
        pre = np.zeros(self.rim.shape + (3,), np.float32)
        alpha = np.zeros(self.rim.shape, np.float32)
        for p, a in self.sheets:
            if blend == "screen":
                pre = pre + p - pre * p
                alpha = alpha + a - alpha * a
            else:
                pre = p + pre * (1.0 - a[..., None])
                alpha = a + alpha * (1.0 - a)
        edge = self.rim[..., None]
        pre = pre + edge - pre * edge
        kick = self.bounce[..., None] * self.tint
        pre = pre + kick - pre * kick
        alpha = np.maximum(alpha, np.maximum(self.rim, self.bounce))
        return np.concatenate([np.clip(pre, 0, 1), np.clip(alpha, 0, 1)[..., None]], -1)

    def multiply_onto(self, bg: np.ndarray, rim_gain: float) -> np.ndarray:
        """Ink on paper: each sheet darkens what is under it by its colour, in proportion to alpha."""
        for p, a in self.sheets:
            bg = bg * (1.0 - a[..., None] + p)
        edge = (self.rim * rim_gain)[..., None]
        return bg + (1.0 - bg) * edge


def render_layers(side: int, pal: dict, mark: Mark | None = None, ss: int = SS) -> Layers:
    """`side` pixels span UNITS design units; the mark is drawn centred in that square."""
    mark = mark or Mark()
    n = side * ss
    px = UNITS / n
    t = (np.arange(n, dtype=np.float32) + 0.5) * px
    X, Y = np.meshgrid(t, t)
    base = mark.sdf(X, Y)
    u = mark.u(X)
    sheets = []
    rim_acc = np.zeros((n, n), np.float32)
    bounce_acc = np.zeros((n, n), np.float32)

    for (up, lo), (c_left, c_tip, a_left, a_tip) in zip(RIBBONS, pal["ribbons"]):
        if up is None:  # the whole triangle
            y0, y1 = np.float32(mark.cy - mark.h), np.float32(mark.cy + mark.h)
            d = base
        else:
            y0, s0 = streamline(mark, X, up, px)
            y1, s1 = streamline(mark, X, lo, px)
            d_up = (y0 - Y) / np.sqrt(1.0 + s0 ** 2)   # negative below the upper streamline
            d_lo = (Y - y1) / np.sqrt(1.0 + s1 ** 2)   # negative above the lower streamline
            d = np.maximum(base, np.maximum(d_up, d_lo))
        cov = np.clip(0.5 - d / px, 0.0, 1.0)
        depth = np.clip(-d, 0.0, None)

        gy, gx = np.gradient(d)
        lit = (gx * LIGHT_DIR[0] + gy * LIGHT_DIR[1]) / (np.hypot(gx, gy) + 1e-6)
        facing, away = np.clip(lit, 0.0, 1.0), np.clip(-lit, 0.0, 1.0)

        # Colour and density both build towards the tip, where the streams converge. Glass is a
        # touch denser at its own edges (the meniscus), which is what defines each sheet.
        k = smoothstep(u * 1.1)
        col = lerp(c_left, c_tip, k[..., None])
        # Across each ribbon the glass is clear where it faces the light and denser below, which
        # is what makes the sheets read as folds of one material rather than coloured bands.
        across = np.clip((Y - y0) / np.maximum(y1 - y0, 1.0), 0.0, 1.0)
        fold = lerp(1.0, FOLD, across ** 1.2)
        a = lerp(a_left, a_tip, k) * fold * (0.80 + 0.20 * np.exp(-depth / 40.0)) * cov
        rim_acc = np.maximum(rim_acc, cov * np.exp(-depth / 4.0) * facing * pal["rim"])
        bounce_acc = np.maximum(bounce_acc, cov * np.exp(-depth / 7.0) * away * pal["bounce"])
        sheets.append((col * a[..., None], a))
        del d, cov, depth, gx, gy, lit, facing, away, col, a, across, fold

    out = [(resize_float(p.astype(np.float32), (side, side)).clip(0, 1),
            resize_float(a.astype(np.float32)[..., None], (side, side))[..., 0].clip(0, 1)) for p, a in sheets]
    rim = resize_float(rim_acc[..., None], (side, side))[..., 0].clip(0, 1)
    bounce = resize_float(bounce_acc[..., None], (side, side))[..., 0].clip(0, 1)
    return Layers(out, rim, bounce, pal["warm"])


# --- backgrounds -----------------------------------------------------------------------------
def render_background(w: int, h: int, pal: dict, scale: float | None = None) -> np.ndarray:
    """(h, w, 3) float, lit around the canvas centre: a vertical fall from `sky` to `floor`, a cool
    light up and to the right, a warm one down and to the left, and a vignette on the dark ground.
    `scale` is the glow size in pixels (defaults to the shorter side)."""
    scale = scale or min(w, h)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    fx, fy = w / 2.0, h / 2.0
    t = np.clip(yy / h, 0, 1)[..., None]
    img = lerp(pal["sky"], pal["floor"], t ** 0.85)

    def glow(dx, dy, radius):
        d2 = ((xx - (fx + dx * scale)) ** 2 + (yy - (fy + dy * scale)) ** 2) / (radius * scale) ** 2
        return np.exp(-d2 * 2.4)[..., None]

    cool = glow(0.20, -0.20, 0.52) * pal["cool_glow"]
    warm = glow(-0.20, 0.22, 0.50) * pal["warm_glow"]
    if pal["blend"] == "screen":
        img = img + cool * pal["cool"] + warm * pal["warm"]
        # The corners fall away so the lit middle has somewhere to glow from.
        vd = np.hypot((xx - fx) / w, (yy - fy) / h) * 1.5
        img = img * (1.0 - 0.38 * np.clip(vd - 0.28, 0, 1) ** 1.3)[..., None]
    else:
        # On paper the lights are faint tints rather than glows.
        img = lerp(img, pal["cool"], cool * 0.30)
        img = lerp(img, pal["warm"], warm * 0.30)
    return np.clip(img, 0.0, 1.0).astype(np.float32)


def bloom_for(mark_rgba: np.ndarray, pal: dict, sigma_frac=0.045) -> np.ndarray:
    """Soft light the mark spills onto the ground, (h, w, 3). Dark icon only."""
    if pal["bloom"] <= 0:
        return np.zeros(mark_rgba.shape[:2] + (3,), np.float32)
    side = max(mark_rgba.shape[:2])
    wide = gaussian_blur(mark_rgba[:, :, :3], side * sigma_frac)
    mid = gaussian_blur(mark_rgba[:, :, :3], side * sigma_frac * 0.35)
    return (wide * 1.4 + mid * 0.5) * pal["bloom"]


def over(bg: np.ndarray, mark: np.ndarray) -> np.ndarray:
    return mark[:, :, :3] + bg * (1.0 - mark[:, :, 3:4])


def embed(tile: np.ndarray, w: int, h: int) -> np.ndarray:
    """Centre a (s, s, c) tile on a transparent (h, w, c) canvas."""
    th, tw = tile.shape[:2]
    out = np.zeros((h, w, tile.shape[2]), np.float32)
    x0, y0 = (w - tw) // 2, (h - th) // 2
    sx, sy = max(0, -x0), max(0, -y0)
    x1, y1 = min(w, x0 + tw), min(h, y0 + th)
    out[max(y0, 0):y1, max(x0, 0):x1] = tile[sy:sy + (y1 - max(y0, 0)), sx:sx + (x1 - max(x0, 0))]
    return out


# --- compositions ----------------------------------------------------------------------------
class Master:
    """The 1024 icon for one palette, rendered once and reused for every size."""

    def __init__(self, pal: dict):
        self.pal = pal
        layers = render_layers(1024, pal)
        bg = render_background(1024, 1024, pal)
        if pal["blend"] == "screen":
            flat = layers.flatten("screen")
            self.square = np.clip(over(bg + bloom_for(flat, pal), flat), 0, 1)
        else:
            self.square = np.clip(layers.multiply_onto(bg, 0.55), 0, 1)

    def ios(self) -> Image.Image:
        return to_image(self.square)

    def mac(self) -> Image.Image:
        """The 824pt body centred on a 1024 canvas with a soft shadow, as macOS icons are drawn."""
        n = 1024 * SS
        px = UNITS / n
        t = (np.arange(n, dtype=np.float32) + 0.5) * px - 512.0
        X, Y = np.meshgrid(t, t)
        half = 412.0
        # Apple's continuous-corner rectangle is close to a superellipse of exponent 5.
        edge = (1.0 - ((np.abs(X) / half) ** 5 + (np.abs(Y) / half) ** 5) ** 0.2) * half  # ~inward distance
        body = np.clip(edge / px + 0.5, 0.0, 1.0)
        # A hairline of light just inside the top edge, as on system icons.
        lip = np.clip(1.0 - np.abs(edge - 1.5) / 1.5, 0.0, 1.0) * np.clip(0.55 - Y / half * 0.6, 0.0, 1.0)
        body_s = resize_float(body[..., None].astype(np.float32), (1024, 1024))[..., 0].clip(0, 1)
        lip_s = resize_float(lip[..., None].astype(np.float32), (1024, 1024))[..., 0].clip(0, 1)
        del X, Y, edge, body, lip
        # The artwork is full bleed at 1024; scale it so it fills the 824 body.
        art = resize_float(self.square.astype(np.float32), (824, 824))
        icon = np.zeros((1024, 1024, 3), np.float32)
        icon[100:924, 100:924] = art
        icon = icon + (1.0 - icon) * (lip_s * 0.22)[..., None]
        shadow = gaussian_blur(np.roll(body_s, 14, axis=0), 16.0) * 0.55
        a = body_s + shadow * (1.0 - body_s)
        rgb = icon * body_s[..., None] / np.maximum(a[..., None], 1e-4)  # the shadow is black
        return to_image(np.clip(rgb, 0, 1), a)


def wide_layers(w: int, h: int, pal: dict, mark_frac: float, cache: dict):
    """(background, front) for a landscape canvas. The front is the mark alone on transparency,
    so tvOS can float it over the back layer. `mark_frac` is the mark's height over the canvas's."""
    side = int(round(h * mark_frac * UNITS / 700.0))   # the mark spans ~700 of 1024 units
    if side not in cache:
        cache[side] = render_layers(side, pal).flatten("screen")
    flat = cache[side]
    bg = render_background(w, h, pal, scale=h) + embed(bloom_for(flat, pal), w, h)
    return np.clip(bg, 0, 1), embed(flat, w, h)


# --- output ----------------------------------------------------------------------------------
def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}")


def front_image(front: np.ndarray) -> Image.Image:
    a = front[:, :, 3:4]
    rgb = np.where(a > 1e-4, front[:, :, :3] / np.maximum(a, 1e-4), 0.0)
    return to_image(np.clip(rgb, 0, 1), a[..., 0])


# tvOS: mark height over canvas height for each kind of image, and the files to write.
TV_ICON = 0.60
TV_SHELF = 0.46
TV_STACKS = [("App Icon.imagestack", 400, 240, "@1x"), ("App Icon.imagestack", 800, 480, "@2x"),
             ("App Icon - App Store.imagestack", 1280, 768, "@1x")]
TV_SHELVES = [("Top Shelf Image.imageset", 1920, 720, "@1x"), ("Top Shelf Image.imageset", 3840, 1440, "@2x"),
              ("Top Shelf Image Wide.imageset", 2320, 720, "@1x"), ("Top Shelf Image Wide.imageset", 4640, 1440, "@2x")]
MAC_SIZES = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]


def main():
    dark, light = Master(DARK), Master(LIGHT)
    ios_dark, ios_light = dark.ios(), light.ios()
    icon_dir = CATALOG / "AppIcon.appiconset"

    print("iOS")
    save(ios_dark, icon_dir / "icon-1024.png")
    save(ios_light, CATALOG / "AppIcon-Light.appiconset/icon-1024.png")
    save(ios_dark, CATALOG / "IconPreviewDark.imageset/icon.png")
    save(ios_light, CATALOG / "IconPreviewLight.imageset/icon.png")
    save(ios_dark.resize((360, 360), Image.LANCZOS), CATALOG / "FlowMark.imageset/flowmark.png")

    print("macOS")
    mac = dark.mac()
    for point, scale in MAC_SIZES:
        px = point * scale
        save(mac if px == 1024 else mac.resize((px, px), Image.LANCZOS), icon_dir / f"mac-{point}@{scale}x.png")

    print("tvOS")
    cache: dict = {}
    for folder, w, h, suffix in TV_STACKS:
        bg, front = wide_layers(w, h, DARK, TV_ICON, cache)
        stack = BRAND / folder
        save(to_image(bg), stack / f"Back.imagestacklayer/Content.imageset/back{suffix}.png")
        save(front_image(front), stack / f"Front.imagestacklayer/Content.imageset/front{suffix}.png")
    for folder, w, h, suffix in TV_SHELVES:
        bg, front = wide_layers(w, h, DARK, TV_SHELF, cache)
        save(to_image(np.clip(over(bg, front), 0, 1)), BRAND / folder / f"shelf{suffix}.png")

    contact_sheet(ios_dark, ios_light, mac, cache)


def squircle_mask(size: int) -> Image.Image:
    """The iOS icon mask, approximated, for previews only (the system applies the real one)."""
    n = size * 4
    t = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(t, t)
    f = (np.abs(X) ** 5 + np.abs(Y) ** 5) ** 0.2
    m = np.clip((1.0 - f) * (n / 2) + 0.5, 0, 1)
    return Image.fromarray((m * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)


def contact_sheet(ios_dark, ios_light, mac, cache):
    """One image to judge the whole set: large, at home-screen sizes, and on the other platforms."""
    W, H = 2400, 1660
    sheet = Image.new("RGB", (W, H), (38, 38, 42))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 22)
    except OSError:
        font = ImageFont.load_default()

    def label(x, y, text):
        draw.text((x, y), text, fill=(190, 190, 196), font=font)

    def tile(img, size):
        return img.resize((size, size), Image.LANCZOS), squircle_mask(size)

    x = 30
    for img, name in ((ios_dark, "iOS dark 1024"), (ios_light, "iOS light 1024 (alternate)")):
        t, m = tile(img, 640)
        sheet.paste(t, (x, 50), m)
        label(x, 14, name)
        x += 670
    plate = Image.new("RGB", (640, 640), (218, 218, 224))
    small_mac = mac.resize((640, 640), Image.LANCZOS)
    plate.paste(small_mac, (0, 0), small_mac)
    sheet.paste(plate, (x, 50))
    label(x, 14, "macOS (824 body on 1024, shadow)")

    y = 740
    label(30, y - 34, "iOS at 120, 87, 58, 40, 29 on dark and light wallpaper")
    for row, ground in enumerate(((24, 26, 34), (226, 228, 234))):
        strip = Image.new("RGB", (1000, 150), ground)
        xx = 14
        for img in (ios_dark, ios_light):
            for size in (120, 87, 58, 40, 29):
                t, m = tile(img, size)
                strip.paste(t, (xx, (150 - size) // 2), m)
                xx += size + 14
            xx += 26
        sheet.paste(strip, (30, y + row * 160))

    def composite(w, h, frac):
        bg, front = wide_layers(w, h, DARK, frac, cache)
        return Image.fromarray((np.clip(over(bg, front), 0, 1) * 255 + 0.5).astype(np.uint8))

    sheet.paste(composite(800, 480, TV_ICON), (1060, y))
    label(1060, y - 34, "tvOS App Icon 800x480 (layers composited)")
    sheet.paste(composite(1920, 720, TV_SHELF).resize((960, 360), Image.LANCZOS), (1060, y + 520))
    label(1060, y + 486, "Top Shelf 1920x720")
    sheet.paste(composite(2320, 720, TV_SHELF).resize((1160, 360), Image.LANCZOS), (30, y + 520))
    label(30, y + 486, "Top Shelf Wide 2320x720")

    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(PREVIEW)
    print(f"  {PREVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
