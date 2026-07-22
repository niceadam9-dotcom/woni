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
import re
import sys
import time
import traceback
import urllib.error
import urllib.request

# --log <파일>: 콘솔 없는 상시 실행(pythonw) — stdout/stderr를 로그 파일로 (10MB 초과 시 .old 교체)
# 배경: 작업 스케줄러 hidden console이 외부 Ctrl+C성 신호로 랜덤 종료되는 문제(2026-07-22) → 콘솔 제거로 차단
if "--log" in sys.argv:
    _log_path = sys.argv[sys.argv.index("--log") + 1]
    if os.path.isfile(_log_path) and os.path.getsize(_log_path) > 10 * 1024 * 1024:
        os.replace(_log_path, _log_path + ".old")
    _log_f = open(_log_path, "a", encoding="utf-8", buffering=1)  # noqa: SIM115 — 프로세스 수명 동안 유지
    sys.stdout = sys.stderr = _log_f
else:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# 단일 인스턴스 락 — 고정 포트 바인드 (중복 기동 시 즉시 종료; 래퍼 감시 루프의 재시도와 공존)
import socket  # noqa: E402

_lock_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    _lock_sock.bind(("127.0.0.1", 48762))
except OSError:
    print("이미 실행 중인 워커가 있어 종료합니다 (포트 48762 락)")
    sys.exit(0)

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_fireplan", os.path.join(HERE, "make-fireplan.py"))
mf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mf)
spec9 = importlib.util.spec_from_file_location("make_report9", os.path.join(HERE, "make-report9.py"))
mr9 = importlib.util.module_from_spec(spec9)
spec9.loader.exec_module(mr9)
spec1011 = importlib.util.spec_from_file_location("make_report1011", os.path.join(HERE, "make-report1011.py"))
m1011 = importlib.util.module_from_spec(spec1011)
spec1011.loader.exec_module(m1011)
specext = importlib.util.spec_from_file_location("make_exterior", os.path.join(HERE, "make-exterior.py"))
mext = importlib.util.module_from_spec(specext)
specext.loader.exec_module(mext)

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
    # 7-4: 서식 입력(fire_plan_forms.sections) → 체크·문구·라벨 병합 (고객 입력 > 프리셋 > 양식 기본값)
    form_rows = db_get(f"fire_plan_forms?customer_id=eq.{cust_id}&select=sections")
    form_sections = (form_rows[0].get("sections") or {}) if form_rows else {}
    form_pairs, form_extras = mf.build_form_pairs(form_sections)
    stage2.update(form_pairs)
    extras.extend(form_extras)

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

    # 어댑터 §7-3: 서식 1.2.1 입력값(fire_plan_forms.sections.zones) 우선 — 없으면 층별 데이터 폴백
    form_zones = form_sections.get("zones") or []
    if form_zones:
        zone_rows = [{1: z.get("zone") or "", 2: z.get("name") or "",
                      3: z.get("area") or "", 10: z.get("phone") or ""} for z in form_zones]
    else:
        floors = db_get(f"fire_facility_floors?building_id=eq.{buildings[0]['id']}&select=floor_label&order=sort_order") if buildings else []
        zone_rows = mf.build_zone_rows(buildings[0] if buildings else None, floors, owner)
    brigade = db_get(f"fire_brigade_members?customer_id=eq.{cust_id}&select=team,name,duty,phone&order=sort_order")
    # 7-4b: 개정이력 다행 — 보관함(fire_plans) 과거 행 + 이번 작성 행
    plans = db_get(f"fire_plans?customer_id=eq.{cust_id}&select=year,revision,note,created_at&order=created_at")
    revisions = [{"date": (p.get("created_at") or "")[:10],
                  "note": p.get("note") or f"{p['year']}년 소방계획서" + (f" (개정{p['revision']})" if (p.get("revision") or 1) > 1 else " 작성"),
                  "author": ""} for p in plans]
    rev_input = form_sections.get("revision") or {}
    revisions.append({
        "date": (rev_input.get("revisionDate") or time.strftime("%Y-%m-%d"))[:10],
        "note": rev_input.get("revisionNote") or f"{year}년 소방계획서 작성",
        "author": "",
    })
    out_hwp, out_odt, out_html = mf.generate_hwp(cust, year, photo=photo_path, extras=extras,
                                                 extra_replacements=stage2, zone_rows=zone_rows, brigade=brigade,
                                                 preset_pairs=preset_pairs,
                                                 form_sections=form_sections, revisions=revisions)
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

