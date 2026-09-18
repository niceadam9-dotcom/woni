# 1.11.4 결과기록부 뒷쪽 — 라벨·예시문 자구 실측 (2026-09-18) — manifest 정적 읽기
import json, sys

m = json.load(open('src/lib/fire-plan-xlsx-manifest.json', encoding='utf-8'))
s = [x for x in m['sheets'] if x['name'] == '1.11.4 결과기록부 뒷쪽'][0]
out = open(sys.argv[1], 'w', encoding='utf-8')
for k in sorted(s['labels'], key=lambda c: (int(''.join(ch for ch in c if ch.isdigit())), c)):
    out.write(f'{k} {s["labels"][k]!r}\n')
out.close()
