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
 *  (`c-fire-safety-manager`) 한 자리에서 채운다 — 링크도 거기로 보낸다. */
const FIX_LINKS: Array<{ match: string; url: (id: string) => string }> = [
  { match: '소방안전관리등급', url: id => `/customers/${id}?tab=contacts#c-fire-safety-manager` },
  { match: '소방안전관리자 선임 형태', url: id => `/customers/${id}?tab=contacts#c-fire-safety-manager` },
  { match: '소방안전관리자', url: id => `/customers/${id}?tab=contacts#c-fire-safety-manager` },
]

export function annexFixHref(item: string, customerId?: string): string | undefined {
  if (!customerId) return undefined
  return FIX_LINKS.find(l => item.includes(l.match))?.url(customerId)
}

const fixLinkCls = 'text-[#7b68ee] hover:underline shrink-0 inline-flex items-center gap-0.5'

/** 항목 목록(항상 펼침) — 작성 패널 1단처럼 세로 공간이 있는 자리 */
export function AnnexMissingList({ missing, customerId }: { missing: string[]; customerId?: string }) {
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
            const href = annexFixHref(m, customerId)
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
export function AnnexMissingChip({ missing, customerId }: { missing: string[]; customerId?: string }) {
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
            const href = annexFixHref(m, customerId)
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