def db_get_all(path: str, page: int = 1000) -> list[dict]:
    """PostgREST 1,000행 한도 대비 offset 페이지 순회"""
    rows: list[dict] = []
    offset = 0
    while True:
        chunk = db_get(f"{path}&limit={page}&offset={offset}")
        rows.extend(chunk)
        if len(chunk) < page:
            return rows
        offset += page

def _match(a: str, b: str) -> bool:
    """설비명 포함 매칭 (공백 제거 후 상호 포함) — build_stage2와 동일 계열"""
    x, y = a.replace(" ", ""), b.replace(" ", "")
    return bool(x) and bool(y) and (x in y or y in x)

def process_report9(job: dict) -> list[str]:
    """별지 9호 실시결과 보고서 1~3쪽 병합 생성 (P3 MVP — 소방계획서_4.md §9-3·§9-6)"""
    cust_id, year = job["customer_id"], int(job["year"])
    insp_id = job.get("inspection_id")
    if not insp_id:
        raise RuntimeError("점검 건(inspection_id)이 없습니다")
    label = f"{job.get('customer_name')} 별지9호 ({year})"
    print(f"[{now_iso()}] 별지9호 생성 시작: {label}")

    insp = db_get(f"inspections?id=eq.{insp_id}"
                  "&select=inspection_type,is_initial,inspection_start_date,inspection_end_date,inspection_days,status,assigned_employee_id")
    if not insp:
        raise RuntimeError("점검 건을 찾을 수 없습니다")
    insp = insp[0]
    cust = db_get(f"customers?id=eq.{cust_id}"
                  "&select=customer_name,address,use_approval_date,fire_station,building_grade,"
                  "insurance_joined,insurance_company,insurance_period,insurance_amount_person,insurance_amount_property,"
                  "email_delivery_consent,report_email")[0]
    blds = db_get(f"buildings?customer_id=eq.{cust_id}&is_active=eq.true"
                  "&select=id,purpose,total_area,building_area,floors_above,floors_below,height,main_structure,roof_structure,"
                  "households,building_count,permit_date,parking_summary,elevator_count,emergency_elevator_count"
                  "&order=created_at&limit=1")
    b = blds[0] if blds else {}
    contacts = db_get(f"customer_contacts?customer_id=eq.{cust_id}&select=role,name,phone")
    owner = next((c for c in contacts if c["role"] == "대표"), contacts[0] if contacts else None)
    company_rows = db_get("company_profile?select=company_name,phone&limit=1")
    company = company_rows[0] if company_rows else {}

    # 점검인력 — 주된 = 담당 직원(참여자 테이블에 '주된' 행이 있으면 우선), 보조 = inspection_participants(064)
    # 자격 = profiles.license_no/grade(063), 참여기간 = 점검기간 전체(§9-6② MVP)
    parts = db_get(f"inspection_participants?inspection_id=eq.{insp_id}&select=employee_id,role,sort_order&order=sort_order")
    if not any(p["role"] == "주된" for p in parts) and insp.get("assigned_employee_id"):
        parts = [{"employee_id": insp["assigned_employee_id"], "role": "주된", "sort_order": -1}] + parts
    prof_map: dict[str, dict] = {}
    if parts:
        ids = ",".join(sorted({p["employee_id"] for p in parts if p.get("employee_id")}))
        if ids:
            prof_map = {p["id"]: p for p in db_get(f"profiles?id=in.({ids})&select=id,name,license_no,license_grade")}

    # 점검표 응답 롤업(§9-3) — 시트별 X 유무 → 3쪽 양호○/불량×, 미설치 설비는 해당없음 /
    responses = db_get_all(f"inspection_sheet_responses?inspection_id=eq.{insp_id}&select=item_code,result")
    items = db_get_all("inspection_sheet_items?select=item_code,sheet_id") if responses else []
    sheets = db_get("inspection_sheets?select=id,sheet_name") if responses else []
    sheet_name_by_id = {s["id"]: s["sheet_name"] for s in sheets}
    sheet_by_item = {i["item_code"]: sheet_name_by_id.get(i["sheet_id"], "") for i in items}
    sheet_stat: dict[str, dict[str, bool]] = {}
    for r in responses:
        name = sheet_by_item.get(r["item_code"], "")
        if not name:
            continue
        st = sheet_stat.setdefault(name, {"any": False, "x": False})
        st["any"] = True
        st["x"] = st["x"] or r.get("result") == "X"

    codes = [f["facility_code"] for f in db_get(
        f"fire_facilities?building_id=eq.{b['id']}&installed=eq.true&select=facility_code")] if b else []
    facility_checks = [it for it in mr9.FORM3_ITEMS if any(_match(c, it) for c in codes)]
    result_marks: dict[str, str] = {}
    for it in mr9.FORM3_ITEMS:
        st = next((v for name, v in sheet_stat.items() if _match(name, it)), None)
        if st and st["any"]:
            result_marks[it] = "×" if st["x"] else "○"
        elif it not in facility_checks:
            result_marks[it] = "/"

    # 2쪽 자동 판정(§9-6③) — 데이터가 있을 때만 체크 (없으면 공란 유지, 단정 금지)
    has_plan = bool(db_get(f"fire_plans?customer_id=eq.{cust_id}&select=id&limit=1"))
    prev = db_get(f"inspections?customer_id=eq.{cust_id}&year=eq.{year - 1}&status=eq.completed&select=inspection_type")
    prev_types = {r["inspection_type"] for r in prev}
    forms = db_get(f"fire_plan_forms?customer_id=eq.{cust_id}&select=sections")
    has_training = bool(forms and (forms[0].get("sections") or {}).get("training"))

    NO = "[  ]"
    CK = "[√]"
    period = ""
    if insp.get("inspection_start_date"):
        end = insp.get("inspection_end_date") or insp["inspection_start_date"]
        period = f"{mf.kdate(insp['inspection_start_date'])} ~ {mf.kdate(end)}"
    ph: dict[str, str] = {k: NO for k in mr9.CK_KEYS}
    ph.update({
        "customer_name": cust["customer_name"], "purpose": b.get("purpose") or "", "address": cust.get("address") or "",
        "insp_period": period, "insp_days": str(insp.get("inspection_days") or (1 if period else "")),
        "ck_contractor": CK, "company_name": company.get("company_name") or "", "company_phone": company.get("phone") or "",
        "report_date": mf.kdate(time.strftime("%Y-%m-%d")),
        "submit_to": f"관계인ㆍ{cust['fire_station']}장" if cust.get("fire_station") else "관계인ㆍ소방본부장ㆍ소방서장",
        "owner_name": (owner or {}).get("name") or "", "owner_phone": (owner or {}).get("phone") or "",
        "mgr_name": (owner or {}).get("name") or "", "mgr_phone": (owner or {}).get("phone") or "",
        "ins_company": cust.get("insurance_company") or "", "ins_period": cust.get("insurance_period") or "",
        "ins_person": cust.get("insurance_amount_person") or "", "ins_property": cust.get("insurance_amount_property") or "",
        "permit_date": mf.kdate(b.get("permit_date")) if b.get("permit_date") else "",
        "use_approval_date": mf.kdate(cust.get("use_approval_date")) if cust.get("use_approval_date") else "",
        "total_area": str(b.get("total_area") or ""), "building_area": str(b.get("building_area") or ""),
        "floors_above": str(b.get("floors_above") or ""), "floors_below": str(b.get("floors_below") or ""),
        "height_m": str(b.get("height") or ""), "building_count": str(b.get("building_count") or ""),
        "households": f"{b['households']}세대" if b.get("households") else "",
        "elv_r": str(b.get("elevator_count") or ""), "elv_e": str(b.get("emergency_elevator_count") or ""),
    })
    # 점검 구분 — 작동/종합(최초·그 밖의)
    itype = insp.get("inspection_type") or ""
    if itype == "작동":
        ph["ck_op"] = CK
    elif itype == "최초" or (itype == "종합" and insp.get("is_initial")):
        ph["ck_initial"] = CK
    elif itype == "종합":
        ph["ck_comp_etc"] = CK
    # 송달 동의(§9-6① — 098)
    if cust.get("email_delivery_consent") is True:
        ph["ck_consent_y"] = CK
        ph["report_email"] = cust.get("report_email") or ""
    elif cust.get("email_delivery_consent") is False:
        ph["ck_consent_n"] = CK
    # 점검인력
    mains = [p for p in parts if p["role"] == "주된"]
    assists = [p for p in parts if p["role"] == "보조"][:5]
    if mains:
        pr = prof_map.get(mains[0]["employee_id"], {})
        ph.update({"m_name": pr.get("name") or "", "m_grade": pr.get("license_grade") or "",
                   "m_no": pr.get("license_no") or "", "m_period": period})
    for i, p in enumerate(assists, start=1):
        pr = prof_map.get(p["employee_id"], {})
        ph.update({f"a{i}_name": pr.get("name") or "", f"a{i}_grade": pr.get("license_grade") or "",
                   f"a{i}_no": pr.get("license_no") or "", f"a{i}_period": period})
    # 2쪽 — 대표자(관계인 대표=소유자로 표기)·관리등급·소방계획서·전년도·교육훈련·화재보험
    if owner:
        ph["ck_rep_owner"] = CK
    grade_key = {"특급": "ck_g0", "1급": "ck_g1", "2급": "ck_g2", "3급": "ck_g3"}.get(cust.get("building_grade") or "")
    if grade_key:
        ph[grade_key] = CK
    if has_plan:
        ph["ck_plan_y"] = CK
        ph["ck_plan_keep"] = CK
    if "작동" in prev_types:
        ph["ck_prev_op_y"] = CK
    if prev_types & {"종합", "최초"}:
        ph["ck_prev_comp_y"] = CK
    if has_training:
        ph["ck_edu_y"] = CK
        ph["ck_drill_y"] = CK
    if cust.get("insurance_joined") is True:
        ph["ck_ins_y"] = CK
    elif cust.get("insurance_joined") is False:
        ph["ck_ins_n"] = CK
    # 건축물구조·지붕·승강기·주차장
    ms = b.get("main_structure") or ""
    for token, key in (("콘크리트", "ck_st_con"), ("철골", "ck_st_steel"), ("조적", "ck_st_brick"), ("목", "ck_st_wood")):
        if token in ms:
            ph[key] = CK
            break
    else:
        if ms:
            ph["ck_st_etc"] = CK
    rf = b.get("roof_structure") or ""
    for token, key in (("슬래브", "ck_rf_slab"), ("슬라브", "ck_rf_slab"), ("기와", "ck_rf_tile"), ("슬레이트", "ck_rf_slate")):
        if token in rf:
            ph[key] = CK
            break
    else:
        if rf:
            ph["ck_rf_etc"] = CK
    if b.get("elevator_count"):
        ph["ck_elv_r"] = CK
    if b.get("emergency_elevator_count"):
        ph["ck_elv_e"] = CK
    pk = b.get("parking_summary") or ""
    for token, key in (("옥내", "ck_pk_in"), ("기계식", "ck_pk_mech"), ("옥외", "ck_pk_out"), ("옥상", "ck_pk_roof")):
        if token in pk:
            ph[key] = CK

    safe = re.sub(r'[\\/:*?"<>|]', "_", cust["customer_name"])
    out_hwp, out_odt, out_html = mr9.generate_report9(ph, facility_checks, result_marks,
                                                      mf.OUT_DIR, f"{safe}_별지9호_{year}")
    heartbeat(f"{label} — 업로드")
    stamp = int(time.time() * 1000)
    base = f"{cust_id}/inspections/{insp_id}/report9_{stamp}"
    with open(out_hwp, "rb") as f:
        st_upload(f"{base}.hwp", f.read(), "application/octet-stream")
    with open(out_html, "rb") as f:
        st_upload(f"{base}.html", f.read(), "text/html; charset=utf-8")
    # PDF — 로컬 LibreOffice 즉시 변환 (실패해도 HWP는 사용 가능)
    pdf_note = ""
    if mf.SOFFICE:
        try:
            out_pdf = out_odt[:-4] + ".pdf"
            mf.convert_pdf_local(out_odt, out_pdf)
            with open(out_pdf, "rb") as f:
                st_upload(f"{base}.pdf", f.read(), "application/pdf")
        except Exception as pe:  # noqa: BLE001
            pdf_note = f"PDF 변환 실패({pe})"
    else:
        pdf_note = "LibreOffice 미설치 — HWP만 등록"

    missing = [lb for lb, has in [
        ("점검기간", period),
        ("주된 점검인력", mains),
        ("점검표 응답", responses),
        ("송달 동의", cust.get("email_delivery_consent") is not None or None),
        ("자격정보", all(prof_map.get(p["employee_id"], {}).get("license_no") for p in parts) if parts else None),
        ("주소", cust.get("address")),
        ("사용승인일", cust.get("use_approval_date")),
        ("건축허가일", b.get("permit_date")),
    ] if not has]
    if pdf_note:
        missing.append(pdf_note)
    print(f"[{now_iso()}] ✅ 별지9호 완료: {label} (누락 {len(missing)}개)")
    return missing

