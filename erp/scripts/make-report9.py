# 별지 9호(소방시설등 자체점검 실시결과 보고서) 병합 모듈 — P3 MVP (2026-07-23, 소방계획서_4.md §9-3·§9-6)
# 범위: 1~3쪽 자동 병합(대상물·점검인력·소방안전정보·건축물 정보·시설 체크·양호/불량), 4~8쪽 빈 서식 유지.
# 방식: seed-report9-placeholders.py가 템플릿에 {{key}}를 1회 심고, 런타임은 단순 치환(소방계획서 A안과 동일).
# 템플릿 기준본 = 법제처 API 수신 최신본(§9-6⑥). 개정 수신 시 재심기.
import importlib.util
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("make_fireplan", os.path.join(HERE, "make-fireplan.py"))
mf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mf)

FORM_DIR = os.path.join(ROOT, "..", "erp_goal", "_form")
TEMPLATE9 = os.path.abspath(os.path.join(FORM_DIR, "별지9호_법제처API_20260701.hwp"))
TEMPLATE9_PH = os.path.abspath(os.path.join(FORM_DIR, "별지9호-placeholder.hwpx"))
PH_RE = mf.PH_RE

# ── 심기 좌표 ① 런 단위 리터럴 치환 (old, new, count) — HWPX <hp:t> 런 원문 기준, count=1이면 첫 등장만 ──
SEED_RUNS: list[tuple[str, str, int]] = [
    # 1쪽 — 대상물 (라벨 셀 자체가 기입란 — 라벨 런에 인라인)
    ("명칭(상호)</hp:t>", "명칭(상호) :  {{customer_name}}</hp:t>", 1),
    ("대상물 구분(용도)</hp:t>", "대상물 구분(용도) :  {{purpose}}</hp:t>", 1),
    (">소재지</hp:t>", ">소재지 :  {{address}}</hp:t>", 1),
    # 1쪽 — 점검 구분
    (" [  ] 작동점검, 종합점검", " {{ck_op}} 작동점검, 종합점검", 1),
    ("([  ]최초점검, [  ]그 밖의 종합점검)", "({{ck_initial}}최초점검, {{ck_comp_etc}}그 밖의 종합점검)", 1),
    # 1쪽 — 점검기간·점검자(항상 관리업자 체크 — §9-6①)·송달 동의·제출일·제출처
    ("         년    월    일    ~      년    월    일 ( 총 점검일수:        일 )",
     "  {{insp_period}}  ( 총 점검일수: {{insp_days}}일 )", 1),
    (" [  ]소방시설관리업자  (업체명:                , 전화번호:                  )",
     " {{ck_contractor}}소방시설관리업자  (업체명: {{company_name}}, 전화번호: {{company_phone}})", 1),
    ("[  ] 동의함", "{{ck_consent_y}} 동의함", 1),
    ("[  ] 동의하지 않음", "{{ck_consent_n}} 동의하지 않음", 1),
    ("전자우편 주소                        @", "전자우편 주소   {{report_email}}", 1),
    ("                                                                      년        월       일",
     "                                                  {{report_date}}", 1),
    (" 관계인ㆍ○○ 소방본부장ㆍ소방서장", " {{submit_to}}", 1),
    # 2쪽 — 1. 소방안전정보
    (" [  ]소유자, [  ]관리자, [  ]점유자 / 성명:           , 전화번호:",
     " {{ck_rep_owner}}소유자, {{ck_rep_manager}}관리자, {{ck_rep_occupant}}점유자 / 성명: {{owner_name}}, 전화번호: {{owner_phone}}", 1),
    (" [  ]특급, [  ]1급, [  ]2급, [  ]3급", " {{ck_g0}}특급, {{ck_g1}}1급, {{ck_g2}}2급, {{ck_g3}}3급", 1),
    ("성명:           , 전화번호:                   , 최근 교육이수일:    년    월    일",
     "성명: {{mgr_name}}, 전화번호: {{mgr_phone}}, 최근 교육이수일: {{mgr_edu_date}}", 1),
    (" [  ]작성 ([  ]보관 [  ]미보관), [  ]미작성",
     " {{ck_plan_y}}작성 ({{ck_plan_keep}}보관 {{ck_plan_nokeep}}미보관), {{ck_plan_n}}미작성", 1),
    (" 작동점검 ([  ]실시 [  ]미실시), 종합점검 ([  ]실시 [  ]미실시)",
     " 작동점검 ({{ck_prev_op_y}}실시 {{ck_prev_op_n}}미실시), 종합점검 ({{ck_prev_comp_y}}실시 {{ck_prev_comp_n}}미실시)", 1),
    (" 소방안전교육 ([  ]실시 [  ]미실시), 소방훈련 ([  ]실시 [  ]미실시)",
     " 소방안전교육 ({{ck_edu_y}}실시 {{ck_edu_n}}미실시), 소방훈련 ({{ck_drill_y}}실시 {{ck_drill_n}}미실시)", 1),
    (" [  ]가입, [  ]미가입", " {{ck_ins_y}}가입, {{ck_ins_n}}미가입", 1),
    ("보험사:                , 가입기간:        년    월    일    ~      년    월    일",
     "보험사: {{ins_company}}, 가입기간: {{ins_period}}", 1),
    ("가입금액:  대인(              천만원)    대물(               천만원)",
     "가입금액:  대인( {{ins_person}} )    대물( {{ins_property}} )", 1),
    ("[  ]해당없음", "{{ck_multi_none}}해당없음", 1),
    # 2쪽 — 2. 건축물 정보 (건축허가일·사용승인일은 동일 리터럴 — XML 등장 순서: 허가일이 먼저)
    ("           년      월      일", " {{permit_date}}", 1),
    ("           년      월      일", " {{use_approval_date}}", 1),
    ("             ㎡", " {{total_area}} ㎡", 1),
    ("           ㎡", " {{building_area}} ㎡", 1),
    ("  지상      층 / 지하      층", "  지상 {{floors_above}} 층 / 지하 {{floors_below}} 층", 1),
    ("        m", " {{height_m}} m", 1),
    ("     개동", " {{building_count}} 개동", 1),
    (" [  ]콘크리트구조, [  ]철골구조, [  ]조적조, [  ]목구조, [  ]기타",
     " {{ck_st_con}}콘크리트구조, {{ck_st_steel}}철골구조, {{ck_st_brick}}조적조, {{ck_st_wood}}목구조, {{ck_st_etc}}기타", 1),
    (" [  ]슬래브, [  ]기와, [  ]슬레이트, [  ]기타",
     " {{ck_rf_slab}}슬래브, {{ck_rf_tile}}기와, {{ck_rf_slate}}슬레이트, {{ck_rf_etc}}기타", 1),
    (" [  ]승용(    대), [  ]비상용(    대), [  ]피난용(    대)",
     " {{ck_elv_r}}승용( {{elv_r}} 대), {{ck_elv_e}}비상용( {{elv_e}} 대), {{ck_elv_v}}피난용( {{elv_v}} 대)", 1),
    (" [  ]옥내([  ]지하 [  ]지상 [  ]필로티 [  ]기계식), [  ]옥상, [  ]옥외",
     " {{ck_pk_in}}옥내({{ck_pk_ug}}지하 {{ck_pk_gr}}지상 {{ck_pk_pl}}필로티 {{ck_pk_mech}}기계식), {{ck_pk_roof}}옥상, {{ck_pk_out}}옥외", 1),
]

