#!/usr/bin/env python3
"""Build the compact Unicode bitmap font used by the localized UI.

Only characters which occur in the shipped catalogues are included.  This
keeps the texture small enough for old mobile GPUs while still supporting
Latin, Greek, Cyrillic, Japanese, Korean and Chinese text.
"""

from __future__ import print_function

import argparse
import io
import math
import os

from PIL import Image, ImageDraw, ImageFont


ASCII = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
LANGUAGE_LABELS = (
    "English Русский Español Français Deutsch Português Brasil Polski "
    "Italiano Türkçe Українська Bahasa Indonesia 日本語 한국어 简体中文 繁體中文")


def unescape(value):
    result = []
    escaped = False
    for char in value:
        if escaped:
            result.append({"n": "\n", "r": "\r", "t": "\t"}.get(char, char))
            escaped = False
        elif char == "\\":
            escaped = True
        else:
            result.append(char)
    if escaped:
        result.append("\\")
    return "".join(result)


def catalogue_characters(paths):
    characters = set(ASCII + LANGUAGE_LABELS)
    for path in paths:
        with io.open(path, "r", encoding="utf-8") as catalogue:
            for line in catalogue:
                if "\t" not in line:
                    continue
                english, translated = line.rstrip("\r\n").split("\t", 1)
                characters.update(unescape(english))
                characters.update(unescape(translated))
    return "".join(sorted(char for char in characters if ord(char) >= 32))


def font_for(char, fonts):
    code = ord(char)
    if 0x3040 <= code <= 0x30ff:
        return fonts["japanese"]
    if 0xac00 <= code <= 0xd7af or 0x1100 <= code <= 0x11ff:
        return fonts["korean"]
    if (0x3000 <= code <= 0x303f or
            0x3400 <= code <= 0x9fff or
            0xf900 <= code <= 0xfaff or
            0xff00 <= code <= 0xffef):
        return fonts["cjk"]
    return fonts["pixel"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output_png")
    parser.add_argument("output_chars")
    parser.add_argument("output_widths")
    parser.add_argument("catalogues", nargs="+")
    parser.add_argument("--pixel-font", required=True)
    parser.add_argument("--cjk-font", required=True)
    parser.add_argument("--japanese-font", required=True)
    parser.add_argument("--korean-font", required=True)
    parser.add_argument("--columns", type=int, default=64)
    parser.add_argument("--cell-width", type=int, default=16)
    parser.add_argument("--cell-height", type=int, default=18)
    args = parser.parse_args()

    chars = catalogue_characters(args.catalogues)
    fonts = {
        "pixel": ImageFont.truetype(args.pixel_font, 16),
        "cjk": ImageFont.truetype(args.cjk_font, 15),
        "japanese": ImageFont.truetype(args.japanese_font, 15),
        "korean": ImageFont.truetype(args.korean_font, 15),
    }

    rows = int(math.ceil(float(len(chars)) / args.columns))
    image = Image.new(
        "RGBA",
        (args.columns * args.cell_width, rows * args.cell_height),
        (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    widths = []

    for index, char in enumerate(chars):
        font = font_for(char, fonts)
        column = index % args.columns
        row = index // args.columns
        x = column * args.cell_width
        y = row * args.cell_height
        advance = int(math.ceil(font.getlength(char)))
        width = max(3, min(args.cell_width, advance + 1))
        widths.append(str(width))
        draw.text((x, y + 15), char, font=font, fill=(255, 255, 255, 255), anchor="ls")

    for output in (args.output_png, args.output_chars, args.output_widths):
        directory = os.path.dirname(os.path.abspath(output))
        if not os.path.isdir(directory):
            os.makedirs(directory)

    image.save(args.output_png, optimize=True)
    with io.open(args.output_chars, "w", encoding="utf-8", newline="") as handle:
        handle.write(chars)
    with io.open(args.output_widths, "w", encoding="ascii", newline="") as handle:
        handle.write(",".join(widths))

    print("Wrote {} glyphs to {} ({}x{})".format(
        len(chars), args.output_png, image.width, image.height))


if __name__ == "__main__":
    main()
