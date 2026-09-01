'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Loader2, Save, ShieldCheck, Layers, Plus, Trash2, X, PanelRightOpen, Maximize2, Minimize2 } from 'lucide-react'
import { saveFacilitiesAction, verifyFacilitiesAction, type FacilityRow, type FloorRow } from '@/app/(dashboard)/customers/facilities-actions'
import { getActiveSpecialInspectionAction } from '@/app/(dashboard)/customers/facility-spec-actions'
// 쓰기 액션은 더 이상 여기서 부르지 않는다 — 입력은 전용 화면 한 곳으로 모았다(소방계획서_28 S4).
// 남은 것은 배지를 그리기 위한 진행률 조회뿐이다.
import { getInspectionSheetOverviewAction } from '@/app/(dashboard)/inspections/sheet-actions'
import { FACILITY_STANDARD, ALL_STANDARD_CODES, EVAC_TYPES, FIRE_SUB_ITEMS } from '@/lib/facility-codes'
import { rollUpForm3Results, sheetMatchesFacilities, type SheetGroupStat } from '@/lib/sheet-facility-map'
import type { SheetOverview } from '@/lib/sheet-overview'
import { PlanForm14Specs, type SpecsSaveResult } from '@/components/customers/plan-form14-specs'
import { NumField, TableWrap } from '@/components/ui/fields'
import { usePlanSaveHandler, useUnsavedNavGuard } from '@/components/ui/unsaved-nav'

/** 서식 1.4 소방시설 현황 — 양식(image-1.png) 재현 입력 화면 (소방계획서_4.md §4)
 *  표 괘선·좌측 분류 세로 병합·셀 전체 클릭 토글·피난기구 하위 8종 연동·항목별 비고(detail.note)·
 *  층별 수량 접기(fire_facility_floors)·시설 확인 완료(verified_at). 저장 = 기존 saveFacilitiesAction. */

type Cell = string | null
type GroupRow = { full?: string; evacSub?: boolean; fireSub?: boolean; pair?: [Cell, Cell] }
const LAYOUT: Array<{ category: string; rows: GroupRow[] }> = [
  { category: '소화설비', rows: [
    { fireSub: true },   // 소화기구 및 자동소화장치 + 하위 5종 (별지 서식 3쪽 원문, image-34)
    { pair: ['옥내소화전설비', '옥외소화전설비'] },
    { pair: ['스프링클러설비', '이산화탄소소화설비'] },
    { pair: ['간이스프링클러설비', '할론소화설비'] },
    { pair: ['화재조기진압용 스프링클러설비', '할로겐화합물 및 불활성기체소화설비'] },
    { pair: ['물분무소화설비', '분말소화설비'] },
    { pair: ['미분무소화설비', '강화액소화설비'] },
    { pair: ['포소화설비', '고체에어로졸소화설비'] },
  ] },
  { category: '경보설비', rows: [
    { pair: ['단독경보형감지기', '통합감시시설'] },
    { pair: ['비상경보설비', '자동화재속보설비'] },
    { pair: ['자동화재탐지설비 및 시각경보기', '누전경보기'] },
    { pair: ['화재알림설비', '가스누설경보기'] },
    { pair: ['비상방송설비', null] },
  ] },
  { category: '피난구조설비', rows: [
    { evacSub: true },
    { pair: ['인명구조기구', '피난유도선'] },
    { pair: ['유도등', '비상조명등'] },
    { pair: ['유도표지', '휴대용비상조명등'] },
  ] },
  { category: '소화용수설비', rows: [{ pair: ['상수도소화용수설비', '소화수조 및 저수조'] }] },
  { category: '소화활동설비', rows: [
    { full: '거실제연설비' },
    { pair: ['부속실 등 제연설비', '비상콘센트설비'] },
    { pair: ['연결송수관설비', '무선통신보조설비'] },
    { pair: ['연결살수설비', '연소방지설비'] },
  ] },
]
const CATEGORY_OF: Record<string, string> = {}
for (const g of LAYOUT) for (const r of g.rows) {
  if (r.full) CATEGORY_OF[r.full] = g.category
  if (r.pair) for (const c of r.pair) if (c) CATEGORY_OF[c] = g.category
}
CATEGORY_OF['피난기구'] = '피난구조설비'
CATEGORY_OF['소화기구 및 자동소화장치'] = '소화설비'
for (const s of FIRE_SUB_ITEMS) CATEGORY_OF[s] = '소화설비'

/** 피난기구 종류의 단일 저장소 경로 — 세부제원 s36_evac.evac_equipment.types (2026-08-08 통일).
 *  아래 하위 체크박스는 fire_facilities가 아니라 이 값을 읽고 쓴다. */
const EVAC_TYPES_PATH = 's36_evac.evac_equipment.types'

const FLOOR_COLS = ['소화기', '차동식', '연기식', '정온식', '유도등', '비상조명']

/** 세부제원 패널 [넓게] 선택 — 기기별 취향이라 DB(profiles)가 아니라 localStorage다.
 *  글자 배율(form_font_scale)과 달리 다른 기기까지 따라갈 이유가 없다. */
const SPEC_WIDE_KEY = 'erp-spec-panel-wide'

type Building = {
  id: string; building_name: string; verified_at: string | null
  facilities: Array<{ facility_code: string; installed: boolean; detail: { note?: string } | null }>
  floors: Array<{ floor_label: string; counts: Record<string, number> }>
  floorsAbove?: number | null; floorsBelow?: number | null
  receiverLocation?: string | null
  emergencyElevatorCount?: number | null   // 세부제원 3-8 비상용승강기의 원천(건물·시설 탭)
}
type FacState = Record<string, { installed: boolean; note: string }>

