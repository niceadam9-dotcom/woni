# 소방계획서 반자동 생성 CLI — 한글 SDK 트라이얼 (Windows 개발 PC 전용, 2026-07-15)
#
# 사용법:
#   python scripts/make-fireplan.py "고객명"                    # 스테이징 DB, HWP+ODT 생성
#   python scripts/make-fireplan.py "고객명" --pdf              # + Gotenberg PDF 변환(VPS 경유)
#   python scripts/make-fireplan.py "고객명" --photo 사진.jpg   # 표지에 건물 사진 삽입
#   python scripts/make-fireplan.py "고객명" --prod             # 운영 DB 고객 조회
#
# 파이프라인: 표준양식.hwp → (SDK) HWPX → XML 치환 병합 → (SDK) 사진 삽입 → HWP/ODT [→ PDF]
# 생성 파이프라인 함수는 fireplan-worker.py(웹 요청 상주 워커)가 재사용한다.
import json
import os
import re
import struct
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # erp/
DATA = os.path.join(os.path.dirname(ROOT), "erp_goal", "_Data")             # erp_goal/_Data
SDK_ROOT = os.environ.get("HWPSDK_ROOT", r"C:\Users\dwhwang\Downloads\HwpSDK_Trial_13.60.0.96_python")
TEMPLATE = os.path.join(DATA, "25년 이후 소방계획서 양식.hwp")
OUT_DIR = os.path.join(DATA, "fireplan-out")
SSH_KEY = r"C:\Users\dwhwang\.ssh\sjfire-erp-key.pem"
VPS = "ubuntu@121.78.123.230"

# ── env / Supabase REST ──────────────────────────────────────
def load_env(prod: bool = False) -> dict:
    env_file = os.path.join(ROOT, ".env.local.prod-backup" if prod else ".env.local")
    env: dict[str, str] = {}
    with open(env_file, encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

def sb_get(env: dict, path: str):
    req = urllib.request.Request(f"{env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/{path}", headers={
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
        "User-Agent": "curl/8.4.0",
    })
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode("utf-8"))

def kdate(iso: str | None) -> str:
    if not iso:
        return ""
    y, m, d = iso.split("-")
    return f"{int(y)}년 {int(m)}월 {int(d)}일"

# ── SDK ───────────────────────────────────────────────────────
_sdk = None
def sdk_app():
    """SDK 1회 초기화 (프로세스 수명 동안 재사용)"""
    global _sdk
    if _sdk is not None:
        return _sdk
    bin_dir = os.path.join(SDK_ROOT, "Bin64" if struct.calcsize("P") * 8 == 64 else "Bin")
    os.add_dll_directory(bin_dir)
    sys.path.insert(0, bin_dir)
    os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
    os.chdir(bin_dir)
    import hwpsdk  # noqa: PLC0415
    if hwpsdk.Application.Initialize() <= 0:
        raise RuntimeError("SDK 초기화 실패 — 라이선스 확인 (erp_goal/_Data/hwpsdk-라이선스-안내.md)")
    _sdk = hwpsdk
    return _sdk

# ── 생성 파이프라인 ───────────────────────────────────────────
def build_replacements(cust: dict) -> dict[str, str]:
    """표준양식의 예시값 → 고객 데이터 치환 맵"""
    rep = {"리젠시빌": cust["customer_name"]}
    if cust.get("contract_date"):
        rep["2017년 4월 24일"] = kdate(cust["contract_date"])
    if cust.get("fire_station"):
        rep["양평 소방서"] = cust["fire_station"]
    return rep

