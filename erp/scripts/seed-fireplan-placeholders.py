# 소방계획서 양식에 {{placeholder}} 1회 심기 (A안, 2026-07-16) — Windows 개발 PC 전용 (한글 SDK)
#
# 산출물: erp_goal/_Data/양식-placeholder.hwpx
#   - 존재하면 make-fireplan.py가 자동으로 placeholder 모드로 동작 (없으면 종전 라벨-앵커 모드)
#   - 원본 양식(25년 이후 소방계획서 양식.hwp)은 건드리지 않는다
#
# 실행: python scripts/seed-fireplan-placeholders.py
# 재실행: 언제나 원본에서 새로 만들므로 멱등
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


def main() -> None:
    hwpsdk = mf.sdk_app()
    obj = hwpsdk.Application.GetHwpObject()

    tmp_hwpx = mf.TEMPLATE_PH + ".tmp"
    doc = obj.CreateDocument()
    assert doc.Open(mf.TEMPLATE, "", ""), "양식 열기 실패"
    assert doc.SaveAs(tmp_hwpx, "HWPX", ""), "HWPX 변환 실패"
    obj.ReleaseDocument(doc)

    ok_anchors: list[str] = []
    fail_anchors: list[str] = []
    global_counts: dict[str, int] = {}

    with zipfile.ZipFile(tmp_hwpx, "r") as zin, \
         zipfile.ZipFile(mf.TEMPLATE_PH, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("Contents/section0.xml", "Preview/PrvText.txt"):
                xml = data.decode("utf-8")
                # 1) 예시값 전역 치환 (리젠시빌 → {{customer_name}} 등, 본문+미리보기)
                for example, key in mf.GLOBAL_PH.items():
                    n = xml.count(example)
                    if item.filename == "Contents/section0.xml":
                        global_counts[key] = n
                    xml = xml.replace(example, f"{{{{{key}}}}}")
                if item.filename == "Contents/section0.xml":
                    # 2) 라벨-앵커 → {{key}} 주입 (ANCHOR_KEYS 기준표)
                    for (label, nth, off), key in mf.ANCHOR_KEYS.items():
                        xml, ok = mf.inject_after_label(xml, label, f"{{{{{key}}}}}", nth, off)
                        (ok_anchors if ok else fail_anchors).append(f"{key}←{label}({nth},{off})")
                    # 3) 서식 1.2.1 구역별 행 (8행 × 데이터 열)
                    zone_rows = [{c: f"{{{{zone_r{i}_c{c}}}}}" for c in mf.ZONE_COLS} for i in range(8)]
                    xml, zn = mf.fill_zone_rows(xml, zone_rows)
                    # 4) 서식 2.2.3 자위소방대 대장/부대장 행
                    members = [
                        {"team": "자위소방대장", "name": "{{brig_l_name}}", "duty": "{{brig_l_duty}}", "phone": "{{brig_l_phone}}"},
                        {"team": "부대장", "name": "{{brig_d_name}}", "duty": "{{brig_d_duty}}", "phone": "{{brig_d_phone}}"},
                    ]
                    xml, bn = mf.fill_brigade(xml, "{{customer_name}}", members)
                    print(f"구역별(1.2.1) 셀 {zn}개, 자위소방대(2.2) 셀 {bn}개 심음")
                data = xml.encode("utf-8")
            zout.writestr(item, data)
    os.remove(tmp_hwpx)

    # 검증: 심긴 토큰 전수 확인
    with zipfile.ZipFile(mf.TEMPLATE_PH) as z:
        xml = z.read("Contents/section0.xml").decode("utf-8")
    seeded = sorted(set(re.findall(r"\{\{([a-z0-9_]+)\}\}", xml)))

    print("\n=== 심기 결과 ===")
    for k, n in global_counts.items():
        print(f"전역: {k} × {n}곳")
    print(f"앵커 성공 {len(ok_anchors)}: {', '.join(ok_anchors)}")
    if fail_anchors:
        print(f"⚠️ 앵커 실패 {len(fail_anchors)}: {', '.join(fail_anchors)}")
    print(f"\n템플릿 내 고유 placeholder {len(seeded)}종: {', '.join(seeded)}")
    print(f"✅ 생성: {mf.TEMPLATE_PH}")
    mf.sdk_app().Application.Finalize()


if __name__ == "__main__":
    main()
