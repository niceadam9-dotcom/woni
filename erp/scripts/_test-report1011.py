# 별지 10·11호 병합 검증 (SDK 불필요 — zip 수준)
import importlib.util
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_report1011", os.path.join(HERE, "make-report1011.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ph10 = {
    "customer_name": "테스트대상물", "purpose": "근린생활시설", "address": "경기 양평군 테스트로 1",
    "owner_name": "박대표", "owner_phone": "010-1234-5678", "mgr_name": "박대표", "mgr_phone": "010-1234-5678",
    "total_period": "2026-07-25 ~ 2026-08-10", "total_days": "17", "report_date": "2026년 7월 23일", "submit_to": "양평소방서장",
}
rows10 = [{"content": "비상경보설비 수리", "period": "2026-07-25 ~ 2026-08-01"},
          {"content": "유도등 램프 교체", "period": "2026-08-01 ~ 2026-08-10"}]
ph11 = {
    **ph10, "company_name": "승진소방ENG", "company_bizno": "123-45-67890",
    "company_rep": "황동원", "company_phone": "031-000-0000", "company_address": "경기 양평군 회사로 1",
}
rows11 = [{"content": "비상경보설비 수리 완료", "period": "2026-08-01"}]

for kind, ph, rows, expects in (
    ("report10", ph10, rows10, ["명칭(상호) :  테스트대상물", "성명: 박대표", "2026-07-25 ~ 2026-08-10", "(총 17일)",
                                 "비상경보설비 수리", "유도등 램프 교체", "양평소방서장", "2026년 7월 23일"]),
    ("report11", ph11, rows11, ["명칭(상호) :  테스트대상물", "업체명(상호) :  승진소방ENG", "사업자번호 :  123-45-67890",
                                 "성명: 황동원", "소재지 :  경기 양평군 회사로 1", "비상경보설비 수리 완료", "양평소방서장"]),
):
    with zipfile.ZipFile(m.PH[kind]) as z:
        xml = z.read("Contents/section0.xml").decode("utf-8")
    merged = m.merge_xml(kind, ph, rows, xml)
    texts = " | ".join(re.findall(r"<hp:t[^>]*>([^<]*)</hp:t>", merged))
    missing = [e for e in expects if e not in texts]
    leftover = re.findall(r"\{\{[a-z0-9_]+\}\}", texts)
    print(f"{kind}: {len(expects) - len(missing)}/{len(expects)} 통과" + (f" ❌미확인 {missing}" if missing else "") + (f" ⚠잔여토큰 {leftover}" if leftover else ""))
    # 11호 예시 문구 제거 확인
    if kind == "report11" and rows11:
        print(f"  예시 제거: {'✅' if '소화펌프' not in texts.split('이행조치 내용')[1][:200] else '❌ 첫 행에 예시 잔존'}")
