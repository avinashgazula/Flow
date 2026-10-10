#!/usr/bin/env python3
"""Generates the light app icon and the Settings previews from the dark 1024px icon.

Usage: scripts/make-light-icon.py   (run from the repo root; needs Pillow and numpy)

The glyph is recovered as an alpha mask from the dark icon (everything brighter than the
background behind it), then drawn dark on a warm-grey gradient. Outputs, all under
Flow/Resources/Assets.xcassets:
  AppIcon-Light.appiconset   the alternate icon (iOS only)
  IconPreviewDark.imageset   the current icon, as a plain image for Settings
  IconPreviewLight.imageset  the light icon, as a plain image for Settings
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

CATALOG = Path("Flow/Resources/Assets.xcassets")
SOURCE = CATALOG / "AppIcon.appiconset" / "icon-1024.png"

TOP = np.array([241, 238, 233], dtype=np.float32)
BOTTOM = np.array([213, 209, 202], dtype=np.float32)
GLYPH = np.array([30, 26, 56], dtype=np.float32)


def glyph_mask(dark: np.ndarray) -> np.ndarray:
    """0...1 coverage of the glyph. The background is nearly constant along a row, so its green
    channel is read from the right-hand margin, where nothing is drawn."""
    green = dark[:, :, 1]
    background = np.median(green[:, 900:], axis=1, keepdims=True)
    mask = np.clip((green - background) / (255.0 - background), 0.0, 1.0)
    # The background's radial falloff and the faint reflection under the glyph read up to ~0.06;
    # the glyph's own edges never drop below ~0.4.
    return np.where(mask < 0.12, 0.0, mask)


def light_icon(dark: Image.Image) -> Image.Image:
    mask = glyph_mask(np.asarray(dark.convert("RGB"), dtype=np.float32))[:, :, None]
    height = mask.shape[0]
    t = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None, None]
    background = TOP + (BOTTOM - TOP) * t
    canvas = background + (GLYPH - background) * mask
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGB")


def write_contents(folder: Path, images: list) -> None:
    contents = {"images": images, "info": {"author": "xcode", "version": 1}}
    (folder / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")


def write_imageset(name: str, image: Image.Image) -> None:
    folder = CATALOG / f"{name}.imageset"
    folder.mkdir(parents=True, exist_ok=True)
    image.save(folder / "icon.png")
    write_contents(folder, [{"filename": "icon.png", "idiom": "universal"}])


def main() -> None:
    dark = Image.open(SOURCE).convert("RGB")
    light = light_icon(dark)

    icon_set = CATALOG / "AppIcon-Light.appiconset"
    icon_set.mkdir(parents=True, exist_ok=True)
    light.save(icon_set / "icon-1024.png")
    write_contents(icon_set, [{"filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}])

    write_imageset("IconPreviewDark", dark)
    write_imageset("IconPreviewLight", light)


if __name__ == "__main__":
    main()
