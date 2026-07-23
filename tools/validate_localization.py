#!/usr/bin/env python3
"""Validate shipped translation tables and their generated bitmap font."""

from __future__ import print_function

import argparse
import io
import os
import re


PLACEHOLDER = re.compile(r"%(?:\d+\$)?\+?([dsf])")

LEGACY_FONT_LAYOUTS = {
    "font1x-layout.txt": (96, 1024, 8),
    "font15x-layout.txt": (96, 1024, 16),
    "font2x-layout.txt": (210, 1024, 64),
    "font25x-layout.txt": (210, 1024, 64),
    "font3x-layout.txt": (210, 2048, 128),
}

# These locales intentionally keep the original heavy pixel font. Its packed
# atlas has a fixed character set, so catalogue punctuation must be checked
# separately from the larger international atlas.
LEGACY_FONT_CATALOGUES = {
    "de.tsv", "es.tsv", "fr.tsv", "id.tsv",
    "it.tsv", "pl.tsv", "pt_BR.tsv", "ru.tsv",
}
LEGACY_FONT_CHARS = set(
    " !¡\"#$%&'()*+,-./0123456789:;<=>?¿@ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u007f"
    "àáâäãąèéêëęìíîïòóôöõùúûüñńçćłśźż"
    "ÀÁÂÄÃĄÈÉÊËĘÌÍÎÏÒÓÔÖÕÙÚÛÜÑŃÇĆŁŚŹŻºß"
    "БГДЖЗИЙЛПУФЦЧШЩЪЫЬЭЮЯ"
    "бвгджзийлмнптуфцчшщъыьэюя"
    "АаВЕеЁёКкМНОоРрСсТХх"
)

# Some names, runes, sound effects and universal symbols are intentionally the
# same in multiple languages.  Every other source-equals-translation entry is
# treated as an untranslated regression, including single-word menu labels.
UNCHANGED_COMMON = {
    "Pixel Dungeon", "pixeldungeon.watabou.ru", "rodriformiga@gmail.com",
    "+", "-", "Ankh", "KAUNAN", "SOWILO", "LAGUZ", "YNGVI", "GYFU",
    "RAIDO", "ISAZ", "MANNAZ", "NAUDIZ", "BERKANAN", "ODAL", "TIWAZ",
    "Baa!", "Baa?", "Baa.", "Baa...", "Bee...", "Ble...", "ZAP",
    "%1$s :%2$d", "%1$s: \"%2$s\"", "DM-300", "DM-350", "Goo",
    "glurp... glurp...", "GLURP-GLURP!", "!!!", "Tengu", "Yog-Dzewa",
    "...", "Psst, %s!", r"\\?\\?\\?", "1", "magenta", "shuriken",
    "tomahawk", "golem", "gladiator", "berserker", "Combo",
}

UNCHANGED_BY_CATALOGUE = {
    "de.tsv": {"indigo", "Statue"},
    "es.tsv": {"invisible", "Invisible", "ERROR", "Catalogus", "jade", "Pedestal"},
    "fr.tsv": {
        "invisible", "Invisible", "mage", "assassin", "Potions", "Journal", "turquoise",
        "indigo", "onyx", "tourmaline", "quartz", "agate", "boomerang",
        "Barricade", "Statue",
    },
    "id.tsv": {"opal", "a"},
    "it.tsv": set(),
    "ja.tsv": set(),
    "ko.tsv": set(),
    "pl.tsv": set(),
    "pt_BR.tsv": {"jade", "Pedestal"},
    "ru.tsv": set(),
    "tr.tsv": {"opal", "topaz"},
    "uk.tsv": set(),
    "zh_CN.tsv": set(),
    "zh_TW.tsv": set(),
}


