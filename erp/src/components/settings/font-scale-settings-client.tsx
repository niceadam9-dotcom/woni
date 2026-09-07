'use client'

import { useEffect, useState, useTransition } from 'react'
import { Check, Loader2, Type } from 'lucide-react'
import { updateFontScaleAction } from '@/app/(dashboard)/settings/actions'

/** 화면 글자 크기 4택 — **앱 전 화면**에 걸린다 (소방계획서_35 S5 → _38 점검표 →
 *  2026-09-07 전역·4단계). 클릭 즉시 적용(저장 버튼 없음).
 *
 *  ⚠ **순환 버튼이 아니라 라디오그룹이다.** 다크 토글은 2상태라 아이콘 하나로 현재 값이
 *  읽히지만, 순환 버튼은 "지금 어디인지"를 눌러보기 전엔 알 수 없다. 시력이 나빠서
 *  이 기능을 쓰는 사람에게 특히 나쁘다(단계가 4개가 되며 더 그렇다).
 *
 *  낙관 적용: 클릭 즉시 <html data-fs>를 바꿔 체감을 살리고, 서버 액션 실패 시 되돌린다.
 *
 *  두 자리에서 쓴다(variant):
 *   - 'card'    설정 화면 카드
 *   - 'compact' 소방계획서 탭 상단 — 배율 효과가 **가장 크게 보이는 화면**이라 여기 둔다.
 *               (종전 '유일한 화면'은 _38이 점검표 입력까지, 전역화가 나머지를 넓히며
 *                거짓이 됐다. 그래도 이 자리는 유지한다 — 서식이 가장 조밀한 화면이다.) */

type FS = 'md' | 'lg' | 'xl' | 'xxl'
const OPTIONS: Array<{ value: FS; label: string; desc: string; sample: string }> = [
  { value: 'md',  label: '보통',      desc: '기본 크기', sample: '가' },
  { value: 'lg',  label: '크게',      desc: '15% 크게',  sample: '가' },
  { value: 'xl',  label: '아주 크게', desc: '30% 크게',  sample: '가' },
  { value: 'xxl', label: '최대',      desc: '45% 크게',  sample: '가' },
]
// ⚠ 이 표본 숫자는 **일부러 고정 px**이다. 배율을 타면 네 칸이 함께 커져 서로 구별되지
//   않는다 — 크기 차이를 눈으로 보여주는 게 이 숫자의 유일한 일이다(설명 문구보다 잘 읽힌다).
//   실측 프로브가 이걸 '안 커진 것'으로 잡아내는데, 결함이 아니라 의도다.
const SAMPLE_PX: Record<FS, number> = { md: 13, lg: 15, xl: 17, xxl: 19 }

function applyDom(scale: FS) {
  document.documentElement.setAttribute('data-fs', scale)
}