# ── 심기 좌표 ② 라벨 뒤 빈 셀 주입 (label, nth, cell_offset) → key ──
ANCHOR_KEYS_9: dict[tuple[str, int, int], str] = {
    ("세 대 수", 1, 1): "households",
    # 점검인력 표 — 주된 1행 + 보조 5행 × (성명·자격구분·자격번호·점검참여일)
    ("주된 점검인력", 1, 1): "m_name", ("주된 점검인력", 1, 2): "m_grade",
    ("주된 점검인력", 1, 3): "m_no", ("주된 점검인력", 1, 4): "m_period",
}
for _i in range(1, 6):
    ANCHOR_KEYS_9[("보조 점검인력", _i, 1)] = f"a{_i}_name"
    ANCHOR_KEYS_9[("보조 점검인력", _i, 2)] = f"a{_i}_grade"
    ANCHOR_KEYS_9[("보조 점검인력", _i, 3)] = f"a{_i}_no"
    ANCHOR_KEYS_9[("보조 점검인력", _i, 4)] = f"a{_i}_period"

# ── 3쪽 소방시설등 점검 결과 — 항목 텍스트 (해당 체크 √ + 점검결과 ○/×// 주입 대상) ──
# 런이 분리된 항목(화재조기진압용·자동화재탐지 등)은 이름 부분 런으로 매칭한다.
FORM3_ITEMS: list[str] = [
    "소화기구 및 자동소화장치", "옥내소화전설비", "스프링클러설비", "간이스프링클러설비",
    "화재조기진압용스프링클러설비", "물분무소화설비", "미분무소화설비", "포소화설비", "이산화탄소소화설비",
    "할론소화설비", "할로겐화합물 및 불활성기체 소화설비", "분말소화설비", "강화액소화설비", "고체에어로졸소화설비",
    "옥외소화전설비",
    "단독경보형감지기", "비상경보설비", "자동화재탐지설비 및 시각경보기", "화재알림설비", "비상방송설비",
    "통합감시시설", "자동화재속보설비", "누전경보기", "가스누설경보기",
    "피난기구", "인명구조기구", "유도등", "유도표지", "피난유도선", "비상조명등", "휴대용비상조명등",
    "상수도소화용수설비", "소화수조 및 저수조",
    "거실제연설비", "부속실 등 제연설비", "연결송수관설비", "연결살수설비", "비상콘센트설비",
    "무선통신보조설비", "연소방지설비",
]


