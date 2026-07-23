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
# 로컬 LibreOffice — 있으면 PDF 변환을 SSH(VPS Gotenberg) 없이 로컬에서 수행 (2026-07-21)
SOFFICE = next((p for p in (
    os.environ.get("SOFFICE_PATH", ""),
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
) if p and os.path.isfile(p)), None)

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

# ── 7차: 공통 수기 프리셋 (fire-plans 버킷 _presets/*.json) ──
# 스토리지가 한글 키를 거부(InvalidKey)해 ASCII 매핑 사용 — src/lib/fire-plan-presets.ts PRESET_FILE_KEYS와 동일
PRESET_FILE_KEYS = {"주택형": "house", "상가형": "retail", "공장형": "factory"}

def load_preset_pairs(env: dict, preset_type: str) -> list[tuple[str, str]]:
    """프리셋 JSON → (양식 기본값, 프리셋 문구) 목록. 없거나 손상 시 [] (양식 기본값 유지, fail-soft).
    긴 문구부터 치환해 짧은 앵커('1층 주차장' 등)가 긴 문구를 먼저 깨뜨리지 않게 한다."""
    key = PRESET_FILE_KEYS.get(preset_type)
    if not key:
        print(f"  ⚠️ 알 수 없는 프리셋 유형(양식 기본값 유지): {preset_type}")
        return []
    url = f"{env['NEXT_PUBLIC_SUPABASE_URL']}/storage/v1/object/fire-plans/_presets/{key}.json"
    try:
        req = urllib.request.Request(url, headers={
            "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
            "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
            "User-Agent": "curl/8.4.0",
        })
        with urllib.request.urlopen(req) as res:
            data = json.loads(res.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠️ 프리셋 '{preset_type}' 로드 실패(양식 기본값 유지): {e}")
        return []
    pairs = [(e.get("find") or "", e.get("value") or "") for e in data.get("entries", [])]
    pairs = [(f, v) for f, v in pairs if f and v and f != v]
    return sorted(pairs, key=lambda p: -len(p[0]))

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

# ── A안: placeholder 템플릿 — 양식에 {{key}}를 1회 심어두고(seed-fireplan-placeholders.py) 런타임은 단순 치환 ──
# 파일이 있으면 자동으로 placeholder 모드, 없으면 종전 라벨-앵커 주입 모드로 동작한다.
TEMPLATE_PH = os.path.join(DATA, "양식-placeholder.hwpx")

# (라벨, nth, cell_offset) → placeholder key. 심기 스크립트와 런타임이 공유하는 단일 기준표.
# build_extras가 내놓는 앵커와 반드시 1:1 — 새 앵커를 추가하면 여기와 심기 재실행 둘 다 필요.
ANCHOR_KEYS: dict[tuple[str, int, int], str] = {
    ("명칭", 1, 1): "customer_name",
    ("도로명주소", 1, 1): "address",
    ("사용승인일", 1, 1): "use_approval_date",
    ("주용도", 1, 1): "purpose",
    ("연면적", 1, 1): "total_area",
    ("층수", 1, 1): "floors",
    ("수신기위치", 1, 1): "receiver_location",
    ("수신기 위치", 1, 1): "receiver_location",
    ("구조", 1, 1): "main_structure",
    ("지붕", 1, 1): "roof_structure",
    ("높이", 1, 1): "height",
    ("가입금액", 1, 1): "insurance_company",
    ("가입금액", 1, 2): "insurance_period",
    ("대인", 1, 1): "insurance_amount_person",
    ("대물", 1, 1): "insurance_amount_property",
    ("대표자(책임자)", 1, 1): "owner_name",
    ("소방안전관리자", 1, 1): "manager_name",
    ("연락처", 2, 1): "owner_phone",
    ("연락처", 3, 1): "owner_phone",
    ("소방안전관리자", 2, 2): "manager_name",
    ("소방안전관리자", 2, 3): "manager_selected_date",
}
# 양식 예시값 → placeholder key (심기 시 전역 치환. 종전에는 값 없으면 예시값이 그대로 남았지만, ph 모드는 빈 칸이 된다)
GLOBAL_PH = {"리젠시빌": "customer_name", "2017년 4월 24일": "contract_date", "양평 소방서": "fire_station"}
ZONE_COLS = (1, 2, 3, 10)   # 서식 1.2.1 데이터 열 (build_zone_rows와 동일)
PH_RE = re.compile(r"\{\{([a-z0-9_]+)\}\}")

# ── 빈 칸 주입 (라벨-앵커 모드): 라벨 셀 다음 셀의 빈 런에 값 삽입 ──
def _xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def inject_after_label(xml: str, label: str, value: str, nth: int = 1, cell_offset: int = 1) -> tuple[str, bool]:
    """서식 표에서 nth번째 `>label</hp:t>` 라벨 뒤 cell_offset번째 <hp:tc>(값 셀)의 빈 런에 value 주입"""
    if not value:
        return xml, False
    anchor = -1
    for _ in range(nth):
        anchor = xml.find(f">{label}</hp:t>", anchor + 1)
        if anchor < 0:
            return xml, False
    tc_start = anchor
    for _ in range(cell_offset):
        tc_start = xml.find("<hp:tc ", tc_start + 1)
        if tc_start < 0:
            return xml, False
    tc_end = xml.find("</hp:tc>", tc_start)
    cell = xml[tc_start:tc_end]
    m = re.search(r'<hp:run charPrIDRef="(\d+)"/>', cell)
    if m:
        new_cell = cell.replace(m.group(0),
            f'<hp:run charPrIDRef="{m.group(1)}"><hp:t>{_xml_escape(value)}</hp:t></hp:run>', 1)
        return xml[:tc_start] + new_cell + xml[tc_end:], True
    # 폴백: 단위만 있는 값 셀 (㎡/m/원/kW/kVA/명) — 값으로 대체 (대상 셀 안에서만 치환)
    for unit in ("㎡", " kW", "kW", " kVA", "kVA", "m", "원", "명"):
        token = f"<hp:t>{unit}</hp:t>"
        if token in cell:
            new_cell = cell.replace(token, f"<hp:t>{_xml_escape(value)}</hp:t>", 1)
            return xml[:tc_start] + new_cell + xml[tc_end:], True
    return xml, False

def build_extras(cust: dict, building: dict | None, owner: dict | None = None) -> list[tuple[str, str, int, int]]:
    """빈 칸 주입 목록: (라벨, 값, n번째 라벨, 셀 오프셋)"""
    extras: list[tuple[str, str, int, int]] = [
        ("명칭", cust["customer_name"], 1, 1),
        ("도로명주소", cust.get("address") or "", 1, 1),
        ("사용승인일", kdate(cust.get("use_approval_date")), 1, 1),
    ]
    if building:
        extras.append(("주용도", building.get("purpose") or "", 1, 1))
        if building.get("total_area") is not None:
            extras.append(("연면적", f"{building['total_area']} ㎡", 1, 1))
        fa, fb = building.get("floors_above"), building.get("floors_below")
        if fa is not None or fb is not None:
            extras.append(("층수", f"지하 {fb or 0}층 / 지상 {fa or 0}층", 1, 1))
        # 5차: 수신기위치(서식1.1 + 1.3), 구조·지붕(037/038 기존 컬럼), 높이(m 단위셀 폴백)
        rc = building.get("receiver_location") or ""
        extras += [("수신기위치", rc, 1, 1), ("수신기 위치", rc, 1, 1)]
        extras.append(("구조", building.get("main_structure") or "", 1, 1))
        extras.append(("지붕", building.get("roof_structure") or "", 1, 1))
        if building.get("height") is not None:
            extras.append(("높이", f"{building['height']} m", 1, 1))
    # 6차 — 화재보험 값 (서식 1.1: '가입금액' 라벨 뒤 빈 셀 2개 = 보험사·기간, 대인/대물은 '원' 단위셀)
    extras += [("가입금액", cust.get("insurance_company") or "", 1, 1),
               ("가입금액", cust.get("insurance_period") or "", 1, 2),
               ("대인", cust.get("insurance_amount_person") or "", 1, 1),
               ("대물", cust.get("insurance_amount_property") or "", 1, 1)]
    if owner:
        name, phone = owner.get("name") or "", owner.get("phone") or ""
        extras += [("대표자(책임자)", name, 1, 1), ("소방안전관리자", name, 1, 1),
                   ("연락처", phone, 2, 1), ("연락처", phone, 3, 1)]
        # 서식 1.7 선임현황 행: 성명(offset2)·선임일자(offset3) — 라벨 2번째 '소방안전관리자' (소속 셀은 구조 상이로 제외)
        extras += [("소방안전관리자", name, 2, 2),
                   ("소방안전관리자", kdate(cust.get("manager_selected_at")), 2, 3)]
    return [(la, v, n, off) for la, v, n, off in extras if v]

# ── 2차 연계: 서식 1.4 시설 체크 + 서식 1.10 자체점검 시기 ──
FACILITY_ITEMS = [
    "소화기구 및 자동소화장치", "옥내소화전설비", "옥외소화전설비", "스프링클러설비", "간이스프링클러설비",
    "화재조기진압용 스프링클러설비", "물분무소화설비", "미분무소화설비", "포소화설비", "이산화탄소소화설비",
    "할론소화설비", "할로겐화합물 및 불활성기체소화설비", "분말소화설비", "강화액소화설비", "고체에어로졸소화설비",
    "단독경보형감지기", "비상경보설비", "자동화재탐지설비 및 시각경보기", "화재알림설비", "비상방송설비",
    "통합감시시설", "자동화재속보설비", "누전경보기", "가스누설경보기",
    "피난기구", "인명구조기구", "피난유도선", "유도등", "비상조명등", "유도표지", "휴대용비상조명등",
    "상수도소화용수설비", "소화수조 및 저수조",
    "거실제연설비", "부속실 등 제연설비", "비상콘센트설비", "연결송수관설비", "무선통신보조설비",
    "연결살수설비", "연소방지설비",
]

def build_stage2(cust: dict, year: int, codes: list[str]) -> dict[str, str]:
    rep: dict[str, str] = {}
    # 서식 1.10: 작동점검 시기 ("년        월" 자리) + 건축물 사용승인일
    if cust.get("plan_anchor_date"):
        am = int(cust["plan_anchor_date"].split("-")[1])
        op = ((am - 1 + 6) % 12) + 1 if cust.get("inspection_type") == "종합" else am
        rep["년        월"] = f"{year}년 {op}월"
    if cust.get("use_approval_date"):
        rep["건축물 사용승인일 :"] = f"건축물 사용승인일 : {kdate(cust['use_approval_date'])}"
    # 서식 1.4: 설치 시설 체크 (□ → ■)
    for item in FACILITY_ITEMS:
        if any(code and (code in item or item in code) for code in codes):
            rep[f"□ {item}"] = f"■ {item}"
    # 6차 — 급수 체크 (서식 1.8·2.1): 양식 예시(■ 3급) 정규화 후 해당 급 마킹
    grade = cust.get("building_grade")
    if grade:
        for g in ("특급", "1급", "2급", "3급"):
            rep[f"■ {g}"] = f"□ {g}"
        # 정규화 뒤 적용되도록 별도 키 (replace 순서: dict 순서 유지)
        rep[f"□ {grade}"] = f"■ {grade}"
    # 6차 — 화재보험 체크 (서식 1.1)
    if cust.get("insurance_joined") is True:
        rep["☐ 가입"] = "■ 가입"
    elif cust.get("insurance_joined") is False:
        rep["☐ 미가입"] = "■ 미가입"
    # 6차 — 운영시간 체크 + 최대수용인원 (양식 예시 "100명")
    if cust.get("op_hours_weekday"):
        rep["☐ 평일"] = f"■ 평일({cust['op_hours_weekday']})"
    if cust.get("op_hours_holiday"):
        rep["☐ 휴일"] = f"■ 휴일({cust['op_hours_holiday']})"
    if cust.get("headcount_max"):
        rep["100명"] = f"{cust['headcount_max']}명"
    return rep

# ── 7-4: 서식 입력(fire_plan_forms.sections) → HWP 병합 (P4-⑤ 1단계) ──
def build_form_pairs(sections: dict) -> tuple[dict[str, str], list[tuple[str, str, int, int]]]:
    """섹션 입력 → (체크·문구 치환 쌍, 라벨 주입 extras). 고객 입력 > 프리셋 > 양식 기본값 우선순위 유지."""
    rep: dict[str, str] = {}
    extras: list[tuple[str, str, int, int]] = []
    # 1.5 계단·기타 피난시설 — 1.1·1.5·3.1 동일 데이터 (양식이 □/☐ 혼용이라 둘 다 치환)
    ef = sections.get("evacFire") or {}
    for name in list(ef.get("stairs") or {}) + list(ef.get("etc") or []):
        for box in ("□", "☐"):
            rep[f"{box} {name}"] = f"■ {name}"
    # 1.6 전기 — 라벨 뒤 단위 셀(kW/kVA) 주입
    elec = (sections.get("etcFacility") or {}).get("electric") or {}
    if elec.get("kw"):
        extras.append(("수전용량 ", f"{elec['kw']} kW", 1, 1))
    if elec.get("kva"):
        extras.append(("변압기용량", f"{elec['kva']} kVA", 1, 1))
    if elec.get("generator") and elec.get("generatorNote"):
        extras.append(("비상발전기", str(elec["generatorNote"]), 1, 1))
    # 1.10.3 다중이용업소 — 라벨 뒤 빈 셀 주입 (해당 시에만)
    mu = sections.get("multiUse") or {}
    if mu.get("applicable"):
        cats = ", ".join(f"{k}({v})" for k, v in (mu.get("categories") or {}).items())
        for label, val in (("사업장명", mu.get("bizName")), ("업    종", cats), ("위    치", mu.get("location")),
                           ("영 업 주", mu.get("owner")), ("연 락 처", mu.get("phone")), ("수용인원", mu.get("capacity"))):
            if val:
                extras.append((label, str(val), 1, 1))
    # 3.5 피난약자 유형 체크 (명수 입력된 유형)
    vul = sections.get("vulnerable") or {}
    if not vul.get("none"):
        for tp, c in (vul.get("counts") or {}).items():
            if (c or {}).get("work") or (c or {}).get("use"):
                rep[f"☐ {tp}"] = f"■ {tp}"
    # 3.4 절차·경로·집결지 + 2장 초기소화 임무 — 7차 프리셋 앵커 재사용 (고객 입력 최우선)
    ep = sections.get("evacPlan") or {}
    routes = ep.get("routes") or []
    if routes and (routes[0] or {}).get("route"):
        rep["각 세대 출입구 앞 직통계단 이용"] = routes[0]["route"]
    if ep.get("assembly"):
        rep["1층 주차장"] = str(ep["assembly"])
    teams = sections.get("brigadeTeams") or {}
    if teams.get("extinguish"):
        rep["소화기를 이용하여 초기 진압 실시"] = str(teams["extinguish"])
    return rep, extras

# ── 7-4b: 범용 표 행 채우기 — 앵커 텍스트 뒤 표의 (rowAddr,colAddr) 셀에 값 주입 ──
def _set_tc_text(tc: str, value: str, clear_rest: bool = False) -> str:
    """셀 텍스트 설정 — 빈 런이면 주입, 예시 텍스트가 있으면 첫 런 내용 교체.
    clear_rest: 다행 예시 셀(런 2개 이상) — 첫 런 교체 후 나머지 런 텍스트 비움"""
    m = re.search(r'<hp:run charPrIDRef="(\d+)"/>', tc)
    if m:
        return tc.replace(m.group(0),
            f'<hp:run charPrIDRef="{m.group(1)}"><hp:t>{_xml_escape(value)}</hp:t></hp:run>', 1)
    m2 = re.search(r"(<hp:t[^>]*>)([^<]*)(</hp:t>)", tc)
    if m2:
        out = tc[:m2.start()] + m2.group(1) + _xml_escape(value) + m2.group(3) + tc[m2.end():]
        if clear_rest:
            head = out[:m2.start() + len(m2.group(1)) + len(_xml_escape(value)) + len(m2.group(3))]
            tail = re.sub(r"(<hp:t[^>]*>)[^<]*(</hp:t>)", r"\1\2", out[len(head):])
            out = head + tail
        return out
    return tc

def fill_table(xml: str, anchor: str, row_start: int, col_map: dict[int, str],
               rows: list[dict], span: int = 30000, stride: int = 1,
               clear_rest: bool = False) -> tuple[str, int]:
    """anchor 이후 span 범위의 표에서 데이터 행(row_start+i*stride)의 col_map 셀에 rows[i][key] 주입 (fail-soft).
    stride: 논리 1건이 표 N행을 차지하는 블록형 표(1.14.2 등)의 행 간격"""
    start = xml.find(anchor)
    if start < 0 or not rows:
        return xml, 0
    end = min(len(xml), start + span)
    filled = 0

    def repl(m: re.Match) -> str:
        nonlocal filled
        tc = m.group(0)
        addr = re.search(r'cellAddr colAddr="(\d+)" rowAddr="(\d+)"', tc)
        if not addr:
            return tc
        c, r = int(addr.group(1)), int(addr.group(2))
        if (r - row_start) % stride != 0:
            return tc
        ri = (r - row_start) // stride
        if ri < 0 or ri >= len(rows) or c not in col_map:
            return tc
        val = str(rows[ri].get(col_map[c]) or "")
        if not val.strip():
            return tc
        filled += 1
        return _set_tc_text(tc, val, clear_rest)

    seg = re.sub(r"<hp:tc .*?</hp:tc>", repl, xml[start:end], flags=re.S)
    return xml[:start] + seg + xml[end:], filled

def apply_form_tables(xml: str, sections: dict | None, revisions: list[dict] | None) -> tuple[str, int]:
    """7-4b 표 병합: 개정이력 다행·1.10.4 이력·3.2 세부현황·3.7 기구·장비 + 기록부(1.12~1.15, 7-4 확장).
    제외(구조 불일치): 1.11.2(차수 블록)·1.11.4(별지 28호 고정 양식)·시나리오(5앵커 분할)·
    1.10.2 dutyLog(양식에 기록표 없음 — '별도 파일철' 보관 대상, ERP 기록·보관용 유지)."""
    n = 0
    if revisions:
        xml, k = fill_table(xml, "소방계획서 개정이력", 1, {1: "date", 2: "note", 3: "author"}, revisions)
        n += k
    s = sections or {}
    hist = s.get("fireHistory") or []
    if hist:
        xml, k = fill_table(xml, "1.10.4 화재/비화재보 이력", 2,
                            {0: "kind", 1: "at", 2: "place", 3: "cause", 5: "action"}, hist)
        n += k
    det = s.get("evacDetail") or []
    if det:
        xml, k = fill_table(xml, "피난시설 및 기타시설 세부현황", 1,
                            {4: "facility", 5: "location", 6: "status"}, det)
        n += k
    equip = s.get("evacEquip") or []
    if equip:
        xml, k = fill_table(xml, "유도장비", 16, {0: "name", 3: "location", 5: "qty"}, equip)
        n += k
    # 1.12 화기취급 감독(fireworkLog) → 1.12.1 화기취급작업 현황 표 (데이터 행 r3~r15 = 13행, 초과분 미병합)
    fw = s.get("fireworkLog") or []
    if fw:
        rows = [{"date": r.get("date"), "place": r.get("place"), "supervisor": r.get("supervisor"),
                 "work": " / ".join(x for x in (r.get("work") or "",
                                                f"안전조치: {r['measure']}" if r.get("measure") else "") if x)}
                for r in fw[:13]]
        xml, k = fill_table(xml, "1.12.1 화기취급작업 현황", 3,
                            {0: "date", 1: "place", 2: "work", 5: "supervisor"}, rows, span=70000)
        n += k
    # 1.13 공사·정비 기록(constructionLog) → 작업내용/작업기간/작업책임자/비고 표 (r1~r11 = 11행)
    con = s.get("constructionLog") or []
    if con:
        rows = [{"date": r.get("date"), "company": r.get("company"), "note": r.get("note"),
                 "content": " — ".join(x for x in (r.get("facility") or "", r.get("content") or "") if x)}
                for r in con[:11]]
        xml, k = fill_table(xml, "소방시설 공사/정비 기록", 1,
                            {0: "content", 1: "date", 2: "company", 5: "note"}, rows, span=60000)
        n += k
    # 1.14 홍보 결과(promoLog) → 1.14.2 표 — 1건=2행 블록×2 (사진 셀은 제외, 방법+내용·일시+대상 병합)
    promo = s.get("promoLog") or []
    if promo:
        rows = [{"mtd": " — ".join(x for x in (r.get("method") or "", r.get("content") or "") if x),
                 "when": " / ".join(x for x in (r.get("date") or "",
                                                f"대상: {r['target']}" if r.get("target") else "") if x)}
                for r in promo[:2]]
        xml, k = fill_table(xml, "1.14.2 화재예방 및 홍보 결과", 1, {1: "mtd", 3: "when"},
                            rows, span=12000, stride=2, clear_rest=True)
        n += k
    # 1.15 피해 복구(recoveryLog) → 화재발생 개요 서식 — 단일 사건 서식이라 첫 행만 (일시·개요=피해 내용·예방대책=복구 조치, 비용 미병합)
    rec = s.get("recoveryLog") or []
    if rec:
        r0 = rec[0]
        rows = [{} for _ in range(8)]
        rows[0] = {"dt": r0.get("date")}          # r9  일   시
        rows[4] = {"dmg": r0.get("damage")}       # r13 발화개요
        rows[7] = {"rcv": r0.get("recovery")}     # r16 예방대책(복구 조치 서술)
        xml, k = fill_table(xml, "피해복구", 9, {2: "dt", 3: "dmg", 1: "rcv"}, rows, span=45000)
        n += k
    return xml, n

# ── 4차: 서식 1.2.1 구역별 세부현황 행 채우기 ─────────────────
def fill_zone_rows(xml: str, zone_rows: list[dict[int, str]]) -> tuple[str, int]:
    """1.2.1 표의 데이터 행(rowAddr 6~)에 값 주입. zone_rows = [{colAddr: 값}]"""
    start = xml.find(">1.2.1")
    end = xml.find(">1.2.2", start)
    if start < 0 or end < 0:
        return xml, 0
    seg = xml[start:end]
    parts = seg.split("<hp:tc ")
    filled = 0
    for idx, row in enumerate(zone_rows[:8]):
        r = 6 + idx
        for col, val in row.items():
            if not val:
                continue
            for pi in range(1, len(parts)):
                if f'colAddr="{col}" rowAddr="{r}"' not in parts[pi]:
                    continue
                m = re.search(r'<hp:run charPrIDRef="(\d+)"/>', parts[pi])
                if m:
                    parts[pi] = parts[pi].replace(
                        m.group(0),
                        f'<hp:run charPrIDRef="{m.group(1)}"><hp:t>{_xml_escape(val)}</hp:t></hp:run>', 1)
                    filled += 1
                break
    return xml[:start] + "<hp:tc ".join(parts) + xml[end:], filled

def build_zone_rows(building: dict | None, floors: list[dict], owner: dict | None) -> list[dict[int, str]]:
    """fire_facility_floors 층별 데이터 → 구역별 행. 없으면 '전층' 1행 폴백"""
    contact = (owner or {}).get("phone") or ""
    purpose = (building or {}).get("purpose") or ""
    if floors:
        return [{1: f.get("floor_label") or "", 2: purpose, 10: contact} for f in floors]
    area = f"{building['total_area']} ㎡" if building and building.get("total_area") is not None else ""
    return [{1: "전층", 2: purpose, 3: area, 10: contact}]

# ── 6차: 서식 2.2.3 자위소방대 편성표 — 대장/부대장 행 주입 ──
def fill_brigade(xml: str, cust_name: str, members: list[dict]) -> tuple[str, int]:
    """편성표(Type-Ⅲ): r3=대장, r4=부대장 행의 소속(c2)/성명(c3)/임무(c5)/개인연락(c7)"""
    anchor = xml.find("대    장")
    if anchor < 0 or not members:
        return xml, 0
    start, end = max(0, anchor - 4000), min(len(xml), anchor + 16000)
    seg = xml[start:end]
    leader = next((m for m in members if m.get("team") == "자위소방대장"), members[0])
    deputy = next((m for m in members if m.get("team") == "부대장"), None)
    targets: list[tuple[int, int, str]] = []
    for row, m in ((3, leader), (4, deputy)):
        if not m:
            continue
        targets += [(2, row, cust_name), (3, row, m.get("name") or ""),
                    (5, row, m.get("duty") or ""), (7, row, m.get("phone") or "")]
    parts = seg.split("<hp:tc ")
    filled = 0
    for col, row, val in targets:
        if not val:
            continue
        for pi in range(1, len(parts)):
            if f'colAddr="{col}" rowAddr="{row}"' not in parts[pi]:
                continue
            m2 = re.search(r'<hp:run charPrIDRef="(\d+)"/>', parts[pi])
            if m2:
                parts[pi] = parts[pi].replace(m2.group(0),
                    f'<hp:run charPrIDRef="{m2.group(1)}"><hp:t>{_xml_escape(val)}</hp:t></hp:run>', 1)
                filled += 1
            break
    return xml[:start] + "<hp:tc ".join(parts) + xml[end:], filled

# ── 생성 파이프라인 ───────────────────────────────────────────
def build_replacements(cust: dict) -> dict[str, str]:
    """표준양식의 예시값 → 고객 데이터 치환 맵"""
    rep = {"리젠시빌": cust["customer_name"]}
    if cust.get("contract_date"):
        rep["2017년 4월 24일"] = kdate(cust["contract_date"])
    if cust.get("fire_station"):
        rep["양평 소방서"] = cust["fire_station"]
    return rep

def generate_hwp(cust: dict, year: int, photo: str | None = None, out_dir: str = OUT_DIR,
                 extras: list | None = None, extra_replacements: dict[str, str] | None = None,
                 zone_rows: list[dict[int, str]] | None = None,
                 brigade: list[dict] | None = None,
                 preset_pairs: list[tuple[str, str]] | None = None,
                 form_sections: dict | None = None,
                 revisions: list[dict] | None = None) -> tuple[str, str]:
    """표준양식 병합 → (hwp_path, odt_path). SDK는 프로세스당 1회 초기화."""
    hwpsdk = sdk_app()
    obj = hwpsdk.Application.GetHwpObject()
    os.makedirs(out_dir, exist_ok=True)

    use_ph = os.path.isfile(TEMPLATE_PH)
    if use_ph:
        clean_hwpx = TEMPLATE_PH   # placeholder 템플릿은 이미 HWPX — SDK 변환 불필요
    else:
        clean_hwpx = os.path.join(out_dir, "_template.hwpx")
        if not os.path.isfile(clean_hwpx) or os.path.getmtime(clean_hwpx) < os.path.getmtime(TEMPLATE):
            doc = obj.CreateDocument()
            assert doc.Open(TEMPLATE, "", ""), "양식 열기 실패"
            assert doc.SaveAs(clean_hwpx, "HWPX", ""), "HWPX 변환 실패"
            obj.ReleaseDocument(doc)

    safe = re.sub(r'[\\/:*?"<>|]', "_", cust["customer_name"])
    merged_hwpx = os.path.join(out_dir, f"_{safe}_merged.hwpx")

    # 7차 프리셋은 최저 우선순위: 같은 키가 있으면 고객 데이터 치환이 덮어씀 (고객 필드 > 프리셋 > 양식 기본값)
    replacements = {**dict(preset_pairs or []), **(extra_replacements or {})}
    legacy_extras = list(extras or [])
    if use_ph:
        # ph 모드: 앵커 주입 대신 {{key}} 토큰 치환. 기준표 밖 앵커만 legacy 주입으로 남긴다.
        ph: dict[str, str] = {"customer_name": cust["customer_name"]}
        if cust.get("contract_date"):
            ph["contract_date"] = kdate(cust["contract_date"])
        if cust.get("fire_station"):
            ph["fire_station"] = cust["fire_station"]
        legacy_extras = []
        for label, value, nth, off in (extras or []):
            key = ANCHOR_KEYS.get((label, nth, off))
            if key:
                ph.setdefault(key, value)
            else:
                legacy_extras.append((label, value, nth, off))
        for idx, row in enumerate((zone_rows or [])[:8]):
            for col, val in row.items():
                if val:
                    ph[f"zone_r{idx}_c{col}"] = val
        if brigade:
            leader = next((m for m in brigade if m.get("team") == "자위소방대장"), brigade[0])
            deputy = next((m for m in brigade if m.get("team") == "부대장"), None)
            for tag, m in (("l", leader), ("d", deputy)):
                if m:
                    ph[f"brig_{tag}_name"] = m.get("name") or ""
                    ph[f"brig_{tag}_duty"] = m.get("duty") or ""
                    ph[f"brig_{tag}_phone"] = m.get("phone") or ""
        replacements.update({f"{{{{{k}}}}}": v for k, v in ph.items() if v})
    else:
        replacements = {**dict(preset_pairs or []), **build_replacements(cust), **(extra_replacements or {})}

    with zipfile.ZipFile(clean_hwpx, "r") as zin, zipfile.ZipFile(merged_hwpx, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in ("Contents/section0.xml", "Preview/PrvText.txt"):
                xml = data.decode("utf-8")
                for old, new in replacements.items():
                    xml = xml.replace(old, new)
                if item.filename == "Contents/section0.xml":
                    for label, value, nth, off in legacy_extras:
                        xml, ok = inject_after_label(xml, label, value, nth, off)
                        if not ok:
                            print(f"  ⚠️ 빈 칸 주입 실패(수동 보완 필요): {label}({nth},{off})")
                    if form_sections or revisions:
                        xml, tn = apply_form_tables(xml, form_sections, revisions)
                        print(f"  서식 표 병합(7-4b): 셀 {tn}개")
                    if not use_ph:
                        if zone_rows:
                            xml, n = fill_zone_rows(xml, zone_rows)
                            print(f"  구역별(1.2.1) 셀 {n}개 주입")
                        if brigade:
                            xml, n = fill_brigade(xml, cust["customer_name"], brigade)
                            print(f"  자위소방대(2.2) 셀 {n}개 주입")
                if use_ph:
                    leftover = sorted(set(PH_RE.findall(xml)))
                    if leftover and item.filename == "Contents/section0.xml":
                        print(f"  미채움 placeholder {len(leftover)}개 → 빈 칸 처리: {', '.join(leftover)}")
                    xml = PH_RE.sub("", xml)
                data = xml.encode("utf-8")
            zout.writestr(item, data)

    doc = obj.CreateDocument()
    assert doc.Open(merged_hwpx, "", ""), "병합본 열기 실패"
    if photo and os.path.isfile(photo):
        doc.MovePos(2)
        doc.InsertPicture(photo, True, 3, False, False, 0, 400, 300)

    out_hwp = os.path.join(out_dir, f"{safe}_소방계획서_{year}.hwp")
    out_odt = os.path.join(out_dir, f"{safe}_소방계획서_{year}.odt")
    out_html = os.path.join(out_dir, f"{safe}_소방계획서_{year}.html")
    assert doc.SaveAs(out_hwp, "HWP", ""), "HWP 저장 실패"
    assert doc.SaveAs(out_odt, "ODT", ""), "ODT 저장 실패"
    # 웹 미리보기용 HTML — SDK가 이미지를 PIC*.png 별도 파일 + 로컬 절대경로로 내보내므로 base64 인라인 필수
    assert doc.SaveAs(out_html, "HTML", ""), "HTML 저장 실패"
    obj.ReleaseDocument(doc)
    inline_html_images(out_html)
    os.remove(merged_hwpx)
    return out_hwp, out_odt, out_html

_IMG_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp"}

def inline_html_images(html_path: str) -> None:
    """SDK HTML 내보내기의 로컬 이미지 참조(.\\PIC*.png, file:///…)를 base64 data URI로 인라인하고 원본 파일 삭제"""
    import base64
    base_dir = os.path.dirname(html_path)
    with open(html_path, encoding="utf-8", errors="ignore") as f:
        html = f.read()
    used: set[str] = set()

    def repl(m: "re.Match[str]") -> str:
        src = m.group(1)
        p = urllib.parse.unquote(src)
        if p.startswith("file:///"):
            p = p[len("file:///"):].replace("/", os.sep)
        elif not os.path.isabs(p):
            p = os.path.join(base_dir, p.lstrip(".\\/"))
        ext = os.path.splitext(p)[1].lower()
        if ext not in _IMG_MIME or not os.path.isfile(p):
            return m.group(0)
        with open(p, "rb") as imgf:
            b64 = base64.b64encode(imgf.read()).decode()
        used.add(p)
        return f'src="data:{_IMG_MIME[ext]};base64,{b64}"'

    html = re.sub(r'src="([^"]+)"', repl, html)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    for p in used:
        try:
            os.remove(p)
        except OSError:
            pass

def convert_pdf_local(odt_path: str, pdf_path: str) -> None:
    """ODT → PDF (로컬 LibreOffice) — SSH 왕복 없는 기본 경로. SOFFICE 미설치 시 호출 금지"""
    if not SOFFICE:
        raise RuntimeError("LibreOffice 미설치 (SOFFICE_PATH 확인)")
    out_dir = os.path.dirname(pdf_path) or "."
    subprocess.run([SOFFICE, "--headless", "--convert-to", "pdf", "--outdir", out_dir, odt_path],
                   check=True, capture_output=True, timeout=180)
    produced = os.path.join(out_dir, os.path.splitext(os.path.basename(odt_path))[0] + ".pdf")
    if os.path.abspath(produced) != os.path.abspath(pdf_path):
        os.replace(produced, pdf_path)
    if not os.path.isfile(pdf_path) or os.path.getsize(pdf_path) < 1000:
        raise RuntimeError("LibreOffice PDF 변환 결과가 비정상입니다")

def convert_pdf(odt_path: str, pdf_path: str) -> None:
    """ODT → PDF — 로컬 LibreOffice 우선, 없으면 VPS Gotenberg(SSH 경유) 폴백"""
    if SOFFICE:
        convert_pdf_local(odt_path, pdf_path)
        return
    convert_pdf_remote(odt_path, pdf_path)

def convert_pdf_remote(odt_path: str, pdf_path: str) -> None:
    """ODT → PDF (VPS의 Gotenberg 경유) — 레거시 폴백, SSH 왕복 4회로 느림"""
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
    ap.add_argument("--preset", default=None, choices=["주택형", "상가형", "공장형"],
                    help="7차 공통 수기 프리셋 (_presets/{유형}.json — ERP 프리셋 관리에서 편집)")
    ap.add_argument("--prod", action="store_true", help="운영 DB 조회 (기본: 스테이징)")
    args = ap.parse_args()

    year = args.year or datetime.date.today().year
    env = load_env(args.prod)

    q = urllib.parse.quote(f"*{args.customer}*")
    custs = sb_get(env, f"customers?customer_name=ilike.{q}&is_active=eq.true"
                        "&select=id,customer_name,address,use_approval_date,fire_station,inspection_type,plan_anchor_date,contract_date,"
                        "manager_selected_at,building_grade,insurance_joined,insurance_company,insurance_period,"
                        "insurance_amount_person,insurance_amount_property,op_hours_weekday,op_hours_holiday,headcount_max")
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

    buildings = sb_get(env, f"buildings?customer_id=eq.{cust['id']}&is_active=eq.true"
                            "&select=id,purpose,total_area,floors_above,floors_below,receiver_location,main_structure,roof_structure,height&order=created_at&limit=1")
    extras = build_extras(cust, buildings[0] if buildings else None, owner)
    print("빈 칸 주입:", ", ".join(f"{la}={v}" for la, v, _, _ in extras) or "(없음)")

    codes: list[str] = []
    if buildings:
        facs = sb_get(env, f"fire_facilities?building_id=eq.{buildings[0]['id']}&installed=eq.true&select=facility_code")
        codes = [f["facility_code"] for f in facs]
    stage2 = build_stage2(cust, year, codes)
    print(f"2차 연계: 시설 체크 {sum(1 for k in stage2 if k.startswith('□'))}개, 점검시기 {'년        월' in stage2}")

    preset_pairs = load_preset_pairs(env, args.preset) if args.preset else []
    if args.preset:
        print(f"7차 프리셋({args.preset}): 문구 {len(preset_pairs)}개 치환 예정")

    photo = os.path.abspath(args.photo) if args.photo else None
    floors = sb_get(env, f"fire_facility_floors?building_id=eq.{buildings[0]['id']}&select=floor_label&order=sort_order") if buildings else []
    zone_rows = build_zone_rows(buildings[0] if buildings else None, floors, owner)
    brigade = sb_get(env, f"fire_brigade_members?customer_id=eq.{cust['id']}&select=team,name,duty,phone&order=sort_order")
    out_hwp, out_odt, out_html = generate_hwp(cust, year, photo, extras=extras, extra_replacements=stage2, zone_rows=zone_rows, brigade=brigade,
                                              preset_pairs=preset_pairs)
    print(f"✅ HWP: {out_hwp}")
    print(f"✅ HTML(미리보기): {out_html}")

    if args.pdf:
        out_pdf = out_hwp[:-4] + ".pdf"
        print(f"PDF 변환 중 ({'로컬 LibreOffice' if SOFFICE else 'VPS Gotenberg'})…")
        convert_pdf(out_odt, out_pdf)
        print(f"✅ PDF: {out_pdf}")

    sdk_app().Application.Finalize()
    print("\n다음: 한글에서 HWP를 열어 빈 칸(명칭·주소 등 양식에 앵커 없는 항목) 보완 후, ERP 보관함에 업로드하세요.")

if __name__ == "__main__":
    main()
