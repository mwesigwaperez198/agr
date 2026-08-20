#!/usr/bin/env python3
"""One-time draft-catalog generator. Output requires administrator/language-expert review."""
import hashlib, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

source_path = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/phrases.json')
target_path = Path(sys.argv[2] if len(sys.argv) > 2 else 'apps/api/src/l10n/lg.draft.json')
phrases = json.loads(source_path.read_text())

def translate_batch(batch):
    payload = '\n'.join(f'{index:04d}|{phrase}' for index, phrase in batch)
    url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=lg&dt=t&q=' + urllib.parse.quote(payload)
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 translation-draft-generator'})
    with urllib.request.urlopen(request, timeout=40) as response:
        data = json.loads(response.read())
    rendered = ''.join(part[0] for part in data[0] if part and part[0])
    result = {}
    matches = list(re.finditer(r'(?m)^(\d{4})\|', rendered))
    for position, match in enumerate(matches):
        end = matches[position + 1].start() if position + 1 < len(matches) else len(rendered)
        result[int(match.group(1))] = rendered[match.end():end].strip()
    return result

def domain_for(source):
    low = source.lower()
    if any(word in low for word in ['admin', 'audit', 'moderation', 'permission', 'platform settings', 'user management']): return 'administration'
    if any(word in low for word in ['sign in', 'login', 'register', 'password', 'account', 'authentication', 'mfa']): return 'identity'
    if any(word in low for word in ['ai', 'guidance', 'advisor', 'diagnosis', 'question']): return 'agricultural_ai'
    if any(word in low for word in ['order', 'buyer', 'seller', 'market', 'price', 'cart', 'payment', 'listing', 'produce']): return 'marketplace'
    if any(word in low for word in ['coffee', 'crop', 'animal', 'farm', 'harvest', 'plant']): return 'agriculture'
    return 'interface'

translations = {}
batch = []
size = 0
all_batches = []
for index, phrase in enumerate(phrases):
    line_size = len(phrase.encode('utf-8')) + 8
    if batch and size + line_size > 4300:
        all_batches.append(batch); batch=[]; size=0
    batch.append((index, phrase)); size += line_size
if batch: all_batches.append(batch)

for number, batch in enumerate(all_batches, 1):
    for attempt in range(4):
        try:
            translations.update(translate_batch(batch)); break
        except Exception as error:
            if attempt == 3: print(f'Batch {number} failed: {error}', file=sys.stderr)
            time.sleep(1.5 * (attempt + 1))
    print(f'Translated batch {number}/{len(all_batches)} ({len(translations)}/{len(phrases)})')
    time.sleep(.15)

# Retry missing entries individually so every source phrase has a published draft.
for index, phrase in enumerate(phrases):
    if index in translations and translations[index]: continue
    try:
        translations.update(translate_batch([(index, phrase)]))
    except Exception:
        translations[index] = phrase  # Explicitly remains draft and visible in the review queue.
    time.sleep(.08)

entries = []
for index, source in enumerate(phrases):
    entry_id = hashlib.sha256(('lg\0' + source).encode()).hexdigest()[:20]
    entries.append({
        'id': entry_id,
        'language': 'lg',
        'source': source,
        'text': translations.get(index) or source,
        'status': 'draft',
        'domain': domain_for(source),
        'reviewedBy': None,
        'updatedAt': '2026-08-16T00:00:00.000Z'
    })

target_path.parent.mkdir(parents=True, exist_ok=True)
target_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
print(f'Wrote {len(entries)} draft entries to {target_path}')
