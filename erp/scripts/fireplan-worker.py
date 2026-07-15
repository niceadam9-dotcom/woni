# 소방계획서 HWP 생성 상주 워커 — ERP 웹 요청 처리 (Windows 개발 PC 전용, 2026-07-15)
#
# 실행: python scripts/fireplan-worker.py            (Ctrl+C로 종료)
# 동작: fire-plans 버킷 _queue/ 를 10초마다 폴링 → 한글 SDK로 HWP+PDF 생성
#       → 보관함 업로드(fire_plans 등록) → _results/ 에 결과 기록, 하트비트 갱신
# 페이지: ERP /fire-plans/generate 에서 요청·상태 확인
import importlib.util
import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_fireplan", os.path.join(HERE, "make-fireplan.py"))
mf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mf)

ENV = mf.load_env(prod=False)  # 스테이징 (운영 전환 시 prod=True + 보관함 마이그레이션 선행)
SB_URL = ENV["NEXT_PUBLIC_SUPABASE_URL"]
SB_KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
BUCKET = "fire-plans"
POLL_SEC = 10

def _req(method: str, url: str, body: bytes | None = None, headers: dict | None = None):
    h = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "User-Agent": "curl/8.4.0"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(req) as res:
        return res.read()

def st_list(prefix: str) -> list[dict]:
    body = json.dumps({"prefix": prefix, "limit": 100, "sortBy": {"column": "name", "order": "asc"}}).encode()
    raw = _req("POST", f"{SB_URL}/storage/v1/object/list/{BUCKET}", body, {"Content-Type": "application/json"})
    return json.loads(raw.decode())

def st_download(path: str) -> bytes:
    return _req("GET", f"{SB_URL}/storage/v1/object/{BUCKET}/{path}")

def st_upload(path: str, data: bytes, mime: str, upsert: bool = False) -> None:
    _req("POST", f"{SB_URL}/storage/v1/object/{BUCKET}/{path}", data,
         {"Content-Type": mime, "x-upsert": "true" if upsert else "false"})

def st_delete(path: str) -> None:
    _req("DELETE", f"{SB_URL}/storage/v1/object/{BUCKET}/{path}")

def db_get(path: str):
    return json.loads(_req("GET", f"{SB_URL}/rest/v1/{path}").decode())

def db_insert(table: str, row: dict) -> None:
    _req("POST", f"{SB_URL}/rest/v1/{table}", json.dumps(row).encode(),
         {"Content-Type": "application/json", "Prefer": "return=minimal"})

def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S+09:00")

def heartbeat() -> None:
    st_upload("_queue/_heartbeat.json", json.dumps({"at": now_iso()}).encode(), "application/json", upsert=True)

def write_result(req_name: str, payload: dict) -> None:
    st_upload(f"_results/{req_name}", json.dumps({**payload, "finishedAt": now_iso()}, ensure_ascii=False).encode(),
              "application/json", upsert=True)

