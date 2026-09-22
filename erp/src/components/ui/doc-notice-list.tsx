'use client'

import Link from 'next/link'
import { ChevronRight, Info } from 'lucide-react'
import { splitNoticeParts, type WorkbookNoticePart } from '@/lib/workbook-notice'

/** 문서 고지를 **두 덩이로 나눠** 그린다 — 이 분리가 이 컴포넌트의 존재 이유다.
 *
 *  종전엔 한 줄짜리 평문이라 「채울 수 있는 것」과 「양식이 못 담는 것」이 섞여 있었다.
 *  사용자는 「보조 점검인력 8번째부터 미표기(허브 7행)」을 보고 **채울 곳을 찾아 헤맨다** —
 *  그건 서식 행수의 한계라 어디에도 채울 칸이 없다.
 *
 *  ⚠ 막지 않는다. 이건 안내일 뿐이고 문서는 이미 받았다
 *    (`inspection-calendar-client.tsx`가 선언한 「달력은 착륙 화면이라 현장 흐름을 끊지 않는다」).
 *  ⚠ 분류를 모르는 조각(`unknown`)은 **글자로만** 남긴다 — 목적지를 지어내지 않는다.
 *  ⚠ 회사·직원 축(`scope: 'org'`)은 실측상 **31/31에 상시로 뜬다**. 회차와 같은 무게로 그리면
 *    매번 같은 줄이 위에 쌓여 정작 이번 회차에 채울 것을 가린다 → 접어서 아래에 둔다.
 */
export function DocNoticeList({ parts, hrefOf, onNavigate, emptyHint }: {
  parts: readonly WorkbookNoticePart[]
  /** 목적지 → 주소. 호출부가 `from=` 복귀 경로까지 붙여 준다 */
  hrefOf: (p: WorkbookNoticePart) => string | null
  /** 이동 **직전**에 부른다 — 호출부가 「돌아오면 이어서 발행」 쪽지를 여기서 쓴다 */
  onNavigate?: (p: WorkbookNoticePart) => void
  emptyHint?: string
}) {
  // 분리 규칙은 **순수 함수**에 있다 — 여기서 filter로 갈라 두면 모양만 보는 단언이
  // 실제 동작(덩이가 뒤섞이는 것)을 못 잡는다(변이 M8이 그렇게 뚫었다)
  const { fixable, org, caps, rest } = splitNoticeParts(parts)

  if (parts.length === 0) return emptyHint ? <p className="text-form-2xs text-ink-meta">{emptyHint}</p> : null

  const Row = ({ p }: { p: WorkbookNoticePart }) => {
    const href = hrefOf(p)
    return (
      <li className="flex items-start gap-1.5 leading-snug">
        {href ? (
          <Link
            href={href}
            data-testid="doc-notice-chip"
            onClick={() => onNavigate?.(p)}
            className="shrink-0 inline-flex items-center gap-0.5 rounded border border-brand-line px-1.5 py-0.5 text-form-2xs font-medium text-brand hover:bg-brand-tint transition-colors">
            {p.label ?? '채우러 가기'} <ChevronRight className="size-2.5" />
          </Link>
        ) : (
          <span className="shrink-0 text-ink-faint">·</span>
        )}
        <span className="text-form-2xs text-ink-sub">{p.text}</span>
      </li>
    )
  }

  return (
    <div data-testid="doc-notice-list" className="w-full space-y-2">
      {fixable.length > 0 && (
        <div>
          <p className="text-form-2xs font-semibold text-ink-sub mb-1">
            채우면 다음 발행에 반영됩니다 ({fixable.length})
          </p>
          <ul className="space-y-1">{fixable.map((p, i) => <Row key={`f${i}`} p={p} />)}</ul>
        </div>
      )}

      {caps.length > 0 && (
        <div data-testid="doc-notice-caps">
          <p className="text-form-2xs font-semibold text-ink-meta mb-1 flex items-center gap-1">
            <Info className="size-3" /> 양식에 다 담기지 않은 것 — 채울 수 없습니다 ({caps.length})
          </p>
          <ul className="space-y-1">
            {caps.map((p, i) => (
              <li key={`c${i}`} className="text-form-2xs text-ink-meta leading-snug">· {p.text}</li>
            ))}
          </ul>
        </div>
      )}

      {rest.length > 0 && (
        <ul className="space-y-1">
          {rest.map((p, i) => (
            <li key={`u${i}`} className="text-form-2xs text-ink-meta leading-snug">· {p.text}</li>
          ))}
        </ul>
      )}

      {org.length > 0 && (
        <details data-testid="doc-notice-org">
          <summary className="text-form-2xs text-ink-meta cursor-pointer select-none">
            회사·직원 정보 ({org.length}) — 이 회차와 무관하게 늘 뜹니다
          </summary>
          <ul className="space-y-1 mt-1">{org.map((p, i) => <Row key={`o${i}`} p={p} />)}</ul>
        </details>
      )}
    </div>
  )
}
