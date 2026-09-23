'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { REPORT_INPUT_TABS, nextGapTab, type ReportGap, type ReportInputTab } from '@/lib/workbook-notice'
import { useCustomerTabs } from '@/components/customers/customer-tabs'

/** 보고서 준비도 (2026-09-23 사용자 요청 「기본정보~보고서 탭을 입력하도록 유도 — 보고서 엑셀을 채우려면」)
 *
 *  탭 뱃지(빈칸 수)와 탭 상단 목록이 **같은 한 번의 조회**를 나눠 쓴다 — 각자 부르면 둘이 다른 순간의
 *  답을 보여 줄 수 있다. 조회는 화면이 뜬 **뒤**에 한다(`/customers/[id]/report-gaps` 주석 참고).
 *  탭을 옮길 때마다 다시 센다 — 저장하고 다음 탭으로 가면 방금 채운 칸이 뱃지에서 빠진다. */

type ByTab = Record<ReportInputTab, ReportGap[]>
type State = { byTab: ByTab | null; roundLabel: string | null; loaded: boolean }
type Ctx = State & { refresh: () => void; returnHref: string }

const ReportGapsContext = createContext<Ctx | null>(null)
export function useReportGaps() {
  return useContext(ReportGapsContext)
}

export const REPORT_TAB_LABEL: Record<ReportInputTab, string> = {
  info: '기본정보', buildings: '건물·시설', contacts: '관계인', facilities: '공통', reports: '보고서',
}

export function ReportGapsProvider({ customerId, returnHref = '', enabled = true, children }: {
  customerId: string
  /** 보고서 엑셀을 받을 권한이 없으면 부르지 않는다(라우트가 403) — 목록·뱃지는 그대로 안 그려진다 */
  enabled?: boolean
  /** 달력 등에서 왔을 때의 복귀 주소(서버가 내부 경로로 검증한 값) — 다 채웠을 때 돌아갈 길 */
  returnHref?: string
  children: ReactNode
}) {
  const [state, setState] = useState<State>({ byTab: null, roundLabel: null, loaded: false })
  // 첫 응답이 고른 회차를 기억한다 — 이후엔 회차 판정(무거운 조회)을 되풀이하지 않는다
  const inspRef = useRef<string | null>(null)
  const labelRef = useRef<string | null>(null)
  // 늦게 도착한 옛 응답이 새 응답을 덮지 않게 — 마지막 요청만 반영한다
  const seqRef = useRef(0)

  const lastAtRef = useRef(0)
  const refresh = useCallback(() => {
    if (!enabled) return
    // 마운트 직후 공급자와 열린 탭의 목록이 동시에 부른다 — 0.8초 안의 중복은 하나로 친다
    const now = Date.now()
    if (now - lastAtRef.current < 800) return
    lastAtRef.current = now
    const seq = ++seqRef.current
    const q = inspRef.current ? `?inspection=${inspRef.current}` : ''
    fetch(`/customers/${customerId}/report-gaps${q}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: { inspectionId: string | null; roundLabel: string | null; byTab: ByTab | null } | null) => {
        if (seq !== seqRef.current) return
        // 실패는 「빈칸 0」이 아니다 — 아무것도 그리지 않는다(0은 「다 찼다」로 읽힌다)
        if (!j) { setState(s => ({ ...s, loaded: true })); return }
        if (j.inspectionId && !inspRef.current) { inspRef.current = j.inspectionId; labelRef.current = j.roundLabel }
        setState({ byTab: j.byTab, roundLabel: labelRef.current, loaded: true })
      })
      .catch(() => { if (seq === seqRef.current) setState(s => ({ ...s, loaded: true })) })
  }, [customerId, enabled])

  useEffect(() => { refresh() }, [refresh])

  return (
    <ReportGapsContext.Provider value={{ ...state, refresh, returnHref }}>
      {children}
    </ReportGapsContext.Provider>
  )
}

/** 점검달력 사이드바 [보고서] 칸이 쓰는 빈칸 요약 — **수와 첫 빈 탭**만 (2026-09-23 image-14).
 *
 *  🚨 종전 판은 탭별 칩 묶음([기본정보 1][관계인 1][보고서 3])을 그렸는데, 소방계획서 칸과 모양이 달라
 *    사이드바가 산만했다(사용자). 이제 제목줄에 「빈칸 N」만, [입력하기]가 **첫 빈 탭**으로 간다 —
 *    칸 이름은 그 탭 맨 위 목록과 「다음 빈 탭 →」이 안내한다(두 곳에서 같은 말을 하지 않는다).
 *  판정 불가(회차 없음·실패·불러오는 중)는 null — 0(「다 찼다」)으로 그리지 않는다. */
export function useReportGapSummary(customerId: string | null, inspectionId: string | null) {
  const [byTab, setByTab] = useState<ByTab | null>(null)
  useEffect(() => {
    setByTab(null)
    if (!customerId || !inspectionId) return
    let alive = true
    fetch(`/customers/${customerId}/report-gaps?inspection=${inspectionId}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: { byTab: ByTab | null } | null) => { if (alive) setByTab(j?.byTab ?? null) })
      .catch(() => {})
    return () => { alive = false }
  }, [customerId, inspectionId])
  if (!byTab) return null
  const total = REPORT_INPUT_TABS.reduce((n, k) => n + byTab[k].length, 0)
  const tabs = REPORT_INPUT_TABS.filter(k => byTab[k].length > 0)
  return { byTab, total, title: tabs.map(k => `${REPORT_TAB_LABEL[k]} ${byTab[k].length}`).join(' · ') }
}

