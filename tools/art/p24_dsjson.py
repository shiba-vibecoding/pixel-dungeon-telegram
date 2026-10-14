# v24: the design system's asset groups for the new art and the game shots, and the change note.
import json, os
P = '/home/claude/ds/project/design-system.json'
d = json.load(open(P)); ids = json.load(open('/home/claude/v24/up-ids.json'))
for g in ('Art-v24', 'Art-v24-shots'):
    files = {}
    for k, v in sorted(ids.items()):
        gg, f = k.split('/', 1)
        if gg != g: continue
        files[f] = {'name': f, 'blob': v, 'size': os.path.getsize('/home/claude/v24/up/' + k), 'type': 'image/png'}
    d['assetGroups'][g] = {'name': g, 'tile': 'm', 'files': files, 'order': list(files)}
    if g not in d['groups']: d['groups'].append(g)
d['lastChange'] = {'by': 'Kirill', 'at': '2026-10-14T23:30:00Z', 'via': 'Claude (Cowork)',
                   'note': 'v24 · арт одним стилем: листы Shattered в раскладках PD (герои, образы, жители, портреты, бафы, значки, метки, журнал), подложка, трава, двери и сундуки из листов регионов, спокойные полы канализации и тюрьмы; арт-дирекция, аудит, было/стало и снимки игры'}
json.dump(d, open(P, 'w'), ensure_ascii=False, indent=1)
print({g: len(d['assetGroups'][g]['files']) for g in ('Art-v24', 'Art-v24-shots')})
