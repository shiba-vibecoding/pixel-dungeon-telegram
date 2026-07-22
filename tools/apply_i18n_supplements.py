#!/usr/bin/env python3
"""Apply reviewed supplement rows to the generated runtime catalogues."""

from __future__ import print_function

import argparse
import io
import os


def read_lines(path):
    with io.open(path, 'r', encoding='utf-8') as handle:
        return handle.read().splitlines()


def entries(path, allow_comments=False):
    result = []
    for line in read_lines(path):
        if allow_comments and (not line or line.startswith('#')):
            continue
        if '\t' not in line:
            continue
        result.append(tuple(line.split('\t', 1)))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        'supplements', nargs='?', default=os.path.join('tools', 'i18n_supplements'))
    parser.add_argument(
        'catalogues', nargs='?', default=os.path.join('android', 'assets', 'i18n'))
    args = parser.parse_args()

    for filename in sorted(os.listdir(args.supplements)):
        if not filename.endswith('.tsv'):
            continue
        supplement_path = os.path.join(args.supplements, filename)
        catalogue_path = os.path.join(args.catalogues, filename)
        if not os.path.isfile(catalogue_path):
            raise SystemExit('Missing runtime catalogue: ' + catalogue_path)

        catalogue = entries(catalogue_path)
        reviewed = entries(supplement_path, allow_comments=True)
        seen_reviewed = set()
        duplicate_reviewed = []
        for key, _ in reviewed:
            if key in seen_reviewed:
                duplicate_reviewed.append(key)
            seen_reviewed.add(key)
        if duplicate_reviewed:
            raise SystemExit('{}: duplicate supplement keys: {}'.format(
                filename, ', '.join(sorted(set(duplicate_reviewed)))))
        reviewed_keys = set(key for key, _ in reviewed)
        merged = [(key, value) for key, value in catalogue if key not in reviewed_keys]
        merged.extend(reviewed)
        with io.open(catalogue_path, 'w', encoding='utf-8', newline='\n') as handle:
            for key, value in merged:
                handle.write(key + '\t' + value + '\n')
        print('{}: {} catalogue rows, {} reviewed supplements'.format(
            filename, len(merged), len(reviewed)))


if __name__ == '__main__':
    main()