/** 탭 바 옆 빈칸 수 — 공급자 밖이거나 판정 불가면 아무것도 그리지 않는다 */
export function ReportGapCount({ tabKey }: { tabKey: string }) {
  const g = useReportGaps()
  if (!g?.byTab || !(REPORT_INPUT_TABS as readonly string[]).includes(tabKey)) return null
  const n = g.byTab[tabKey as ReportInputTab].length
  if (n === 0) return null
  return (
    <span data-testid={`tab-gap-${tabKey}`} title={`보고서 엑셀에 빈칸 ${n}개 — 이 탭에서 채웁니다`}
      className="inline-flex items-center justify-center min-w-[1.25rem] h-[1.25rem] px-1 rounded-full bg-rose-100 text-rose-700 text-form-2xs font-semibold">
      {n}
    </span>
  )
}

/** 탭 상단 목록 — 「이 탭에서 채울 칸」과 「다음 빈 탭 →」 */
export function ReportGapsStrip({ tabKey }: { tabKey: ReportInputTab }) {
  const g = useReportGaps()
  const tabs = useCustomerTabs()
  // 이 탭이 **열릴 때** 다시 센다 — 앞 탭에서 저장하고 넘어오면 방금 채운 칸이 빠져 있어야 한다.
  // ⚠ 첫 마운트를 건너뛰면 안 된다: 공통·보고서는 지연 마운트라 **처음 열 때가 곧 마운트**다.
  //   공급자의 첫 조회와 겹치는 것은 공급자가 합친다(짧은 간격 중복 무시).
  const active = tabs?.activeTab === tabKey
  const refresh = g?.refresh
  useEffect(() => {
    if (active) refresh?.()
  }, [active, refresh])
  if (!g?.byTab) return null
  const mine = g.byTab[tabKey]
  const next = nextGapTab(g.byTab, tabKey)
  // 회차 이름은 문장 끝에 「· N차 기준」으로 — 괄호 안에 넣으면 「(2026년 2차 (작동))」처럼 겹친다
  const round = g.roundLabel ? ` · ${g.roundLabel} 기준` : ''
  const back = g.returnHref ? (
    <Link href={g.returnHref} data-testid="report-gaps-return"
      className="text-form-xs font-medium text-brand hover:underline shrink-0">점검달력으로 돌아가기</Link>
  ) : null
  const goNext = next ? (
    <button type="button" data-testid="report-gaps-next" onClick={() => tabs?.goTab(next)}
      className="inline-flex items-center gap-1 h-form-7 px-2.5 rounded-lg bg-brand text-white text-form-xs font-medium hover:opacity-90 shrink-0">
      다음 빈 탭: {REPORT_TAB_LABEL[next]} →
    </button>
  ) : null

  if (mine.length === 0) {
    return (
      <div data-testid={`report-gaps-strip-${tabKey}`} data-gaps="0"
        className={`flex items-center gap-2 flex-wrap rounded-lg border px-3 py-1.5 text-form-xs ${next ? 'border-line bg-paper text-ink-sub' : 'border-green-200 bg-green-50 text-green-800'}`}>
        <span className="flex-1">
          {next ? `✓ 이 탭은 보고서 엑셀 빈칸이 없습니다${round}` : `✓ 보고서 엑셀에 필요한 칸을 모두 채웠습니다${round}`}
        </span>
        {goNext}
        {back}
      </div>
    )
  }
  return (
    <div data-testid={`report-gaps-strip-${tabKey}`} data-gaps={mine.length}
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex-1 text-form-sm font-semibold text-rose-800">
          보고서 엑셀에 빈칸으로 나갈 칸 {mine.length}개 — 이 탭에서 채웁니다<span className="font-normal text-rose-600">{round}</span>
        </span>
        {goNext}
        {back}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {mine.map(m => (
          <li key={m.short} title={m.text}
            className="rounded-full border border-rose-200 bg-surface px-2 py-0.5 text-form-xs text-rose-800">
            {tabKey === 'facilities' && <span className="text-rose-500 mr-1">{m.target === 'common11' ? '1.1' : '1.4'}</span>}
            {m.short}
          </li>
        ))}
      </ul>
    </div>
  )
}
