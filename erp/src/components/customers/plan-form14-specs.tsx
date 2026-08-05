'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, CornerUpLeft, Eye, Loader2, Save } from 'lucide-react'
import { saveFacilitySpecAction, getInspectedFacilityCodesAction } from '@/app/(dashboard)/customers/facility-spec-actions'
import { getCustomerRoundsAction } from '@/app/(dashboard)/reports/docs-actions'
import { getAnnexPreviewHtmlAction } from '@/app/(dashboard)/inspections/report9-actions'
import { FACILITY_SPEC_SECTIONS, type SpecBlock, type SpecField } from '@/lib/facility-spec-schema'

/** 설비 대장 — 설비 세부 제원 입력 (S3A/H-19, 소방계획서_7.md §4-A-2)
 *  별지 4호 3~7쪽 = 별지 9호 4~7쪽 "소방시설등의 세부 현황" 공용 원본(customer_facility_specs).
 *  폼은 H-18 카탈로그(FACILITY_SPEC_SECTIONS)만으로 렌더 — 필드 하드코딩 금지.
 *  facilityHint 블록은 1.4 표에서 설치(√)된 설비만 펼침 가능(§4-A-2 입력량 최소화),
 *  힌트 없는 블록(3-2 수계 공통 등)은 항상 입력 가능. 저장은 섹션 단위(건물 축 = 1.4의 bidx). */

type FieldValue = string | boolean | string[]
type SectionValues = Record<string, Record<string, FieldValue>> // blockKey → fieldKey → 값

function initFieldValue(f: SpecField, raw: unknown): FieldValue {
  if (f.type === 'check') return raw === true
  if (f.type === 'multicheck') return Array.isArray(raw) ? raw.map(String) : []
  return raw == null ? '' : String(raw)
}
function isFilled(v: FieldValue): boolean {
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.length > 0
  return v.trim() !== ''
}
function hintCodes(b: SpecBlock): string[] {
  return (b.facilityHint ?? '').split(',').map(c => c.trim()).filter(Boolean)
}

const CATALOG_TOTAL = FACILITY_SPEC_SECTIONS.reduce(
  (n, s) => n + s.blocks.reduce((m, b) => m + b.fields.length, 0), 0)

