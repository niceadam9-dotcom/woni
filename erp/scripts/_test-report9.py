# 별지 9호 병합 스모크 테스트 (일회성) — 샘플 값 배치 검증
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

CK = "[√]"
NO = "[  ]"
ph = {
    "customer_name": "테스트대상물", "purpose": "근린생활시설", "address": "경기 양평군 테스트로 1",
    "ck_op": CK, "ck_initial": NO, "ck_comp_etc": NO,
    "insp_period": "2026년 07월 01일 ~ 2026년 07월 02일", "insp_days": "2",
    "ck_contractor": CK, "company_name": "승진소방ENG", "company_phone": "031-000-0000",
    "ck_consent_y": CK, "ck_consent_n": NO, "report_email": "owner@example.com",
    "report_date": "2026년 07월 23일", "submit_to": "관계인ㆍ양평소방서장",
    "m_name": "홍주된", "m_grade": "소방시설관리사", "m_no": "제0001호", "m_period": "07-01~07-02",
    "a1_name": "김보조", "a1_grade": "중급점검자", "a1_no": "제0002호", "a1_period": "07-01~07-02",
    "ck_rep_owner": CK, "ck_rep_manager": NO, "ck_rep_occupant": NO,
    "owner_name": "박대표", "owner_phone": "010-1234-5678",
    "ck_g0": NO, "ck_g1": NO, "ck_g2": NO, "ck_g3": CK,
    "mgr_name": "박대표", "mgr_phone": "010-1234-5678", "mgr_edu_date": "2025년 5월 1일",
    "ck_plan_y": CK, "ck_plan_keep": CK, "ck_plan_nokeep": NO, "ck_plan_n": NO,
    "ck_prev_op_y": CK, "ck_prev_op_n": NO, "ck_prev_comp_y": NO, "ck_prev_comp_n": CK,
    "ck_edu_y": NO, "ck_edu_n": CK, "ck_drill_y": NO, "ck_drill_n": CK,
    "ck_ins_y": CK, "ck_ins_n": NO, "ins_company": "삼성화재", "ins_period": "2026-01-01 ~ 2027-01-01",
    "ins_person": "1억", "ins_property": "10억", "ck_multi_none": CK,
    "permit_date": "1999년 01월 02일", "use_approval_date": "2000년 03월 04일",
    "total_area": "1,234.5", "building_area": "567.8", "floors_above": "5", "floors_below": "1",
    "height_m": "20", "building_count": "2", "households": "12세대",
    "ck_st_con": CK, "ck_st_steel": NO, "ck_st_brick": NO, "ck_st_wood": NO, "ck_st_etc": NO,
    "ck_rf_slab": CK, "ck_rf_tile": NO, "ck_rf_slate": NO, "ck_rf_etc": NO,
    "ck_elv_r": CK, "elv_r": "2", "ck_elv_e": NO, "elv_e": "0",
    "ck_pk_in": NO, "ck_pk_ug": NO, "ck_pk_gr": NO, "ck_pk_pl": NO, "ck_pk_mech": NO, "ck_pk_roof": NO, "ck_pk_out": CK,
}
checks = ["소화기구 및 자동소화장치", "자동화재탐지설비 및 시각경보기", "유도등", "화재조기진압용스프링클러설비"]
marks = {"소화기구 및 자동소화장치": "○", "자동화재탐지설비 및 시각경보기": "×", "옥내소화전설비": "/"}

out_dir = os.path.join(HERE, "..", "..", "erp_goal", "_Data", "fireplan-out")
hwp, odt, html = mr9.generate_report9(ph, checks, marks, out_dir, "테스트_별지9호")
print("생성:", hwp)

# 출력 HWP → HWPX 재변환 → 텍스트 배치 검증
mfx = mr9.mf
obj = mfx.sdk_app().Application.GetHwpObject()
vx = hwp + ".verify.hwpx"
doc = obj.CreateDocument()
assert doc.Open(os.path.abspath(hwp), "", "")
assert doc.SaveAs(os.path.abspath(vx), "HWPX", "")
obj.ReleaseDocument(doc)
with zipfile.ZipFile(vx) as z:
    xml = z.read("Contents/section0.xml").decode("utf-8")
texts = re.findall(r"<hp:t[^>]*>([^<]*)</hp:t>", xml)
joined = " | ".join(texts)

expects = [
    "명칭(상호) :  테스트대상물", "대상물 구분(용도) :  근린생활시설", "소재지 :  경기 양평군 테스트로 1",
    "[√] 작동점검", "2026년 07월 01일 ~ 2026년 07월 02일", "총 점검일수: 2일",
    "[√]소방시설관리업자", "승진소방ENG", "[√] 동의함", "owner@example.com",
    "홍주된", "소방시설관리사", "김보조", "관계인ㆍ양평소방서장", "2026년 07월 23일",
    "[√]소유자", "박대표", "[√]3급", "[√]작성", "[√]보관",
    "삼성화재", "1억", "[√]해당없음",
    "1999년 01월 02일", "2000년 03월 04일", "1,234.5 ㎡", "567.8 ㎡",
    "지상 5 층 / 지하 1 층", "20 m", "2 개동", "12세대",
    "[√]콘크리트구조", "[√]슬래브", "[√]승용( 2 대)", "[√]옥외",
    "[√]소화기구 및 자동소화장치", "[√]유도등",
]
missing = [e for e in expects if e not in joined]
print(f"\n배치 검증: {len(expects) - len(missing)}/{len(expects)} 통과")
if missing:
    print("❌ 미확인:", missing)

# 3쪽 결과 마크 주변 문맥
for i, t in enumerate(texts):
    if t in ("○", "×", "/"):
        print(f"  마크[{i}] {t!r}: …{' | '.join(texts[max(0, i - 2):i + 3])}…")
os.remove(vx)
mfx.sdk_app().Application.Finalize()
