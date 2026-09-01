'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, CornerUpLeft, Eye, Loader2, Wand2 } from 'lucide-react'
import { saveFacilitySpecsBulkAction, getInspectedFacilityCodesAction } from '@/app/(dashboard)/customers/facility-spec-actions'
import { getCustomerRoundsAction } from '@/app/(dashboard)/reports/docs-actions'
import { getAnnexPreviewHtmlAction } from '@/app/(dashboard)/inspections/report9-actions'
import {
  FACILITY_SPEC_SECTIONS, isDerivedField, mergeDerivedMulti, derivedBuildingValue,
  normalizeRows, rowIsEmpty, rowsHaveValue, columnTotal, s31LegacyRow,
  type SpecBlock, type SpecField, type SpecSection, type SpecColumn, type SpecRow, type DerivedCtx,
} from '@/lib/facility-spec-schema'
import { ALL_STANDARD_CODES } from '@/lib/facility-codes'
import { rollUpForm3Results, form3ItemsForSheet, type SheetGroupStat } from '@/lib/sheet-facility-map'
import { bumpNumber } from '@/components/ui/fields'
import { useCustomerTabs } from '@/components/customers/customer-tabs'

/** ± 스테퍼를 붙일 수량형 단위 (S4-4) — 용량·치수(㎥·㎾·MPa·ℓ·ℓ/min·m·㎜·㎡ 등)는 ±1이 무의미해 제외 */
const COUNT_UNITS = new Set(['개', '대', '개소', '개층', '구역'])

/** 설비 대장 — 설비 세부 제원 입력 (S3A/H-19, 소방계획서_7.md §4-A-2)
 *  별지 4호 3~7쪽 = 별지 9호 4~7쪽 "소방시설등의 세부 현황" 공용 원본(customer_facility_specs).
 *  폼은 H-18 카탈로그(FACILITY_SPEC_SECTIONS)만으로 렌더 — 필드 하드코딩 금지.
 *  facilityHint 블록은 1.4 표에서 설치(√)된 설비만 펼침 가능(§4-A-2 입력량 최소화),
 *  힌트 없는 블록(3-2 수계 공통 등)은 항상 입력 가능. 저장은 섹션 단위(건물 축 = 1.4의 bidx). */

type FieldValue = string | boolean | string[] | SpecRow[]
type SectionValues = Record<string, Record<string, FieldValue>> // blockKey → fieldKey → 값

function initFieldValue(f: SpecField, raw: unknown): FieldValue {
  if (f.type === 'check') return raw === true
  if (f.type === 'multicheck') return Array.isArray(raw) ? raw.map(String) : []
  if (f.type === 'rowtable') return normalizeRows(raw)
  return raw == null ? '' : String(raw)
}
function isFilled(v: FieldValue): boolean {
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    // multicheck(문자열 배열)과 rowtable(행 객체 배열)이 같은 자리를 쓴다.
    // 빈 행만 든 표는 '입력됨'이 아니다 — 완성도·빈칸 큐가 거짓 100%를 내면 안 된다.
    if (v.length === 0) return false
    return typeof v[0] === 'string' ? true : rowsHaveValue(v as SpecRow[])
  }
  return v.trim() !== ''
}
function hintCodes(b: SpecBlock): string[] {
  return (b.facilityHint ?? '').split(',').map(c => c.trim()).filter(Boolean)
}

const CATALOG_TOTAL = FACILITY_SPEC_SECTIONS.reduce(
  (n, s) => n + s.blocks.reduce((m, b) => m + b.fields.length, 0), 0)

/** 제원 저장 결과 — 부모(패널 푸터·본문 공용 통합 [저장], 소방계획서_12 U3)가 메시지 합성에 사용 */
export type SpecsSaveResult = { requested: number; saved: number; failedLabels: string[] }

