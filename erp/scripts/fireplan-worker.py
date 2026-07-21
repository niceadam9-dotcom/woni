# 소방계획서 HWP 생성 상주 워커 — ERP 웹 요청 처리 (Windows 개발 PC 전용, 2026-07-15)
#
# 실행: python scripts/fireplan-worker.py            (Ctrl+C로 종료)
# 동작: fire_plan_gen_jobs 테이블(094)을 10초마다 폴링 → 한글 SDK로 HWP+HTML(미리보기)+ODT 생성
#       → HWP·HTML·ODT 업로드 + fire_plans 즉시 등록(pdf_status=converting) → 작업 done
#       → PDF는 로컬 LibreOffice로 후속 변환(2단계) — 실패/미설치 시 VPS Gotenberg 크론이 ODT로 변환
# 큐 전환(2026-07-21): 스토리지 _queue/*.json → DB 테이블 — 상태 추적(processing)·중복 방지·중단 복구
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
JOBS = "fire_plan_gen_jobs"
POLL_SEC = 10
MAX_ATTEMPTS = 3  # 워커 중단으로 processing에 남은 작업의 재시도 한도
ERP_BASE = "https://staging.sjfire.co.kr"  # 로컬 PDF 변환 실패 시 크론 변환 트리거용
CRON_SECRET = ENV.get("CRON_SECRET", "")

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

def db_insert(table: str, row: dict) -> list:
    raw = _req("POST", f"{SB_URL}/rest/v1/{table}", json.dumps(row).encode(),
               {"Content-Type": "application/json", "Prefer": "return=representation"})
    return json.loads(raw.decode() or "[]")

def db_patch(path: str, patch: dict) -> list:
    """조건부 갱신 — 갱신된 행 목록 반환 (빈 목록 = 조건 불일치, 예: 이미 다른 상태)"""
    raw = _req("PATCH", f"{SB_URL}/rest/v1/{path}", json.dumps(patch).encode(),
               {"Content-Type": "application/json", "Prefer": "return=representation"})
    return json.loads(raw.decode() or "[]")

def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S+09:00")

