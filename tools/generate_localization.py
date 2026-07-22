#!/usr/bin/env python3
"""Convert Android string catalogues into Pixel Dungeon's portable TSV map."""

from __future__ import print_function

import argparse
import io
import os
import difflib
import xml.etree.ElementTree as ET


def clean(value):
    return (value.replace("\\'", "'")
                 .replace('\\"', '"')
                 .replace("\\n", "\n")
                 .replace("\\u0020", " "))


def values(path):
    result = {}
    root = ET.parse(path).getroot()
    for element in root:
        name = element.attrib.get("name")
        if element.tag == "string":
            result[name] = clean("".join(element.itertext()))
        elif element.tag == "string-array":
            for index, item in enumerate(element.findall("item")):
                result[name + "." + str(index)] = clean("".join(item.itertext()))

    # Android resources often reuse another string with @string/name.  Resolve
    # those references here so the portable catalogue never displays the
    # resource identifier itself.
    for key in list(result):
        value = result[key]
        visited = set()
        while value.startswith("@string/"):
            reference = value[len("@string/"):]
            if reference in visited or reference not in result:
                break
            visited.add(reference)
            value = result[reference]
        result[key] = value
    return result


def escape(value):
    return (value.replace("\\", "\\\\")
                 .replace("\t", "\\t")
                 .replace("\r", "\\r")
                 .replace("\n", "\\n"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("english")
    parser.add_argument("translated")
    parser.add_argument("output")
    parser.add_argument(
        "--translated-base",
        help=("English catalogue which belongs to the translated catalogue. "
              "When supplied, missing legacy keys are also matched by their "
              "English text."))
    parser.add_argument(
        "--supplement",
        help="Reviewed legacy English-to-translation TSV entries to append.")
    args = parser.parse_args()

    english = values(args.english)
    translated = values(args.translated)
    translated_base = values(args.translated_base) if args.translated_base else english

    # Some community translations come from a newer fork of Pixel Dungeon.
    # Most resource keys survived unchanged; for renamed keys the original
    # English sentence is a reliable bridge between the two catalogues.
    keys_by_english = {}
    for key, value in translated_base.items():
        keys_by_english.setdefault(value, []).append(key)
    lowercase_keys_by_english = {}
    for key, value in translated_base.items():
        lowercase_keys_by_english.setdefault(value.lower(), []).append(key)

    def one_translation(keys):
        translations = []
        for candidate in keys:
            if candidate in translated and translated[candidate] not in translations:
                translations.append(translated[candidate])
        return translations[0] if len(translations) == 1 else None

    base_items_by_length = {}
    for candidate_key, candidate_value in translated_base.items():
        base_items_by_length.setdefault(
            len(candidate_value), []).append((candidate_key, candidate_value))

    lines = []
    for key, value in english.items():
        translated_value = one_translation((key, key.replace(".", "_")))
        if translated_value is None:
            translated_value = one_translation(keys_by_english.get(value, []))
        if translated_value is None:
            translated_value = one_translation(
                lowercase_keys_by_english.get(value.lower(), []))

        # A handful of sentences were lightly copy-edited in Remixed Dungeon
        # (US/UK spelling and punctuation).  Only accept an unambiguous,
        # extremely close match; looser fuzzy matching would risk changing a
        # joke or attaching the wrong item description.
        if translated_value is None and args.translated_base:
            close = []
            value_lower = value.lower()
            length_margin = max(2, int(len(value) * 0.12))
            for candidate_length in range(
                    max(0, len(value) - length_margin),
                    len(value) + length_margin + 1):
                for candidate_key, candidate_value in base_items_by_length.get(
                        candidate_length, []):
                    matcher = difflib.SequenceMatcher(
                        None, value_lower, candidate_value.lower())
                    if matcher.quick_ratio() < 0.93:
                        continue
                    ratio = matcher.ratio()
                    if ratio >= 0.93:
                        close.append((ratio, candidate_key))
            if close:
                best_ratio = max(item[0] for item in close)
                translated_value = one_translation(
                    item[1] for item in close if item[0] == best_ratio)

        if translated_value is not None:
            lines.append(escape(value) + "\t" + escape(translated_value))

    if args.supplement:
        with io.open(args.supplement, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.rstrip("\r\n")
                if line and not line.startswith("#") and "\t" in line:
                    lines.append(line)

    # The runtime map is keyed by the English text, so keep only the final
    # translation for duplicate source phrases.  Reviewed supplements are
    # appended last and intentionally win over community-catalogue mistakes.
    latest = {}
    for index, line in enumerate(lines):
        latest[line.split("\t", 1)[0]] = index
    lines = [line for index, line in enumerate(lines)
             if latest[line.split("\t", 1)[0]] == index]

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)
    with io.open(args.output, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    print("Wrote {} unique entries from {} source resources to {}".format(
        len(lines), len(english), args.output))


if __name__ == "__main__":
    main()
