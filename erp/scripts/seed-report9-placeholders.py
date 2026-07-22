# 별지 9호에 {{placeholder}} 1회 심기 (P3, 2026-07-23) — Windows 개발 PC 전용 (한글 SDK)
#
# 산출물: erp_goal/_form/별지9호-placeholder.hwpx (원본 별지9호_법제처API_20260701.hwp는 불변)
# 실행: python scripts/seed-report9-placeholders.py   (재실행 멱등 — 매번 원본에서 새로 생성)
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


def seed_xml(xml: str, is_section: bool) -> tuple[str, list[str], list[str]]:
    ok: list[str] = []
    fail: list[str] = []
    for old, new, count in mr9.SEED_RUNS:
        if old in xml:
            xml = xml.replace(old, new, count)
            ok.append(new[:24])
        elif is_section:
            fail.append(old[:30])
    if is_section:
        for (label, nth, off), key in mr9.ANCHOR_KEYS_9.items():
            xml, injected = mf.inject_after_label(xml, label, f"{{{{{key}}}}}", nth, off)
            (ok if injected else fail).append(f"{key}←{label}({nth},{off})")
    return xml, ok, fail


def main() -> None:
    hwpsdk = mf.sdk_app()
    obj = hwpsdk.Application.GetHwpObject()
    tmp = mr9.TEMPLATE9_PH + ".tmp"
    doc = obj.CreateDocument()
    assert doc.Open(mr9.TEMPLATE9, "", ""), "별지9호 열기 실패"
    assert doc.SaveAs(tmp, "HWPX", ""), "HWPX 변환 실패"
    obj.ReleaseDocument(doc)

    all_fail: list[str] = []
    with zipfile.ZipFile(tmp, "r") as zin, zipfile.ZipFile(mr9.TEMPLATE9_PH, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("Contents/section0.xml", "Preview/PrvText.txt"):
                xml = data.decode("utf-8")
                is_section = item.filename == "Contents/section0.xml"
                xml, ok, fail = seed_xml(xml, is_section)
                if is_section:
                    all_fail = fail
                    print(f"section0: 심기 성공 {len(ok)}건")
                data = xml.encode("utf-8")
            zout.writestr(item, data)
    os.remove(tmp)

    with zipfile.ZipFile(mr9.TEMPLATE9_PH) as z:
        xml = z.read("Contents/section0.xml").decode("utf-8")
    seeded = sorted(set(re.findall(r"\{\{([a-z0-9_]+)\}\}", xml)))
    print(f"\n템플릿 내 고유 placeholder {len(seeded)}종")
    if all_fail:
        print(f"⚠️ 심기 실패 {len(all_fail)}건: {all_fail}")
    print(f"✅ 생성: {mr9.TEMPLATE9_PH}")
    mf.sdk_app().Application.Finalize()


if __name__ == "__main__":
    main()