def heartbeat(note: str | None = None) -> None:
    """단일 행(id=1) upsert — note = 현재 처리 중 작업 (긴 단계 전에도 호출해 온라인 유지)"""
    body = json.dumps({"id": 1, "last_seen_at": now_iso(), "processing_note": note}).encode()
    _req("POST", f"{SB_URL}/rest/v1/fire_plan_worker_status", body,
         {"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})

def trigger_cron_convert() -> None:
    """VPS Gotenberg 크론 변환 즉시 트리거 — 실패해도 무방 (주기 크론이 폴백)"""
    try:
        req = urllib.request.Request(f"{ERP_BASE}/api/cron/convert-fireplan-pdf",
                                     headers={"Authorization": f"Bearer {CRON_SECRET}", "User-Agent": "curl/8.4.0"})
        with urllib.request.urlopen(req, timeout=120) as res:
            print(f"[{now_iso()}] 크론 PDF 변환 트리거: HTTP {res.status}")
    except Exception as e:  # noqa: BLE001
        print(f"[{now_iso()}] 크론 트리거 실패(주기 실행 대기): {e}")

def attach_pdf(plan_id: str, odt_local: str, odt_storage: str, pdf_storage: str, year: int, label: str) -> None:
    """2단계: 등록된 계획서에 PDF를 뒤따라 첨부 — 로컬 LibreOffice, 실패 시 VPS 크론 폴백"""
    if not mf.SOFFICE:
        print(f"[{now_iso()}] LibreOffice 미설치 → 크론 변환 위임: {label}")
        trigger_cron_convert()
        return
    try:
        heartbeat(f"{label} — PDF 변환")
        out_pdf = odt_local[:-4] + ".pdf"
        mf.convert_pdf_local(odt_local, out_pdf)
        with open(out_pdf, "rb") as f:
            st_upload(pdf_storage, f.read(), "application/pdf", upsert=True)
        db_patch(f"fire_plans?id=eq.{plan_id}",
                 {"pdf_name": f"{year}년 소방계획서(HWP양식).pdf", "pdf_path": pdf_storage,
                  "pdf_status": "ready", "pdf_error": None, "odt_path": None})
        try:
            st_delete(odt_storage)
        except Exception:  # noqa: BLE001
            pass
        print(f"[{now_iso()}] ✅ PDF 첨부 완료: {label}")
    except Exception as e:  # noqa: BLE001
        print(f"[{now_iso()}] 로컬 PDF 변환 실패 → 크론 폴백: {e}")
        trigger_cron_convert()

def process(job: dict) -> tuple[list[str], dict | None]:
    """작업 1건 생성·업로드(1단계: HWP·HTML 즉시 등록). 반환 = (누락 라벨, PDF 후속 변환 작업)"""
    cust_id, year = job["customer_id"], int(job["year"])
    preset_type = (job.get("preset_type") or "").strip()
    label = f"{job.get('customer_name')} ({year}{', ' + preset_type if preset_type else ''})"
    print(f"[{now_iso()}] 생성 시작: {label}")

    rows = db_get(f"customers?id=eq.{cust_id}"
                  "&select=id,customer_name,address,use_approval_date,fire_station,inspection_type,plan_anchor_date,contract_date,"
                  "manager_selected_at,building_grade,insurance_joined,insurance_company,insurance_period,"
                  "insurance_amount_person,insurance_amount_property,op_hours_weekday,op_hours_holiday,"
                  "headcount_worker,headcount_resident,headcount_max")
    if not rows:
        raise RuntimeError("고객을 찾을 수 없습니다")
    cust = rows[0]

    buildings = db_get(f"buildings?customer_id=eq.{cust_id}&is_active=eq.true"
                       "&select=id,purpose,total_area,floors_above,floors_below,receiver_location,main_structure,roof_structure,height&order=created_at&limit=1")
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

    # 7차: 공통 수기 프리셋 — 요청에 유형이 있으면 _presets/{유형}.json 문구 치환 (없으면 양식 기본값 유지)
    preset_pairs = mf.load_preset_pairs(ENV, preset_type) if preset_type else []
    if preset_type:
        print(f"[{now_iso()}] 프리셋({preset_type}): 문구 {len(preset_pairs)}개 치환 예정")

    floors = db_get(f"fire_facility_floors?building_id=eq.{buildings[0]['id']}&select=floor_label&order=sort_order") if buildings else []
    zone_rows = mf.build_zone_rows(buildings[0] if buildings else None, floors, owner)
    brigade = db_get(f"fire_brigade_members?customer_id=eq.{cust_id}&select=team,name,duty,phone&order=sort_order")
    out_hwp, out_odt, out_html = mf.generate_hwp(cust, year, photo=photo_path, extras=extras,
                                                 extra_replacements=stage2, zone_rows=zone_rows, brigade=brigade,
                                                 preset_pairs=preset_pairs)
    heartbeat(f"{label} — 업로드")

    # 1단계: HWP·HTML(미리보기)·ODT(변환 소스) 업로드 → 보관함 즉시 등록 (PDF는 attach_pdf가 뒤따라 채움)
    stamp = int(time.time() * 1000)
    base = f"{cust_id}/{year}/generated_hwp_{stamp}"
    hwp_path, html_path, odt_path, pdf_path = f"{base}.hwp", f"{base}.html", f"{base}.odt", f"{base}.pdf"
    with open(out_hwp, "rb") as f:
        st_upload(hwp_path, f.read(), "application/octet-stream")
    with open(out_html, "rb") as f:
        st_upload(html_path, f.read(), "text/html; charset=utf-8")
    with open(out_odt, "rb") as f:
        st_upload(odt_path, f.read(), "application/vnd.oasis.opendocument.text")

    existing = db_get(f"fire_plans?customer_id=eq.{cust_id}&year=eq.{year}&select=id")
    inserted = db_insert("fire_plans", {
        "customer_id": cust_id,
        "year": year,
        "title": f"{year}년 소방계획서",
        "pdf_name": None,
        "pdf_path": None,
        "pdf_status": "converting",
        "html_path": html_path,
        "odt_path": odt_path,
        "hwp_name": f"{year}년 소방계획서.hwp",
        "hwp_path": hwp_path,
        "revision": len(existing) + 1,
        "note": f"HWP 자동 생성 (표준양식{', ' + preset_type + ' 프리셋' if preset_type else ''})",
        "uploaded_by": job.get("requested_by"),
    })
    pdf_task = {"plan_id": inserted[0]["id"], "odt_local": out_odt, "odt_storage": odt_path,
                "pdf_storage": pdf_path, "year": year, "label": label}
    # 누락 필드 안내 — 페이지에서 고객 상세 바로가기와 함께 표시
    # 5·6차 필드 포함 — 라벨은 준비율 어휘와 동일 (src/lib/fire-plan-readiness.ts, 설계 §6)
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
        ("수신기위치", b.get("receiver_location")),
        ("구조", b.get("main_structure")),
        ("지붕", b.get("roof_structure")),
        ("선임일", cust.get("manager_selected_at")),
        ("급수", cust.get("building_grade")),
        ("화재보험", cust.get("insurance_joined") is not None or None),
        ("운영시간", cust.get("op_hours_weekday")),
        ("인원", any(cust.get(k) is not None for k in ("headcount_worker", "headcount_resident", "headcount_max")) or None),
        ("자위소방대", brigade or None),
    ] if not has]
    print(f"[{now_iso()}] ✅ 1단계 완료: {cust['customer_name']} → HWP·미리보기 등록 (누락 {len(missing)}개)")
    return missing, pdf_task

