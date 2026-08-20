#!/usr/bin/env python3
"""Find UI phrases added after the last catalogue export and add Luganda drafts."""
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

app_path = Path(sys.argv[1] if len(sys.argv) > 1 else 'apps/web/src/App.tsx')
catalogue_path = Path(sys.argv[2] if len(sys.argv) > 2 else 'apps/api/src/l10n/lg.draft.json')
source_path = Path(sys.argv[3] if len(sys.argv) > 3 else 'apps/api/src/l10n/en.source.json')

source = app_path.read_text()
phrases = set()

def add(value):
    value = re.sub(r'\s+', ' ', value).strip()
    if len(value) < 3 or len(value) > 240 or not re.search(r'[A-Za-z]', value):
        return
    if any(token in value for token in ['=>', '===', '!==', 'useState', 'useEffect', 'Promise.', 'return ', '&&', '||', 'className', 'fontSize']):
        return
    if value.startswith(('[', '(', '{', ':', ';', '/', '=')):
        return
    phrases.add(value)

for match in re.finditer(r'>([^<>{}\n]{3,240})<', source):
    add(match.group(1))
for match in re.finditer(r'(?:placeholder|aria-label|title)=(["\'])(.*?)\1', source):
    add(match.group(2))

existing = json.loads(catalogue_path.read_text())
known = {entry['source'] for entry in existing}
missing = sorted(phrases - known)
if not missing:
    source_path.write_text(json.dumps(sorted(set(json.loads(source_path.read_text())) | phrases), ensure_ascii=False, indent=2) + '\n')
    print('Luganda catalogue is already complete for extracted UI phrases.')
    raise SystemExit(0)

def translate_batch(batch):
    payload = '\n'.join(f'{index:04d}|{phrase}' for index, phrase in batch)
    url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=lg&dt=t&q=' + urllib.parse.quote(payload)
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 agri-connect-catalogue'})
    with urllib.request.urlopen(request, timeout=40) as response:
        data = json.loads(response.read())
    rendered = ''.join(part[0] for part in data[0] if part and part[0])
    matches = list(re.finditer(r'(?m)^(\d{4})\|', rendered))
    result = {}
    for position, match in enumerate(matches):
        end = matches[position + 1].start() if position + 1 < len(matches) else len(rendered)
        result[int(match.group(1))] = rendered[match.end():end].strip()
    return result

translated = {}
for start in range(0, len(missing), 35):
    batch = list(enumerate(missing[start:start + 35], start))
    for attempt in range(4):
        try:
            translated.update(translate_batch(batch))
            break
        except Exception as error:
            if attempt == 3:
                print(f'Batch {start // 35 + 1} failed: {error}', file=sys.stderr)
            time.sleep(1.5 * (attempt + 1))
    time.sleep(.2)

now = '2026-08-17T00:00:00.000Z'
for index, phrase in enumerate(missing):
    text = translated.get(index) or phrase
    existing.append({
        'id': hashlib.sha256(('lg\0' + phrase).encode()).hexdigest()[:20],
        'language': 'lg', 'source': phrase, 'text': text, 'status': 'draft',
        'domain': 'interface', 'reviewedBy': None, 'updatedAt': now,
    })

catalogue_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + '\n')
all_sources = sorted(set(json.loads(source_path.read_text())) | phrases)
source_path.write_text(json.dumps(all_sources, ensure_ascii=False, indent=2) + '\n')
print(f'Added {len(missing)} new Luganda drafts; catalogue now has {len(existing)} entries.')