# 체크박스 placeholder 키 전체 — 워커가 기본값 '[  ]'를 채우고 해당 항목만 '[√]'로 덮어씀
CK_KEYS: list[str] = sorted(set(re.findall(r"\{\{(ck_[a-z0-9_]+)\}\}", "".join(n for _, n, _ in SEED_RUNS))))

# ── 3쪽 2절 안전시설등(다중이용업소) — §9-6e. item_code = 시트 MU-001~016(seed-mu-sheet.mjs와 1:1) ──
# (item_code, 체크 리터럴(런 원문 '[ ]…' — 2절 영역 내 1회 교체), 결과 셀 탐색 키(해당 행 셀 내 고유 문자열))
MU_ITEMS: list[tuple[str, str, str]] = [
    ("MU-001", "[ ]소화기 또는 자동확산소화기", "소화기 또는 자동확산소화기"),
    ("MU-002", "[ ]간이스프링클러설비", "간이스프링클러설비"),
    ("MU-003", "[ ]비상경보설비 또는", "비상경보설비 또는"),  # 런 분리: '…또는' + '자동화재탐지설비'
    ("MU-004", "[ ]가스누설경보기", "가스누설경보기"),
    ("MU-005", "[ ]피난기구", "피난기구"),
    ("MU-006", "[ ]피난유도선", "피난유도선"),
    ("MU-007", "[ ]피난안내도, 피난안내영상물", "피난안내도, 피난안내영상물"),
    ("MU-008", "[ ]유", "도등, 유도표지 또는 비상조명등"),  # 런 분리: '[ ]유' + '도등, …'
    ("MU-009", "[ ]휴대용비상조명등", "휴대용비상조명등"),
    ("MU-010", "[ ]창 문", "창 문"),
    ("MU-011", "[ ]방화문", "방화문"),
    ("MU-012", "[ ]비상구(비상탈출구)", "비상구(비상탈출구)"),
    ("MU-013", "[ ]영업장 내부 피난통로", "영업장 내부 피난통로"),
    ("MU-014", "[ ]영상음향차단장치", "영상음향차단장치"),
    ("MU-015", "[ ]누전차단기", "누전차단기"),
    ("MU-016", "[ ]방염대상물품", "방염대상물품"),
]
MU_BY_CODE = {c: (ck, anchor) for c, ck, anchor in MU_ITEMS}
MU_SECTION_START = "2. 안전시설등 점검 결과"
MU_SECTION_END = "3. 소방시설등의 세부 현황"


def _apply_mu(xml: str, mu_results: dict[str, str]) -> tuple[str, int]:
    """2절 영역 한정 병합 — ○/×는 해당 설비 체크(√)+결과, /는 결과만. 1절의 동명 '[ ]항목'과 충돌 방지."""
    start = xml.find(MU_SECTION_START)
    end = xml.find(MU_SECTION_END, start)
    if start < 0 or end < 0:
        return xml, 0
    region = xml[start:end]
    ok = 0
    for code, mark in mu_results.items():
        if code not in MU_BY_CODE or mark not in ("○", "×", "/"):
            continue
        ck, anchor = MU_BY_CODE[code]
        if mark in ("○", "×") and ck in region:
            region = region.replace(ck, ck.replace("[ ]", "[√]", 1), 1)
        region, injected = _result_after(region, anchor, mark)
        ok += 1 if injected else 0
    return xml[:start] + region + xml[end:], ok


