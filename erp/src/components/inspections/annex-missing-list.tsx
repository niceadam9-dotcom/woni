'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'

/** 별지 조립 '미비 항목' 표시 — 작성 패널·작업대 미리보기 **공용 1곳**.
 *
 *  왜 공용인가: 종전엔 작성 패널은 문구를 한 줄로 이어 붙여 보여주고, 정작 주 화면인 작업대
 *  미리보기는 `⚠ 미입력 3곳`처럼 **개수만** 보여줬다. 그래서 조립 쪽에 누락 항목을 하나 더
 *  추가해도 작업대에서는 숫자만 하나 올라갈 뿐 "무엇이 왜 비었는지"가 끝내 보이지 않았다.
 *
 *  문구 자체는 서버(report9-actions의 missing.push)가 만든다 — 여기서는 **어디서 고치는지**만 덧붙인다. */

/** 미비 항목 → 고칠 화면 딥링크. 문구가 길어 **접두어 포함 여부**로 맞춘다.
 *  2026-08-20부터 별지 9호 2쪽 «소방안전정보»의 사람 축은 관계인 탭 [소방안전관리] 구역
 *  (`c-fire-safety-manager`) 한 자리에서 채운다 — 링크도 거기로 보낸다.
 *
 *  축이 둘이다: 고객에서 고치는 항목(customerId)과 **점검 건에서 고치는 항목**(inspectionId).
 *  점검표 계열은 입력의 정본인 `/inspections/{id}/sheet`(소방계획서_28 S1)로 보낸다.
 *
 *  ⚠ '점검표 응답'은 **완전일치**로만 잡는다. 부분일치로 두면 고칠 곳이 1.4 설비 대장인
 *     «대장 미체크인데 점검표 응답 있음 …»·«설비 대장 미등록 시트 … 점검표 응답이 있어 …»
 *     (report9-assemble.ts:527·537)까지 삼켜 엉뚱한 화면으로 보낸다. */
type FixRule = {
  match: string
  /** true면 문구 전체가 match와 같을 때만 — 부분일치가 이웃 문구를 삼키는 걸 막는다 */
  exact?: boolean
  /** 이 항목을 고치는 축 — 해당 id가 없으면 링크를 걸지 않는다(종전 동작 보존) */
  axis: 'customer' | 'inspection'
  url: (id: string) => string
}

const sheetEntry = (id: string) => `/inspections/${id}/sheet`

const FIX_LINKS: FixRule[] = [
  // ── 점검 건 축(점검표·결과칸 공란 계열) — 근거 문구는 아래 3곳에서 그대로 옮겼다
  //    report9-assemble.ts:522  `설치 설비 중 점검표 무응답 N건 — 3쪽 결과칸 공란`  (별지 9호·4호 공통)
  //    report9-assemble.ts:513  `점검표 응답`                                       (응답이 아예 0건)
  //    report9-actions.ts:380   `외관점검 시트 응답 없음 — 결과란 공란`             (assembleExterior)
  { match: '설치 설비 중 점검표 무응답', axis: 'inspection', url: sheetEntry },
  { match: '외관점검 시트 응답 없음', axis: 'inspection', url: sheetEntry },
  { match: '점검표 응답', exact: true, axis: 'inspection', url: sheetEntry },
  // ── 고객 축
  { match: '소방안전관리등급', axis: 'customer', url: id => `/customers/${id}?tab=contacts#c-fire-safety-manager` },
  { match: '소방안전관리자 선임 형태', axis: 'customer', url: id => `/customers/${id}?tab=contacts#c-fire-safety-manager` },
  { match: '소방안전관리자', axis: 'customer', url: id => `/customers/${id}?tab=contacts#c-fire-safety-manager` },
]

export function annexFixHref(item: string, customerId?: string, inspectionId?: string, from?: string): string | undefined {
  const hit = FIX_LINKS.find(l => (l.exact ? item === l.match : item.includes(l.match)))
  if (!hit) return undefined
  const id = hit.axis === 'inspection' ? inspectionId : customerId
  if (!id) return undefined
  const href = hit.url(id)
  // 복귀 경로는 점검표 입력 화면만 받는다 — 고객 축 링크는 하던 대로(자체 앵커·탭 딥링크가 있다)
  return hit.axis === 'inspection' && from ? `${href}?from=${encodeURIComponent(from)}` : href
}

const fixLinkCls = 'text-[#7b68ee] hover:underline shrink-0 inline-flex items-center gap-0.5'

/** 항목 목록(항상 펼침) — 작성 패널 1단처럼 세로 공간이 있는 자리 */
export function AnnexMissingList({ missing, customerId, inspectionId, from }: {
  missing: string[]; customerId?: string; inspectionId?: string; from?: string
}) {
  if (missing.length === 0) {
    return (
      <p className="text-[11px] text-green-600 flex items-center gap-1 pt-1">
        <CheckCircle2 className="size-3.5 shrink-0" /> 자동 채움 항목에 누락이 없습니다
      </p>
    )
  }
  return (
    <div className="text-[11px] text-amber-600 flex items-start gap-1 pt-1">
      <AlertTriangle className="size-3.5 shrink-0 mt-px" />
      <div>
        <span>미비 항목: 빈 칸으로 출력됩니다 (생성은 막지 않음)</span>
        <ul className="mt-0.5 space-y-0.5">
          {missing.map(m => {
            const href = annexFixHref(m, customerId, inspectionId, from)
            return (
              <li key={m} className="flex items-start gap-1">
                <span>· {m}</span>
                {href && (
                  <Link href={href} className={fixLinkCls}>고치기 <ExternalLink className="size-2.5" /></Link>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/** 개수 칩 + 펼치면 목록 — 미리보기 머리줄처럼 한 줄만 있는 자리.
 *  종전의 `⚠ 미입력 N곳`을 그대로 두되 **눌러서 무엇인지 볼 수 있게** 한다(문구·개수 표기 유지). */
export function AnnexMissingChip({ missing, customerId, inspectionId }: {
  missing: string[]; customerId?: string; inspectionId?: string
}) {
  const [open, setOpen] = useState(false)
  if (missing.length === 0) return <span className="text-[10px] text-green-600">✓ 빈칸 없음</span>
  return (
    <>
      <button onClick={() => setOpen(v => !v)} data-testid="annex-missing-chip"
        title="무엇이 비었는지 보기 — 빈 칸으로 출력됩니다 (생성은 막지 않음)"
        className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 hover:underline">
        {open ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
        ⚠ 미입력 {missing.length}곳
      </button>
      {open && (
        <ul className="absolute left-1 right-1 top-6 z-10 rounded-lg border border-amber-200 bg-white p-2 shadow-lg space-y-0.5 text-[10px] text-amber-700">
          {missing.map(m => {
            const href = annexFixHref(m, customerId, inspectionId)
            return (
              <li key={m} className="flex items-start gap-1">
                <span>· {m}</span>
                {href && <Link href={href} className={fixLinkCls}>고치기 <ExternalLink className="size-2.5" /></Link>}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
