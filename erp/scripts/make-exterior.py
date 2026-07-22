# 외관점검표(소방시설등 외관점검표 — 소방시설 자체점검사항 등에 관한 고시 별지 6호) 병합 모듈
# 범위(§9-8d): 표지(대상물·관리자·해당 월 점검 기록) + 14개 설비 점검표의 해당 월 결과란(○/×//) 병합.
# 방식: seed-exterior-placeholders.py가 템플릿에 {{key}}를 심고(월별 셀 = x{섹션}_{행}_{월}),
#       런타임은 단순 치환. 항목↔행 매핑은 item_code(X{섹션}-{행})에 내장 — 별도 매핑 파일 불필요.
# 템플릿 기준본 = 법제처 수신본(고시 2022-71, 2022-12-01 개정). 개정 수신 시 재심기.
import importlib.util
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("make_fireplan", os.path.join(HERE, "make-fireplan.py"))
mf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mf)

FORM_DIR = os.path.join(ROOT, "..", "erp_goal", "_form")
TEMPLATE_EXT = os.path.abspath(os.path.join(FORM_DIR, "외관점검표_법제처API_20221201.hwp"))
TEMPLATE_EXT_PH = os.path.abspath(os.path.join(FORM_DIR, "외관점검표-placeholder.hwpx"))
MANIFEST_EXT = os.path.abspath(os.path.join(FORM_DIR, "외관점검표-manifest.json"))
PH_RE = mf.PH_RE

# ── 표지 심기 좌표 — 런 단위 리터럴 치환 (old, new, count) ──
SEED_RUNS_EXT: list[tuple[str, str, int]] = [
    ("기관명</hp:t>", "기관명 :  {{customer_name}}</hp:t>", 1),
    ("대상물 구분</hp:t>", "대상물 구분 :  {{purpose}}</hp:t>", 1),
    (">소재지</hp:t>", ">소재지 :  {{address}}</hp:t>", 1),
    ("직위:             직급:              성명:            전화번호:",
     "직위: {{mgr_title}}   직급:    성명: {{mgr_name}}   전화번호: {{mgr_phone}}", 1),
    ("(         년도) 점검결과", "( {{yr}} 년도) 점검결과", -1),  # 전체 섹션 표 공통
]

# 표지 월별 12행 기본값 — 미기입 행은 원형 유지 (워커가 해당 월만 덮어씀)
BLANK_MD = "        월      일"
BLANK_CK = "[  ]"


def default_ph() -> dict[str, str]:
    """치환 기본값 — 표지 12행 공란 원형 + 체크박스"""
    ph: dict[str, str] = {}
    for i in range(1, 13):
        ph[f"d{i}_md"] = BLANK_MD
        ph[f"d{i}_g"] = BLANK_CK
        ph[f"d{i}_b"] = BLANK_CK
        ph[f"d{i}_nm"] = ""
    return ph


def generate_exterior(ph: dict[str, str], out_dir: str, out_base: str) -> tuple[str, str, str]:
    """placeholder 치환 → (hwp, odt, html) 생성. 미채움 키는 빈 칸(월별 결과란 등)."""
    assert os.path.isfile(TEMPLATE_EXT_PH), "외관점검표 placeholder 템플릿 없음 — seed-exterior-placeholders.py 먼저 실행"
    hwpsdk = mf.sdk_app()
    obj = hwpsdk.Application.GetHwpObject()
    os.makedirs(out_dir, exist_ok=True)
    merged = os.path.join(out_dir, f"_{out_base}_merged.hwpx")

    full = default_ph()
    full.update({k: v for k, v in ph.items() if v})
    replacements = {f"{{{{{k}}}}}": v for k, v in full.items() if v}
    with zipfile.ZipFile(TEMPLATE_EXT_PH, "r") as zin, zipfile.ZipFile(merged, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("Contents/section0.xml", "Preview/PrvText.txt"):
                xml = data.decode("utf-8")
                for old, new in replacements.items():
                    xml = xml.replace(old, new)
                xml = PH_RE.sub("", xml)  # 미채움(월별 결과란 등) → 빈 칸
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