def process_report1011(job: dict) -> list[str]:
    """별지 10호(이행계획)·11호(이행완료) 병합 생성 (R-3 — §9-7, 데이터 = inspection_defects 생애주기)"""
    kind = job["report_type"]  # report10 | report11
    cust_id, year = job["customer_id"], int(job["year"])
    insp_id = job.get("inspection_id")
    if not insp_id:
        raise RuntimeError("점검 건(inspection_id)이 없습니다")
    label = f"{job.get('customer_name')} 별지{'10' if kind == 'report10' else '11'}호"
    print(f"[{now_iso()}] {label} 생성 시작")

    cust = db_get(f"customers?id=eq.{cust_id}&select=customer_name,address,fire_station")[0]
    blds = db_get(f"buildings?customer_id=eq.{cust_id}&is_active=eq.true&select=purpose&order=created_at&limit=1")
    contacts = db_get(f"customer_contacts?customer_id=eq.{cust_id}&select=role,name,phone")
    owner = next((c for c in contacts if c["role"] == "대표"), contacts[0] if contacts else None)
    defects = db_get(f"inspection_defects?inspection_id=eq.{insp_id}"
                     "&select=defect_name,action_plan,action_start,action_end,action_taken,action_completed_at&order=created_at")

    ph: dict[str, str] = {
        "customer_name": cust["customer_name"], "purpose": (blds[0].get("purpose") if blds else "") or "",
        "address": cust.get("address") or "",
        "owner_name": (owner or {}).get("name") or "", "owner_phone": (owner or {}).get("phone") or "",
        "mgr_name": (owner or {}).get("name") or "", "mgr_phone": (owner or {}).get("phone") or "",
        "report_date": mf.kdate(time.strftime("%Y-%m-%d")),
        "submit_to": f"{cust['fire_station']}장" if cust.get("fire_station") else "관할 소방서장",
    }
    rows: list[dict] = []
    missing: list[str] = []
    if kind == "report10":
        planned = [d for d in defects if d.get("action_plan") or d.get("action_start")]
        rows = [{"content": d.get("action_plan") or d.get("defect_name") or "",
                 "period": f"{d.get('action_start') or ''} ~ {d.get('action_end') or ''}".strip(" ~")} for d in planned]
        starts = sorted(d["action_start"] for d in planned if d.get("action_start"))
        ends = sorted(d["action_end"] for d in planned if d.get("action_end"))
        if starts and ends:
            days = (int(time.mktime(time.strptime(ends[-1], "%Y-%m-%d"))) - int(time.mktime(time.strptime(starts[0], "%Y-%m-%d")))) // 86400 + 1
            ph["total_period"] = f"{mf.kdate(starts[0])} ~ {mf.kdate(ends[-1])}"
            ph["total_days"] = str(days)
        if not planned:
            missing.append("이행조치 계획 미입력")
        if len(planned) > 4:
            missing.append(f"계획 {len(planned)}건 중 4건만 표기(서식 행 한도)")
    else:
        done = [d for d in defects if d.get("action_completed_at")]
        rows = [{"content": d.get("action_taken") or d.get("defect_name") or "",
                 "period": d.get("action_completed_at") or ""} for d in done]
        company_rows = db_get("company_profile?select=company_name,business_number,representative,phone,address&limit=1")
        company = company_rows[0] if company_rows else {}
        ph.update({
            "company_name": company.get("company_name") or "", "company_bizno": company.get("business_number") or "",
            "company_rep": company.get("representative") or "", "company_phone": company.get("phone") or "",
            "company_address": company.get("address") or "",
        })
        if not done:
            missing.append("이행완료 항목 없음")
        if len(done) > 4:
            missing.append(f"완료 {len(done)}건 중 4건만 표기(서식 행 한도)")

    safe = re.sub(r'[\\/:*?"<>|]', "_", cust["customer_name"])
    tag = "10" if kind == "report10" else "11"
    out_hwp, out_odt, out_html = m1011.generate_annex(kind, ph, rows, mf.OUT_DIR, f"{safe}_별지{tag}호_{year}")
    heartbeat(f"{label} — 업로드")
    stamp = int(time.time() * 1000)
    base = f"{cust_id}/inspections/{insp_id}/{kind}_{stamp}"
    with open(out_hwp, "rb") as f:
        st_upload(f"{base}.hwp", f.read(), "application/octet-stream")
    with open(out_html, "rb") as f:
        st_upload(f"{base}.html", f.read(), "text/html; charset=utf-8")
    if mf.SOFFICE:
        try:
            out_pdf = out_odt[:-4] + ".pdf"
            mf.convert_pdf_local(out_odt, out_pdf)
            with open(out_pdf, "rb") as f:
                st_upload(f"{base}.pdf", f.read(), "application/pdf")
        except Exception as pe:  # noqa: BLE001
            missing.append(f"PDF 변환 실패({pe})")
    else:
        missing.append("LibreOffice 미설치 — HWP만 등록")
    print(f"[{now_iso()}] ✅ {label} 완료 (누락 {len(missing)}개)")
    return missing

