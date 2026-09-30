import json
import urllib.request
from pathlib import Path

base = Path(r'c:\Users\user\OneDrive\Desktop\day1')

for name in ['index.html', 'about.html']:
    html = (base / name).read_text(encoding='utf-8')
    request = urllib.request.Request(
        'https://validator.w3.org/nu/?out=json',
        data=html.encode('utf-8'),
        headers={'Content-Type': 'text/html; charset=utf-8'},
        method='POST'
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode('utf-8'))

    errors = [
        item for item in payload.get('messages', [])
        if item.get('type') in ('error', 'non-document-error')
    ]
    warnings = [
        item for item in payload.get('messages', [])
        if item.get('type') == 'warning'
    ]

    print(f'{name}: errors={len(errors)} warnings={len(warnings)}')
    for item in errors[:5]:
        print(' ', item.get('message'))

    if errors:
        print('VALIDATION FAILED')
    else:
        print('VALIDATION OK')
