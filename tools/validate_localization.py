#!/usr/bin/env python3
"""Validate shipped translation tables and their generated bitmap font."""

from __future__ import print_function

import argparse
import io
import os
import re


PLACEHOLDER = re.compile(r"%(?:\d+\$)?\+?([dsf])")


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
            if sorted(PLACEHOLDER.findall(english)) != sorted(
                    PLACEHOLDER.findall(translated)):
                print("{}:{}: placeholder mismatch".format(filename, line_number))
                failed = True
            if "@string/" in translated or "@array/" in translated:
                print("{}:{}: unresolved Android resource".format(filename, line_number))
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

    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