print(f"소방계획서 생성 워커 시작 — {SB_URL} / 폴링 {POLL_SEC}초 (종료: Ctrl+C)")
mf.sdk_app()  # 라이선스 선검증
print("SDK 초기화 OK")

# 중단 복구: 이전 실행이 processing으로 남긴 작업 → 한도 내 재시도(pending), 초과 시 failed
db_patch(f"{JOBS}?status=eq.processing&attempts=gte.{MAX_ATTEMPTS}",
         {"status": "failed", "error": "워커 중단 — 재시도 한도 초과", "finished_at": now_iso()})
recovered = db_patch(f"{JOBS}?status=eq.processing", {"status": "pending"})
if recovered:
    print(f"[{now_iso()}] 중단 복구: {len(recovered)}건 재대기 전환")

while True:
    try:
        heartbeat()
        jobs = db_get(f"{JOBS}?status=eq.pending&select=*&order=created_at&limit=10")
        for job in jobs:
            # 선점(claim): pending일 때만 processing 전환 — 빈 반환이면 이미 다른 워커가 집어감
            claimed = db_patch(f"{JOBS}?id=eq.{job['id']}&status=eq.pending",
                               {"status": "processing", "started_at": now_iso(),
                                "attempts": int(job.get("attempts") or 0) + 1})
            if not claimed:
                continue
            heartbeat(f"{job.get('customer_name')} ({job.get('year')}년)")
            try:
                missing, pdf_task = process(job)
                # HWP 등록 시점에 작업 완료 — 사용자는 즉시 HWP·미리보기 사용 가능, PDF는 뒤따라 첨부
                db_patch(f"{JOBS}?id=eq.{job['id']}",
                         {"status": "done", "missing": missing, "error": None, "finished_at": now_iso()})
                attach_pdf(**pdf_task)
            except Exception as err:  # noqa: BLE001
                print(f"[{now_iso()}] ❌ 실패({job.get('customer_name')}): {err}")
                traceback.print_exc()
                try:
                    db_patch(f"{JOBS}?id=eq.{job['id']}",
                             {"status": "failed", "error": str(err)[:300], "finished_at": now_iso()})
                except Exception:  # noqa: BLE001
                    pass
            finally:
                heartbeat()
    except KeyboardInterrupt:
        print("\n워커 종료")
        break
    except Exception as loop_err:  # noqa: BLE001
        print(f"[{now_iso()}] 루프 오류: {loop_err}")
    time.sleep(POLL_SEC)
