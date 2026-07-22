# 외관점검표(별지 6호)에 {{placeholder}} 1회 심기 + 시트 항목 manifest 추출 — Windows 개발 PC 전용 (한글 SDK)
#
# 산출물: erp_goal/_form/외관점검표-placeholder.hwpx (원본 외관점검표_법제처API_20221201.hwp는 불변)
#         erp_goal/_form/외관점검표-manifest.json    (섹션·항목 — seed-exterior-sheet.mjs가 DB 시딩에 사용)
# 좌표: 표지 = 리터럴 치환 + 월별 12행({{d{i}_md/g/b/nm}}), 섹션 표 = 항목 행별 월 셀 {{x{섹션}_{행}_{월}}}
# 실행: python scripts/seed-exterior-placeholders.py   (재실행 멱등 — 매번 원본에서 새로 생성)
import importlib.util
import json
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_exterior", os.path.join(HERE, "make-exterior.py"))
mx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mx)
mf = mx.mf

CELL_RE = re.compile(r"<hp:tc\b.*?</hp:tc>", re.S)
ROW_RE = re.compile(r"<hp:tr>.*?</hp:tr>", re.S)
TBL_RE = re.compile(r"<hp:tbl\b.*?</hp:tbl>", re.S)
TITLE_RE = re.compile(r"^\s*(\d{1,2})\.")
SKIP_SINGLE = ("※", "210mm", "(앞 쪽)", "(뒤 쪽)", "■")


def cell_text(tc: str) -> str:
    return "".join(re.findall(r"<hp:t>([^<]*)</hp:t>", tc))


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("", "·")).strip()


def inject_cell(tc: str, text: str) -> tuple[str, bool]:
    """빈 셀에 텍스트 주입 — 자기닫힘 런 우선, 빈 <hp:t> 폴백"""
    m = re.search(r'<hp:run charPrIDRef="(\d+)"/>', tc)
    if m:
        return tc.replace(m.group(0), f'<hp:run charPrIDRef="{m.group(1)}"><hp:t>{text}</hp:t></hp:run>', 1), True
    m = re.search(r"<hp:t>(\s*)</hp:t>", tc)
    if m:
        return tc.replace(m.group(0), f"<hp:t>{text}</hp:t>", 1), True
    return tc, False


def replace_run_text(tc: str, contains: str, new_text: str) -> tuple[str, bool]:
    """셀 안에서 특정 문자열을 포함한 <hp:t> 런 전체를 새 텍스트로 교체"""
    for m in re.finditer(r"<hp:t>([^<]*)</hp:t>", tc):
        if contains in m.group(1):
            return tc[: m.start()] + f"<hp:t>{new_text}</hp:t>" + tc[m.end():], True
    return tc, False


