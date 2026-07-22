#!/usr/bin/env python3
"""Find player-facing Java strings that are absent from i18n catalogues."""

from __future__ import print_function

import argparse
import io
import os
import re


JAVA_STRING = re.compile(r'"(?:\\.|[^"\\])*"')
STRING_SEQUENCE = re.compile(
    r'"(?:\\.|[^"\\])*"(?:\s*\+\s*"(?:\\.|[^"\\])*")*', re.DOTALL)
STRING_DECLARATION = re.compile(
    r'\b(?:public|protected|private)?\s*static\s+(?:final\s+)?String\s+'
    r'([A-Z][A-Z0-9_]*)\s*=\s*('
    r'(?:(?:"(?:\\.|[^"\\])*")|[^;])*);', re.DOTALL)
STRING_ARRAY_DECLARATION = re.compile(
    r'\b(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?String\s*'
    r'\[\](?:\[\])?\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*'
    r'((?:(?:"(?:\\.|[^"\\])*")|[^;])*);', re.DOTALL)
DIRECT_MESSAGE = re.compile(
    r'\b(?:GLog\.[ipnwh]|yell)\s*\(\s*("(?:\\.|[^"\\])*")')
DIRECT_UI = re.compile(
    r'\bnew\s+(?:RedButton|WndMessage|Toast)\s*\(\s*'
    r'("(?:\\.|[^"\\])*")')
RETURN_EXPRESSION = re.compile(
    r'\breturn\s+((?:(?:"(?:\\.|[^"\\])*")|[^;])*);', re.DOTALL)
NAME_ASSIGNMENT = re.compile(r'\bname\s*=\s*(.*?);', re.DOTALL)
POSITIONAL_ARGUMENT = re.compile(r'%(\d+)\$')


def read(path):
    with io.open(path, 'r', encoding='utf-8') as handle:
        return handle.read()


def unescape_catalogue(value):
    result = []
    escaped = False
    for char in value:
        if escaped:
            result.append({'n': '\n', 'r': '\r', 't': '\t'}.get(char, char))
            escaped = False
        elif char == '\\':
            escaped = True
        else:
            result.append(char)
    if escaped:
        result.append('\\')
    return ''.join(result)


def unescape_java(literal):
    value = literal[1:-1]
    result = []
    index = 0
    escapes = {
        'b': '\b', 't': '\t', 'n': '\n', 'f': '\f', 'r': '\r',
        '"': '"', "'": "'", '\\': '\\'
    }
    while index < len(value):
        char = value[index]
        if char != '\\' or index + 1 >= len(value):
            result.append(char)
            index += 1
            continue
        index += 1
        char = value[index]
        if char == 'u':
            while index < len(value) and value[index] == 'u':
                index += 1
            result.append(chr(int(value[index:index + 4], 16)))
            index += 4
        elif char in '01234567':
            end = index + 1
            while end < min(index + 3, len(value)) and value[end] in '01234567':
                end += 1
            result.append(chr(int(value[index:end], 8)))
            index = end
        else:
            result.append(escapes.get(char, char))
            index += 1
    return ''.join(result)


def string_expression(expression):
    """Evaluate a Java expression made only from concatenated literals."""
    literals = JAVA_STRING.findall(expression)
    if not literals:
        return None
    remainder = JAVA_STRING.sub('', expression)
    if re.sub(r'[+\s()]', '', remainder):
        return None
    return ''.join(unescape_java(literal) for literal in literals)


def normalize(value):
    return POSITIONAL_ARGUMENT.sub('%', value)


def line_number(source, offset):
    return source.count('\n', 0, offset) + 1


def catalogue_keys(path):
    keys = set()
    for line in read(path).splitlines():
        if '\t' in line:
            keys.add(normalize(unescape_catalogue(line.split('\t', 1)[0])))
    return keys


