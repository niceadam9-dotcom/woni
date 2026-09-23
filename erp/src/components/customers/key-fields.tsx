/** 고객 화면 공용 「그룹 정렬」 부품 (2026-09-23 사용자 요청)
 *
 *  「산만하게 조회되지 않게 — 그룹 단위로 묶어서 정렬」 + 「사용승인일·점검일자는 중요하니 눈에 띄게」.
 *  고객 등록 · 기본정보 · 건물·시설 · 관계인 네 화면이 **이 부품만으로** 칸을 놓는다:
 *
 *   GroupBox  — 그룹 하나 = 테두리 상자 하나(번호·제목·필수 상태 머리)
 *   SubRow    — 그룹 안의 소그룹 줄: 왼쪽 소그룹 이름 + 오른쪽 **4열 격자**. `accent`면 보라 바탕(기준일 등 핵심)
 *   Cell      — 격자 한 칸(라벨 위). 폭은 span 1·2·3·4 **넷 중 하나만** — 그래서 세로줄이 화면 끝까지 맞는다
 *   RoleBadge — 기준일 칸의 `기산점`/`참고` 알약(판정은 lib/anchor-role → resolveAnchor)
 *
 *  ⚠ 색은 기존 토큰(brand·brand-tint·brand-line·line·paper)만 쓴다 — 다크 모드가 따라온다.
 *  ⚠ 좁은 상자에선 4열 → 2열 → 1열로 **같은 순서**를 지키며 접힌다(소그룹 이름은 위로 올라간다).
 *    기준은 화면이 아니라 **상자 폭**(컨테이너 쿼리 @md=28rem · @2xl=42rem · @4xl=56rem).
 */
import type { ReactNode } from 'react'
import { Star } from 'lucide-react'
import type { AnchorRole } from '@/lib/anchor-role'

const cardCls = 'bg-surface rounded-xl border shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px]'

/** 핵심 칸 입력 모양 — 기준일·고객명. 나머지 칸은 각 화면의 보통 입력 그대로(대비가 강조를 만든다) */
// ⚠ `!`(우선) — 화면마다 보통 칸 높이 토큰(h-10·h-form-9)이 먼저 붙어 있어도 핵심 칸이 이긴다
export const keyInputCls = '!h-12 !text-lg font-semibold tabular-nums !border-2'
/** 필수인데 비었을 때 — 멀리서도 보이게 */
export const emptyRequiredCls = '!border-amber-400 bg-amber-50/40'

export function GroupBox({ n, title, status, right, alert, children, testId }: {
  n: number
  title: string
  /** 필수 입력 현황 — [채운 수, 전체]. 다 차면 초록, 아니면 주황 */
  status?: [number, number]
  right?: ReactNode
  /** 상자 테두리를 붉게(예: 담당 미배정) */
  alert?: boolean
  children: ReactNode
  testId?: string
}) {
  const done = status ? status[0] >= status[1] : true
  return (
    <section data-testid={testId} className={`${cardCls} ${alert ? 'border-red-200' : 'border-line'} overflow-hidden`}>
      <div className="flex items-center gap-2 px-5 py-3 border-b border-line bg-paper">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-white text-xs font-bold">{n}</span>
        <h2 className="text-sm font-bold text-ink shrink-0">{title}</h2>
        {status && (
          <span data-testid={testId ? `${testId}-status` : undefined}
            className={`text-form-2xs font-medium px-2 py-0.5 rounded-full ${done ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            필수 {status[0]}/{status[1]}
          </span>
        )}
        {right && <div className="ml-auto flex items-center gap-2 min-w-0">{right}</div>}
      </div>
      {/* `@container` — 열 수를 **화면 폭이 아니라 상자 폭**으로 정한다. 같은 1280 화면이라도 등록 화면은
          상자가 ~1000px(4열), 상세 탭은 요약 패널 옆이라 ~740px(2열)이다. 화면 폭으로 정했더니
          상세 탭에서 날짜가 잘리고 담당 안내가 한 글자씩 꺾였다(2026-09-23 실측). */}
      <div className="@container divide-y divide-brand-line-soft">{children}</div>
    </section>
  )
}

export function SubRow({ label, accent, children, testId }: {
  label: string
  /** 핵심 소그룹 — 보라 바탕 + 왼쪽 굵은 띠 + 별 */
  accent?: boolean
  children: ReactNode
  testId?: string
}) {
  return (
    <div data-testid={testId} data-accent={accent ? '1' : undefined}
      className={`grid grid-cols-1 @2xl:grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-4 ${
        accent ? 'bg-brand-tint border-l-4 border-l-brand pl-4' : ''}`}>
      <div className={`flex items-center gap-1 @2xl:pt-0.5 text-xs font-semibold ${accent ? 'text-brand' : 'text-ink-meta'}`}>
        {accent && <Star className="size-3.5 fill-current" aria-hidden />}
        {label}
      </div>
      <div className="grid grid-cols-1 @md:grid-cols-2 @4xl:grid-cols-4 gap-x-4 gap-y-3 min-w-0">{children}</div>
    </div>
  )
}

const SPAN: Record<1 | 2 | 3 | 4, string> = {
  1: '',
  2: '@md:col-span-2',
  3: '@md:col-span-2 @4xl:col-span-3',
  4: '@md:col-span-2 @4xl:col-span-4',
}

export function Cell({ span = 1, label, required, htmlFor, badge, missing, children, testId }: {
  span?: 1 | 2 | 3 | 4
  label?: ReactNode
  required?: boolean
  htmlFor?: string
  /** 라벨 오른쪽 알약(예: 기산점) */
  badge?: ReactNode
  /** 필수인데 비었다 — 라벨 옆에 `필수` 알약 */
  missing?: boolean
  children: ReactNode
  testId?: string
}) {
  return (
    <div data-testid={testId} data-span={span} className={`min-w-0 space-y-1.5 ${SPAN[span]}`}>
      {label !== undefined && (
        <div className="flex items-center gap-1.5 min-h-5">
          <label htmlFor={htmlFor} className="text-xs font-semibold text-ink-sub">
            {label}{required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {missing && <span className="text-form-2xs font-semibold px-1.5 rounded-full bg-amber-100 text-amber-800">필수</span>}
          {badge}
        </div>
      )}
      {children}
    </div>
  )
}

/** 기준일 칸의 역할 알약 — 쓰이는 날짜는 진하게 `기산점`, 값은 있지만 안 쓰이면 `참고` */
export function RoleBadge({ role, testId }: { role: AnchorRole; testId?: string }) {
  if (role === 'empty') return null
  return role === 'anchor'
    ? <span data-testid={testId} data-role="anchor" className="text-form-2xs font-bold px-2 py-0.5 rounded-full bg-brand text-white">기산점</span>
    : <span data-testid={testId} data-role="reference" className="text-form-2xs font-medium px-2 py-0.5 rounded-full bg-surface text-ink-meta border border-line">참고</span>
}
