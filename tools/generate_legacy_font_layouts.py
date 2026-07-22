#!/usr/bin/env python3
"""Generate deterministic glyph bounds for the original Pixel Dungeon fonts.

The game used to rediscover these bounds from decoded PNG pixels at runtime.
That is unreliable in some Android WebViews, so the generated text files are
committed and loaded directly by the game. Pillow is only needed to regenerate
the files when a legacy font image changes.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "android" / "assets"

SPECIAL = "àáâäãąèéêëęìíîïòóôöõùúûüñńçćłśźż"
SPECIAL_UPPER = "ÀÁÂÄÃĄÈÉÊËĘÌÍÎÏÒÓÔÖÕÙÚÛÜÑŃÇĆŁŚŹŻºß"
LATIN_FULL = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\x7f"
LATIN_EXTENDED = " !¡\"#$%&'()*+,-./0123456789:;<=>?¿@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\x7f"
CYRILLIC_UPPER = "БГДЖЗИЙЛПУФЦЧШЩЪЫЬЭЮЯ"
CYRILLIC_LOWER = "бвгджзийлмнптуфцчшщъыьэюя"
ALL_CHARS = LATIN_EXTENDED + SPECIAL + SPECIAL_UPPER + CYRILLIC_UPPER + CYRILLIC_LOWER

SPECS = {
    "font1x": LATIN_FULL,
    "font15x": LATIN_FULL,
    "font2x": ALL_CHARS,
    "font25x": ALL_CHARS,
    "font3x": ALL_CHARS,
}


def bounds(image_path, chars):
    image = Image.open(image_path).convert("RGBA")
    width, height = image.size
    alpha = image.getchannel("A")

    def row_empty(y):
        return not alpha.crop((0, y, width, y + 1)).getbbox()

    def column_empty(x, top, bottom):
        return not alpha.crop((x, top, x + 1, bottom)).getbbox()

    result = []
    char_index = 0
    line_top = 0
    while line_top < height and char_index < len(chars):
        while line_top < height and row_empty(line_top):
            line_top += 1
        if line_top >= height:
            break

        line_bottom = line_top
        while line_bottom < height and not row_empty(line_bottom):
            line_bottom += 1

        column = 0
        while column < width and char_index < len(chars):
            empty = column + 1
            while empty < width and not column_empty(empty, line_top, line_bottom):
                empty += 1
            next_filled = empty
            while next_filled < width and column_empty(next_filled, line_top, line_bottom):
                next_filled += 1

            end_of_row = next_filled >= width
            char_border = empty - 1 if end_of_row else next_filled - 1
            char = chars[char_index]
            char_index += 1
            glyph_right = char_border
            if char != " ":
                while (glyph_right > column + 1 and
                       column_empty(glyph_right, line_top, line_bottom)):
                    glyph_right -= 1
                glyph_right += 1

            result.append((column, line_top, glyph_right, line_bottom))
            if end_of_row:
                break
            column = char_border

        line_top = line_bottom + 1

    if char_index != len(chars):
        raise RuntimeError(
            "{}: found {} of {} glyphs".format(image_path.name, char_index, len(chars)))
    return result


def main():
    for stem, chars in SPECS.items():
        layout = bounds(ASSETS / (stem + ".png"), chars)
        data = ";".join(",".join(str(value) for value in rect) for rect in layout) + "\n"
        destination = ASSETS / (stem + "-layout.txt")
        destination.write_text(data, encoding="ascii", newline="\n")
        print("{}: {} glyphs".format(destination.name, len(layout)))


if __name__ == "__main__":
    main()