def player_facing(value, name=''):
    without_formats = re.sub(r'%(?:\d+\$)?\+?[dsf]', '', value or '')
    if not value or not re.search(r'[A-Za-z]', without_formats):
        return False
    # Compact HUD notation (%+dHP, %s x%d, etc.) is intentionally universal.
    if re.match(r'^(?:%(?:\d+\$)?\+?[dsf]|[\s+xA-Z])+$', value):
        return False
    # Tiny fragments used in concatenations are not independently translatable.
    if len(value.strip()) < 3:
        return False
    if not (name.startswith('TXT_') or re.search(r'\s', value)):
        return False
    return not re.match(r'^(?:[a-z0-9_.-]+/)+[a-z0-9_.-]+$', value, re.I)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', nargs='?', default=os.path.join('core', 'src'))
    parser.add_argument(
        'catalogue', nargs='?', default=os.path.join('android', 'assets', 'i18n', 'ru.tsv'))
    parser.add_argument('--fail-on-missing', action='store_true')
    args = parser.parse_args()

    keys = catalogue_keys(args.catalogue)
    found = {}
    dynamic = []
    for root, _, filenames in os.walk(args.source):
        for filename in filenames:
            if not filename.endswith('.java'):
                continue
            path = os.path.join(root, filename)
            source = read(path)
            for match in STRING_DECLARATION.finditer(source):
                value = string_expression(match.group(2))
                if player_facing(value, match.group(1)):
                    found.setdefault(value, (path, line_number(source, match.start()), match.group(1)))
                elif (match.group(1).startswith('TXT_')
                      and '+' in JAVA_STRING.sub('', match.group(2))
                      and JAVA_STRING.search(match.group(2))):
                    dynamic.append((path, line_number(source, match.start()),
                                    match.group(1), 'composed display constant'))
            if not (path.endswith(os.path.join('i18n', 'Localization.java')) or
                    path.endswith(os.path.join('windows', 'WndLanguage.java'))):
                for match in STRING_ARRAY_DECLARATION.finditer(source):
                    for sequence in STRING_SEQUENCE.finditer(match.group(2)):
                        value = string_expression(sequence.group(0))
                        if player_facing(value, 'TXT_ARRAY'):
                            found.setdefault(value, (
                                path, line_number(source, match.start()),
                                'display array ' + match.group(1)))
            for match in DIRECT_MESSAGE.finditer(source):
                value = unescape_java(match.group(1))
                if player_facing(value):
                    found.setdefault(value, (path, line_number(source, match.start()), 'direct message'))
            for match in DIRECT_UI.finditer(source):
                value = unescape_java(match.group(1))
                if player_facing(value, 'TXT_UI'):
                    found.setdefault(value, (path, line_number(source, match.start()), 'direct UI text'))
            for match in RETURN_EXPRESSION.finditer(source):
                value = string_expression(match.group(1))
                if player_facing(value, 'RETURN_TEXT'):
                    found.setdefault(value, (path, line_number(source, match.start()), 'returned text'))
                elif value is None and '+' in match.group(1) and JAVA_STRING.search(match.group(1)):
                    literal_text = ''.join(
                        unescape_java(literal) for literal in JAVA_STRING.findall(match.group(1)))
                    explicitly_localized = (
                        'Utils.format' in match.group(1) or
                        'Localization.translate' in match.group(1) or
                        path.endswith(os.path.join('utils', 'Utils.java')) or
                        path.endswith(os.path.join('i18n', 'Localization.java')))
                    if (player_facing(literal_text, 'RETURN_TEXT')
                            and normalize(literal_text) not in keys
                            and not explicitly_localized):
                        dynamic.append((path, line_number(source, match.start()),
                                        'return', 'dynamically composed display text'))
            for match in NAME_ASSIGNMENT.finditer(source):
                value = string_expression(match.group(1))
                if player_facing(value, 'TXT_NAME'):
                    found.setdefault(value, (path, line_number(source, match.start()), 'display name'))
                elif value is None:
                    for literal in JAVA_STRING.findall(match.group(1)):
                        option = unescape_java(literal)
                        if player_facing(option, 'TXT_NAME'):
                            found.setdefault(option, (
                                path, line_number(source, match.start()), 'display name option'))

    missing = []
    for value, location in found.items():
        if normalize(value) not in keys:
            missing.append((location[0], location[1], location[2], value))
    missing.sort()

    for path, line, kind, value in missing:
        printable = value.replace('\n', '\\n')
        print('{}:{}: {}: {}'.format(path, line, kind, printable))
    for path, line, kind, message in sorted(dynamic):
        print('{}:{}: {}: {}'.format(path, line, kind, message))
    print('{} checked, {} missing, {} dynamic from {}'.format(
        len(found), len(missing), len(dynamic), args.catalogue))
    if (missing or dynamic) and args.fail_on_missing:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