def process(req_name: str) -> None:
    raw = st_download(f"_queue/{req_name}")
    req = json.loads(raw.decode())
    cust_id, year = req["customerId"], int(req["year"])
    print(f"[{now_iso()}] 생성 시작: {req.get('customerName')} ({year})")

    rows = db_get(f"customers?id=eq.{cust_id}"
                  "&select=id,customer_name,address,use_approval_date,fire_station,inspection_type,plan_anchor_date,contract_date")
    if not rows:
        raise RuntimeError("고객을 찾을 수 없습니다")
    cust = rows[0]

    buildings = db_get(f"buildings?customer_id=eq.{cust_id}&is_active=eq.true"
                       "&select=id,purpose,total_area,floors_above,floors_below&order=created_at&limit=1")
    contacts = db_get(f"customer_contacts?customer_id=eq.{cust_id}&select=role,name,phone")
    owner = next((c for c in contacts if c["role"] == "대표"), contacts[0] if contacts else None)
    extras = mf.build_extras(cust, buildings[0] if buildings else None, owner)
    codes = []
    if buildings:
        codes = [f["facility_code"] for f in db_get(
            f"fire_facilities?building_id=eq.{buildings[0]['id']}&installed=eq.true&select=facility_code")]
    stage2 = mf.build_stage2(cust, year, codes)

    # 사진 연계: 고객 gen-assets(웹 PDF 생성 시 업로드)의 최신 이미지 1장을 표지에 삽입
    photo_path = None
    try:
        assets = st_list(f"{cust_id}/gen-assets/")
        imgs = sorted([a["name"] for a in assets if a.get("name", "").lower().endswith((".jpg", ".jpeg", ".png", ".webp"))])
        if imgs:
            photo_path = os.path.join(mf.OUT_DIR, f"_photo_{cust_id}{os.path.splitext(imgs[-1])[1]}")
            with open(photo_path, "wb") as f:
                f.write(st_download(f"{cust_id}/gen-assets/{imgs[-1]}"))
            print(f"[{now_iso()}] 사진 연계: {imgs[-1]}")
    except Exception as pe:  # noqa: BLE001
        print(f"[{now_iso()}] 사진 연계 건너뜀: {pe}")

    floors = db_get(f"fire_facility_floors?building_id=eq.{buildings[0]['id']}&select=floor_label&order=sort_order") if buildings else []
    zone_rows = mf.build_zone_rows(buildings[0] if buildings else None, floors, owner)
    out_hwp, out_odt = mf.generate_hwp(cust, year, photo=photo_path, extras=extras,
                                       extra_replacements=stage2, zone_rows=zone_rows)
    out_pdf = out_hwp[:-4] + ".pdf"
    mf.convert_pdf(out_odt, out_pdf)

    stamp = int(time.time() * 1000)
    pdf_path = f"{cust_id}/{year}/generated_hwp_{stamp}.pdf"
    hwp_path = f"{cust_id}/{year}/generated_hwp_{stamp}.hwp"
    with open(out_pdf, "rb") as f:
        st_upload(pdf_path, f.read(), "application/pdf")
    with open(out_hwp, "rb") as f:
        st_upload(hwp_path, f.read(), "application/octet-stream")

    existing = db_get(f"fire_plans?customer_id=eq.{cust_id}&year=eq.{year}&select=id")
    db_insert("fire_plans", {
        "customer_id": cust_id,
        "year": year,
        "title": f"{year}년 소방계획서",
        "pdf_name": f"{year}년 소방계획서(HWP양식).pdf",
        "pdf_path": pdf_path,
        "hwp_name": f"{year}년 소방계획서.hwp",
        "hwp_path": hwp_path,
        "revision": len(existing) + 1,
        "note": "HWP 자동 생성 (표준양식)",
        "uploaded_by": req.get("requestedBy"),
    })
    # 누락 필드 안내 — 페이지에서 고객 상세 바로가기와 함께 표시
    b = buildings[0] if buildings else {}
    missing = [label for label, has in [
        ("주소", cust.get("address")),
        ("사용승인일", cust.get("use_approval_date")),
        ("계약일", cust.get("contract_date")),
        ("관계인", owner),
        ("건물 용도", b.get("purpose")),
        ("연면적", b.get("total_area") is not None or None),
        ("층수", (b.get("floors_above") is not None or b.get("floors_below") is not None) or None),
        ("시설현황", codes or None),
    ] if not has]
    write_result(req_name, {"ok": True, "customerName": cust["customer_name"], "year": year, "missing": missing})
    print(f"[{now_iso()}] ✅ 완료: {cust['customer_name']} → 보관함 등록 (누락 {len(missing)}개)")

print(f"소방계획서 생성 워커 시작 — {SB_URL} / 폴링 {POLL_SEC}초 (종료: Ctrl+C)")
mf.sdk_app()  # 라이선스 선검증
print("SDK 초기화 OK")

while True:
    try:
        heartbeat()
        entries = st_list("_queue/")
        for e in entries:
            name = e.get("name", "")
            if not name.endswith(".json") or name == "_heartbeat.json":
                continue
            try:
                process(name)
            except Exception as err:  # noqa: BLE001
                print(f"[{now_iso()}] ❌ 실패({name}): {err}")
                traceback.print_exc()
                try:
                    raw = st_download(f"_queue/{name}")
                    req = json.loads(raw.decode())
                except Exception:  # noqa: BLE001
                    req = {}
                write_result(name, {"ok": False, "error": str(err)[:300],
                                    "customerName": req.get("customerName"), "year": req.get("year")})
            finally:
                try:
                    st_delete(f"_queue/{name}")
                except Exception:  # noqa: BLE001
                    pass
    except KeyboardInterrupt:
        print("\n워커 종료")
        break
    except Exception as loop_err:  # noqa: BLE001
        print(f"[{now_iso()}] 루프 오류: {loop_err}")
    time.sleep(POLL_SEC)