export function PlanForm14({ customerId, buildings, canManage, canRegister = false, specsByBuilding = {} }: {
  customerId: string; buildings: Building[]; canManage: boolean
  /** 소방계획서_26 S4 — 설비별 점검결과 입력 권한. 1.4의 canManage(customer_manage)와 축이 다르다:
   *  결과 쓰기 액션은 전부 inspection_register라 이 값이 없으면 배지·패널을 아예 그리지 않는다. */
  canRegister?: boolean
  /** H-19 설비 대장 — 건물별 세부 제원 초기값 (customer_facility_specs, '' = 대표/공통 폴백) */
  specsByBuilding?: Record<string, Record<string, Record<string, unknown>>>
}) {
  const [bidx, setBidx] = useState(0)
  const b = buildings[bidx]
  // 피난기구 하위는 더 이상 fire_facilities 코드가 아니다 — 세부제원 types가 단일 저장소(2026-08-08)
  const allCodes = [...FACILITY_STANDARD.flatMap(g => g.items), ...FIRE_SUB_ITEMS]
  const initFac = (bld?: Building): FacState => {
    const map: FacState = {}
    for (const code of allCodes) {
      const ex = bld?.facilities.find(f => f.facility_code === code)
      map[code] = { installed: ex?.installed ?? false, note: ex?.detail?.note ?? '' }
    }
    return map
  }
  const [fac, setFac] = useState<FacState>(() => initFac(b))
  const [floors, setFloors] = useState<FloorRow[]>(
    () => (b?.floors ?? []).map((f, i) => ({ floor_label: f.floor_label, sort_order: i, counts: { ...f.counts } })))
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  // 소방계획서_12 S1 — useTransition 대신 로컬 saving: isPending은 revalidatePath發 RSC 재조회(825줄 페이지)까지
  // 포함해 true로 남아 저장 후에도 수 초간 버튼이 죽는다. 액션 응답 즉시 재활성이 이번 개선의 목적
  const [saving, setSaving] = useState(false)
  // 층별 수량 — 행 확장 편집(소방계획서_9 S4-3). 표는 6열 밀집이라 셀마다 ± 버튼을 넣으면 폭이 깨지므로,
  // 행을 펼쳐 넉넉한 [−][값][+] 스테퍼로 입력한다(표 직접 타이핑도 그대로 병행).
  const [openFloor, setOpenFloor] = useState<number | null>(null)

  // 2026-08-05 사용자 확정: 토글마다 자동 저장 폐지 — 최종 [저장] 1회 + 이탈 가드. 제원 입력은 우측 슬라이드 패널
  const [specsOpen, setSpecsOpen] = useState(false)
  // [넓게] — 패널 폭 2단(900px / 1400px, 둘 다 배율을 곱한다). 실값은 globals.css [data-spec-panel].
  // ⚠ 초기값에서 localStorage를 읽으면 안 된다 — 서버 렌더엔 없어서 하이드레이션이 어긋난다.
  //   첫 렌더는 항상 false로 두고 마운트 뒤 한 번 교정한다(깜빡임은 폭 전환 한 번뿐).
  const [specsWide, setSpecsWide] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem(SPEC_WIDE_KEY) === '1') setSpecsWide(true) } catch { /* 프라이빗 모드 */ }
  }, [])
  // F-1(소방계획서_37) — 자식(세부제원)이 [문서 미리보기 나란히]를 켜면 패널을 자동으로 넓힌다.
  // 기존 erp:open-spec-section과 같은 이벤트 버스 방식(자식→부모라 방향만 반대).
  // ⚠ 켤 때만 넓히고 **끌 때 되돌리지 않는다** — 사용자가 그 사이 [기본 폭]을 골랐을 수 있고,
  //   그걸 뒤집으면 마지막에 누른 사람이 사용자가 아니게 된다. localStorage에도 쓰지 않는다
  //   (취향 설정이 아니라 세션 편의 — 새로고침하면 사용자가 고른 값으로 돌아간다).
  useEffect(() => {
    const onWide = () => setSpecsWide(true)
    window.addEventListener('erp:spec-panel-wide', onWide)
    return () => window.removeEventListener('erp:spec-panel-wide', onWide)
  }, [])
  const toggleSpecsWide = useCallback(() => {
    setSpecsWide(prev => {
      const next = !prev
      try { localStorage.setItem(SPEC_WIDE_KEY, next ? '1' : '0') } catch { /* 프라이빗 모드 */ }
      return next
    })
  }, [])
  // 설비 대장(세부 제원)의 미저장 섹션 수 — 자식(PlanForm14Specs)이 통지 (소방계획서_9·12 U1)
  const [specsDirtyCount, setSpecsDirtyCount] = useState(0)
  const specsDirty = specsDirtyCount > 0
  // S1(소방계획서_12) — 저장 응답의 확인일을 로컬 반영 (router.refresh 제거). 서버 초기값은 b.verified_at
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null)
  // U3 — 자식(설비 대장)의 [모두 저장]을 통합 [저장]에서 await 하기 위한 등록 지점
  const specsSaveRef = useRef<(() => Promise<SpecsSaveResult>) | null>(null)
  const registerSpecsSave = useCallback((fn: () => Promise<SpecsSaveResult>) => { specsSaveRef.current = fn }, [])
  // 대장 쪽 미러 토글을 자식의 dirty에 반영하기 위한 등록 지점 (저장 누락 방지)
  const specsMarkDirtyRef = useRef<((sectionKey: string) => void) | null>(null)
  const registerSpecsMarkDirty = useCallback((fn: (sectionKey: string) => void) => { specsMarkDirtyRef.current = fn }, [])

  // ── 소방계획서_26 S4 — 설비별 점검결과(○×／) 입력 ──────────────────────────
  // 결과의 단일 원천은 점검표 응답(회차 단위)이다. 여기는 그 시트의 항목들을 쓰는 **단축 입력기**로,
  // 별도 저장소를 만들지 않는다(3쪽 ×인데 불량내역 0건 같은 모순 문서 방지 — 26.md Q-1·C안 기각).
  const [resultCtx, setResultCtx] = useState<{ inspection: { id: string; label: string } | null; reason?: string } | null>(null)
  const [overview, setOverview] = useState<SheetOverview | null>(null)
  const resultFetched = useRef(false)

  useEffect(() => {
    if (!canRegister || resultFetched.current) return
    resultFetched.current = true
    // 실패(권한·네트워크)는 조용히 생략 — 배지는 보조 정보고 1.4 본연의 입력은 그대로 동작해야 한다
    getActiveSpecialInspectionAction(customerId)
      .then(async ctx => {
        setResultCtx(ctx)
        if (!ctx.inspection) return
        const ov = await getInspectionSheetOverviewAction([ctx.inspection.id], { withGroups: true })
        const o = ov.overviews?.[ctx.inspection.id]
        if (o) setOverview(o)
      })
      .catch(() => {})
  }, [canRegister, customerId])

  // 마크 판정 — 별지 3쪽·세부제원 배지와 **같은 함수**(rollUpForm3Results). 설치 여부는 화면의
  // 현재 체크 상태를 넘긴다(방금 켠 미저장 설비가 ／로 보이면 거짓말 — plan-form14-specs와 같은 이유).
  const resultMarks = useMemo(() => {
    if (!overview) return {} as Record<string, 'O' | 'X' | 'N'>
    // 중분류(groups)가 오면 그 단위로 접는다 — 한 점검표가 설비 여럿을 덮을 때 시트 단위로 접으면
    // 형제 설비 배지까지 같은 마크가 칠해져 **문서와 갈라진다**(2026-09-01 유도등 사고).
    // groups는 withGroups=true에서만 온다. 안 오면 종전대로 시트 단위(group: null) — 폴백은 옛 동작.
    const stats: SheetGroupStat[] = overview.sheets
      .filter(s => s.responded > 0)
      .flatMap<SheetGroupStat>(s => s.groups
        ? s.groups.filter(g => g.responded > 0).map(g => ({
          sheet: s.sheetName, group: g.groupCode,
          stat: { any: true, x: g.x > 0, o: g.o > 0 },
        }))
        : [{ sheet: s.sheetName, group: null, stat: { any: true, x: s.counts.X > 0, o: s.counts.O > 0 } }])
    const installedNow = ALL_STANDARD_CODES.filter(c => fac[c]?.installed)
    return rollUpForm3Results(stats, ALL_STANDARD_CODES, installedNow).resultMarks
  }, [overview, fac])

  const canInputResult = canRegister && !!resultCtx?.inspection && (overview?.canEdit ?? false)

  async function refreshResults(reloadItems: boolean) {
    const inspId = resultCtx?.inspection?.id
    if (!inspId) return
    const ov = await getInspectionSheetOverviewAction([inspId], { withGroups: true })
    const o = ov.overviews?.[inspId]
    if (o) setOverview(o)
  }




  /** 설치 행의 결과 배지 — ○(녹)/×(적)/／(회)/미입력(호박). 클릭 = **전용 입력 화면의 그 설비로 이동**.
   *  진행 중 회차가 없으면(입력 불가) 배지를 그리지 않는다 — 이유는 표 위 안내줄이 말한다.
   *
   *  소방계획서_28 S4 — 종전엔 여기서 패널을 열어 직접 입력했다(26 S4). 같은 데이터를 입력하는 곳이
   *  넷이 되면서 저장 규칙이 화면마다 갈렸고("즉시 기록 — 아래 [저장]과 무관"이라는 안내문이
   *  그 증거였다), 정작 어디서 채우는지는 아무도 몰랐다. 배지는 **결과를 보여주는 일**만 하고
   *  입력은 정본 화면으로 보낸다.
   *
   *  ⚠ `?facility=` 로 보낸다 — 설비→시트 매핑(sheetMatchesFacilities)을 링크 생성부에서 다시 하면
   *     규칙이 두 벌이 된다. 해석은 전용 페이지가 서버에서 한 번만 한다.
   *  `?from=` — 입력 화면의 뒤로가기가 이 서식(1.4)으로 돌아오게 한다. 현재 URL 캡처가 아니라
   *     정적 딥링크다: 배지는 항상 ?tab=plan&form=1.4 화면에만 그려지므로 목적지가 결정적이다. */
  const resultBadge = (code: string) => {
    if (!fac[code]?.installed || !canInputResult) return null
    const mk = resultMarks[code]
    const lbl = mk === 'O' ? '○' : mk === 'X' ? '×' : mk === 'N' ? '／' : '미입력'
    const cls = mk === 'O' ? 'text-green-600 border-green-300 bg-green-50'
      : mk === 'X' ? 'text-red-600 border-red-300 bg-red-50'
      : mk === 'N' ? 'text-ink-soft border-brand-line bg-brand-tint'
      : 'text-amber-700 border-amber-300 bg-amber-50'
    const from = encodeURIComponent(`/customers/${customerId}?tab=plan&form=1.4`)
    return (
      <Link href={`/inspections/${resultCtx!.inspection!.id}/sheet?facility=${encodeURIComponent(code)}&from=${from}`}
        onClick={e => e.stopPropagation()}
        data-testid={`form14-result-link-${code}`}
        title={`점검결과 — ${resultCtx?.inspection?.label} (클릭하면 점검표 입력 화면이 열립니다)`}
        className={`ml-auto shrink-0 h-5 min-w-7 px-1.5 rounded-full border text-form-2xs font-bold inline-flex items-center justify-center ${cls}`}>
        {lbl}
      </Link>
    )
  }

  // 피난기구 종류 — 저장소는 세부제원 한 곳이지만 **1.4 하위 체크박스와 세부제원 화면이 함께 쓴다**.
  // 두 화면이 같은 값을 보도록 부모가 상태를 들고 양쪽에 내려준다(2026-08-08 중복 입력 제거).
  const initMirror = (bid?: string): Record<string, string[]> => {
    const sec = (specsByBuilding[bid ?? ''] ?? specsByBuilding[''] ?? {}) as Record<string, unknown>
    const raw = ((sec['s36_evac'] as Record<string, unknown> | undefined)?.['evac_equipment'] as
      Record<string, unknown> | undefined)?.['types']
    return { [EVAC_TYPES_PATH]: Array.isArray(raw) ? raw.map(String) : [] }
  }
  const [mirror, setMirror] = useState<Record<string, string[]>>(() => initMirror(b?.id))
  const onMirrorChange = useCallback((path: string, next: string[]) => {
    setMirror(p => ({ ...p, [path]: next }))
  }, [])
  const evacTypes = mirror[EVAC_TYPES_PATH] ?? []
  // 세부제원의 건물 파생 필드 원천 (3-8 비상용승강기) — 매 렌더 새 객체면 자식 useMemo가 헛돈다
  const buildingRow = useMemo(
    () => ({ emergency_elevator_count: b?.emergencyElevatorCount ?? null }), [b?.emergencyElevatorCount])
  /** 하위 종류 토글 — fire_facilities가 아니라 세부제원 types를 갱신하고, 부모 '피난기구'는 자동 체크 */
  function toggleEvacType(t: string) {
    if (!canManage) return
    const on = evacTypes.includes(t)
    onMirrorChange(EVAC_TYPES_PATH, on ? evacTypes.filter(x => x !== t) : [...evacTypes, t])
    // 저장 대상은 자식이 dirty 섹션 기준으로 고른다 — 여기서 표시하지 않으면 저장에서 누락된다
    specsMarkDirtyRef.current?.(EVAC_TYPES_PATH.split('.')[0])
    if (!on && !fac['피난기구'].installed) {
      setFac(p => ({ ...p, '피난기구': { ...p['피난기구'], installed: true } }))
      markDirty()
    }
  }
  function markDirty() { setDirty(true) }
  function clearDirty() { setDirty(false) }
  /** 층별 수량 1칸 갱신 — 표 셀 입력과 확장 스테퍼 공용 (빈 값은 0으로 저장, 기존 규약 유지) */
  function setFloorCount(rowIdx: number, col: string, raw: string) {
    const n = parseInt(raw, 10)
    setFloors(p => p.map((x, j) => j === rowIdx ? { ...x, counts: { ...x.counts, [col]: isNaN(n) ? 0 : n } } : x))
    markDirty()
  }
  // 서식 트리 이동 가드(PlanTabView select 확인창) 공유 — 1.4·설비 대장 미저장의 합집합을 단일 지점에서 통지
  // (개별 dispatch는 1.4 저장이 설비 대장 미저장 상태를 덮어쓰는 문제가 있어 union으로 통합, 소방계획서_9)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('erp:plan-dirty', { detail: dirty || specsDirty }))
  }, [dirty, specsDirty])
  // 이동 확인창의 [저장하고 이동] — 통합 save()(본문+제원)를 그대로 재사용
  usePlanSaveHandler(save, canManage && (dirty || specsDirty))
  // 미저장 상태 새로고침·창 닫기 가드
  useEffect(() => {
    if (!dirty && !specsDirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty, specsDirty])
  // 별지 9호發 진입(?from=report9)은 설비 대장 패널 자동 오픈 (D-17 흐름 유지)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('from') !== 'report9') return
    const t = setTimeout(() => setSpecsOpen(true), 0)
    return () => clearTimeout(t)
  }, [])
  // 패널 Esc 닫기
  useEffect(() => {
    if (!specsOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSpecsOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [specsOpen])

  // 설비 대장은 key 리마운트로 초기화되므로 미저장 편집이 조용히 유실됨 — 전환 전 확인 (소방계획서_9)
  const buildingNav = useUnsavedNavGuard<number>({
    onProceed: applySwitchBuilding,
    message: '지금 건물을 전환하면 1.4 본문·설비 대장의 저장하지 않은 입력이 사라집니다.',
    saveLabel: '저장하고 전환',
    discardLabel: '저장하지 않고 전환',
  })
  function switchBuilding(i: number) {
    if (dirty || specsDirty) { buildingNav.request(i); return }
    applySwitchBuilding(i)
  }
  function applySwitchBuilding(i: number) {
    setBidx(i)
    setFac(initFac(buildings[i]))
    setMirror(initMirror(buildings[i]?.id))   // 피난기구 종류도 건물 축 — 이전 건물 값이 남으면 안 된다
    setFloors((buildings[i]?.floors ?? []).map((f, j) => ({ floor_label: f.floor_label, sort_order: j, counts: { ...f.counts } })))
    setOpenFloor(null)   // 행 목록이 통째로 교체됨 — 인덱스 기준 펼침 상태는 초기화
    clearDirty()
    setSpecsDirtyCount(0)
    setVerifiedAt(null)  // S1-4 — 이전 건물의 확인일이 새 건물 푸터에 잔류하면 안 됨
    // 소방계획서_28 — 결과 입력 패널이 사라져(전용 화면으로 이관) 건물 전환 시 닫을 것이 없다.
    // overview는 건드리지 않는다 — 점검표 응답은 회차(고객) 축이라 건물이 바뀌어도 그대로 유효하다.
  }
  function toggle(code: string) {
    if (!canManage) return
    const turningOn = !fac[code].installed
    // 피난기구 부모 해제 → 하위 종류도 비운다. 소화기구는 이미 부모 해제 시 하위를 내리는데(아래)
    // 피난기구만 빠져 있어, 부모 ☐ + 하위 √로 남으면 별지 3쪽에 '부모 빈칸 + 하위 √'가 인쇄됐다
    // (소방계획서_12 K-2에서 지적된 모양). 하위 저장소가 fire_facilities가 아니라 세부제원이라
    // 같은 자리에서 못 지웠던 것 — 여기서 미러 경로로 지운다.
    // ⚠ 세부제원 삭제라 되돌릴 수 없다. 값이 있을 때만 확인을 받고, 취소하면 해제 자체를 접는다.
    if (code === '피난기구' && !turningOn && evacTypes.length > 0) {
      const ok = window.confirm(
        `피난기구를 해제하면 입력한 종류 ${evacTypes.length}개(${evacTypes.join(', ')})가 함께 지워집니다.\n\n`
        + '해제할까요?',
      )
      if (!ok) return
      onMirrorChange(EVAC_TYPES_PATH, [])
      specsMarkDirtyRef.current?.(EVAC_TYPES_PATH.split('.')[0])
    }
    setFac(p => {
      const on = !p[code].installed
      const next = { ...p, [code]: { ...p[code], installed: on } }
      if (code === '소화기구 및 자동소화장치' && !on) {
        for (const s of FIRE_SUB_ITEMS) next[s] = { ...next[s], installed: false } // 부모 해제 → 하위 해제
      }
      if (FIRE_SUB_ITEMS.includes(code) && on) {
        next['소화기구 및 자동소화장치'] = { ...next['소화기구 및 자동소화장치'], installed: true } // 하위 체크 → 부모 자동 체크
      }
      return next
    })
    markDirty()
    // 체크(√) 순간 우측 설비 대장 패널 오픈 + 해당 섹션 펼침 (2026-08-05: 본문 스크롤 대신 옆 패널 — 화면이 밀리지 않음)
    if (turningOn) openLedger(code)
  }
  /** 설비 대장 패널 열기 + 해당 섹션 펼침 — **설치 체크는 건드리지 않는다**.
   *
   *  종전엔 이 동작이 toggle()의 부수효과였고 조건이 `if (turningOn)`이라, 이미 체크된 설비의
   *  대장을 보려면 클릭할 곳이 체크 셀뿐인데 그 클릭이 곧 '해제'로 해석됐다 — 의도를 표현할
   *  입력 수단 자체가 없었다(피난기구는 해제가 세부제원 종류까지 지우므로 오클릭이 파괴적이다).
   *  이제 설비명 클릭이 이 함수를 직접 부른다. 패널은 항상 마운트돼 있고 erp:open-spec-section을
   *  듣고 있으므로(아래 슬라이드 패널) 새 배선은 없다. */
  function openLedger(code: string) {
    const specCode = FIRE_SUB_ITEMS.includes(code) ? '소화기구 및 자동소화장치' : code
    setSpecsOpen(true)
    setTimeout(() => window.dispatchEvent(new CustomEvent('erp:open-spec-section', { detail: { code: specCode } })), 120)
  }
  function autoFloors() {
    const fa = b?.floorsAbove ?? 0
    const fb = b?.floorsBelow ?? 0
    if (fa + fb === 0) { setMsg('⚠ 건물 층수가 없습니다 — 건물·시설 탭에서 층수를 먼저 입력해주세요.'); return }
    const rows: FloorRow[] = []
    for (let i = fb; i >= 1; i--) rows.push({ floor_label: `지하${i}층`, sort_order: rows.length, counts: {} })
    for (let i = 1; i <= fa; i++) rows.push({ floor_label: `${i}층`, sort_order: rows.length, counts: {} })
    setFloors(rows)
    setOpenFloor(null)   // 행 목록 재생성 — 인덱스 기준 펼침 상태는 초기화
    markDirty()
  }
  /** 통합 [저장] (소방계획서_12 U3) — 본문(설비·층별)과 제원(설비 대장)을 한 번에, dirty인 쪽만 호출.
   *  두 액션은 서로 독립이라 Promise.all 동시 실행. 실패한 쪽은 dirty가 유지돼 재클릭 = 재시도 (U3-6) */
  async function save(): Promise<boolean> {
    if (!canManage || (!dirty && !specsDirty) || saving) return false
    setSaving(true)
    setMsg('')   // 직전 저장 결과가 새 저장 중에 남아 있으면 완료로 오인된다 (E2E 스테일 매칭 포함)
    try {
      const rows: FacilityRow[] = allCodes.map(code => ({
        category: CATEGORY_OF[code] ?? '기타', facility_code: code,
        installed: fac[code].installed, detail: fac[code].note || null,
      }))
      const [mainRes, specsRes] = await Promise.all([
        dirty ? saveFacilitiesAction(b.id, customerId, rows, floors) : Promise.resolve(null),
        specsDirty && specsSaveRef.current ? specsSaveRef.current() : Promise.resolve(null),
      ])
      const parts: string[] = []
      let ok = true
      if (mainRes) {
        if (mainRes.error) { ok = false; parts.push(`본문 저장 실패: ${mainRes.error}`) }
        else {
          clearDirty()
          if (mainRes.verifiedAt) setVerifiedAt(mainRes.verifiedAt)  // S1 — refresh 없이 푸터 확인일 갱신
          parts.push('본문 저장됨')
        }
      }
      if (specsRes) {
        if (specsRes.saved > 0) parts.push(`제원 ${specsRes.saved}개 섹션 저장됨`)
        if (specsRes.failedLabels.length > 0) { ok = false; parts.push(`제원 저장 실패: ${specsRes.failedLabels.join(', ')}`) }
      }
      setMsg(`${ok ? '✅' : '❌'} ${parts.join(' · ')}${ok ? ' — 계획서·별지 4·9호 출력에 반영됩니다' : ''}`)
      return ok
    } catch {
      setMsg('❌ 저장 중 오류가 발생했습니다 — 잠시 후 다시 시도해주세요')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function verifyOnly() {
    if (saving) return
    setSaving(true)
    try {
      const res = await verifyFacilitiesAction(b.id, customerId)
      setMsg(res.error ? `❌ ${res.error}` : '✅ 시설 확인 완료로 기록됨')
      if (!res.error && res.verifiedAt) setVerifiedAt(res.verifiedAt)  // S1 — refresh 없이 로컬 반영
    } finally {
      setSaving(false)
    }
  }
  // U2 — Ctrl/⌘+S 저장 단축키. preventDefault는 항상(브라우저 저장 대화상자 차단), 저장할 것 없으면 무동작.
  // save는 렌더마다 새로 정의되므로 ref로 최신 클로저를 호출 (stale fac·floors 방지)
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!b) {
    return <p className="text-form-base text-ink-sub py-6 text-center">등록된 활성 건물이 없습니다 — 건물·시설 탭에서 먼저 등록해주세요.</p>
  }

  const installedCount = allCodes.filter(c => fac[c].installed).length
  const evacOn = fac['피난기구'].installed
  // S1-3 — 저장 응답의 확인일이 있으면 우선, 없으면 서버 초기값
  const shownVerifiedAt = verifiedAt ?? b.verified_at

  /** ☑/☐ 만 토글하는 버튼 — 2026-08-26 사용자 확정으로 '셀 전체 = 토글'이 여기로 좁아졌다.
   *  표적이 좁아진 만큼 **히트박스를 글리프보다 넉넉히**(w-7 h-form-7) 잡는다. 좁은 채로 두면
   *  빗맞은 클릭이 설비명(=대장 열기)으로 떨어져 패널이 본문을 덮고, 그 편이 종전보다 나쁘다. */
  const checkBox = (code: string, disabled = false) => (
    <button type="button" aria-disabled={disabled} aria-pressed={fac[code].installed}
      aria-label={`${code} 설치 체크`} data-testid={`form14-check-${code}`}
      onClick={() => !disabled && toggle(code)}
      title={disabled ? undefined : `${code} 설치 여부를 체크합니다`}
      className={`shrink-0 inline-flex items-center justify-center w-7 h-form-7 rounded ${
        disabled ? 'cursor-not-allowed text-ink-faint' : 'cursor-pointer hover:bg-brand-tint'}`}>
      <span className="text-form-base leading-none">{fac[code].installed ? '☑' : '☐'}</span>
    </button>
  )
  /** 설비명 = 설비 대장 열기. **체크 상태는 바뀌지 않는다** — 종전에 이 자리를 누르면 해제됐다.
   *  점선 밑줄로 '누를 수 있는 이름'임을 알린다(hover가 없는 태블릿에서도 밑줄은 보인다). */
  const ledgerLabel = (code: string, disabled = false) => (
    <button type="button" aria-disabled={disabled} data-testid={`form14-ledger-${code}`}
      onClick={() => !disabled && openLedger(code)}
      title={disabled ? undefined : `${code} — 설비 대장에서 세부 제원을 봅니다 (설치 체크는 바뀌지 않습니다)`}
      className={`min-w-0 truncate text-left text-form-sm ${
        disabled ? 'cursor-not-allowed text-ink-faint'
          : `cursor-pointer underline decoration-dotted decoration-line underline-offset-2 hover:decoration-brand ${
            fac[code].installed ? 'font-bold text-ink' : 'text-ink-sub'}`}`}>
      {code}
    </button>
  )

  /** 체크 셀 — 2026-08-26 사용자 확정: **☑는 토글 / 설비명은 대장 열기**로 클릭 의미를 분리.
   *  (종전 2026-08-04 확정은 '셀 전체 클릭=√ 토글'이었으나, 그러면 이미 체크된 설비의 대장을
   *   여는 방법이 없어 사용자가 체크를 해제해야만 했다.) 편집(✎) 아이콘은 여전히 없다.
   *  비고 값이 기존에 있으면 표시만 유지(입력·수정은 폐지 — 상세 제원은 설비 대장에서).
   *  ⚠ resultBadge는 <Link>다 — 버튼 안에 넣으면 중첩 인터랙티브가 되므로 형제로 둔다. */
  const cell = (code: Cell, opts?: { sub?: boolean }) => {
    if (!code) return <td className="border border-line" />
    const st = fac[code]
    const disabled = !!(opts?.sub && !evacOn && !st.installed)
    return (
      <td className={`border border-line p-0 ${disabled ? 'bg-paper' : ''}`}>
        <div className="flex items-center gap-1 pl-0.5 pr-2 py-1 min-h-7 select-none">
          {checkBox(code, disabled)}
          {ledgerLabel(code, disabled)}
          {st.note && <span className="text-form-2xs text-amber-600 truncate max-w-24" title={st.note}>({st.note})</span>}
          {resultBadge(code)}
        </div>
      </td>
    )
  }

  return (
    <div className="space-y-3">
      {buildingNav.dialog}
      {/* 타이틀 + 대상명 (양식 비고 2 — 대상물별 세트) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-form-sm font-semibold text-ink">서식 1.4 소방시설 현황</span>
        {/* 안내문이 조작 규약의 단일 설명이다 — 클릭 의미를 분리했으면 여기도 같이 바꿔야 한다
            (종전 '해당되는 곳을 클릭해 √' 문구는 이제 설비명 클릭과 모순된다) */}
        <span className="text-form-xs text-ink-meta">※ ☑ 를 클릭해 √ 표시 · <span className="underline decoration-dotted underline-offset-2">설비명</span>을 클릭하면 설비 대장이 열립니다(체크 유지)</span>
        {/* 소방계획서_26 S4 — 결과 배지의 회차 축 안내. 진행 중 회차가 없으면 왜 배지가 없는지 여기서 말한다 */}
        {canRegister && resultCtx && (resultCtx.inspection
          ? <span className="text-form-2xs text-brand">점검결과(○×／)는 {resultCtx.inspection.label}에 기록됩니다</span>
          : <span className="text-form-2xs text-ink-meta" title={resultCtx.reason}>점검결과 입력 불가 — {resultCtx.reason}</span>)}
        {buildings.length > 1 && (
          <select value={bidx} onChange={e => switchBuilding(parseInt(e.target.value, 10))}
            className="ml-auto h-form-7 rounded-lg border border-brand-line bg-surface px-2 text-form-sm outline-none">
            {buildings.map((bb, i) => <option key={bb.id} value={i}>{bb.building_name}</option>)}
          </select>
        )}
        {buildings.length === 1 && <span className="ml-auto text-form-sm text-ink-sub">대상명: {b.building_name}</span>}
      </div>

      {/* 양식 재현 표 — 좌측 분류 세로 병합 */}
      <table className="w-full border-collapse">
        <tbody>
          {LAYOUT.map(g => g.rows.map((r, ri) => (
            <tr key={`${g.category}-${ri}`}>
              {/* 분류 열(‘소 화 설 비’)은 글자와 함께 넓어져야 한다 (소방계획서_35 S2-6).
                  48px에 11px로도 이미 감겨 있어(52px 필요) 확대하면 더 감긴다 —
                  auto layout이라 넘치진 않지만 행 높이가 계속 자란다. */}
              {ri === 0 && (
                <th rowSpan={g.rows.length} className="border border-line bg-brand-tint w-[calc(var(--fs-col-cat)*var(--fs-scale))] px-1 text-form-xs font-semibold text-ink-sub">
                  {g.category.replace('설비', '').split('').join(' ')}<br />설 비
                </th>
              )}
              {r.full && cell(r.full)}
              {r.full && <td className="border border-line" />}
              {r.fireSub && (
                <td colSpan={2} className="border border-line p-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1">
                    {/* 부모 행도 셀과 같은 규약 — ☑는 토글, 이름은 대장 열기 (한 곳만 고치면 이웃에서 같은 사고가 난다) */}
                    <div className="flex items-center gap-1 select-none">
                      {checkBox('소화기구 및 자동소화장치')}
                      {ledgerLabel('소화기구 및 자동소화장치')}
                      {resultBadge('소화기구 및 자동소화장치')}
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 pl-2 border-l border-brand-line-soft">
                      {FIRE_SUB_ITEMS.map(sname => {
                        const on = fac[sname].installed
                        const dim = !fac['소화기구 및 자동소화장치'].installed && !on
                        return (
                          <button key={sname} onClick={() => canManage && toggle(sname)} disabled={!canManage}
                            className={`inline-flex items-center gap-1 text-form-xs ${
                              on ? 'font-bold text-ink' : dim ? 'text-ink-meta hover:text-brand' : 'text-ink-sub hover:text-brand'}`}>
                            <span>{on ? '☑' : '☐'}</span>{sname}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </td>
              )}
              {r.evacSub && (
                <td colSpan={2} className="border border-line p-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1">
                    {/* 피난기구는 해제가 세부제원 종류까지 지운다(toggle 참조) — 이름 클릭이 해제로
                        해석되던 종전 구조에서 특히 위험했다. 여기서도 ☑만 토글한다. */}
                    <div className="flex items-center gap-1 select-none">
                      {checkBox('피난기구')}
                      {ledgerLabel('피난기구')}
                      {resultBadge('피난기구')}
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 pl-2 border-l border-brand-line-soft">
                      {/* 통합 어휘 11종 — 저장소는 세부제원 s36_evac.evac_equipment.types 하나다.
                          여기서 체크하면 그 값이 바뀌고, 세부제원 화면의 '종류'에도 즉시 같은 상태가 보인다. */}
                      {EVAC_TYPES.map(sname => {
                        const on = evacTypes.includes(sname)
                        // 피난기구 미체크 시 흐림 표시 — 클릭하면 피난기구가 자동 체크됨 (§4-2)
                        const dim = !evacOn && !on
                        return (
                          <button key={sname} onClick={() => toggleEvacType(sname)} disabled={!canManage}
                            title="세부제원 3-6 피난기구 '종류'와 같은 값입니다"
                            className={`inline-flex items-center gap-1 text-form-xs ${
                              on ? 'font-bold text-ink' : dim ? 'text-ink-meta hover:text-brand' : 'text-ink-sub hover:text-brand'}`}>
                            <span>{on ? '☑' : '☐'}</span>{sname}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </td>
              )}
              {r.pair && cell(r.pair[0])}
              {r.pair && cell(r.pair[1])}
            </tr>
          )))}
        </tbody>
      </table>
      <p className="text-form-2xs text-ink-meta">※ 비고 1. 설치장소·규격 등은 자체점검표 참조 2. 건물군은 대상명을 바꿔 대상물별로 작성</p>

      {/* 소방계획서_28 S4 — 결과 입력 패널은 전용 화면(/inspections/{id}/sheet)으로 옮겼다.
          여기서 직접 입력하던 종전 구조(26 S4)는 "즉시 기록 — 아래 [저장]과 무관"이라는 안내문으로
          저장 규칙 차이를 메워야 했고, 정작 어느 화면에서 채우는지는 알려주지 못했다.
          배지는 결과를 보여주고 그 자리로 보내는 일만 한다(resultBadge). */}

      {/* 층별 수량 접기 (fire_facility_floors) */}
      <details className="rounded-xl border border-brand-line-soft bg-brand-tint px-4 py-2">
        <summary className="text-form-sm font-semibold text-ink-sub cursor-pointer">층별 수량 입력 (소화기·감지기·유도등 등)</summary>
        <div className="mt-2">
          {canManage && (
            <div className="flex items-center gap-2 mb-2">
              <button onClick={autoFloors} className="inline-flex items-center gap-1 h-form-7 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint">
                <Layers className="size-3" /> 층 자동 생성
              </button>
              <button onClick={() => { setFloors(p => [...p, { floor_label: '', sort_order: p.length, counts: {} }]); markDirty() }}
                className="inline-flex items-center gap-1 h-form-7 px-2 rounded-lg border border-brand-line text-form-xs text-ink-sub hover:bg-brand-tint">
                <Plus className="size-3" /> 행 추가
              </button>
            </div>
          )}
          {/* ⚠ TableWrap 필수 (소방계획서_35 W-2). 이 표는 table-fixed가 아닌 auto layout에
              열 수가 FLOOR_COLS만큼 늘어나는데 가로 스크롤 래퍼가 없었다 — 글자를 12→14px로
              올리면 헤더가 넓어져 표가 컨테이너를 밀고 **페이지 전체에 가로 스크롤**이 생긴다. */}
          {floors.length > 0 && (
            <TableWrap>
            <table className="w-full text-form-sm">
              <thead>
                <tr className="text-left text-form-xs text-ink-sub border-b border-brand-line-soft">
                  <th className="pb-1 pr-1 w-24 font-medium">층</th>
                  {FLOOR_COLS.map(c => <th key={c} className="pb-1 pr-1 font-medium">{c}</th>)}
                  <th className="pb-1 w-7" />
                </tr>
              </thead>
              <tbody>
                {floors.map((fl, i) => {
                  const open = openFloor === i
                  const rowName = fl.floor_label.trim() || `${i + 1}번째 행`
                  return (
                  <Fragment key={i}>
                  <tr>
                    <td className="py-0.5 pr-1">
                      <span className="flex items-center gap-0.5">
                        <button type="button" onClick={() => setOpenFloor(open ? null : i)}
                          aria-label={`${rowName} 수량 ${open ? '접기' : '펼쳐서 ± 입력'}`} aria-expanded={open}
                          title="펼쳐서 ± 버튼으로 입력"
                          className="shrink-0 text-ink-meta hover:text-brand">
                          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        </button>
                        <input value={fl.floor_label} disabled={!canManage}
                          onChange={e => { setFloors(p => p.map((x, j) => j === i ? { ...x, floor_label: e.target.value } : x)); markDirty() }}
                          className="h-form-6 w-full min-w-0 rounded border border-brand-line bg-surface px-1 text-form-sm outline-none" />
                      </span>
                    </td>
                    {FLOOR_COLS.map(c => (
                      <td key={c} className="py-0.5 pr-1">
                        <input value={fl.counts[c] || ''} disabled={!canManage} inputMode="numeric"
                          onChange={e => setFloorCount(i, c, e.target.value)}
                          className="h-form-6 w-full rounded border border-brand-line bg-surface px-1 text-form-sm outline-none" />
                      </td>
                    ))}
                    <td className="py-0.5">
                      {canManage && (
                        <button onClick={() => {
                          setFloors(p => p.filter((_, j) => j !== i))
                          setOpenFloor(null)   // 인덱스 기준이라 삭제 후 잔류하면 다른 행이 열림
                          markDirty()
                        }}
                          className="text-ink-meta hover:text-red-500" aria-label="층 삭제">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {/* 행 확장 편집 (S4-3) — 6열 표 폭을 건드리지 않고 넉넉한 ± 스테퍼 제공 */}
                  {open && (
                    <tr>
                      <td colSpan={FLOOR_COLS.length + 2} className="pb-2">
                        <div className="rounded-lg border border-brand-line-soft bg-brand-tint p-2.5">
                          <p className="mb-1.5 text-form-xs font-medium text-ink-sub">
                            {rowName} 수량
                            <span className="ml-1 font-normal text-ink-meta">— ± 버튼으로 입력합니다 (위 표에 직접 입력해도 됩니다)</span>
                          </p>
                          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                            {FLOOR_COLS.map(c => (
                              <div key={c} className="flex items-center gap-1.5">
                                <span className="w-14 shrink-0 text-form-xs text-ink-sub">{c}</span>
                                <NumField value={fl.counts[c] ? String(fl.counts[c]) : ''} disabled={!canManage}
                                  unit="개" className="w-12"
                                  onChange={v => setFloorCount(i, c, v)} />
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
            </TableWrap>
          )}
        </div>
      </details>

      {/* 푸터 — 설치 요약·미저장 배지(U1)·확인 완료·통합 저장(U3) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-form-xs text-ink-sub">설치 {installedCount}종{shownVerifiedAt ? ` · 마지막 확인 ${shownVerifiedAt.slice(5)}` : ''}</span>
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            {dirty || specsDirty ? (
              <span data-testid="form14-dirty-badge" className="text-form-xs font-medium text-amber-600">
                ● 미저장 · {[dirty ? '본문' : null, specsDirty ? `제원 ${specsDirtyCount}섹션` : null].filter(Boolean).join(' · ')}
              </span>
            ) : (
              <span data-testid="form14-clean-badge" className="text-form-xs text-ink-meta">변경 없음</span>
            )}
            <button onClick={() => setSpecsOpen(true)}
              className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint">
              <PanelRightOpen className="size-3.5" /> 설비 대장
            </button>
            <button onClick={() => { void verifyOnly() }} disabled={saving}
              className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg border border-brand-line text-form-sm text-ink-sub hover:bg-brand-tint disabled:opacity-50">
              <ShieldCheck className="size-3.5" /> 시설 확인 완료
            </button>
            <button data-testid="form14-save" onClick={() => { void save() }} disabled={!(dirty || specsDirty) || saving}
              title="본문(설비·층별)과 설비 대장 제원을 한 번에 저장합니다 (Ctrl+S)"
              className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg bg-brand text-white text-form-sm font-medium disabled:opacity-50">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 저장
            </button>
          </div>
        )}
      </div>
      {msg && <p className="text-form-sm text-ink-sub">{msg}</p>}

      {/* H-19 설비 대장 — 우측 슬라이드 패널 (2026-08-05 사용자 확정: 본문 하단 인라인 → 옆 패널, 체크해도 화면이 밀리지 않음).
          항상 마운트 — erp:open-spec-section 수신·입력 상태 유지, 닫힘은 CSS 슬라이드. 건물 축은 대상명 선택(bidx)과 동일(key 재적재) */}
      <div className={`fixed inset-0 z-40 ${specsOpen ? '' : 'pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-black/20 dark:bg-black/60 transition-opacity ${specsOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setSpecsOpen(false)} />
        {/* ⚠ 패널 폭도 배율을 탄다 (소방계획서_35 S6-7). 폭에서 p-4를 빼면 실가용이 32px 줄어드는데
            세부제원 표의 숫자열이 배율과 함께 넓어지므로, 폭이 고정이면 xl에서 표가 패널을
            넘겨 가로 스크롤이 생긴다. 그래서 실값(--fs-panel-w)에 --fs-scale을 곱한다.
            data-fs-boost가 이 요소의 --fs-scale을 ×1.15 해 두므로 **글자와 폭이 같은 수로 커진다**.
            2026-08-30: 기본 640→900px + [넓게] 1400px(data-wide). 실값 3개는 전부 globals.css에 있다.
            96vw 상한은 유지 — 좁은 화면에서 화면을 통째로 덮으면 뒤 본문 맥락이 사라진다. */}
        <div data-spec-panel data-fs-boost {...(specsWide ? { 'data-wide': '' } : {})}
          className={`absolute top-0 right-0 bottom-0 w-[min(96vw,calc(var(--fs-panel-w)*var(--fs-scale)))] bg-surface shadow-2xl flex flex-col transition-[transform,width] duration-200 ${specsOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-brand-line-soft shrink-0">
            <p className="text-form-base font-semibold text-ink shrink-0">설비 대장 — 세부 제원</p>
            <span className="text-form-2xs text-ink-meta truncate">체크(√)한 설비의 섹션이 자동으로 펼쳐집니다</span>
            <button type="button" onClick={toggleSpecsWide} data-testid="specs-wide-toggle" aria-pressed={specsWide}
              title={specsWide ? '기본 폭으로 — 뒤 본문이 보입니다' : '넓게 — 표가 빽빽할 때. 선택은 이 브라우저에 기억됩니다'}
              className="ml-auto shrink-0 inline-flex items-center gap-1 h-form-6 px-2 rounded-lg border border-brand-line text-form-2xs font-medium text-ink-sub hover:bg-brand-tint transition-colors">
              {specsWide ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
              {specsWide ? '기본 폭' : '넓게'}
            </button>
            <button onClick={() => setSpecsOpen(false)} className="shrink-0 text-ink-meta hover:text-ink-sub" aria-label="닫기">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <PlanForm14Specs key={b.id} customerId={customerId} buildingId={b.id}
              installed={Object.fromEntries(allCodes.map(c => [c, fac[c].installed]))}
              initialSpecs={specsByBuilding[b.id] ?? specsByBuilding[''] ?? {}}
              receiverLocation={b.receiverLocation} canManage={canManage}
              buildingName={b.building_name}
              buildingNames={buildings.map(x => x.building_name).filter(Boolean)}
              floorsAbove={b.floorsAbove} floorsBelow={b.floorsBelow}
              extinguisherTotal={floors.reduce((n, f) => n + (f.counts['소화기'] || 0), 0)}
              buildingRow={buildingRow}
              mirrorValues={mirror} onMirrorChange={onMirrorChange}
              onDirtyChange={setSpecsDirtyCount} onRegisterSaveAll={registerSpecsSave}
              onRegisterMarkDirty={registerSpecsMarkDirty} />
          </div>
          {/* B안(2026-08-08) — 저장 버튼 단일화. 패널은 화면을 덮는 오버레이라 본문 [저장]에 손이 닿지 않는데,
              종전 패널 버튼은 제원만 저장해 본문이 미저장으로 남았다(별지 9호 3쪽 부모/하위 모순의 원인).
              이제 패널에서도 본문·제원을 함께 저장한다 — 본문 [저장]·Ctrl+S와 완전히 같은 경로다. */}
          {/* 닫혀 있을 때는 아예 렌더하지 않는다 — 패널은 항상 마운트라 그대로 두면 저장 버튼이 화면 밖에 하나 더
              남아 접근성 트리·테스트에서 '버튼 2개'로 보인다(B안의 취지가 흐려짐). 자식은 계속 마운트된다. */}
          {canManage && specsOpen && (
            <div className="shrink-0 flex items-center gap-2 border-t border-brand-line-soft bg-surface px-4 py-2.5">
              <span className="text-form-xs text-ink-sub" data-testid="specs-footer-status">
                {dirty || specsDirty
                  ? <>미저장 {dirty && <b className="text-amber-600">본문</b>}{dirty && specsDirty && ' · '}
                    {specsDirty && <><b className="text-amber-600">제원 {specsDirtyCount}</b>개 섹션</>}</>
                  : '모든 변경이 저장됐습니다'}
              </span>
              <button type="button" data-testid="specs-save" onClick={() => { void save() }}
                disabled={!(dirty || specsDirty) || saving}
                title="본문(설비·층별)과 세부 제원을 한 번에 저장합니다 (Ctrl+S)"
                className="ml-auto inline-flex items-center gap-1 h-form-7 px-3 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-xs font-medium disabled:opacity-50">
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 저장
              </button>
            </div>
          )}
          {specsOpen && msg && <p className="shrink-0 px-4 pb-2 text-form-xs text-ink-sub">{msg}</p>}
        </div>
      </div>
    </div>
  )
}
