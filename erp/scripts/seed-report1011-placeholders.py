# 별지 10·11호에 {{placeholder}} 1회 심기 (R-3) — Windows 개발 PC 전용 (한글 SDK)
# 산출물: erp_goal/_form/별지10호-placeholder.hwpx · 별지11호-placeholder.hwpx (재실행 멱등)
import importlib.util
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_report1011", os.path.join(HERE, "make-report1011.py"))
m1011 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m1011)
mf = m1011.mf


def main() -> None:
    obj = mf.sdk_app().Application.GetHwpObject()
    for kind in ("report10", "report11"):
        tmp = m1011.PH[kind] + ".tmp"
        doc = obj.CreateDocument()
        assert doc.Open(m1011.SRC[kind], "", ""), f"{kind} 열기 실패"
        assert doc.SaveAs(tmp, "HWPX", ""), f"{kind} HWPX 변환 실패"
        obj.ReleaseDocument(doc)

        fails: list[str] = []
        with zipfile.ZipFile(tmp, "r") as zin, zipfile.ZipFile(m1011.PH[kind], "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "Contents/section0.xml":
                    xml = data.decode("utf-8")
                    for pattern, repl, count in m1011.SEED_REGEX[kind]:
                        new_xml, n = re.subn(pattern, repl, xml, count=count)
                        if n == 0:
                            fails.append(pattern[:40])
                        xml = new_xml
                    data = xml.encode("utf-8")
                zout.writestr(item, data)
        os.remove(tmp)

        with zipfile.ZipFile(m1011.PH[kind]) as z:
            xml = z.read("Contents/section0.xml").decode("utf-8")
        seeded = sorted(set(re.findall(r"\{\{([a-z0-9_]+)\}\}", xml)))
        print(f"{kind}: placeholder {len(seeded)}종" + (f" ⚠실패 {fails}" if fails else " ✅"))
    mf.sdk_app().Application.Finalize()


if __name__ == "__main__":
    main()