def read(path, encoding):
    with io.open(path, "r", encoding=encoding) as handle:
        return handle.read()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("assets", nargs="?", default=os.path.join("android", "assets"))
    args = parser.parse_args()

    failed = False
    catalogues = os.path.join(args.assets, "i18n")
    catalogue_keys = {}
    catalogue_characters = set()
    for filename in sorted(os.listdir(catalogues)):
        if not filename.endswith(".tsv"):
            continue
        path = os.path.join(catalogues, filename)
        entries = {}
        for line_number, line in enumerate(read(path, "utf-8").splitlines(), 1):
            if "\t" not in line:
                print("{}:{}: missing tab separator".format(filename, line_number))
                failed = True
                continue
            english, translated = line.split("\t", 1)
            if english in entries:
                print("{}:{}: duplicate English key".format(filename, line_number))
                failed = True
            entries[english] = translated
            catalogue_characters.update(english)
            catalogue_characters.update(translated)
            if not translated and english != "a":
                print("{}:{}: empty translation: {}".format(
                    filename, line_number, english))
                failed = True
            if (english == translated and
                    english not in UNCHANGED_COMMON and
                    english not in UNCHANGED_BY_CATALOGUE.get(filename, set())):
                print("{}:{}: untranslated English text: {}".format(
                    filename, line_number, english))
                failed = True
            if sorted(PLACEHOLDER.findall(english)) != sorted(
                    PLACEHOLDER.findall(translated)):
                print("{}:{}: placeholder mismatch".format(filename, line_number))
                failed = True
            if "@string/" in translated or "@array/" in translated:
                print("{}:{}: unresolved Android resource".format(filename, line_number))
                failed = True
            if filename in LEGACY_FONT_CATALOGUES:
                unsupported = sorted(set(
                    char for char in translated
                    if ord(char) >= 32 and char not in LEGACY_FONT_CHARS))
                if unsupported:
                    print("{}:{}: legacy font is missing glyphs {}: {}".format(
                        filename, line_number, "".join(unsupported), english))
                    failed = True
        catalogue_keys[filename] = set(entries)
        print("{}: {} entries".format(filename, len(entries)))

    if catalogue_keys:
        reference_name = max(catalogue_keys, key=lambda name: len(catalogue_keys[name]))
        reference = catalogue_keys[reference_name]
        for filename, keys in sorted(catalogue_keys.items()):
            missing = reference - keys
            extra = keys - reference
            if missing or extra:
                print("{}: catalogue differs from {} ({} missing, {} extra)".format(
                    filename, reference_name, len(missing), len(extra)))
                failed = True

    chars = read(os.path.join(args.assets, "font-intl-chars.txt"), "utf-8")
    widths = read(os.path.join(args.assets, "font-intl-widths.txt"), "ascii").split(",")
    if len(chars) != len(widths):
        print("International font mismatch: {} glyphs, {} widths".format(
            len(chars), len(widths)))
        failed = True
    else:
        print("International font: {} glyphs".format(len(chars)))

    missing_glyphs = sorted(
        char for char in catalogue_characters
        if ord(char) >= 32 and char not in chars)
    if missing_glyphs:
        print("International font is missing {} catalogue glyphs: {}".format(
            len(missing_glyphs), "".join(missing_glyphs)))
        failed = True

    for filename, (expected, image_width, image_height) in LEGACY_FONT_LAYOUTS.items():
        entries = read(os.path.join(args.assets, filename), "ascii").strip().split(";")
        if len(entries) != expected:
            print("{}: expected {} glyphs, found {}".format(
                filename, expected, len(entries)))
            failed = True
            continue
        for index, entry in enumerate(entries):
            try:
                left, top, right, bottom = [int(value) for value in entry.split(",")]
            except ValueError:
                print("{}: invalid glyph {}: {}".format(filename, index, entry))
                failed = True
                break
            if not (0 <= left < right <= image_width and
                    0 <= top < bottom <= image_height):
                print("{}: out-of-range glyph {}: {}".format(filename, index, entry))
                failed = True
                break
        else:
            print("{}: {} deterministic glyphs".format(filename, len(entries)))

    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
