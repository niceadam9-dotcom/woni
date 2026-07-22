# 외관점검표 병합 E2E — 샘플 데이터로 생성 후 산출물 텍스트 검증
import importlib.util
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_exterior", os.path.join(HERE, "make-exterior.py"))
mx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mx)

OUT = mx.mf.OUT_DIR
ph = {
    "customer_name": "테스트빌딩", "purpose": "업무시설", "address": "세종시 테스트로 1",
    "mgr_title": "과장", "mgr_name": "홍길동", "mgr_phone": "010-1234-5678", "yr": "2026",
    # 7월 점검 기록 (표지 7행)
    "d7_md": "  7월 21일", "d7_g": "[√]", "d7_b": "[  ]", "d7_nm": "김점검",
    # 섹션1 항목 결과 — 7월
    "x1_1_7": "○", "x1_2_7": "○", "x1_3_7": "×", "x1_4_7": "/",
    "x14_7_7": "○",
}
hwp, odt, html = mx.generate_exterior(ph, OUT, "_e2e_외관점검표")
ok = fail = 0

def check(name: str, cond: bool, detail: str = "") -> None:
    global ok, fail
    print(("  ✅" if cond else "  ❌") + f" {name}" + (f" — {detail}" if detail and not cond else ""))
    ok, fail = ok + (1 if cond else 0), fail + (0 if cond else 1)

for p in (hwp, odt, html):
    check(f"산출물 존재 {os.path.basename(p)}", os.path.isfile(p) and os.path.getsize(p) > 5000)

# ODT 텍스트 검증
with zipfile.ZipFile(odt) as z:
    body = z.read("content.xml").decode("utf-8")
text = re.sub(r"<[^>]+>", "", re.sub(r"<text:s[^>]*/>", " ", body))
check("기관명 병합", "테스트빌딩" in text)
check("구분·소재지", "업무시설" in text and "세종시 테스트로 1" in text)
check("관리자", "홍길동" in text and "010-1234-5678" in text)
check("연도", "( 2026 년도)" in text)
check("표지 7월 기록", "7월 21일" in text and "김점검" in text)
check("표지 양호 체크", "[√]양호" in text)
check("빈 행 원형 유지(월   일)", len(re.findall(r"월\s+일", text)) >= 11)
check("결과 마크 ○/×//", "×" in text and "/" in text and "○" in text)
check("placeholder 잔존 없음", "{{" not in text)
mx.mf.sdk_app().Application.Finalize()
print(f"\n결과: {ok} 통과 / {fail} 실패")
sys.exit(1 if fail else 0)
