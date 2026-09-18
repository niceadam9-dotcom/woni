# 1.14.1 월 격자 상자 좌표·방법 라벨 실측 (2026-09-18) — manifest 정적 읽기
import json, re, sys

m = json.load(open('src/lib/fire-plan-xlsx-manifest.json', encoding='utf-8'))
s = [x for x in m['sheets'] if x['name'] == '1.14.1 화재예방 및 홍보 계획'][0]
out = open(sys.argv[1], 'w', encoding='utf-8')
byrow = {}
for k in s['boxes']:
    r = int(re.sub(r'[A-Z]', '', k))
    byrow.setdefault(r, []).append(re.sub(r'[0-9]', '', k))
for r in sorted(byrow):
    out.write(f'row {r}: {sorted(byrow[r], key=lambda c: (len(c), c))}\n')
for a in ['A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'AO16', 'AO17']:
    out.write(f'{a} {s["labels"].get(a)!r}\n')
out.close()