export function PlanForm14Specs({ customerId, buildingId, installed, initialSpecs, receiverLocation, canManage }: {
  customerId: string
  buildingId: string
  /** 1.4 표의 현재 설치(√) 상태 — facility_code → installed (라이브 연동) */
  installed: Record<string, boolean>
  /** 서버 초기값: sectionKey → { blockKey: { fieldKey: 값 } } */
  initialSpecs: Record<string, Record<string, unknown>>
  /** 기존 필드 자동 연결(§4-A-1) — 빠른 입력의 수신기 위치(회색 표시, 재입력 금지) */
  receiverLocation?: string | null
  canManage: boolean
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
      out[sec.key] = sv
    }
    return out
  })
  const [openSec, setOpenSec] = useState<string | null>(null)
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({})
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
  const [savingSec, setSavingSec] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()
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
      })
      .catch(() => {})
  }

  const enabled = (b: SpecBlock) => !b.facilityHint || hintCodes(b).some(c => installed[c])

  /** 첫 빈칸 포커스 (D-17 9호發) — 설치 설비 기준 첫 미입력 필드의 섹션·블록을 열고 스크롤·포커스 */
  function focusFirstEmpty() {
    for (const sec of FACILITY_SPEC_SECTIONS) {
      for (const bl of sec.blocks) {
        if (bl.facilityHint && !hintCodes(bl).some(c => installed[c])) continue
        const f = bl.fields.find(fd => !isFilled(values[sec.key][bl.key][fd.key]))
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
    setFromReport9(true)
    detailsRef.current?.setAttribute('open', '')
    fetchInspected()
    openSplit(sp.get('insp'))
    focusFirstEmpty()
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
          if (!isFilled(values[sec.key][bl.key][f.key])) snap.add(`${sec.key}.${bl.key}.${f.key}`)
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
      if (!isFilled(values[sk]?.[bk]?.[fk] ?? '')) n++
    }
    return n
  }, [emptySnap, values])

  /** 교차 검증 대상 블록 판정 (D-17) — 점검표 응답 있는 설비 & 제원 전부 빈칸 */
  const crossWarn = (secKey: string, bl: SpecBlock): boolean => {
    if (!inspected || !bl.facilityHint) return false
    if (!enabled(bl)) return false
    if (!hintCodes(bl).some(c => inspected.codes.has(c))) return false
    return !bl.fields.some(f => isFilled(values[secKey][bl.key][f.key]))
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
          const filled = isFilled(values[sec.key][bl.key][fd.key])
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
  }

  function saveSection(secKey: string) {
    const sec = FACILITY_SPEC_SECTIONS.find(s => s.key === secKey)
    if (!sec || !canManage) return
    // 값 있는 필드만 JSONB로 — 비운 필드는 저장에서 제거(값 삭제), 미설치 블록의 기존 값도 보존
    const spec: Record<string, Record<string, unknown>> = {}
    for (const bl of sec.blocks) {
      const out: Record<string, unknown> = {}
      for (const f of bl.fields) {
        const v = values[secKey][bl.key][f.key]
        if (!isFilled(v)) continue
        if (f.type === 'number' && typeof v === 'string') {
          const n = Number(v)
          out[f.key] = Number.isFinite(n) ? n : v
        } else out[f.key] = v
      }
      if (Object.keys(out).length > 0) spec[bl.key] = out
    }
    setSavingSec(secKey)
    startTransition(async () => {
      const res = await saveFacilitySpecAction(customerId, buildingId, secKey, spec)
      setSavingSec(null)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(p => ({ ...p, [secKey]: false }))
      setMsg(`✅ ${sec.no} ${sec.label} 제원 저장됨 — 별지 4호(3~7쪽)·9호(4~7쪽) 세부현황에 반영됩니다`)
      if (splitOn && splitInspId) loadSplit(splitInspId)   // D-13: 저장 즉시 우측 미리보기 재렌더
    })
  }

  /** 필드 1개 위젯 — type별 렌더, 미입력은 옅은 주황 하이라이트(§4-A-2) */
  function fieldWidget(secKey: string, bl: SpecBlock, f: SpecField, blockOn: boolean) {
    const v = values[secKey][bl.key][f.key]
    const empty = !isFilled(v)
    const dis = !canManage || !blockOn
    const box = `h-7 w-full rounded border px-1.5 text-xs outline-none focus:border-[#7b68ee] disabled:opacity-60 ${
      empty ? 'border-amber-200 bg-amber-50/40' : 'border-[#d0ccf5] bg-white'}`
    if (f.type === 'check') {
      return (
        <button type="button" disabled={dis} onClick={() => setField(secKey, bl.key, f.key, !(v as boolean))}
          aria-label={f.label}
          className={`inline-flex items-center gap-1 h-7 text-xs ${v ? 'font-bold text-[#090c1d]' : 'text-[#514b81] hover:text-[#7b68ee]'} disabled:opacity-60`}>
          <span className="text-sm leading-none">{v ? '☑' : '☐'}</span> 해당
        </button>
      )
    }
    if (f.type === 'multicheck') {
      const arr = v as string[]
      return (
        <div className="flex flex-wrap gap-x-2.5 gap-y-1 py-1">
          {(f.options ?? []).map(o => {
            const on = arr.includes(o)
            return (
              <button key={o} type="button" disabled={dis}
                onClick={() => setField(secKey, bl.key, f.key, on ? arr.filter(x => x !== o) : [...arr, o])}
                className={`inline-flex items-center gap-1 text-[11px] ${on ? 'font-bold text-[#090c1d]' : 'text-[#514b81] hover:text-[#7b68ee]'} disabled:opacity-60`}>
                <span>{on ? '☑' : '☐'}</span>{o}
              </button>
            )
          })}
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
    return (
      <div className="flex items-center gap-1">
        <input value={v as string} disabled={dis} aria-label={f.label}
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          onChange={e => setField(secKey, bl.key, f.key, e.target.value)} className={box} />
        {f.unit && <span className="text-[10px] text-[#b0acd6] shrink-0">{f.unit}</span>}
      </div>
    )
  }

  return (
    <details ref={detailsRef} className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] px-4 py-2"
      onToggle={e => { if ((e.target as HTMLDetailsElement).open) fetchInspected() }}>
      <summary className="text-xs font-semibold text-[#514b81] cursor-pointer select-none">
        설비 대장 — 별지 3. 소방시설등의 세부현황
        <span className="ml-1.5 font-normal text-[#b0acd6]">(섹션 3-1~3-8 = 별지 4호 3~7쪽·9호 4~7쪽과 번호 동일)</span>
        {/* D-17 완성도 게이지 클릭 = 빈칸만 보기 토글 */}
        <button type="button"
          onClick={e => { e.preventDefault(); e.stopPropagation(); detailsRef.current?.setAttribute('open', ''); toggleEmptyOnly() }}
          title="클릭하면 미입력 칸만 모아 봅니다 (다시 클릭 = 전체 보기)"
          className={`ml-2 font-normal hover:underline ${emptySnap ? 'text-amber-600 font-semibold' : 'text-[#7b68ee]'}`}>
          제원 입력 {gauge.filledAll}/{CATALOG_TOTAL} — 설치 설비 기준 {gauge.filledOn}/{gauge.totalOn}
        </button>
      </summary>

      <div className="mt-2 space-y-2">
        <p className="text-[11px] text-[#514b81]">
          <span className="inline-flex items-center rounded bg-[#7b68ee]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#7b68ee] mr-1">입력</span>
          이 영역이 설비 제원의 단일 원본입니다 — 별지 4호 1·2쪽 대상물·점검결과는
          <span className="inline-flex items-center rounded bg-[#eeecf8] px-1.5 py-0.5 text-[10px] font-semibold text-[#514b81] mx-1">자동</span>
          (고객정보·점검표에서 채움). 설치(√)한 설비 블록만 펼쳐 입력합니다.
        </p>

        {/* D-17 9호發 복귀 바 — 안내칩으로 넘어온 경우에만 */}
        {fromReport9 && (
          <div className="flex items-center gap-2 rounded-lg bg-[#f5f4ff] border border-[#d0ccf5] px-3 py-1.5 text-[11px] text-[#514b81]">
            <span>별지 9호에서 넘어왔습니다 — 세부현황(4~7쪽)은 여기서만 입력하고, 저장하면 9호에 바로 반영됩니다</span>
            <button type="button" onClick={() => router.back()}
              className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium shrink-0">
              <CornerUpLeft className="size-3" /> ⑨ 9호로 돌아가기
            </button>
          </div>
        )}

        {/* 소방계획서_8 D-13·D-18: 사용처 칩 + 스플릿 토글 — 이 입력이 어느 문서에 쓰이는지 */}
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
          <span className="text-[#b0acd6] font-medium">사용처:</span>
          <span className="px-1.5 py-0.5 rounded-full bg-[#eeecf8] text-[#514b81] font-medium">④ 별지 4호 3~7쪽</span>
          <span className="px-1.5 py-0.5 rounded-full bg-[#eeecf8] text-[#514b81] font-medium">⑨ 별지 9호 4~7쪽</span>
          <span className="px-1.5 py-0.5 rounded-full bg-[#eeecf8] text-[#514b81] font-medium">📘 계획서 1.4</span>
          {/* D-17 교차 검증 칩 — 점검표엔 응답이 있는데 제원이 전부 빈 설비 블록 */}
          {crossWarnCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-700 font-medium"
              title={`${inspected?.label} 점검표에 ○× 응답이 있는 설비인데 제원(세부현황)이 비어 있습니다 — 해당 블록에 ⚠ 표시`}>
              ⚠ 점검함·제원 미입력 {crossWarnCount}곳{inspected?.label ? ` (${inspected.label} 점검표 기준)` : ''}
            </span>
          )}
          <button type="button" onClick={toggleEmptyOnly}
            className={`ml-auto md:ml-0 inline-flex items-center gap-1 h-6 px-2 rounded-lg border text-[11px] font-medium transition-colors ${
              emptySnap ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`}
            title="미입력 칸만 모아 보기 — 마무리 단계에서 빠르게 소진 (완성도 게이지 클릭과 동일)">
            {emptySnap ? '전체 보기' : '빈칸만 보기'}
          </button>
          <button type="button" onClick={toggleSplit}
            className={`hidden md:inline-flex items-center gap-1 md:ml-auto h-6 px-2 rounded-lg border text-[11px] font-medium transition-colors ${
              splitOn ? 'border-[#7b68ee] bg-[#f5f4ff] text-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`}
            title="입력하면서 별지 9호 세부현황(4~7쪽)에 어떻게 찍히는지 나란히 확인 — 저장 시 실시간 갱신">
            <Eye className="size-3" /> {splitOn ? '미리보기 닫기' : '문서 미리보기 나란히'}
          </button>
        </div>

        {/* D-17 빈칸만 보기 상태 바 */}
        {emptySnap && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
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
            <div key={sec.key} data-spec-section={sec.key} className="rounded-lg border border-[#e0ddf5] bg-white">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <button type="button" onClick={() => { setOpenSec(secOpen ? null : sec.key); setNotice(null) }}
                  className="flex flex-1 items-center gap-2 text-left min-w-0">
                  {secOpen ? <ChevronDown className="size-3.5 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />}
                  <span className="text-xs font-semibold text-[#090c1d] truncate">{sec.no} {sec.label}</span>
                  {dirty[sec.key] && <span className="text-[10px] text-amber-500">● 미저장</span>}
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    <span className="h-1 w-16 rounded bg-[#eeecf8] overflow-hidden">
                      <span className="block h-full bg-[#7b68ee]" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-[10px] text-[#514b81] tabular-nums">{g.total > 0 ? `${g.filled}/${g.total}` : '—'}</span>
                  </span>
                </button>
                {canManage && secOpen && (
                  <button type="button" onClick={() => saveSection(sec.key)} disabled={savingSec === sec.key}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded-lg bg-[#7b68ee] text-white text-[11px] font-medium disabled:opacity-50 shrink-0">
                    {savingSec === sec.key ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 제원 저장
                  </button>
                )}
              </div>

              {secOpen && (
                <div className="border-t border-[#eeecf8] px-3 py-2 space-y-2">
                  {sec.blocks.map(bl => {
                    const on = enabled(bl)
                    const bid = `${sec.key}.${bl.key}`
                    // 빈칸만 보기: 스냅샷 필드가 있는 블록만, 강제 펼침
                    if (secSnap && !secSnap.some(k => k.startsWith(`${bid}.`))) return null
                    const blOpen = secSnap ? on : on && !!openBlocks[bid]
                    const blFilled = bl.fields.filter(f => isFilled(values[sec.key][bl.key][f.key])).length
                    const warn = crossWarn(sec.key, bl)
                    return (
                      <div key={bl.key} data-spec-block={bl.key}
                        className={`rounded-lg border ${on ? 'border-[#e0ddf5]' : 'border-[#eeecf8] bg-[#f8f8fb]'}`}>
                        <button type="button"
                          onClick={() => {
                            if (!on) { setNotice(notice === bid ? null : bid); return }
                            setOpenBlocks(p => ({ ...p, [bid]: !p[bid] }))
                          }}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
                          {on
                            ? (blOpen ? <ChevronDown className="size-3 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3 text-[#b0acd6] shrink-0" />)
                            : <span className="inline-flex items-center rounded bg-[#eeecf8] px-1.5 py-0.5 text-[10px] text-[#b0acd6] shrink-0">미설치</span>}
                          <span className={`text-[11px] ${on ? 'font-medium text-[#090c1d]' : 'text-[#b0acd6]'}`}>{bl.label}</span>
                          {/* D-17 교차 검증 칩 — 점검표 응답은 있는데 제원이 전부 빈 블록 */}
                          {warn && (
                            <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-300 rounded-full px-1.5 py-px font-medium shrink-0"
                              title={`${inspected?.label} 점검표에 이 설비의 ○× 응답이 있는데 제원은 비어 있습니다`}>
                              ⚠ 점검함·제원 미입력
                            </span>
                          )}
                          {on && blFilled > 0 && <span className="ml-auto text-[10px] text-[#7b68ee] tabular-nums">{blFilled}/{bl.fields.length}</span>}
                        </button>
                        {!on && notice === bid && (
                          <p className="px-2.5 pb-1.5 text-[10px] text-[#514b81]">
                            1.4 설비 표에서 &lsquo;{hintCodes(bl)[0]}&rsquo;{hintCodes(bl).length > 1 ? ' 등' : ''} 설치 체크 후 입력할 수 있습니다.
                          </p>
                        )}
                        {blOpen && (
                          <div className="border-t border-[#eeecf8] px-2.5 py-2">
                            {receiverLocation && (bl.key === 'fire_detection' || bl.key === 'fire_alert') && (
                              <p className="mb-1.5 text-[10px] text-[#b0acd6]">
                                <span className="inline-flex items-center rounded bg-[#eeecf8] px-1 py-px font-semibold text-[#514b81] mr-1">자동</span>
                                빠른 입력의 수신기 위치: {receiverLocation} — 수정은 계획서 정보(1.1)에서
                              </p>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1.5">
                              {bl.fields
                                .filter(f => !secSnap || secSnap.includes(`${bid}.${f.key}`))
                                .map(f => (
                                  <div key={f.key} data-spec-field={`${bid}.${f.key}`}
                                    className={f.type === 'multicheck' ? 'col-span-full' : ''}>
                                    <p className="mb-0.5 text-[10px] text-[#514b81]">
                                      {f.label}{f.unit ? ` (${f.unit})` : ''}
                                      {secSnap && isFilled(values[sec.key][bl.key][f.key]) && <span className="ml-1 text-green-600">✓</span>}
                                    </p>
                                    {fieldWidget(sec.key, bl, f, on)}
                                  </div>
                                ))}
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
        {msg && <p className="text-xs text-[#514b81]">{msg}</p>}
        </div>

        {/* D-13 스플릿 우측 — 별지 9호 세부현황 실시간 미리보기 (저장 시 재렌더, 데스크톱 전용) */}
        {splitOn && (
          <div className="hidden md:block md:w-1/2 sticky top-2">
            <p className="text-[10px] text-[#b0acd6] mb-1">
              ⑨ 별지 9호 미리보기 — 제원 저장 시 즉시 갱신 · 빈칸은 노란 하이라이트
              {splitLoading && <Loader2 className="inline size-3 animate-spin ml-1" />}
            </p>
            {splitErr ? (
              <p className="text-[11px] text-amber-600 bg-white rounded-lg border border-[#e0ddf5] p-3">{splitErr}</p>
            ) : splitHtml ? (
              <iframe srcDoc={splitHtml} title="별지 9호 미리보기" className="w-full h-[640px] bg-white rounded-lg border border-[#e0ddf5]" />
            ) : (
              <div className="h-64 bg-white rounded-lg border border-[#e0ddf5] animate-pulse" />
            )}
          </div>
        )}
        </div>
      </div>
    </details>
  )
}