def generate_hwp(cust: dict, year: int, photo: str | None = None, out_dir: str = OUT_DIR) -> tuple[str, str]:
    """표준양식 병합 → (hwp_path, odt_path). SDK는 프로세스당 1회 초기화."""
    hwpsdk = sdk_app()
    obj = hwpsdk.Application.GetHwpObject()
    os.makedirs(out_dir, exist_ok=True)

    clean_hwpx = os.path.join(out_dir, "_template.hwpx")
    if not os.path.isfile(clean_hwpx) or os.path.getmtime(clean_hwpx) < os.path.getmtime(TEMPLATE):
        doc = obj.CreateDocument()
        assert doc.Open(TEMPLATE, "", ""), "양식 열기 실패"
        assert doc.SaveAs(clean_hwpx, "HWPX", ""), "HWPX 변환 실패"
        obj.ReleaseDocument(doc)

    safe = re.sub(r'[\\/:*?"<>|]', "_", cust["customer_name"])
    merged_hwpx = os.path.join(out_dir, f"_{safe}_merged.hwpx")
    replacements = build_replacements(cust)
    with zipfile.ZipFile(clean_hwpx, "r") as zin, zipfile.ZipFile(merged_hwpx, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("Contents/section0.xml", "Preview/PrvText.txt"):
                xml = data.decode("utf-8")
                for old, new in replacements.items():
                    xml = xml.replace(old, new)
                data = xml.encode("utf-8")
            zout.writestr(item, data)

    doc = obj.CreateDocument()
    assert doc.Open(merged_hwpx, "", ""), "병합본 열기 실패"
    if photo and os.path.isfile(photo):
        doc.MovePos(2)
        doc.InsertPicture(photo, True, 3, False, False, 0, 400, 300)

    out_hwp = os.path.join(out_dir, f"{safe}_소방계획서_{year}.hwp")
    out_odt = os.path.join(out_dir, f"{safe}_소방계획서_{year}.odt")
    assert doc.SaveAs(out_hwp, "HWP", ""), "HWP 저장 실패"
    assert doc.SaveAs(out_odt, "ODT", ""), "ODT 저장 실패"
    obj.ReleaseDocument(doc)
    os.remove(merged_hwpx)
    return out_hwp, out_odt

def convert_pdf(odt_path: str, pdf_path: str) -> None:
    """ODT → PDF (VPS의 Gotenberg 경유)"""
    def run(*cmd: str) -> None:
        subprocess.run(cmd, check=True, capture_output=True)
    run("scp", "-i", SSH_KEY, odt_path, f"{VPS}:/tmp/mkfp.odt")
    run("ssh", "-i", SSH_KEY, VPS,
        "sudo docker run --rm --network erp_default -v /tmp:/t curlimages/curl -s -o /t/mkfp.pdf "
        "-F files=@/t/mkfp.odt http://gotenberg-staging:3000/forms/libreoffice/convert")
    run("scp", "-i", SSH_KEY, f"{VPS}:/tmp/mkfp.pdf", pdf_path)
    run("ssh", "-i", SSH_KEY, VPS, "sudo rm -f /tmp/mkfp.odt /tmp/mkfp.pdf")

# ── CLI ───────────────────────────────────────────────────────
def main() -> None:
    import argparse
    import datetime
    ap = argparse.ArgumentParser()
    ap.add_argument("customer", help="고객명 (부분 일치)")
    ap.add_argument("--year", type=int, default=None)
    ap.add_argument("--photo", default=None, help="표지 삽입 사진 (jpg/png)")
    ap.add_argument("--pdf", action="store_true", help="Gotenberg PDF 변환까지 (VPS 경유)")
    ap.add_argument("--prod", action="store_true", help="운영 DB 조회 (기본: 스테이징)")
    args = ap.parse_args()

    year = args.year or datetime.date.today().year
    env = load_env(args.prod)

    q = urllib.parse.quote(f"*{args.customer}*")
    custs = sb_get(env, f"customers?customer_name=ilike.{q}&is_active=eq.true"
                        "&select=id,customer_name,address,use_approval_date,fire_station,inspection_type,plan_anchor_date,contract_date")
    if not custs:
        print(f"❌ 고객 '{args.customer}' 을(를) 찾을 수 없습니다 ({'운영' if args.prod else '스테이징'} DB)")
        sys.exit(1)
    if len(custs) > 1:
        print(f"⚠️ {len(custs)}명이 일치합니다 — 더 구체적으로 입력하세요:")
        for c in custs[:10]:
            print("   -", c["customer_name"])
        sys.exit(1)
    cust = custs[0]
    print(f"고객: {cust['customer_name']} ({cust['inspection_type']}) / {'운영' if args.prod else '스테이징'} DB")
    print("치환:", ", ".join(f"{k}→{v}" for k, v in build_replacements(cust).items()))

    contacts = sb_get(env, f"customer_contacts?customer_id=eq.{cust['id']}&select=role,name,phone")
    owner = next((c for c in contacts if c["role"] == "대표"), contacts[0] if contacts else None)
    if owner:
        print(f"관계인(참고): {owner['name']} / {owner.get('phone') or '-'} — 양식에 앵커가 없어 미병합 (한글에서 확인)")

    photo = os.path.abspath(args.photo) if args.photo else None
    out_hwp, out_odt = generate_hwp(cust, year, photo)
    print(f"✅ HWP: {out_hwp}")

    if args.pdf:
        out_pdf = out_hwp[:-4] + ".pdf"
        print("PDF 변환 중 (Gotenberg)…")
        convert_pdf(out_odt, out_pdf)
        print(f"✅ PDF: {out_pdf}")

    sdk_app().Application.Finalize()
    print("\n다음: 한글에서 HWP를 열어 빈 칸(명칭·주소 등 양식에 앵커 없는 항목) 보완 후, ERP 보관함에 업로드하세요.")

if __name__ == "__main__":
    main()
