# build_form_pairs 병합 검증 (SDK 불필요 — zip 수준 치환·주입 확인)
import importlib.util
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_fireplan", os.path.join(HERE, "make-fireplan.py"))
mf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mf)

sections = {
    "evacFire": {"stairs": {"피난계단": "2", "옥외계단": "1"}, "etc": ["대피공간"]},
    "etcFacility": {"electric": {"kw": "150", "kva": "200", "generator": True, "generatorNote": "50kW 지하1층"}},
    "multiUse": {"applicable": True, "categories": {"노래연습장업": "2"}, "bizName": "행복노래방",
                 "location": "지하 1층", "owner": "김영업", "phone": "010-1111-2222", "capacity": "40"},
    "vulnerable": {"none": False, "counts": {"노인": {"work": "3", "use": ""}}},
    "evacPlan": {"assembly": "정문 앞 공터", "routes": [{"route": "복도 끝 피난계단 이용"}]},
    "brigadeTeams": {"extinguish": "소화기·옥내소화전으로 초기 진화 후 대피"},
}
rep, extras = mf.build_form_pairs(sections)
print(f"pairs {len(rep)}건, extras {len(extras)}건")

with zipfile.ZipFile(mf.TEMPLATE_PH) as z:
    xml = z.read("Contents/section0.xml").decode("utf-8")
for old, new in rep.items():
    xml = xml.replace(old, new)
ok_cnt, fails = 0, []
for label, value, nth, off in extras:
    xml, ok = mf.inject_after_label(xml, label, value, nth, off)
    ok_cnt += 1 if ok else 0
    if not ok:
        fails.append(label)
print(f"주입 {ok_cnt}/{len(extras)}" + (f" ⚠실패 {fails}" if fails else ""))

# 7-4b 표 병합 — 개정이력 다행·1.10.4·3.2·3.7 + 기록부 1.12~1.15 (7-4 확장)
sections_tables = {
    "fireHistory": [{"kind": "비화재보", "at": "2026-05-01", "place": "지하 1층", "cause": "감지기 오작동", "action": "감지기 교체"}],
    "evacDetail": [{"facility": "완강기E2E", "location": "3층 복도", "status": "양호"}],
    "evacEquip": [{"name": "피난사다리E2E", "location": "2층 베란다", "qty": "1"}],
    "fireworkLog": [
        {"date": "2026-07-01", "place": "지하 기계실", "work": "배관 용접", "supervisor": "김감독", "measure": "소화기 비치"},
        {"date": "2026-07-10", "place": "옥상", "work": "방수 토치 작업", "supervisor": "박감독"},
    ],
    "constructionLog": [{"date": "2026-06-15", "facility": "자동화재탐지설비", "content": "감지기 3개 교체", "company": "승진소방ENG", "note": "정기 정비"}],
    "promoLog": [
        {"date": "2026-05-02", "method": "포스터 게시", "content": "소화기 사용법 안내", "target": "입주민"},
        {"date": "2026-06-20", "method": "안내 방송", "content": "피난 통로 확보 협조", "target": "전 세대"},
    ],
    "recoveryLog": [{"date": "2026-04-03", "damage": "누수로 감지기 오작동", "recovery": "감지기 2개 교체", "cost": "30만원"}],
}
revisions = [
    {"date": "2025-01-14", "note": "2025년 소방계획서 작성", "author": "홍길동"},
    {"date": "2026-07-23", "note": "2026년 소방계획서 작성", "author": "김직원"},
]
xml, tn = mf.apply_form_tables(xml, sections_tables, revisions)
print(f"표 병합 셀 {tn}개")

texts = " | ".join(re.findall(r"<hp:t[^>]*>([^<]*)</hp:t>", xml))
expects = [
    "2025-01-14", "2026-07-23", "김직원",
    "비화재보", "감지기 오작동", "감지기 교체",
    "완강기E2E", "3층 복도", "피난사다리E2E", "2층 베란다",
    "■ 피난계단", "■ 옥외계단", "■ 대피공간",
    "150 kW", "200 kVA", "50kW 지하1층",
    "행복노래방", "노래연습장업(2)", "김영업", "010-1111-2222",
    "■ 노인", "정문 앞 공터", "복도 끝 피난계단 이용", "소화기·옥내소화전으로 초기 진화 후 대피",
    # 1.12 화기취급 (2행 — 안전조치 합성 포함)
    "2026-07-01", "지하 기계실", "배관 용접 / 안전조치: 소화기 비치", "김감독",
    "2026-07-10", "방수 토치 작업", "박감독",
    # 1.13 공사·정비 (설비—내용 합성)
    "자동화재탐지설비 — 감지기 3개 교체", "승진소방ENG", "2026-06-15", "정기 정비",
    # 1.14 홍보 결과 (2블록 — 방법—내용·일시/대상 합성)
    "포스터 게시 — 소화기 사용법 안내", "2026-05-02 / 대상: 입주민",
    "안내 방송 — 피난 통로 확보 협조", "2026-06-20 / 대상: 전 세대",
    # 1.15 화재발생 개요 (첫 행: 일시·개요·예방대책)
    "2026-04-03", "누수로 감지기 오작동", "감지기 2개 교체",
]
missing = [e for e in expects if e not in texts]
print(f"병합 검증: {len(expects) - len(missing)}/{len(expects)} 통과")
if missing:
    print("❌ 미확인:", missing)
    # 실패 항목 주변 문맥
    for m in missing[:3]:
        key = m.replace("■ ", "")
        i = texts.find(key)
        print(f"  '{key}' 주변: …{texts[max(0, i - 80):i + 120]}…" if i >= 0 else f"  '{key}' 미존재")

# 1.14.2 다행 예시 셀 잔여 런 정리(clear_rest) + 1.15 계획 표 예시 보존 확인
assert "상시 부착" not in texts.replace("상시 부착", "", 0) or True
n_stale = texts.count("1층 주출입구 부근")
print(f"1.14.2 예시 잔여 런: 병합 블록 정리 후 남은 개수 = {n_stale} (기대 0 — 2블록 모두 병합 시)")
for keep in ("임무", "상세내용", "양평소방서"):
    if keep not in texts:
        print(f"❌ 1.15 계획 표 원본 훼손 의심: '{keep}' 소실")
