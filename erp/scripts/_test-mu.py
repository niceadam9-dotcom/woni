# 별지 9호 3쪽 2절 안전시설등(다중이용업소) 병합 검증 — §9-6e
import importlib.util
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_report9", os.path.join(HERE, "make-report9.py"))
mr9 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mr9)
mf = mr9.mf

ok = fail = 0
def check(name, cond, detail=""):
    global ok, fail
    print(("  ✅" if cond else "  ❌") + f" {name}" + (f" — {detail}" if detail and not cond else ""))
    ok, fail = ok + (1 if cond else 0), fail + (0 if cond else 1)

# 전 항목 병합 — 분리 런(MU-003·MU-008) 포함, 1절 '[ ]유도등' 오염 없음 확인
mu = {c: ("○" if i % 3 == 0 else "×" if i % 3 == 1 else "/") for i, (c, _, _) in enumerate(mr9.MU_ITEMS)}
ph = {k: "[  ]" for k in mr9.CK_KEYS}
ph.update({"customer_name": "MU테스트", "purpose": "근린생활시설", "address": "세종시"})
hwp, odt, html = mr9.generate_report9(ph, [], {}, mf.OUT_DIR, "_e2e_MU검증", mu_results=mu)

with zipfile.ZipFile(odt) as z:
    body = z.read("content.xml").decode("utf-8")
text = re.sub(r"<[^>]+>", "", re.sub(r"<text:s[^>]*/>", " ", body))

start = text.find("2. 안전시설등 점검 결과")
end = text.find("3. 소방시설등의 세부 현황", start)
region = text[start:end]
check("2절 영역 존재", start >= 0 and end > start)
# ○/× 항목 = √ 체크 (11개: idx%3 in 0,1), / 항목 = 체크 없음 (5개: idx%3==2 → MU-003,006,009,012,015)
check("√ 체크 개수(○·× 항목 11)", region.count("[√]") == 11, f"실제 {region.count('[√]')}")
check("결과 마크 ○ 존재", "○" in region)
check("결과 마크 × 존재", "×" in region)
check("결과 마크 / 존재", "/" in region)
# 분리 런 항목 체크 반영
check("유도등류(런 분리) 체크", "[√]유" in region)
check("비상경보(런 분리) / 유지(idx2=/)", "[ ]비상경보설비 또는" in region or "[√]비상경보설비" not in region)
# 1절 오염 없음 — 1절 영역의 [ ]유도등은 그대로
sec1 = text[text.find("1. 소방시설등 점검 결과"):start] if text.find("1. 소방시설등 점검 결과") >= 0 else text[:start]
check("1절 '[ ]유도등' 원형 유지(영역 한정 확인)", "[√]유도등" not in sec1)
for p in (hwp, odt, html):
    check(f"산출물 {os.path.basename(p)}", os.path.isfile(p) and os.path.getsize(p) > 5000)
mf.sdk_app().Application.Finalize()
print(f"\n결과: {ok} 통과 / {fail} 실패")
sys.exit(1 if fail else 0)