export function PlanForm14Specs({ customerId, buildingId, installed, initialSpecs, receiverLocation, canManage, buildingName, buildingNames = [], floorsAbove, floorsBelow, extinguisherTotal, onDirtyChange, onRegisterSaveAll, onRegisterMarkDirty, buildingRow, mirrorValues, onMirrorChange }: {
  customerId: string
  buildingId: string
  /** 1.4 표의 현재 설치(√) 상태 — facility_code → installed (라이브 연동) */
  installed: Record<string, boolean>
  /** 서버 초기값: sectionKey → { blockKey: { fieldKey: 값 } } */
  initialSpecs: Record<string, Record<string, unknown>>
  /** 기존 필드 자동 연결(§4-A-1) — 빠른 입력의 수신기 위치(회색 표시, 재입력 금지) */
  receiverLocation?: string | null
  canManage: boolean
  /** 소방계획서_9 간편 입력 — 기본값 채우기·칩용 건물 데이터 */
  buildingName?: string
  buildingNames?: string[]
  floorsAbove?: number | null
  floorsBelow?: number | null
  /** 1.4 층별 수량표 소화기 합계(라이브 state) — s31 수량 기본값 */
  extinguisherTotal?: number
  /** 미저장 섹션 수 통지 — 부모(plan-form14)가 이탈 가드·푸터 배지에 사용 (소방계획서_12 U1: boolean → 개수) */
  onDirtyChange?: (dirtyCount: number) => void
  /** U3 — 부모(1.4 통합 [저장])가 제원 저장을 await 할 수 있게 saveAll을 등록 */
  onRegisterSaveAll?: (fn: () => Promise<SpecsSaveResult>) => void
  /** 미러 필드를 **1.4 대장 쪽에서** 고쳤을 때 해당 섹션을 미저장으로 표시하기 위한 등록 지점.
   *  이게 없으면 대장에서 체크한 피난기구 종류가 저장 대상에 들어가지 않는다(2026-08-08 E2E가 잡은 결함). */
  onRegisterMarkDirty?: (fn: (sectionKey: string) => void) => void
  /** 건물 파생 필드(비상용승강기 수)의 원천 — buildings 행 (2026-08-08 중복 입력 제거) */
  buildingRow?: Record<string, number | string | null | undefined>
  /** mirrorInLedger 필드(피난기구 종류)의 값·갱신 — 저장소는 세부제원이지만 1.4 대장 하위 체크박스도
   *  같은 값을 읽고 쓴다. 부모(plan-form14)가 상태를 들고 양쪽에 내려준다. */
  mirrorValues?: Record<string, string[]>
  onMirrorChange?: (fieldPath: string, next: string[]) => void
}) {
  const [values, setValues] = useState<Record<string, SectionValues>>(() => {
    const out: Record<string, SectionValues> = {}
    for (const sec of FACILITY_SPEC_SECTIONS) {
      const rawSec = (initialSpecs[sec.key] ?? {}) as Record<string, unknown>
      const sv: SectionValues = {}
      for (const bl of sec.blocks) {
        const rawBl = (rawSec[bl.key] ?? {}) as Record<string, unknown>
        sv[bl.key] = {}
        for (const f of bl.fields) sv[bl.key][f.key] = initFieldValue(f, rawBl[f.key])
      }
      // 3-1 개편 이관(2026-08-20) — 구 저장분은 합계 수량 6칸이 summary에 직접 있었다.
      // 동별 표가 비어 있을 때만 첫 행으로 올린다(다시 저장하면 새 구조로 확정).
      // 인쇄 쪽도 같은 폴백을 갖고 있어, 저장 전까지 화면과 문서가 같은 값을 보인다.
      if (sec.key === 's31_extinguisher' && !rowsHaveValue(sv['summary']?.['dong_rows'] as SpecRow[])) {
        const legacy = s31LegacyRow(rawSec, buildingName)
        if (legacy) sv['summary']['dong_rows'] = [legacy]
      }
      out[sec.key] = sv
    }
    return out
  })
  const [openSec, setOpenSec] = useState<string | null>(null)
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({})
  /** 접어둔 필드 묶음(설치장소 2행 등)을 사용자가 편 상태 — 블록:그룹 단위 */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const detailsRef = useRef<HTMLDetailsElement | null>(null)

  // A안(2026-08-04): 1.4에서 설비 체크(√) → 해당 제원 섹션 자동 펼침·블록 오픈·스크롤 (erp:open-spec-section)
  useEffect(() => {
    function onOpenSection(e: Event) {
      const code = (e as CustomEvent).detail?.code as string | undefined
      if (!code) return
      for (const sec of FACILITY_SPEC_SECTIONS) {
        const bl = sec.blocks.find(b => (b.facilityHint ?? '').split(',').map(t => t.trim()).includes(code))
        if (!bl) continue
        detailsRef.current?.setAttribute('open', '')          // 설비 대장 접힘 해제
        setOpenSec(sec.key)
        setOpenBlocks(p => ({ ...p, [`${sec.key}.${bl.key}`]: true }))
        setTimeout(() => {
          document.querySelector(`[data-spec-block="${bl.key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 120)
        return
      }
    }
    window.addEventListener('erp:open-spec-section', onOpenSection)
    return () => window.removeEventListener('erp:open-spec-section', onOpenSection)
  }, [])
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState<string | null>(null) // 미설치 블록 클릭 안내 대상
  const [msg, setMsg] = useState('')
  // 소방계획서_9: 기본값 채우기로 채워진 경로("sec.bl.f") — 보라 링 표시, 수동 수정·저장 시 제거
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set())

  // 미저장 섹션 수 — 부모 이탈 가드·패널 푸터·본문 배지 통지 (소방계획서_9·12 U1)
  const dirtyCount = useMemo(() => Object.values(dirty).filter(Boolean).length, [dirty])
  const onDirtyChangeRef = useRef(onDirtyChange)
  useEffect(() => { onDirtyChangeRef.current = onDirtyChange })
  useEffect(() => { onDirtyChangeRef.current?.(dirtyCount) }, [dirtyCount])
  const router = useRouter()
  const tabsShell = useCustomerTabs()   // 탭 셸 안에서만 non-null — [9호로 돌아가기]의 같은 경로 전환용 (소방계획서_34 S4-4)
  // 소방계획서_8 D-13 스플릿 입력 — 우측에 별지 9호 4~7쪽 실시간 미리보기 (저장 시 재렌더, 데스크톱)
  const [splitOn, setSplitOn] = useState(false)
  const [splitInspId, setSplitInspId] = useState<string | null>(null)
  const [splitHtml, setSplitHtml] = useState('')
  const [splitLoading, setSplitLoading] = useState(false)
  const [splitErr, setSplitErr] = useState<string | null>(null)
  // D-17 9호發 진입 컨텍스트 (?from=report9) — 복귀 버튼·스플릿 자동 ON·첫 빈칸 포커스
  const [fromReport9, setFromReport9] = useState(false)
  // D-17 빈칸만 보기 — 토글 시점 스냅샷(입력 중 필드가 사라지지 않게 고정, 채우면 ✓ 전환)
  const [emptySnap, setEmptySnap] = useState<Set<string> | null>(null)
  // D-17 교차 검증 — 최근 자체점검 회차의 점검표 응답이 있는 설비 코드 (점검함·제원 미입력 칩)
  const [inspected, setInspected] = useState<{ codes: Set<string>; label: string } | null>(null)
  const inspectedFetched = useRef(false)
  // T-2a — 같은 회차의 시트별 응답 통계·불량 수. 섹션 헤더 점검 결과 배지가 쓴다
  const [sheetStats, setSheetStats] = useState<SheetGroupStat[]>([])
  const [defectsBySheet, setDefectsBySheet] = useState<Record<string, number>>({})

  function loadSplit(inspId: string) {
    setSplitLoading(true)
    void getAnnexPreviewHtmlAction(inspId, 'report9').then(res => {
      setSplitLoading(false)
      if (res.error || !res.html) { setSplitErr(res.error ?? '미리보기 렌더 실패'); return }
      setSplitErr(null)
      setSplitHtml(res.html)
    })
  }
  function openSplit(directInspId?: string | null) {
    setSplitOn(true)
    // F-1(소방계획서_37) — 나란히 보기를 켜면 패널을 자동으로 [넓게]로.
    //   기본 폭에서 반으로 가르면 한쪽이 ~500px라 표와 미리보기 둘 다 답답하다(넓게면 각 729px).
    //   ⚠ **끌 때 되돌리지 않고, localStorage에도 쓰지 않는다.** 이건 사용자의 취향 설정이 아니라
    //     이번 세션의 편의다 — 저장해 버리면 사용자가 고른 기본 폭을 조용히 덮어쓴다.
    //     새로고침하면 사용자가 고른 값으로 돌아간다.
    window.dispatchEvent(new CustomEvent('erp:spec-panel-wide'))
    if (directInspId) { setSplitInspId(directInspId); loadSplit(directInspId); return }
    if (splitInspId) { if (!splitHtml) loadSplit(splitInspId); return }
    setSplitLoading(true)
    void getCustomerRoundsAction(customerId).then(res => {
      const started = res.data?.rounds.find(r => r.docs)
      if (!started?.docs) { setSplitLoading(false); setSplitErr('시작된 자체점검 회차가 없어 미리보기를 만들 수 없습니다.'); return }
      setSplitInspId(started.docs.inspectionId)
      loadSplit(started.docs.inspectionId)
    })
  }
  function toggleSplit() {
    if (splitOn) { setSplitOn(false); return }
    openSplit()
  }

  function fetchInspected() {
    if (inspectedFetched.current) return
    inspectedFetched.current = true
    // 조회 실패(네트워크 등)는 조용히 생략 — 칩은 보조 정보 (권한은 이 화면 도달 시점에 이미 충족)
    getInspectedFacilityCodesAction(customerId)
      .then(res => {
        if (res.codes.length > 0) setInspected({ codes: new Set(res.codes), label: res.roundLabel ?? '' })
        setSheetStats(res.sheetStats ?? [])
        setDefectsBySheet(res.defectsBySheet ?? {})
      })
      .catch(() => {})
  }

  const enabled = (b: SpecBlock) => !b.facilityHint || hintCodes(b).some(c => installed[c])

  // ── T-2a 점검 결과 배지 (소방계획서_14_점검업무) ─────────────────────────────
  // 마크 판정은 별지9호 3쪽과 **같은 함수**(rollUpForm3Results)를 쓴다 — 문서와 화면이 어긋나면 안 된다.
  // 설치 여부는 서버 DB가 아니라 화면의 현재 체크 상태를 넘긴다: 방금 켠(미저장) 설비가 ／로 보이면 거짓말이 된다.
  const installedCodes = useMemo(() => Object.keys(installed).filter(c => installed[c]), [installed])
  const inspectionMarks = useMemo(
    () => rollUpForm3Results(sheetStats, ALL_STANDARD_CODES, installedCodes).resultMarks,
    [sheetStats, installedCodes])
  /** 설비 코드 → 불량 수 — 시트별 X 수를 그 시트가 덮는 설비로 전개 */
  const defectsByCode = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [sheet, n] of Object.entries(defectsBySheet)) {
      for (const c of form3ItemsForSheet(sheet, ALL_STANDARD_CODES)) out[c] = (out[c] ?? 0) + n
    }
    return out
  }, [defectsBySheet])

  /** 섹션 배지 — 섹션이 덮는 설비들의 마크를 합쳐 하나로. 불량이 하나라도 있으면 ×가 이긴다 */
  function sectionBadge(sec: SpecSection): { mark: 'O' | 'X' | 'N' | null; defects: number; codes: string[] } | null {
    if (sheetStats.length === 0) return null
    const codes = [...new Set(sec.blocks.flatMap(hintCodes))]
    if (codes.length === 0) return null                    // 공통사항 섹션(3-2 등)은 배지 없음
    const marks = codes.map(c => inspectionMarks[c]).filter(Boolean) as Array<'O' | 'X' | 'N'>
    if (marks.length === 0) return { mark: null, defects: 0, codes }   // 설치했는데 응답 없음 = 미입력
    const defects = codes.reduce((n, c) => n + (defectsByCode[c] ?? 0), 0)
    const mark = marks.includes('X') ? 'X' : marks.includes('O') ? 'O' : 'N'
    return { mark, defects, codes }
  }

  // ── 중복 입력 제거(2026-08-08) — 원천이 다른 세 갈래를 한 접근자로 흡수 ─────────
  //   ① 파생: 대장 체크·건물 정보에서 계산 (읽기 전용, 세부제원에 저장하지 않음)
  //   ② 미러: 저장소는 세부제원이지만 1.4 대장 하위 체크박스와 값을 공유 (피난기구 종류)
  //   ③ 그 외: 종전대로 이 컴포넌트의 로컬 state
  // 완성도·빈칸 큐·교차검증도 전부 이 접근자를 거쳐야 한다 — 저장분만 보면 파생 필드가 늘 '미입력'이 된다.
  const derivedCtx: DerivedCtx = useMemo(
    () => ({ installed: Object.keys(installed).filter(c => installed[c]), building: buildingRow }),
    [installed, buildingRow])

  const fieldPath = (secKey: string, blKey: string, fKey: string) => `${secKey}.${blKey}.${fKey}`

  /** 화면에 보일 최종 값 — 파생·미러를 반영한다 */
  function fieldValue(secKey: string, bl: SpecBlock | string, f: SpecField): FieldValue {
    const blKey = typeof bl === 'string' ? bl : bl.key
    const stored = values[secKey]?.[blKey]?.[f.key] ?? (f.type === 'multicheck' ? [] : '')
    if (f.mirrorInLedger) return mirrorValues?.[fieldPath(secKey, blKey, f.key)] ?? (stored as string[])
    if (f.derivedFrom) return mergeDerivedMulti(f, stored, derivedCtx)
    if (f.derivedFromBuilding) return derivedBuildingValue(f, derivedCtx)
    return stored
  }
  const filledAt = (secKey: string, bl: SpecBlock, f: SpecField) => isFilled(fieldValue(secKey, bl, f))

  /** 값 변경 — 미러 필드는 부모 상태로, 나머지는 로컬 state로 */
  function writeField(secKey: string, bl: SpecBlock, f: SpecField, v: FieldValue) {
    if (f.mirrorInLedger) {
      onMirrorChange?.(fieldPath(secKey, bl.key, f.key), v as string[])
      setDirty(p => ({ ...p, [secKey]: true }))
      return
    }
    setField(secKey, bl.key, f.key, v)
  }

  /** 첫 빈칸 포커스 (D-17 9호發) — 설치 설비 기준 첫 미입력 필드의 섹션·블록을 열고 스크롤·포커스 */
  function focusFirstEmpty() {
    for (const sec of FACILITY_SPEC_SECTIONS) {
      for (const bl of sec.blocks) {
        if (bl.facilityHint && !hintCodes(bl).some(c => installed[c])) continue
        // 파생 필드는 여기서 채울 수 없으니(읽기 전용) 빈칸 후보에서 제외
        const f = bl.fields.find(fd => !isDerivedField(fd) && !filledAt(sec.key, bl, fd))
        if (!f) continue
        setOpenSec(sec.key)
        setOpenBlocks(p => ({ ...p, [`${sec.key}.${bl.key}`]: true }))
        setTimeout(() => {
          const base = `[data-spec-field="${sec.key}.${bl.key}.${f.key}"]`
          const el = document.querySelector<HTMLElement>(`${base} input, ${base} select, ${base} button`)
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el?.focus({ preventScroll: true })
        }, 200)
        return
      }
    }
  }

  // D-17 9호發 진입 — ?from=report9(&insp=점검ID): 대장 펼침 + 스플릿 ON + 첫 빈칸 포커스 + 복귀 버튼
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('from') !== 'report9') return
    const t = setTimeout(() => {
      setFromReport9(true)
      detailsRef.current?.setAttribute('open', '')
      fetchInspected()
      openSplit(sp.get('insp'))
      focusFirstEmpty()
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 빈칸만 보기 토글 (D-17) — 켤 때 미입력 필드 경로를 스냅샷으로 고정 */
  function toggleEmptyOnly() {
    if (emptySnap) { setEmptySnap(null); return }
    const snap = new Set<string>()
    for (const sec of FACILITY_SPEC_SECTIONS) {
      for (const bl of sec.blocks) {
        if (!enabled(bl)) continue
        for (const f of bl.fields) {
          if (!isDerivedField(f) && !filledAt(sec.key, bl, f)) snap.add(`${sec.key}.${bl.key}.${f.key}`)
        }
      }
    }
    setEmptySnap(snap)
  }
  const emptyRemaining = useMemo(() => {
    if (!emptySnap) return 0
    let n = 0
    for (const path of emptySnap) {
      const [sk, bk, fk] = path.split('.')
      const bl = FACILITY_SPEC_SECTIONS.find(s => s.key === sk)?.blocks.find(b => b.key === bk)
      const f = bl?.fields.find(fd => fd.key === fk)
      if (bl && f && !filledAt(sk, bl, f)) n++
    }
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emptySnap, values, mirrorValues, installed, buildingRow])

  /** 교차 검증 대상 블록 판정 (D-17) — 점검표 응답 있는 설비 & 제원 전부 빈칸 */
  const crossWarn = (secKey: string, bl: SpecBlock): boolean => {
    if (!inspected || !bl.facilityHint) return false
    if (!enabled(bl)) return false
    if (!hintCodes(bl).some(c => inspected.codes.has(c))) return false
    return !bl.fields.some(f => filledAt(secKey, bl, f))
  }
  const crossWarnCount = useMemo(() => {
    if (!inspected) return 0
    let n = 0
    for (const sec of FACILITY_SPEC_SECTIONS) for (const bl of sec.blocks) if (crossWarn(sec.key, bl)) n++
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspected, values, installed])

  // 완성도 — 전체(카탈로그) + 설치 설비 기준(펼침 가능 블록만 분모)
  const gauge = useMemo(() => {
    const per: Record<string, { filled: number; total: number }> = {}
    let filledAll = 0, filledOn = 0, totalOn = 0
    for (const sec of FACILITY_SPEC_SECTIONS) {
      let f = 0, t = 0
      for (const bl of sec.blocks) {
        const on = enabled(bl)
        for (const fd of bl.fields) {
          const filled = filledAt(sec.key, bl, fd)
          if (filled) filledAll++
          if (on) { t++; if (filled) f++ }
        }
      }
      per[sec.key] = { filled: f, total: t }
      filledOn += f; totalOn += t
    }
    return { per, filledAll, filledOn, totalOn }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, installed])

  function setField(secKey: string, blKey: string, fKey: string, v: FieldValue) {
    setValues(p => ({ ...p, [secKey]: { ...p[secKey], [blKey]: { ...p[secKey][blKey], [fKey]: v } } }))
    setDirty(p => ({ ...p, [secKey]: true }))
    // 자동 채움 값을 사용자가 직접 수정하면 보라 링 해제
    const path = `${secKey}.${blKey}.${fKey}`
    setAutoFilled(p => { if (!p.has(path)) return p; const n = new Set(p); n.delete(path); return n })
  }


  /** 섹션 1개 spec JSONB 구성 — 값 있는 필드만(비운 필드는 저장에서 제거), 미설치 블록 기존 값 보존.
   *  파생 필드(대장·건물이 원천)는 **저장하지 않는다** — 사본을 남기면 원천이 바뀔 때 낡은 값이 인쇄된다. */
  function buildSectionSpec(secKey: string): Record<string, Record<string, unknown>> {
    const sec = FACILITY_SPEC_SECTIONS.find(s => s.key === secKey)
    const spec: Record<string, Record<string, unknown>> = {}
    if (!sec) return spec
    for (const bl of sec.blocks) {
      const out: Record<string, unknown> = {}
      for (const f of bl.fields) {
        if (isDerivedField(f)) continue
        const v = fieldValue(secKey, bl.key, f)
        // rowtable: 빈 행은 버리고, 수량 열은 숫자로 저장한다(합계·인쇄가 숫자로 읽는다)
        if (f.type === 'rowtable') {
          const numeric = new Set((f.columns ?? []).filter(c => c.type === 'number').map(c => c.key))
          const rows = (v as SpecRow[])
            .filter(r => !rowIsEmpty(r))
            .map(r => {
              const out2: Record<string, unknown> = {}
              for (const [k, raw] of Object.entries(r)) {
                const s = String(raw ?? '').trim()
                if (!s) continue
                const n = Number(s)
                out2[k] = numeric.has(k) && Number.isFinite(n) ? n : s
              }
              return out2
            })
          if (rows.length > 0) out[f.key] = rows
          continue
        }
        // 부분 파생(유도등): 사용자가 고른 비파생 선택지만 저장하고 대장에서 오는 값은 뺀다
        if (f.derivedFrom && f.type === 'multicheck' && Array.isArray(v)) {
          const own = (v as string[]).filter(o => !f.derivedFrom![o])
          if (own.length) out[f.key] = own
          continue
        }
        if (!isFilled(v)) continue
        if (f.type === 'number' && typeof v === 'string') {
          const n = Number(v)
          out[f.key] = Number.isFinite(n) ? n : v
        } else out[f.key] = v
      }
      if (Object.keys(out).length > 0) spec[bl.key] = out
    }
    return spec
  }

  /** 제원 저장 — 미저장 섹션 전부를 벌크 액션 1회로. 실패 섹션은 dirty 유지(재클릭 = 재시도).
   *  결과를 반환하는 async — 부모(1.4 통합 [저장], 소방계획서_12 U3-4)가 await 해 메시지를 합성한다 */
  async function saveAll(): Promise<SpecsSaveResult> {
    const keys = FACILITY_SPEC_SECTIONS.map(s => s.key).filter(k => dirty[k])
    if (!canManage || keys.length === 0) return { requested: 0, saved: 0, failedLabels: [] }
    const payload = Object.fromEntries(keys.map(k => [k, buildSectionSpec(k)]))
    // 진행 표시는 부모 패널 푸터의 통합 [저장]이 담당한다(B안) — 여기서 별도 saving 상태를 두지 않는다
    const res = await saveFacilitySpecsBulkAction(customerId, buildingId, payload)
    setDirty(p => { const n = { ...p }; for (const k of res.saved) n[k] = false; return n })
    setAutoFilled(p => {
      if (p.size === 0) return p
      return new Set([...p].filter(path => !res.saved.some(k => path.startsWith(`${k}.`))))
    })
    const errKeys = Object.keys(res.errors)
    const failedLabels = errKeys.map(k => { const s = FACILITY_SPEC_SECTIONS.find(x => x.key === k); return s ? `${s.no} ${s.label}` : k })
    // 결과 문구는 부모가 본문 저장분과 합쳐 패널 푸터에 한 줄로 띄운다(B안) — 여기서 또 쓰면 같은 말이 두 번 나온다
    if (splitOn && splitInspId) loadSplit(splitInspId)   // D-13: 저장 즉시 우측 미리보기 재렌더
    return { requested: keys.length, saved: res.saved.length, failedLabels }
  }
  // U3-4 — 최신 클로저의 saveAll을 부모에 등록 (ref 경유라 재등록 없이도 항상 최신 state를 저장)
  const saveAllRef = useRef(saveAll)
  useEffect(() => { saveAllRef.current = saveAll })
  useEffect(() => { onRegisterSaveAll?.(() => saveAllRef.current()) }, [onRegisterSaveAll])
  // 1.4 대장 쪽에서 미러 필드를 고쳤을 때 이 컴포넌트의 dirty에 반영 — saveAll 대상에 들어가야 저장된다
  useEffect(() => {
    onRegisterMarkDirty?.((sectionKey: string) => setDirty(p => (p[sectionKey] ? p : { ...p, [sectionKey]: true })))
  }, [onRegisterMarkDirty])

  /** 소방계획서_9: 기본값 유도 — 건물명·층수·1.4 층별 수량표에서 채울 수 있는 필드만 (빈 칸 한정) */
  function deriveDefault(bl: SpecBlock, f: SpecField): string | null {
    const below = floorsBelow ?? 0, above = floorsAbove ?? 0
    if (f.type === 'text') {
      if ((f.key === 'dong' || f.key.endsWith('_dong')) && buildingName) return buildingName
      if (f.key === 'from_floor') return below > 0 ? String(below) : above > 0 ? '1' : null
      if (f.key === 'to_floor') return above > 0 ? String(above) : null
    }
    if (f.type === 'select') {
      if (f.key === 'coverage') return below > 0 || above > 0 ? '전체층' : null
      if (f.key === 'from_ground') return below > 0 ? '지하' : above > 0 ? '지상' : null
      if (f.key === 'to_ground') return above > 0 ? '지상' : null
    }
    return null
  }

  /** rowtable 기본 첫 행 — 동명(건물명) + 1.4 층별 수량표의 소화기 합계.
   *  종전엔 3-1 합계 칸(qty_ext_powder)에 직접 넣던 값이다(소방계획서_9). 합계가 동별 합으로
   *  바뀌었으니 같은 값을 **첫 동의 분말 수량**으로 넣는다 — 합계는 그대로 같은 수가 된다. */
  function deriveRowDefault(f: SpecField): SpecRow | null {
    const seed: SpecRow = {}
    const cols = f.columns ?? []
    if (buildingName && cols.some(c => c.key === 'dong')) seed.dong = buildingName
    if ((extinguisherTotal ?? 0) > 0 && cols.some(c => c.key === 'qty_ext_powder')) {
      seed.qty_ext_powder = String(extinguisherTotal)
    }
    return rowIsEmpty(seed) ? null : seed
  }

  function fillDefaults() {
    if (!canManage) return
    const next = { ...values }
    const copiedSec = new Set<string>()
    const copiedBl = new Set<string>()
    const added: string[] = []
    for (const sec of FACILITY_SPEC_SECTIONS) {
      for (const bl of sec.blocks) {
        if (!enabled(bl)) continue
        for (const f of bl.fields) {
          if (isDerivedField(f)) continue   // 원천이 대장·건물 — 여기서 기본값을 심으면 안 된다
          if (isFilled(next[sec.key][bl.key][f.key])) continue
          const d: FieldValue | null = f.type === 'rowtable'
            ? (() => { const r = deriveRowDefault(f); return r ? [r] : null })()
            : deriveDefault(bl, f)
          if (d == null) continue
          if (!copiedSec.has(sec.key)) { next[sec.key] = { ...next[sec.key] }; copiedSec.add(sec.key) }
          const bid = `${sec.key}.${bl.key}`
          if (!copiedBl.has(bid)) { next[sec.key][bl.key] = { ...next[sec.key][bl.key] }; copiedBl.add(bid) }
          next[sec.key][bl.key][f.key] = d
          added.push(`${bid}.${f.key}`)
        }
      }
    }
    if (added.length === 0) {
      setMsg('채울 수 있는 빈 칸이 없습니다 — 동명·층 범위·소화기 수량이 이미 입력됐거나, 유도할 건물 데이터(건물명·층수·층별 수량)가 없습니다.')
      return
    }
    setValues(next)
    setAutoFilled(p => new Set([...p, ...added]))
    setDirty(p => { const n = { ...p }; for (const s of copiedSec) n[s] = true; return n })
    setMsg(`✨ ${added.length}칸 자동 입력됨 (동명·층 범위·소화기 수량) — 값 확인 후 아래 [저장]을 눌러주세요`)
  }

  // 소방계획서_9: 층·동명 칩 — 클릭만으로 입력 (직접 타이핑 병행)
  const dongChips = useMemo(() => [...new Set(buildingNames.filter(Boolean))], [buildingNames])
  const floorChips = useMemo(() => {
    const out: Array<{ label: string; ground: string; floor: string }> = []
    const below = floorsBelow ?? 0, above = floorsAbove ?? 0
    for (let i = below; i >= 1; i--) out.push({ label: `지하${i}`, ground: '지하', floor: String(i) })
    const ups = above <= 6
      ? Array.from({ length: above }, (_, i) => i + 1)
      : [1, 2, 3, above]   // 고층 요약: 1~3층 + 최상층
    for (const i of ups) out.push({ label: `${i}층`, ground: '지상', floor: String(i) })
    return out
  }, [floorsAbove, floorsBelow])

  /** 필드 1개 위젯 — type별 렌더, 미입력은 옅은 주황·자동 채움은 보라 링 하이라이트(§4-A-2·소방계획서_9) */
  function fieldWidget(secKey: string, bl: SpecBlock, f: SpecField, blockOn: boolean) {
    const v = fieldValue(secKey, bl, f)
    const derivedAll = isDerivedField(f)          // 전부 파생 → 읽기 전용 (가스계 종류·비상용승강기)
    const empty = !isFilled(v)
    const dis = !canManage || !blockOn || derivedAll
    const auto = autoFilled.has(`${secKey}.${bl.key}.${f.key}`)
    // min-w-0 = 스테퍼(±) 형제와 같은 flex 행에서 입력칸이 정상 축소되도록 (S4-4)
    const box = `h-form-7 w-full min-w-0 rounded border px-1.5 text-form-sm outline-none focus:border-brand disabled:opacity-60 ${
      empty ? 'border-amber-200 bg-amber-50/40'
        : auto ? 'border-brand bg-brand-tint ring-1 ring-brand/40'
        : 'border-brand-line bg-surface'}`
    if (f.type === 'check') {
      return (
        <button type="button" disabled={dis} onClick={() => setField(secKey, bl.key, f.key, !(v as boolean))}
          aria-label={f.label}
          className={`inline-flex items-center gap-1 h-form-7 text-form-sm ${v ? 'font-bold text-ink' : 'text-ink-sub hover:text-brand'} disabled:opacity-60`}>
          <span className="text-form-base leading-none">{v ? '☑' : '☐'}</span> 해당
        </button>
      )
    }
    if (f.type === 'multicheck') {
      const arr = v as string[]
      // limitToInstalled: 1.4에서 설치(√)한 설비만 고를 수 있게 — 대장에 없는 자유 항목('기타')은 항상 허용
      const instSet = new Set(Object.keys(installed).filter(c => installed[c]))
      const allOpts = f.options ?? []
      const known = new Set(allOpts.filter(o => instSet.has(o) || !Object.hasOwn(installed, o)))
      /** 체크 토글 — 이 선택지가 같은 블록 rowtable의 어떤 열을 여닫는가(enabledBy)까지 책임진다.
       *  끄면 그 열은 잠기므로, 값이 남아 있으면 '설치 안 했는데 수량이 인쇄되는' 모순이 된다.
       *  조용히 지우지도, 조용히 남기지도 않는다 — 몇 칸이 지워지는지 밝히고 확인을 받는다. */
      function toggleOpt(o: string, on: boolean) {
        if (on) {
          const tbl = bl.fields.find(x => x.type === 'rowtable' && (x.columns ?? []).some(c => c.enabledBy === o))
          const col = tbl?.columns?.find(c => c.enabledBy === o)
          if (tbl && col) {
            const rows = fieldValue(secKey, bl, tbl) as SpecRow[]
            const n = rows.filter(r => String(r[col.key] ?? '').trim()).length
            if (n > 0) {
              if (!window.confirm(`‘${o}’ 체크를 해제하면 표에 입력된 ${col.label} 수량 ${n}칸이 지워집니다. 계속할까요?`)) return
              setField(secKey, bl.key, tbl.key, rows.map(r => { const c2 = { ...r }; delete c2[col.key]; return c2 }))
            }
          }
        }
        writeField(secKey, bl, f, on ? arr.filter(x => x !== o) : [...arr, o])
      }
      return (
        <div className="flex flex-wrap gap-x-2.5 gap-y-1 py-1">
          {allOpts.map(o => {
            const on = arr.includes(o)
            // 이 선택지만 대장·건물에서 오는가 (유도등의 유도표지·피난유도선 같은 부분 파생)
            const optDerived = !!f.derivedFrom?.[o]
            const blocked = !!f.limitToInstalled && !known.has(o)
            const lock = dis || optDerived || blocked
            const title = optDerived ? '1.4 설치 체크에서 자동 반영 — 여기서는 수정하지 않습니다'
              : blocked ? '1.4에서 설치(√)로 체크한 설비만 고를 수 있습니다' : undefined
            return (
              <button key={o} type="button" disabled={lock} title={title}
                onClick={() => toggleOpt(o, on)}
                className={`inline-flex items-center gap-1 text-form-xs ${
                  on ? 'font-bold text-ink' : 'text-ink-sub hover:text-brand'
                } ${optDerived ? '!text-ink-soft cursor-default' : ''} disabled:opacity-60`}>
                <span>{on ? '☑' : '☐'}</span>{o}{optDerived && <span className="text-form-3xs text-ink-meta">(대장)</span>}
              </button>
            )
          })}
        </div>
      )
    }
    // 반복 행 표(3-1 동별 수량) — 한 행 = 한 동, 합계 행은 세로 합(읽기 전용).
    // 수량 칸을 좁게 깔아 6종 + 비고가 **한 줄**에 들어간다(2026-08-20 요청).
    if (f.type === 'rowtable') {
      const cols = f.columns ?? []
      // 열을 여닫는 체크박스 = 같은 블록의 multicheck. 카탈로그의 enabledBy로만 연결한다(하드코딩 금지)
      const gate = bl.fields.find(x => x.type === 'multicheck')
      const checked = new Set(gate ? (fieldValue(secKey, bl, gate) as string[]) : [])
      const colOn = (c: SpecColumn) => !c.enabledBy || checked.has(c.enabledBy)
      const rows = v as SpecRow[]
      // 행이 0개면 입력할 칸 자체가 사라진다 — 빈 행 1개는 항상 보인다(값이 들어가야 저장 대상이 됨)
      const shown: SpecRow[] = rows.length > 0 ? rows : [{}]
      const write = (next: SpecRow[]) => setField(secKey, bl.key, f.key, next)
      const setCell = (i: number, key: string, val: string) => {
        const next = shown.map(r => ({ ...r }))
        if (val.trim()) next[i][key] = val
        else delete next[i][key]
        write(next)
      }
      // 서식 원문의 2단 헤더(소화기 › 분말/기타) 재현 — group이 같은 이웃 열끼리 묶는다
      const groups: Array<{ group?: string; cols: SpecColumn[] }> = []
      for (const c of cols) {
        const last = groups[groups.length - 1]
        if (c.group && last?.group === c.group) last.cols.push(c)
        else groups.push({ group: c.group, cols: [c] })
      }
      const th = 'border border-brand-line-soft bg-paper px-0.5 py-1 text-form-3xs font-medium leading-tight'
      const td = 'border border-brand-line-soft p-0.5 align-middle'
      const dlId = `dongopt-${secKey}-${bl.key}-${f.key}`
      const usedDongs = new Set(shown.map(r => (r.dong ?? '').trim()).filter(Boolean))
      const nextDong = dongChips.find(nm => !usedDongs.has(nm)) ?? ''
      return (
        <div>
          <div className="overflow-x-auto">
            <table data-testid={`rowtable-${secKey}-${f.key}`} className="w-full border-collapse table-fixed">
              <colgroup>
                {/* ⚠ 숫자열 폭은 글자 크기와 **함께** 커져야 한다 (소방계획서_35 W-1).
                    44px 열의 실제 입력 폭은 border·padding을 빼면 28px뿐이라, 글자만
                    11→13px로 올리면 들어가는 자릿수가 4에서 3으로 줄어든다. */}
                {cols.map(c => <col key={c.key} style={{ width: c.wide ? undefined : 'calc(var(--fs-col-num) * var(--fs-scale))' }} />)}
                {!dis && <col style={{ width: '24px' }} />}
              </colgroup>
              <thead>
                <tr>
                  {groups.map(g => g.group
                    ? <th key={g.group} colSpan={g.cols.length}
                        className={`${th} ${g.cols.some(colOn) ? 'text-ink-sub' : 'text-ink-meta'}`}>{g.group}</th>
                    : <th key={g.cols[0].key} rowSpan={2} className={`${th} text-ink-sub`}>{g.cols[0].short ?? g.cols[0].label}</th>)}
                  {!dis && <th rowSpan={2} className={th} />}
                </tr>
                <tr>
                  {groups.filter(g => g.group).flatMap(g => g.cols).map(c => (
                    <th key={c.key} title={colOn(c) ? c.label : `${c.label} — 위 ‘설치 종류’에서 체크해야 입력할 수 있습니다`}
                      className={`${th} ${colOn(c) ? 'text-ink' : 'text-ink-meta font-normal'}`}>
                      {colOn(c) ? '☑' : '☐'} {c.short ?? c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* 합계 — 아래 동별 행의 세로 합. 직접 입력하지 않는다(동을 더해도 늘 맞는다) */}
                <tr data-testid="rowtable-total" className="bg-brand-tint">
                  {cols.map((c, ci) => {
                    if (ci === 0) return <td key={c.key} className={`${td} text-center text-form-xs font-semibold text-ink-sub`}>합계</td>
                    const t = c.total && colOn(c) ? columnTotal(shown, c.key) : null
                    return <td key={c.key} data-total={c.key}
                      className={`${td} text-center text-form-xs font-semibold tabular-nums text-ink`}>{t ?? ''}</td>
                  })}
                  {!dis && <td className={td} />}
                </tr>
                {shown.map((r, i) => (
                  <tr key={i}>
                    {cols.map(c => {
                      const on = colOn(c)
                      return (
                        <td key={c.key} className={td}>
                          <input
                            value={r[c.key] ?? ''} disabled={dis || !on}
                            list={c.key === 'dong' && dongChips.length > 0 ? dlId : undefined}
                            inputMode={c.type === 'number' ? 'decimal' : undefined}
                            aria-label={`${i + 1}행 ${c.label}`}
                            title={on ? undefined : `‘${c.enabledBy}’를 체크해야 입력할 수 있습니다`}
                            placeholder={on ? undefined : '—'}
                            onChange={e => setCell(i, c.key, e.target.value)}
                            className={`h-form-6 w-full min-w-0 rounded-sm border px-1 text-form-xs outline-none focus:border-brand ${
                              c.wide ? 'text-left' : 'text-center tabular-nums'} ${
                              on ? 'border-brand-line bg-surface' : 'border-transparent bg-[#f3f2f8] dark:bg-gray-100 text-ink-faint placeholder:text-[#d5d2e6] dark:placeholder:text-ink-faint cursor-not-allowed'}`} />
                        </td>
                      )
                    })}
                    {!dis && (
                      <td className={`${td} text-center`}>
                        <button type="button" aria-label={`${i + 1}행 삭제`} title="이 동 삭제"
                          disabled={shown.length <= 1 && rowIsEmpty(r)}
                          onClick={() => write(shown.filter((_, j) => j !== i))}
                          className="text-form-xs leading-none text-ink-faint hover:text-red-500 disabled:opacity-30">✕</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dongChips.length > 0 && (
            <datalist id={dlId}>{dongChips.map(nm => <option key={nm} value={nm} />)}</datalist>
          )}
          {!dis && (
            <div className="mt-1 flex items-center gap-2">
              <button type="button" onClick={() => write([...shown, nextDong ? { dong: nextDong } : {}])}
                className="inline-flex items-center gap-1 h-form-6 px-2 rounded-lg border border-brand-line text-form-2xs font-medium text-brand hover:bg-brand-tint transition-colors">
                + 동 추가{nextDong ? ` (${nextDong})` : ''}
              </button>
              <span className="text-form-2xs text-ink-meta">
                합계는 동별 행의 자동 합산입니다 · 체크한 종류의 칸만 열립니다
              </span>
            </div>
          )}
        </div>
      )
    }
    if (f.type === 'select') {
      return (
        <select value={v as string} disabled={dis} aria-label={f.label}
          onChange={e => setField(secKey, bl.key, f.key, e.target.value)} className={box}>
          <option value="">—</option>
          {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    // 소방계획서_9: 동명·층 텍스트 필드는 칩 클릭만으로 입력 (직접 타이핑 병행)
    const isDongField = f.type === 'text' && (f.key === 'dong' || f.key.endsWith('_dong'))
    const isFloorField = f.type === 'text' && (f.key === 'floor' || f.key.endsWith('_floor'))
    const chipCls = 'h-5 px-1.5 rounded border border-brand-line text-form-2xs text-brand hover:bg-brand-tint transition-colors'
    // S4-4: 수량형 숫자 필드만 ± 스테퍼 — 용량·치수(㎥·㎾·MPa·ℓ·m 등)는 ±1이 무의미해 직접 입력 유지.
    // 강조 링(box)을 건드리지 않도록 NumField 대신 같은 증감 규칙(bumpNumber)으로 좌우 버튼만 붙인다.
    const isCountField = f.type === 'number' && !!f.unit && COUNT_UNITS.has(f.unit)
    const stepBtnCls = 'shrink-0 grid place-items-center size-6 rounded border border-brand-line text-ink-sub hover:bg-brand-tint disabled:opacity-40 disabled:hover:bg-transparent text-form-base leading-none select-none'
    const stepBtn = (dir: 1 | -1) => (
      <button type="button" disabled={dis} className={stepBtnCls}
        aria-label={`${f.label} ${dir === 1 ? '1 증가' : '1 감소'}`}
        onClick={() => {
          const next = bumpNumber(String(v ?? ''), dir)
          if (next !== null) setField(secKey, bl.key, f.key, next)
        }}>{dir === 1 ? '+' : '−'}</button>
    )
    return (
      <div>
        <div className="flex items-center gap-1">
          {isCountField && stepBtn(-1)}
          <input value={v as string} disabled={dis} aria-label={f.label}
            inputMode={f.type === 'number' ? 'decimal' : undefined}
            onChange={e => setField(secKey, bl.key, f.key, e.target.value)} className={box} />
          {f.unit && <span className="text-form-2xs text-ink-meta shrink-0">{f.unit}</span>}
          {isCountField && stepBtn(1)}
        </div>
        {!dis && isDongField && dongChips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {dongChips.map(nm => (
              <button key={nm} type="button" onClick={() => setField(secKey, bl.key, f.key, nm)} className={chipCls}>{nm}</button>
            ))}
          </div>
        )}
        {!dis && isFloorField && floorChips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {floorChips.map(c => (
              <button key={c.label} type="button" className={chipCls}
                title={`클릭 = 층${bl.fields.some(x => x.key === f.key.replace(/floor$/, 'ground')) ? ' + 지상/지하' : ''} 입력`}
                onClick={() => {
                  setField(secKey, bl.key, f.key, c.floor)
                  const groundKey = f.key.replace(/floor$/, 'ground')
                  if (bl.fields.some(x => x.key === groundKey)) setField(secKey, bl.key, groundKey, c.ground)
                }}>{c.label}</button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <details ref={detailsRef} className="rounded-xl border border-brand-line-soft bg-brand-tint px-4 py-2"
      onToggle={e => { if ((e.target as HTMLDetailsElement).open) fetchInspected() }}>
      <summary className="text-form-sm font-semibold text-ink-sub cursor-pointer select-none">
        설비 대장 — 별지 3. 소방시설등의 세부현황
        <span className="ml-1.5 font-normal text-ink-meta">(섹션 3-1~3-8 = 별지 4호 3~7쪽·9호 4~7쪽과 번호 동일)</span>
        {/* D-17 완성도 게이지 클릭 = 빈칸만 보기 토글 */}
        <button type="button"
          onClick={e => { e.preventDefault(); e.stopPropagation(); detailsRef.current?.setAttribute('open', ''); toggleEmptyOnly() }}
          title="클릭하면 미입력 칸만 모아 봅니다 (다시 클릭 = 전체 보기)"
          className={`ml-2 font-normal hover:underline ${emptySnap ? 'text-amber-600 font-semibold' : 'text-brand'}`}>
          제원 입력 {gauge.filledAll}/{CATALOG_TOTAL} — 설치 설비 기준 {gauge.filledOn}/{gauge.totalOn}
        </button>
      </summary>

      <div className="mt-2 space-y-2">
        <p className="text-form-xs text-ink-sub">
          <span className="inline-flex items-center rounded bg-brand/10 px-1.5 py-0.5 text-form-2xs font-semibold text-brand mr-1">입력</span>
          이 영역이 설비 제원의 단일 원본입니다 — 별지 4호 1·2쪽 대상물·점검결과는
          <span className="inline-flex items-center rounded bg-brand-line-soft px-1.5 py-0.5 text-form-2xs font-semibold text-ink-sub mx-1">자동</span>
          (고객정보·점검표에서 채움). 설치(√)한 설비 블록만 펼쳐 입력합니다.
        </p>
        {/* 여기 넣은 제원이 소방계획서 본문에 안 보인다는 문의가 반복된다(2026-08-20) —
            소방계획서 템플릿은 customer_facility_specs를 아예 읽지 않는다(설비 체크 목록만 인쇄).
            같은 '1.4' 카드 안에서 두 층위가 서로 다른 문서로 가는 게 원인이라 인쇄처를 못박아 둔다. */}
        <p className="rounded-lg border border-brand-line bg-brand-tint px-3 py-1.5 text-form-xs text-ink-sub">
          <span className="inline-flex items-center rounded bg-brand/10 px-1.5 py-0.5 text-form-2xs font-semibold text-brand mr-1">인쇄처</span>
          여기 입력한 제원(설치장소·수량·규격 등)은 <b>별지 9호 4~7쪽 · 별지 4호 3~7쪽</b>에 인쇄됩니다.
          <b> 소방계획서 본문(서식 1.4)에는 설비 체크 목록만</b> 나가고 제원은 실리지 않습니다.
        </p>

        {/* D-17 9호發 복귀 바 — 안내칩으로 넘어온 경우에만 */}
        {fromReport9 && (
          <div className="flex items-center gap-2 rounded-lg bg-brand-tint border border-brand-line px-3 py-1.5 text-form-xs text-ink-sub">
            <span>별지 9호에서 넘어왔습니다 — 세부현황(4~7쪽)은 여기서만 입력하고, 저장하면 9호에 바로 반영됩니다</span>
            <button type="button"
              onClick={() => {
                // 새 탭(ctrl-click) 진입은 히스토리가 없어 back이 무동작 — 별지서식 탭으로 폴백
                if (window.history.length > 1) { router.back(); return }
                // ⚠ 여기는 고객 상세 = **같은 경로**다. router.push로 ?tab=annex를 밀어도 서버가
                //   재렌더되지 않아 활성 탭이 소방계획서인 채로 남는다(소방계획서_34 S4-4).
                //   탭 셸 컨텍스트로 직접 전환하면 미저장 확인창도 그대로 존중된다.
                if (tabsShell) tabsShell.goTab('annex')
                else window.location.assign(`/customers/${customerId}?tab=annex`)
              }}
              className="ml-auto inline-flex items-center gap-1 h-form-6 px-2 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-xs font-medium shrink-0">
              <CornerUpLeft className="size-3" /> ⑨ 9호로 돌아가기
            </button>
          </div>
        )}

        {/* 소방계획서_8 D-13·D-18: 사용처 칩 + 스플릿 토글 — 이 입력이 어느 문서에 쓰이는지 */}
        <div className="flex items-center gap-1.5 flex-wrap text-form-2xs">
          <span className="text-ink-meta font-medium">사용처:</span>
          <span className="px-1.5 py-0.5 rounded-full bg-brand-line-soft text-ink-sub font-medium">④ 별지 4호 3~7쪽</span>
          <span className="px-1.5 py-0.5 rounded-full bg-brand-line-soft text-ink-sub font-medium">⑨ 별지 9호 4~7쪽</span>
          <span className="px-1.5 py-0.5 rounded-full bg-brand-line-soft text-ink-sub font-medium">📘 계획서 1.4</span>
          {/* D-17 교차 검증 칩 — 점검표엔 응답이 있는데 제원이 전부 빈 설비 블록 */}
          {crossWarnCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-700 font-medium"
              title={`${inspected?.label} 점검표에 ○× 응답이 있는 설비인데 제원(세부현황)이 비어 있습니다 — 해당 블록에 ⚠ 표시`}>
              ⚠ 점검함·제원 미입력 {crossWarnCount}곳{inspected?.label ? ` (${inspected.label} 점검표 기준)` : ''}
            </span>
          )}
          {canManage && (
            <button type="button" onClick={fillDefaults}
              className="ml-auto md:ml-0 inline-flex items-center gap-1 h-form-6 px-2 rounded-lg border border-brand-line text-form-xs font-medium text-brand hover:bg-brand-tint transition-colors"
              title="동명(건물명)·층 범위(전체층)·소화기 수량(1.4 층별 표 합계)을 빈 칸에만 자동 입력합니다 — 기존 입력은 건드리지 않음">
              <Wand2 className="size-3" /> 기본값 채우기
            </button>
          )}
          <button type="button" onClick={toggleEmptyOnly}
            className={`${canManage ? '' : 'ml-auto md:ml-0 '}inline-flex items-center gap-1 h-form-6 px-2 rounded-lg border text-form-xs font-medium transition-colors ${
              emptySnap ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`}
            title="미입력 칸만 모아 보기 — 마무리 단계에서 빠르게 소진 (완성도 게이지 클릭과 동일)">
            {emptySnap ? '전체 보기' : '빈칸만 보기'}
          </button>
          <button type="button" onClick={toggleSplit}
            className={`hidden md:inline-flex items-center gap-1 md:ml-auto h-form-6 px-2 rounded-lg border text-form-xs font-medium transition-colors ${
              splitOn ? 'border-brand bg-brand-tint text-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`}
            title="입력하면서 별지 9호 세부현황(4~7쪽)에 어떻게 찍히는지 나란히 확인 — 저장 시 실시간 갱신">
            <Eye className="size-3" /> {splitOn ? '미리보기 닫기' : '문서 미리보기 나란히'}
          </button>
        </div>

        {/* D-17 빈칸만 보기 상태 바 */}
        {emptySnap && (
          <p className="text-form-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            🔍 빈칸만 보기 — 남은 미입력 {emptyRemaining}칸{emptyRemaining < emptySnap.size ? ` (채움 ${emptySnap.size - emptyRemaining}칸)` : ''} ·
            채워도 목록은 유지됩니다. 끝나면 <button type="button" onClick={toggleEmptyOnly} className="underline font-medium">전체 보기</button>로 복귀
          </p>
        )}

        <div className={splitOn ? 'md:flex md:gap-3 md:items-start' : ''}>
        <div className={`space-y-2 ${splitOn ? 'md:w-1/2' : ''}`}>
        {FACILITY_SPEC_SECTIONS.map(sec => {
          const g = gauge.per[sec.key]
          // 빈칸만 보기(D-17): 스냅샷에 든 필드가 있는 섹션만, 강제 펼침
          const secSnap = emptySnap ? [...emptySnap].filter(k => k.startsWith(`${sec.key}.`)) : null
          if (secSnap && secSnap.length === 0) return null
          const secOpen = secSnap ? true : openSec === sec.key
          const pct = g.total > 0 ? Math.round((g.filled / g.total) * 100) : 0
          return (
            <div key={sec.key} data-spec-section={sec.key} className="rounded-lg border border-brand-line-soft bg-surface">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <button type="button" onClick={() => { setOpenSec(secOpen ? null : sec.key); setNotice(null) }}
                  className="flex flex-1 items-center gap-2 text-left min-w-0">
                  {secOpen ? <ChevronDown className="size-3.5 text-ink-faint shrink-0" /> : <ChevronRight className="size-3.5 text-ink-faint shrink-0" />}
                  <span className="text-form-sm font-semibold text-ink truncate">{sec.no} {sec.label}</span>
                  {dirty[sec.key] && <span className="text-form-2xs text-amber-500">● 미저장</span>}
                  {/* T-2a 점검 결과 배지 — 최신 자체점검 회차 기준, 읽기 전용. 별지9호 3쪽과 같은 판정 로직 */}
                  {(() => {
                    const badge = sectionBadge(sec)
                    if (!badge) return null
                    const round = inspected?.label ? `${inspected.label} ` : ''
                    const codes = badge.codes.join('·')
                    if (badge.mark === 'X') return (
                      <span data-testid={`spec-mark-${sec.key}`} title={`${round}점검 결과 불량 — ${codes}`}
                        className="shrink-0 text-form-2xs font-semibold text-red-600">× 불량 {badge.defects}건</span>
                    )
                    if (badge.mark === 'O') return (
                      <span data-testid={`spec-mark-${sec.key}`} title={`${round}점검 결과 양호 — ${codes}`}
                        className="shrink-0 text-form-2xs font-semibold text-green-600">○ 양호</span>
                    )
                    if (badge.mark === 'N') return (
                      <span data-testid={`spec-mark-${sec.key}`} title={`미설치로 해당없음 — ${codes}`}
                        className="shrink-0 text-form-2xs text-ink-meta">／ 해당없음</span>
                    )
                    return (
                      <span data-testid={`spec-mark-${sec.key}`} title={`${round}점검표에 이 설비 응답이 없습니다 — ${codes}`}
                        className="shrink-0 text-form-2xs text-amber-600">점검 미입력</span>
                    )
                  })()}
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    <span className="h-1 w-16 rounded bg-brand-line-soft overflow-hidden">
                      <span className="block h-full bg-brand" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-form-2xs text-ink-sub tabular-nums">{g.total > 0 ? `${g.filled}/${g.total}` : '—'}</span>
                  </span>
                </button>
              </div>

              {secOpen && (
                <div className="border-t border-brand-line-soft px-3 py-2 space-y-2">
                  {sec.blocks.map(bl => {
                    const on = enabled(bl)
                    const bid = `${sec.key}.${bl.key}`
                    // 빈칸만 보기: 스냅샷 필드가 있는 블록만, 강제 펼침
                    if (secSnap && !secSnap.some(k => k.startsWith(`${bid}.`))) return null
                    const blOpen = secSnap ? on : on && !!openBlocks[bid]
                    const blFilled = bl.fields.filter(f => filledAt(sec.key, bl, f)).length
                    const warn = crossWarn(sec.key, bl)
                    return (
                      <div key={bl.key} data-spec-block={bl.key}
                        className={`rounded-lg border ${on ? 'border-brand-line-soft' : 'border-brand-line-soft bg-paper'}`}>
                        <button type="button"
                          onClick={() => {
                            if (!on) { setNotice(notice === bid ? null : bid); return }
                            setOpenBlocks(p => ({ ...p, [bid]: !p[bid] }))
                          }}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
                          {on
                            ? (blOpen ? <ChevronDown className="size-3 text-ink-faint shrink-0" /> : <ChevronRight className="size-3 text-ink-faint shrink-0" />)
                            : <span className="inline-flex items-center rounded bg-brand-line-soft px-1.5 py-0.5 text-form-2xs text-ink-meta shrink-0">미설치</span>}
                          <span className={`text-form-xs ${on ? 'font-medium text-ink' : 'text-ink-meta'}`}>{bl.label}</span>
                          {/* D-17 교차 검증 칩 — 점검표 응답은 있는데 제원이 전부 빈 블록 */}
                          {warn && (
                            <span className="text-form-2xs text-amber-700 bg-amber-50 border border-amber-300 rounded-full px-1.5 py-px font-medium shrink-0"
                              title={`${inspected?.label} 점검표에 이 설비의 ○× 응답이 있는데 제원은 비어 있습니다`}>
                              ⚠ 점검함·제원 미입력
                            </span>
                          )}
                          {on && blFilled > 0 && <span className="ml-auto text-form-2xs text-brand tabular-nums">{blFilled}/{bl.fields.length}</span>}
                        </button>
                        {!on && notice === bid && (
                          <p className="px-2.5 pb-1.5 text-form-2xs text-ink-sub">
                            1.4 설비 표에서 &lsquo;{hintCodes(bl)[0]}&rsquo;{hintCodes(bl).length > 1 ? ' 등' : ''} 설치 체크 후 입력할 수 있습니다.
                          </p>
                        )}
                        {blOpen && (
                          <div className="border-t border-brand-line-soft px-2.5 py-2">
                            {receiverLocation && (bl.key === 'fire_detection' || bl.key === 'fire_alert') && (
                              <p className="mb-1.5 text-form-2xs text-ink-meta">
                                <span className="inline-flex items-center rounded bg-brand-line-soft px-1 py-px font-semibold text-ink-sub mr-1">자동</span>
                                빠른 입력의 수신기 위치: {receiverLocation} — 수정은 계획서 정보(1.1)에서
                              </p>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1.5">
                              {/* 서식 줄 머리글(◦ 설치장소 등) — f.group이 바뀌는 자리에 한 번만 끼운다.
                                  '빈칸만 보기'로 필드가 걸러지면 남은 목록 기준으로 다시 계산된다. */}
                              {(() => {
                                const shown = bl.fields.filter(f => !secSnap || secSnap.includes(`${bid}.${f.key}`))
                                // group이 같은 연속 구간 단위로 묶는다 — 머리글은 구간당 한 번
                                const runs: Array<{ group?: string; fields: SpecField[] }> = []
                                for (const f of shown) {
                                  const last = runs[runs.length - 1]
                                  if (last && last.group === f.group) last.fields.push(f)
                                  else runs.push({ group: f.group, fields: [f] })
                                }
                                return runs.flatMap((run, ri) => {
                                  const gid = `${bid}:${run.group ?? ''}#${ri}`
                                  // 전부 비었고 접기 대상이면 버튼만 — '빈칸만 보기'에서는 접지 않는다(찾으러 온 칸이다)
                                  const collapsible = !secSnap && !!run.group
                                    && run.fields.every(f => f.collapsedWhenEmpty)
                                    && run.fields.every(f => !filledAt(sec.key, bl, f))
                                  if (collapsible && !openGroups[gid]) {
                                    return [
                                      <button key={gid} type="button" disabled={!on}
                                        onClick={() => setOpenGroups(p => ({ ...p, [gid]: true }))}
                                        className="col-span-full mt-1 justify-self-start rounded border border-dashed border-brand-line px-2 py-0.5 text-form-2xs text-brand hover:bg-brand-tint disabled:opacity-50">
                                        + {run.group} 입력 <span className="text-ink-meta">(동이 둘 이상일 때만)</span>
                                      </button>,
                                    ]
                                  }
                                  return [
                                    ...(run.group
                                      ? [
                                        <p key={gid}
                                          className="col-span-full mt-1 mb-0 text-form-2xs font-semibold text-ink-sub">
                                          ◦ {run.group}
                                        </p>,
                                      ]
                                      : []),
                                    ...run.fields.map(f => (
                                      <div key={f.key} data-spec-field={`${bid}.${f.key}`}
                                        className={f.type === 'multicheck' || f.type === 'rowtable' ? 'col-span-full' : ''}>
                                        <p className="mb-0.5 text-form-2xs text-ink-sub">
                                          {f.label}{f.unit ? ` (${f.unit})` : ''}
                                          {secSnap && filledAt(sec.key, bl, f) && <span className="ml-1 text-green-600">✓</span>}
                                        </p>
                                        {fieldWidget(sec.key, bl, f, on)}
                                      </div>
                                    )),
                                  ]
                                })
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {msg && <p className="text-form-sm text-ink-sub">{msg}</p>}
        {/* 2026-08-08(B안): 여기 있던 sticky [모두 저장]을 폐지했다. 제원만 저장해 본문(1.4 표)이 남는 바람에
            별지 9호 3쪽에 '부모 피난기구 빈칸 + 하위 종류 √' 같은 모순이 인쇄될 수 있었다(소방계획서_12 K-2의 잔반).
            저장 버튼은 패널 푸터의 통합 [저장] 하나뿐이고, 소유자는 부모(plan-form14)다. */}
        </div>

        {/* D-13 스플릿 우측 — 별지 9호 세부현황 실시간 미리보기 (저장 시 재렌더, 데스크톱 전용) */}
        {splitOn && (
          <div className="hidden md:block md:w-1/2 sticky top-2">
            <p className="text-form-2xs text-ink-meta mb-1">
              ⑨ 별지 9호 미리보기 — 제원 저장 시 즉시 갱신 · 빈칸은 노란 하이라이트
              {splitLoading && <Loader2 className="inline size-3 animate-spin ml-1" />}
            </p>
            {splitErr ? (
              <p className="text-form-xs text-amber-600 bg-surface rounded-lg border border-brand-line-soft p-3">{splitErr}</p>
            ) : splitHtml ? (
              // F-2(소방계획서_37) — 고정 640px은 세로가 남는 화면에서 미리보기를 괜히 좁게 만든다.
              // vh 기준으로 두되 상한을 둬, 아주 큰 화면에서 한 쪽이 과도하게 길어지지 않게 한다.
              <iframe srcDoc={splitHtml} title="별지 9호 미리보기" className="w-full h-[min(78vh,900px)] bg-surface rounded-lg border border-brand-line-soft" />
            ) : (
              <div className="h-64 bg-surface rounded-lg border border-brand-line-soft animate-pulse" />
            )}
          </div>
        )}
        </div>
      </div>
    </details>
  )
}