def _check_run(xml: str, item: str) -> tuple[str, bool]:
    """3쪽 ` [ ]항목` → ` [√]항목` — 런 분리 케이스는 항목명 직전 `[ ]` 런을 찾아 치환"""
    direct = f"[ ]{item}"
    if direct in xml:
        return xml.replace(direct, f"[√]{item}", 1), True
    # 런 분리: <hp:t>…[ ]</hp:t> … <hp:t>항목명…</hp:t> — 항목명 런 앞쪽 400자 내 마지막 `[ ]`
    pos = xml.find(f"<hp:t>{item}")
    if pos < 0:
        return xml, False
    window = xml[max(0, pos - 400):pos]
    ck = window.rfind("[ ]")
    if ck < 0:
        return xml, False
    abs_ck = max(0, pos - 400) + ck
    return xml[:abs_ck] + "[√]" + xml[abs_ck + 3:], True


def _result_after(xml: str, item: str, mark: str) -> tuple[str, bool]:
    """항목이 속한 셀 다음의 빈 셀(점검결과란)에 ○/×// 주입"""
    pos = xml.find(item)
    if pos < 0:
        return xml, False
    tc_end = xml.find("</hp:tc>", pos)
    if tc_end < 0:
        return xml, False
    nxt = xml.find("<hp:tc ", tc_end)
    if nxt < 0:
        return xml, False
    cell_end = xml.find("</hp:tc>", nxt)
    cell = xml[nxt:cell_end]
    m = re.search(r'<hp:run charPrIDRef="(\d+)"/>', cell)
    if not m:
        return xml, False
    new_cell = cell.replace(m.group(0),
        f'<hp:run charPrIDRef="{m.group(1)}"><hp:t>{mark}</hp:t></hp:run>', 1)
    return xml[:nxt] + new_cell + xml[cell_end:], True


def generate_report9(ph: dict[str, str], facility_checks: list[str], result_marks: dict[str, str],
                     out_dir: str, out_base: str,
                     mu_results: dict[str, str] | None = None) -> tuple[str, str, str]:
    """placeholder 치환 + 3쪽 체크·결과 주입(1절 + 2절 안전시설등 §9-6e) → (hwp, odt, html) 생성."""
    assert os.path.isfile(TEMPLATE9_PH), "별지9호 placeholder 템플릿 없음 — seed-report9-placeholders.py 먼저 실행"
    hwpsdk = mf.sdk_app()
    obj = hwpsdk.Application.GetHwpObject()
    os.makedirs(out_dir, exist_ok=True)
    merged = os.path.join(out_dir, f"_{out_base}_merged.hwpx")

    replacements = {f"{{{{{k}}}}}": v for k, v in ph.items() if v}
    with zipfile.ZipFile(TEMPLATE9_PH, "r") as zin, zipfile.ZipFile(merged, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("Contents/section0.xml", "Preview/PrvText.txt"):
                xml = data.decode("utf-8")
                for old, new in replacements.items():
                    xml = xml.replace(old, new)
                if item.filename == "Contents/section0.xml":
                    ck_ok, ck_fail, rs_ok = 0, [], 0
                    for it in facility_checks:
                        xml, ok = _check_run(xml, it)
                        ck_ok, ck_fail = ck_ok + (1 if ok else 0), ck_fail + ([] if ok else [it])
                    for it, mark in result_marks.items():
                        xml, ok = _result_after(xml, it, mark)
                        rs_ok += 1 if ok else 0
                    mu_ok = 0
                    if mu_results:
                        xml, mu_ok = _apply_mu(xml, mu_results)
                    print(f"  3쪽: 체크 {ck_ok}/{len(facility_checks)}, 결과 {rs_ok}/{len(result_marks)}"
                          + (f", 안전시설등 {mu_ok}/{len(mu_results)}" if mu_results else "")
                          + (f" ⚠미매칭 {ck_fail}" if ck_fail else ""))
                # 미채움 placeholder → 빈 칸 (체크박스 기본값은 워커가 '[  ]'를 제공)
                xml = PH_RE.sub("", xml)
                data = xml.encode("utf-8")
            zout.writestr(item, data)

    doc = obj.CreateDocument()
    assert doc.Open(merged, "", ""), "병합본 열기 실패"
    out_hwp = os.path.join(out_dir, f"{out_base}.hwp")
    out_odt = os.path.join(out_dir, f"{out_base}.odt")
    out_html = os.path.join(out_dir, f"{out_base}.html")
    assert doc.SaveAs(out_hwp, "HWP", ""), "HWP 저장 실패"
    assert doc.SaveAs(out_odt, "ODT", ""), "ODT 저장 실패"
    assert doc.SaveAs(out_html, "HTML", ""), "HTML 저장 실패"
    obj.ReleaseDocument(doc)
    mf.inline_html_images(out_html)
    os.remove(merged)
    return out_hwp, out_odt, out_html