def seed_section0(xml: str) -> tuple[str, list[dict], list[str]]:
    fails: list[str] = []
    # ① 표지·공통 리터럴
    for old, new, count in mx.SEED_RUNS_EXT:
        if old in xml:
            xml = xml.replace(old, new) if count < 0 else xml.replace(old, new, count)
        else:
            fails.append(f"리터럴: {old[:30]}")

    # ② 표 순회 — 위치 보존을 위해 교체 스팬을 모아 역순 적용
    spans: list[tuple[int, int, str]] = []
    manifest: list[dict] = []
    sec_no, sec_title, row_no = 0, "", 0
    month_i = 0  # 표지 월별 행 인덱스

    for tm in TBL_RE.finditer(xml):
        tbl = tm.group(0)
        new_tbl = tbl
        rows = list(ROW_RE.finditer(tbl))
        # 섹션 제목 탐색 (첫 행들) — 없으면 직전 섹션의 연속 표((뒤 쪽) 등)
        for rm in rows[:2]:
            t = norm(cell_text(rm.group(0)))
            m = TITLE_RE.match(t)
            if m and "점  검  내  용" not in t:
                sec_no, sec_title, row_no = int(m.group(1)), norm(re.sub(r"^\s*\d{1,2}\.\s*", "", t)), 0
                manifest.append({"sec": sec_no, "title": sec_title, "items": []})
                break

        category = None
        row_edits: list[tuple[str, str]] = []  # (old_row, new_row) — 표 내 1회 교체
        for rm in rows:
            row = rm.group(0)
            tcs = list(CELL_RE.finditer(row))
            texts = [cell_text(c.group(0)) for c in tcs]
            # 표지 월별 12행: [월 일][양호/불량][점검자(빈)][확인자 (서명)]
            if len(tcs) == 4 and "월" in texts[0] and "양호" in texts[1]:
                month_i += 1
                i = month_i
                new_row = row
                c0, ok0 = replace_run_text(tcs[0].group(0), "월", f"{{{{d{i}_md}}}}")
                c1 = tcs[1].group(0).replace("[  ]양호 [  ]불량", f"{{{{d{i}_g}}}}양호 {{{{d{i}_b}}}}불량", 1)
                ok1 = c1 != tcs[1].group(0)
                c2, ok2 = inject_cell(tcs[2].group(0), f"{{{{d{i}_nm}}}}")
                if not (ok0 and ok1 and ok2):
                    fails.append(f"표지 월행 {i}: md={ok0} ck={ok1} nm={ok2}")
                new_row = new_row.replace(tcs[0].group(0), c0, 1).replace(tcs[1].group(0), c1, 1).replace(tcs[2].group(0), c2, 1)
                row_edits.append((row, new_row))
                continue
            # 섹션 구분(카테고리) 행 — 전체 폭 단일 셀
            if len(tcs) == 1:
                t = norm(texts[0])
                if t and not any(t.startswith(s) for s in SKIP_SINGLE) and not TITLE_RE.match(t):
                    category = t
                continue
            # 항목 행: [점검내용][빈 월셀 ×12]
            if len(tcs) == 13 and texts[0].strip() and all(not t.strip() for t in texts[1:]):
                if sec_no == 0:
                    fails.append(f"섹션 미확정 항목: {norm(texts[0])[:20]}")
                    continue
                row_no += 1
                new_row = row
                for mth in range(1, 13):
                    old_tc = tcs[mth].group(0)
                    new_tc, ok = inject_cell(old_tc, f"{{{{x{sec_no}_{row_no}_{mth}}}}}")
                    if not ok:
                        fails.append(f"월셀 x{sec_no}_{row_no}_{mth}")
                    new_row = new_row.replace(old_tc, new_tc, 1)
                row_edits.append((row, new_row))
                manifest[-1]["items"].append({
                    "code": f"X{sec_no}-{row_no:02d}",
                    "category": category,
                    "content": norm(texts[0]),
                })
        for old_row, new_row in row_edits:
            new_tbl = new_tbl.replace(old_row, new_row, 1)
        if new_tbl != tbl:
            spans.append((tm.start(), tm.end(), new_tbl))

    for s, e, body in reversed(spans):
        xml = xml[:s] + body + xml[e:]
    return xml, manifest, fails


def main() -> None:
    hwpsdk = mf.sdk_app()
    obj = hwpsdk.Application.GetHwpObject()
    tmp = mx.TEMPLATE_EXT_PH + ".tmp"
    doc = obj.CreateDocument()
    assert doc.Open(mx.TEMPLATE_EXT, "", ""), "외관점검표 열기 실패"
    assert doc.SaveAs(tmp, "HWPX", ""), "HWPX 변환 실패"
    obj.ReleaseDocument(doc)

    manifest: list[dict] = []
    fails: list[str] = []
    with zipfile.ZipFile(tmp, "r") as zin, zipfile.ZipFile(mx.TEMPLATE_EXT_PH, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "Contents/section0.xml":
                xml, manifest, fails = seed_section0(data.decode("utf-8"))
                data = xml.encode("utf-8")
            zout.writestr(item, data)
    os.remove(tmp)

    with zipfile.ZipFile(mx.TEMPLATE_EXT_PH) as z:
        xml = z.read("Contents/section0.xml").decode("utf-8")
    seeded = set(re.findall(r"\{\{([a-z0-9_]+)\}\}", xml))
    n_items = sum(len(s["items"]) for s in manifest)
    with open(mx.MANIFEST_EXT, "w", encoding="utf-8") as f:
        json.dump({"version": "v2022", "source": "소방청고시 2022-71 별지 6호 (2022-12-01 개정)",
                   "sections": manifest}, f, ensure_ascii=False, indent=1)
    print(f"섹션 {len(manifest)}개 · 항목 {n_items}개 · 고유 placeholder {len(seeded)}종")
    for s in manifest:
        print(f"  {s['sec']:2d}. {s['title'][:34]} — {len(s['items'])}항목")
    if fails:
        print(f"⚠️ 심기 실패 {len(fails)}건: {fails[:10]}")
    print(f"✅ 생성: {mx.TEMPLATE_EXT_PH}")
    print(f"✅ 생성: {mx.MANIFEST_EXT}")
    mf.sdk_app().Application.Finalize()


if __name__ == "__main__":
    main()
