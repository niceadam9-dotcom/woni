# 별지 10호(이행계획서)·11호(이행완료 보고서) 병합 모듈 — R-3 (2026-07-23, 소방계획서_4.md §9-7)
# 1쪽 단순 서식 — placeholder 심기(정규식 기반) + 런타임 치환 + 이행 행 셀 주입.
# 데이터 원천 = inspection_defects (계획: action_plan/start/end(099) · 완료: action_taken/completed_at(084))
import importlib.util
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("make_fireplan", os.path.join(HERE, "make-fireplan.py"))
mf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mf)

FORM_DIR = os.path.abspath(os.path.join(ROOT, "..", "erp_goal", "_form"))
SRC = {
    "report10": os.path.join(FORM_DIR, "[별지_제10호서식]_소방시설등의_자체점검_결과_이행계획서(소방시설_설치_및_관리에_관한_법률_시행규칙)_홈페이지_게시용.hwp"),
    "report11": os.path.join(FORM_DIR, "[별지_제11호서식]_소방시설등의_자체점검_결과_이행완료_보고서(소방시설_설치_및_관리에_관한_법률_시행규칙)_홈페이지_게시용.hwp"),
}
PH = {
    "report10": os.path.join(FORM_DIR, "별지10호-placeholder.hwpx"),
    "report11": os.path.join(FORM_DIR, "별지11호-placeholder.hwpx"),
}
PH_RE = mf.PH_RE

# 심기 — (패턴, 치환, 횟수). 공백 개수가 문서마다 달라 정규식으로 심는다.
SEED_REGEX: dict[str, list[tuple[str, str, int]]] = {
    "report10": [
        (r"대상물 명칭\(상호\)</hp:t>", "대상물 명칭(상호) :  {{customer_name}}</hp:t>", 1),
        (r"대상물 구분\(용도\)</hp:t>", "대상물 구분(용도) :  {{purpose}}</hp:t>", 1),
        (r">소재지</hp:t>", ">소재지 :  {{address}}</hp:t>", 1),
        # 문서 순서: 첫 괄호 = 관계인, 둘째 = 소방안전관리자
        (r"\(성명:\s+전화번호:\s+\)", "(성명: {{owner_name}}   전화번호: {{owner_phone}})", 1),
        (r"\(성명:\s+전화번호:\s+\)", "(성명: {{mgr_name}}   전화번호: {{mgr_phone}})", 1),
        (r"년\s{2,}월\s{2,}일\s+~\s+년\s{2,}월\s{2,}일\(총\s+일\)", " {{total_period}} (총 {{total_days}}일)", 1),
        (r"\s{40,}년\s{5,}월\s{5,}일", "                                  {{report_date}}", 1),
        (r"세종북부소방서장", "{{submit_to}}", 1),
    ],
    "report11": [
        (r"대상물 명칭\(상호\)</hp:t>", "대상물 명칭(상호) :  {{customer_name}}</hp:t>", 1),
        (r"대상물 구분\(용도\)</hp:t>", "대상물 구분(용도) :  {{purpose}}</hp:t>", 1),
        (r">소재지</hp:t>", ">소재지 :  {{address}}</hp:t>", 1),          # 첫 소재지 = 대상물
        (r"\(성명:\s+전화번호:\s+\)", "(성명: {{owner_name}}   전화번호: {{owner_phone}})", 1),  # 관계인
        (r">성명:</hp:t>", ">성명: {{mgr_name}}</hp:t>", 1),               # 소방안전관리자 (분리 런)
        (r">전화번호:</hp:t>", ">전화번호: {{mgr_phone}}</hp:t>", 1),
        (r"업체명\(상호\)</hp:t>", "업체명(상호) :  {{company_name}}</hp:t>", 1),
        (r">사업자번호</hp:t>", ">사업자번호 :  {{company_bizno}}</hp:t>", 1),
        (r"\(성명:\s+전화번호:\s+\)", "(성명: {{company_rep}}   전화번호: {{company_phone}})", 1),  # 대표이사
        (r">소재지</hp:t>", ">소재지 :  {{company_address}}</hp:t>", 1),   # 둘째 소재지 = 업체
        (r"\s{40,}년\s{5,}월\s{5,}일", "                              {{report_date}}", 1),
        (r"세종북부소방서장", "{{submit_to}}", 1),
    ],
}
# 이행 행 좌표 — (앵커, 데이터 시작 rowAddr, {colAddr: 키})
ROW_TABLE: dict[str, tuple[str, int, dict[int, str]]] = {
    "report10": ("이행조치 사항", 8, {1: "content", 4: "period"}),
    "report11": ("이행조치 내용", 11, {1: "content", 4: "period"}),
}


def _set_cell_full(tc: str, value: str) -> str:
    """셀의 모든 텍스트 런을 비운 뒤 값 주입 (예시 문구 다중 런·빈 런 혼재 대응)"""
    cleared = re.sub(r"(<hp:t[^>]*>)[^<]*(</hp:t>)", r"\1\2", tc)
    m = re.search(r'<hp:run charPrIDRef="(\d+)"/>', cleared)
    if m:
        return cleared.replace(m.group(0),
            f'<hp:run charPrIDRef="{m.group(1)}"><hp:t>{mf._xml_escape(value)}</hp:t></hp:run>', 1)
    return re.sub(r"(<hp:t[^>]*>)(</hp:t>)", lambda mm: mm.group(1) + mf._xml_escape(value) + mm.group(2), cleared, count=1)


def fill_rows(xml: str, kind: str, rows: list[dict]) -> tuple[str, int]:
    anchor, row_start, col_map = ROW_TABLE[kind]
    start = xml.find(anchor)
    if start < 0 or not rows:
        return xml, 0
    end = min(len(xml), start + 22000)
    filled = 0

    def repl(m: re.Match) -> str:
        nonlocal filled
        tc = m.group(0)
        addr = re.search(r'cellAddr colAddr="(\d+)" rowAddr="(\d+)"', tc)
        if not addr:
            return tc
        c, r = int(addr.group(1)), int(addr.group(2))
        ri = r - row_start
        if ri < 0 or ri >= min(len(rows), 4) or c not in col_map:
            return tc
        val = str(rows[ri].get(col_map[c]) or "")
        if not val.strip():
            return tc
        filled += 1
        return _set_cell_full(tc, val)

    seg = re.sub(r"<hp:tc .*?</hp:tc>", repl, xml[start:end], flags=re.S)
    return xml[:start] + seg + xml[end:], filled


def merge_xml(kind: str, ph: dict[str, str], rows: list[dict], xml: str) -> str:
    for old, new in {f"{{{{{k}}}}}": v for k, v in ph.items() if v}.items():
        xml = xml.replace(old, new)
    xml, _ = fill_rows(xml, kind, rows)
    return PH_RE.sub("", xml)


def generate_annex(kind: str, ph: dict[str, str], rows: list[dict], out_dir: str, out_base: str) -> tuple[str, str, str]:
    """placeholder 템플릿 병합 → (hwp, odt, html)"""
    tpl = PH[kind]
    assert os.path.isfile(tpl), f"{kind} placeholder 템플릿 없음 — seed-report1011-placeholders.py 먼저 실행"
    obj = mf.sdk_app().Application.GetHwpObject()
    os.makedirs(out_dir, exist_ok=True)
    merged = os.path.join(out_dir, f"_{out_base}_merged.hwpx")
    with zipfile.ZipFile(tpl, "r") as zin, zipfile.ZipFile(merged, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("Contents/section0.xml", "Preview/PrvText.txt"):
                data = merge_xml(kind, ph, rows, data.decode("utf-8")).encode("utf-8")
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