def process_exterior(job: dict) -> list[str]:
    """외관점검표(별지 6호) 병합 생성 (§9-8d — 일반관리, 데이터 = 외관점검 시트 응답 X{섹션}-{행})"""
    cust_id, year = job["customer_id"], int(job["year"])
    insp_id = job.get("inspection_id")
    if not insp_id:
        raise RuntimeError("점검 건(inspection_id)이 없습니다")
    label = f"{job.get('customer_name')} 외관점검표 ({year})"
    print(f"[{now_iso()}] 외관점검표 생성 시작: {label}")

    insp = db_get(f"inspections?id=eq.{insp_id}&select=inspection_start_date,assigned_employee_id")
    if not insp:
        raise RuntimeError("점검 건을 찾을 수 없습니다")
    insp = insp[0]
    cust = db_get(f"customers?id=eq.{cust_id}&select=customer_name,address")[0]
    blds = db_get(f"buildings?customer_id=eq.{cust_id}&is_active=eq.true&select=purpose&order=created_at&limit=1")
    contacts = db_get(f"customer_contacts?customer_id=eq.{cust_id}&select=role,name,phone")
    owner = next((c for c in contacts if c["role"] == "대표"), contacts[0] if contacts else None)
    inspector = ""
    if insp.get("assigned_employee_id"):
        prof = db_get(f"profiles?id=eq.{insp['assigned_employee_id']}&select=name")
        inspector = prof[0]["name"] if prof else ""

    start = insp.get("inspection_start_date") or time.strftime("%Y-%m-%d")
    month, day = int(start[5:7]), int(start[8:10])

    # 외관점검 시트 응답(X{섹션}-{행}) → 해당 월 결과란 ○/×//
    responses = db_get_all(f"inspection_sheet_responses?inspection_id=eq.{insp_id}&item_code=like.X*&select=item_code,result")
    marks = {"O": "○", "X": "×", "N": "/"}
    ph: dict[str, str] = {
        "customer_name": cust["customer_name"], "purpose": (blds[0].get("purpose") if blds else "") or "",
        "address": cust.get("address") or "", "yr": str(year),
        "mgr_name": (owner or {}).get("name") or "", "mgr_phone": (owner or {}).get("phone") or "",
        # 표지 — 해당 월 행: 점검월일·양호/불량(불량 1건이라도 있으면 불량)·점검자
        f"d{month}_md": f"  {month}월 {day}일", f"d{month}_nm": inspector,
    }
    any_x = any(r["result"] == "X" for r in responses)
    if responses:
        ph[f"d{month}_g"] = "[  ]" if any_x else "[√]"
        ph[f"d{month}_b"] = "[√]" if any_x else "[  ]"
    n_marks = 0
    for r in responses:
        m = re.match(r"^X(\d{1,2})-(\d{1,3})$", r["item_code"])
        if m and r["result"] in marks:
            ph[f"x{int(m.group(1))}_{int(m.group(2))}_{month}"] = marks[r["result"]]
            n_marks += 1

    safe = re.sub(r'[\\/:*?"<>|]', "_", cust["customer_name"])
    out_hwp, out_odt, out_html = mext.generate_exterior(ph, mf.OUT_DIR, f"{safe}_외관점검표_{year}")
    heartbeat(f"{label} — 업로드")
    stamp = int(time.time() * 1000)
    base = f"{cust_id}/inspections/{insp_id}/exterior_{stamp}"
    with open(out_hwp, "rb") as f:
        st_upload(f"{base}.hwp", f.read(), "application/octet-stream")
    with open(out_html, "rb") as f:
        st_upload(f"{base}.html", f.read(), "text/html; charset=utf-8")
    missing: list[str] = []
    if mf.SOFFICE:
        try:
            out_pdf = out_odt[:-4] + ".pdf"
            mf.convert_pdf_local(out_odt, out_pdf)
            with open(out_pdf, "rb") as f:
                st_upload(f"{base}.pdf", f.read(), "application/pdf")
        except Exception as pe:  # noqa: BLE001
            missing.append(f"PDF 변환 실패({pe})")
    else:
        missing.append("LibreOffice 미설치 — HWP만 등록")
    if not responses:
        missing.append("외관점검 시트 응답 없음 — 결과란 공란")
    if not inspector:
        missing.append("점검자(담당) 미배정")
    if not (owner or {}).get("name"):
        missing.append("소방안전관리자(대표 관계인) 미등록")
    print(f"[{now_iso()}] ✅ 외관점검표 완료: {label} ({month}월 결과 {n_marks}건, 누락 {len(missing)}개)")
    return missing

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
                rtype = job.get("report_type") or "fire_plan"
                if rtype == "report9":
                    missing = process_report9(job)
                    db_patch(f"{JOBS}?id=eq.{job['id']}",
                             {"status": "done", "missing": missing, "error": None, "finished_at": now_iso()})
                elif rtype in ("report10", "report11"):
                    missing = process_report1011(job)
                    db_patch(f"{JOBS}?id=eq.{job['id']}",
                             {"status": "done", "missing": missing, "error": None, "finished_at": now_iso()})
                elif rtype == "exterior":
                    missing = process_exterior(job)
                    db_patch(f"{JOBS}?id=eq.{job['id']}",
                             {"status": "done", "missing": missing, "error": None, "finished_at": now_iso()})
                else:
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