export function FontScaleSettingsClient({
  initialScale, variant = 'card',
}: { initialScale?: FS; variant?: 'card' | 'compact' }) {
  const [scale, setScale] = useState<FS>(initialScale ?? 'md')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  // 컴팩트(소방계획서 탭)는 서버에서 값을 내려받지 않는다 — 그 프롭을 넣으려면
  // 고객 상세 페이지 → PlanTabView까지 배관을 새로 깔아야 하는데, 정본은 이미
  // <html data-fs>에 인라인 스크립트가 세워 둔 상태다. 그것을 읽어 맞춘다.
  // ⚠ 서버 렌더 시점엔 DOM이 없으므로 첫 렌더는 양쪽 다 'md'다(하이드레이션 일치).
  //   교정은 마운트 뒤 한 번 — 깜빡임은 강조색 한 칸뿐이다.
  useEffect(() => {
    if (initialScale) return
    const v = document.documentElement.getAttribute('data-fs')
    if (v === 'md' || v === 'lg' || v === 'xl' || v === 'xxl') setScale(v)
  }, [initialScale])

  function choose(next: FS) {
    if (next === scale || isPending) return
    setError(''); setSaved(false)
    const prev = scale
    setScale(next)
    applyDom(next)
    startTransition(async () => {
      const res = await updateFontScaleAction(next)
      if (res.error) { setScale(prev); applyDom(prev); setError(res.error); return }
      setSaved(true)
    })
  }

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1" data-testid="plan-font-scale">
        <Type className="size-3.5 text-ink-faint shrink-0" aria-hidden />
        <div className="flex items-center rounded-lg border border-line overflow-hidden" role="radiogroup" aria-label="화면 글자 크기">
          {OPTIONS.map(o => {
            const active = scale === o.value
            return (
              <button key={o.value} type="button" role="radio" aria-checked={active}
                onClick={() => choose(o.value)} disabled={isPending}
                title={`${o.label} — ${o.desc}`}
                data-testid={`plan-fs-${o.value}`}
                className={`px-2 py-1 leading-none transition-colors disabled:opacity-60 ${
                  active ? 'bg-brand text-white' : 'text-ink-sub hover:bg-paper'}`}>
                <span style={{ fontSize: SAMPLE_PX[o.value] }}>{o.label}</span>
              </button>
            )
          })}
        </div>
        {isPending && <Loader2 className="size-3.5 text-brand animate-spin" />}
        {error && <span className="text-form-xs text-red-600" data-testid="plan-fs-error">{error}</span>}
      </div>
    )
  }

  return (
    <div>
      {/* 4단계라 좁은 화면에서 한 줄에 넣으면 라벨이 감긴다 — 2×2로 접는다 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="radiogroup" aria-label="화면 글자 크기">
        {OPTIONS.map(o => {
          const active = scale === o.value
          return (
            <button key={o.value} type="button" role="radio" aria-checked={active}
              onClick={() => choose(o.value)} disabled={isPending}
              data-testid={`fs-option-${o.value}`}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                active ? 'border-brand bg-brand-tint' : 'border-line hover:bg-paper'}`}>
              {/* 표본 글자를 실제 그 크기로 보여준다 — '15%'라는 숫자보다 훨씬 잘 읽힌다 */}
              <span className={`shrink-0 w-6 text-center font-semibold ${active ? 'text-brand' : 'text-ink-sub'}`}
                style={{ fontSize: SAMPLE_PX[o.value] + 4 }}>{o.sample}</span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-medium ${active ? 'text-brand' : 'text-ink'}`}>{o.label}</span>
                {/* S7-1 — 배율 옵션 설명. 고르는 근거라 읽혀야 한다 */}
                <span className="block text-form-xs text-ink-meta">{o.desc}</span>
              </span>
              {active && !isPending && <Check className="size-4 text-brand shrink-0" data-testid="fs-active-check" />}
              {active && isPending && <Loader2 className="size-4 text-brand shrink-0 animate-spin" />}
            </button>
          )
        })}
      </div>
      {/* S7-1 — '어디에 적용되고 어디엔 안 되는지'를 알려주는 문장(인쇄는 안 바뀐다).
          ⚠ 2026-09-07 전역화로 앞 절이 거짓이 됐다 — 화면 목록을 나열하면 범위가 넓어질
            때마다 또 낡는다. '전 화면'이라고만 쓰고 예외(인쇄)만 명시한다. */}
      <p className="mt-2 text-form-xs text-ink-meta">
        점검 달력·고객·점검표·소방계획서 등 <strong className="font-semibold">모든 화면</strong>에 적용됩니다. 인쇄·PDF는 법정 서식 규격이라 바뀌지 않습니다.
      </p>
      {saved && <p className="mt-1 text-form-xs text-green-600" data-testid="fs-saved">✓ 저장됨 — 다른 기기에도 로그인하면 적용됩니다</p>}
      {error && <p className="mt-1 text-form-xs text-red-600" data-testid="fs-error">{error}</p>}
    </div>
  )
}
