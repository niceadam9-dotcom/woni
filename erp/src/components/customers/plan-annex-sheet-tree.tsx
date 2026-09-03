'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, ClipboardList, Loader2, RefreshCw } from 'lucide-react'
import { getInspectionSheetOverviewAction } from '@/app/(dashboard)/inspections/sheet-actions'
import type { SheetOverview, SheetProgress } from '@/lib/sheet-overview'
import { countBlanks, countRequiredItemBlanks, countCompBlanks } from '@/lib/sheet-blanks'
import { sheetShownWhenInstalledOnly } from '@/lib/sheet-facility-map'
import { useSheetResponsesRealtime } from '@/hooks/use-sheet-responses-realtime'

/** 회차별 작성·조회 트리의 점검표 노드 — **조회 전용** (소방계획서_28 S4).
 *
 *  종전에는 여기서 항목을 인라인으로 펼쳐 입력했다(소방계획서_16 S4). 그런데 같은 데이터를 입력하는
 *  화면이 넷으로 늘고 저장 규칙이 셋으로 갈리면서 "어디가 정본인가"가 사라졌다 —
 *  2026-08-24 물분무소화설비 결과칸 공란 사고가 그 대가였다. 입력은 전용 페이지 한 곳으로 모으고
 *  이 트리는 **진행률을 보여주고 그 자리로 보내는 일**만 한다.
 *
 *  남긴 것: 설비별 진행률·불량 수·[설치 설비만 보기]·[갱신]·Realtime 반영.
 *  옮긴 것: 항목 입력·[설치 설비 전체 양호]·[지난 회차 결과 불러오기]·불량 검색 → /inspections/{id}/sheet
 *
 *  ⚠ 이 컴포넌트에 '점검표 입력' 문자열을 **더 늘리지 말 것** —
 *     test-annex-interaction.mts가 그 문자열 개수로 회차 펼침 상태를 판정한다.
 *     (머리줄의 1개는 기존 판정 기준이라 그대로 둔다) */

type Props = {
  inspectionId: string
  /** 역할 축 권한 (can(role,'inspection_register')) — 점검 건 축(overview.canEdit)과 AND로 게이트 */
  canRegister: boolean
  /** 원격 저장이 반영되면 상위 회차 카드의 응답 수 표시를 갱신 */
  onSaved?: (respondedTotal: number, defectDelta: number) => void
  /** 미입력(설치·응답 0) 설비 수 통지 — 회차 카드가 별지 블록 제목에 경고를 복제하고
   *  발행 가드 팝업(blanksGuardThenGo)의 분모로 쓴다.
   *  39 §0 확장: requiredItems = 설치 시트의 범위 내 무응답 **항목** 합(작동·종합 공통),
   *  compItems = 그중 ●(종합 필수). 자체점검이 아니면 0. */
  onBlankCount?: (n: number, requiredItems?: number, compItems?: number) => void
  /** 입력 화면 뒤로가기 복귀 경로(?from=) — 미지정이면 종전대로 점검 상세로 돌아간다 */
  from?: string
}

// countBlanks는 lib/sheet-blanks로 이동(39) — 전용 페이지·발행 가드와 같은 정의를 한 곳에서 쓴다

const numCls = (p: SheetProgress) =>
  p.responded === 0 ? 'text-amber-600' : p.responded >= p.total ? 'text-green-600' : 'text-amber-600'

export function PlanAnnexSheetTree({ inspectionId, canRegister, onSaved, onBlankCount, from }: Props) {
  const [ov, setOv] = useState<SheetOverview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [installedOnly, setInstalledOnly] = useState(true)
  const [isLoading, startLoading] = useTransition()

  const load = useCallback(() => {
    startLoading(async () => {
      try {
        const res = await getInspectionSheetOverviewAction([inspectionId])
        if (res.error) { setErr(res.error); return }
        setErr(null)
        const next = res.overviews?.[inspectionId] ?? null
        setOv(next)
        if (next) {
          onSaved?.(next.totals.responded, 0)
          onBlankCount?.(
            countBlanks(next.sheets),
            next.scope.isSpecial ? countRequiredItemBlanks(next.sheets) : 0,
            next.scope.isSpecial ? countCompBlanks(next.sheets) : 0)
        }
      } catch {
        // requirePermission 리다이렉트 등 — 카드 전체가 죽지 않게 (plan-annex-section의 기존 패턴)
        setErr('점검표 진행률을 불러오지 못했습니다 — 권한이 없거나 일시 오류입니다.')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId])

  useEffect(() => { load() }, [load])

  // Realtime — 편집 상태가 없어졌으므로 dirty·stale 경합 처리가 통째로 불필요해졌다.
  // 다른 곳(전용 입력 페이지·점검 상세)의 저장이 오면 그냥 다시 읽으면 된다.
  useSheetResponsesRealtime([inspectionId], load)

  const editable = canRegister && !!ov?.canEdit

  if (err) return <p className="py-1.5 text-[11px] text-amber-600">{err}</p>
  if (!ov) {
    return (
      <p className="py-1.5 text-[11px] text-ink-meta inline-flex items-center gap-1">
        {/* 완료 문구('설비별 진행 N/M')와 접두사가 겹치면 상태 구분이 어렵다 — 다른 어휘로 */}
        <Loader2 className="size-3 animate-spin" /> 점검표 설비 목록을 불러오는 중…
      </p>
    )
  }

  // 설치 정보가 아예 없는 고객은 필터를 걸면 전부 사라지므로 자동 해제
  const filterOn = installedOnly && !ov.noFacilityInfo
  // 규칙은 lib/sheet-facility-map 한 곳(보드·스텝 링크·인쇄 번들과 동일).
  const rows = filterOn ? ov.sheets.filter(sheetShownWhenInstalledOnly) : ov.sheets
  const hiddenCount = ov.sheets.length - rows.length
  const blankCount = countBlanks(ov.sheets)
  // 39 §0 — 필수 미입력 항목(설치 시트·범위 내)과 그중 ●. 자체점검 회차만 필수 축이 있다
  const requiredBlank = ov.scope.isSpecial ? countRequiredItemBlanks(ov.sheets) : 0
  const compBlankTotal = ov.scope.isSpecial ? countCompBlanks(ov.sheets) : 0
  const entryHref = `/inspections/${inspectionId}/sheet`
  const fromQ = from ? `&from=${encodeURIComponent(from)}` : ''
  // 39 S2-4 — 미입력 설비 해소 양갈래 중 '1.4 대장 체크 해제' 링크. from(고객 상세 딥링크)에서
  // 파생한다 — 같은 경로 ?tab= Link는 서버를 안 깨우므로(risk_same_path_tab_link) 전체 이동 <a>로 쓴다
  const ledgerHref = from ? `${from.split('?')[0]}?tab=plan&form=1.4` : null

  return (
    <div className="pl-5 pb-1">
      <div className="flex items-center gap-2 flex-wrap py-1">
        <span className="text-[11px] text-ink-sub">
          설비별 진행 {ov.totals.responded}/{ov.totals.total}
          {ov.totals.x > 0 && <span className="text-red-500 ml-1">✕{ov.totals.x}</span>}
        </span>
        {/* 설치인데 응답 0건인 설비가 몇 개인지 — 별지 결과칸이 **기본 ○(양호)**로 인쇄될 개수다
            (2026-09-02 정책 — 종전 공란). 이 숫자를 안 보여줬던 것이 물분무 사고의 직접 원인이라
            여기에도 띄우고, 발행 칩(엑셀·전체 인쇄)은 같은 수로 확인 팝업을 띄운다(round-card).
            39 S2-4 — 해소는 양갈래: 점검표 입력, 또는 실제 미설치면 1.4 대장에서 체크 해제. */}
        {blankCount > 0 && (
          <span className="text-[10px] text-amber-600 font-medium">
            ⚠ 설치 설비 중 미입력 {blankCount}개 — 기본 ○로 인쇄.{' '}
            {ledgerHref
              ? <>점검표를 입력하거나, 실제 미설치면 <a href={ledgerHref} className="underline hover:text-amber-700">1.4 대장에서 체크 해제</a></>
              : '점검표를 입력하거나, 실제 미설치면 1.4 설비 대장에서 체크를 해제하세요'}
          </span>
        )}
        {/* 39 S1 — 필수 미입력 항목 카운터(설치 시트의 범위 내 전 항목 ○/✕/／ 필수, ●는 종합 법정 필수) */}
        {requiredBlank > 0 && (
          <span className="text-[10px] text-amber-700 font-medium" data-testid="tree-required-blank"
            title="설치된 설비의 점검표는 항목마다 ○/✕/／ 중 하나를 기재해야 합니다 — ●는 종합점검 필수(고시 별지4호)">
            필수 미입력 {requiredBlank}건{compBlankTotal > 0 ? ` (● ${compBlankTotal})` : ''}
          </span>
        )}
        {!ov.noFacilityInfo && (
          <label className="inline-flex items-center gap-1 text-[10px] text-ink-soft cursor-pointer">
            <input type="checkbox" checked={installedOnly} onChange={e => setInstalledOnly(e.target.checked)} className="size-3" />
            설치 설비만 보기{hiddenCount > 0 ? ` (${hiddenCount} 숨김)` : ''}
          </label>
        )}
        {ov.noFacilityInfo && (
          <span className="text-[10px] text-amber-600">설치 시설 정보가 없어 전체 시트를 표시합니다 — 1.4에서 등록하세요</span>
        )}
        {!editable && <span className="text-[10px] text-ink-meta">보기 전용 — 담당자·팀장만 입력</span>}
        <button onClick={load} disabled={isLoading} className="ml-auto text-[10px] text-ink-faint hover:text-brand inline-flex items-center gap-0.5 disabled:opacity-50">
          <RefreshCw className={`size-2.5 ${isLoading ? 'animate-spin' : ''}`} /> 갱신
        </button>
      </div>

      {rows.length === 0 && <p className="text-[11px] text-ink-meta py-1">표시할 설비 시트가 없습니다.</p>}

      {/* 시트 행이 곧 딥링크 — 클릭하면 전용 화면의 그 설비가 열린다("어디서 채우나"가 한 번에 풀린다) */}
      <div className="space-y-0.5">
        {rows.map(p => (
          <Link key={p.sheetId} href={`${entryHref}?sheet=${encodeURIComponent(p.sheetCode)}${fromQ}`}
            data-testid={`annex-sheet-link-${p.sheetCode}`}
            className={`w-full flex items-center gap-1.5 px-2 py-1 rounded border border-brand-line-soft hover:bg-brand-tint ${
              p.installed && p.responded === 0 ? 'bg-amber-50' : ''}`}>
            <ChevronRight className="size-3 text-ink-faint shrink-0" />
            <span className="text-[11px] text-ink flex-1 min-w-0 truncate">{p.sheetName}</span>
            {p.counts.X > 0 && <span className="text-[10px] text-red-500 shrink-0">✕{p.counts.X}</span>}
            <span className={`text-[10px] shrink-0 ${numCls(p)}`}>{p.responded}/{p.total}</span>
            {p.responded >= p.total ? (
              <span className="text-[10px] text-green-600 shrink-0">✓</span>
            ) : (
              <span className="text-[10px] text-amber-600 shrink-0">⚠ 미입력 {p.total - p.responded}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}

/** 점검표 노드 머리줄 — 아이콘·라벨·딥링크. 트리 본체와 분리해 호출부가 배치를 정한다 */
export function PlanAnnexSheetHeader({ inspectionId, responded, defects, from }: {
  inspectionId: string; responded: number; defects: number; from?: string
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs border-b border-brand-line-soft">
      <ClipboardList className="size-3.5 text-brand shrink-0" />
      <span className="font-medium text-ink w-44">점검표 입력</span>
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-tint text-brand">입력</span>
      <span className="text-ink-sub">응답 {responded} · 불량 {defects}</span>
      {/* ⚠ 라벨에 '점검표 입력' 6글자를 넣지 말 것 — 위 머리줄과 합쳐 개수가 2배가 되면
          test-annex-interaction의 회차 펼침 판정이 깨진다 */}
      <Link href={`/inspections/${inspectionId}/sheet${from ? `?from=${encodeURIComponent(from)}` : ''}`} data-testid="annex-sheet-entry-link"
        className="ml-auto text-[11px] text-brand hover:underline">
        입력 화면 열기 →
      </Link>
    </div>
  )
}
