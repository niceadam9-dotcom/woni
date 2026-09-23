'use client'

import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { collectPlanSaveHandlers, useUnsavedNavGuard } from '@/components/ui/unsaved-nav'

/** 고객 상세 탭 셸 (설계 §2·§4·§6-C) — URL ?tab= 동기화 + 상태 뱃지 + 미저장 경고 + 다음 탭 전환.
 *  패널은 전부 서버 렌더 후 show/hide — 탭 전환에도 각 폼의 입력 상태가 유지된다. */

export type CustomerTabDef = {
  key: string
  label: string
  badge?: string   // 표시 텍스트 (예: "6/9", "(2)", "07-10")
  warn?: boolean   // 미완 ⚠ (앰버)
  /** 라벨 뒤에 덧붙일 표식(예: 보고서 엑셀 빈칸 수 — 화면이 뜬 뒤 비동기로 채워진다) */
  extra?: ReactNode
}

type TabsCtx = {
  activeTab: string
  /** 특정 탭으로 이동 (딥링크 대체 — §3) */
  goTab: (key: string) => void
  /** 각 탭 폼의 미저장 변경 등록 (§6-C-5) */
  setTabDirty: (key: string, dirty: boolean) => void
}

const CustomerTabsContext = createContext<TabsCtx | null>(null)
/** 탭 셸 밖(단독 사용)에서는 null — 호출부는 옵셔널 체이닝으로 사용 */
export function useCustomerTabs() {
  return useContext(CustomerTabsContext)
}

export function CustomerTabs({ initialTab, tabs, panels, summary, banner, fullWidthKeys, wideKeys, lazyKeys }: {
  initialTab: string
  tabs: CustomerTabDef[]
  panels: Record<string, ReactNode>
  summary?: ReactNode        // 우측 고객 요약 패널 — fullWidth 탭에서는 접힘(숨김)
  /** 탭 목록 **위**에 띠를 얹는다(신규등록 진행 안내 등).
   *  🚨 Provider **안**에 그려야 한다 — 밖(페이지 본문)에 두면 `useCustomerTabs()`가 null이라
   *  탭 이동을 못 한다. URL만 바꾸는 우회는 안 된다(활성 탭은 아래 state가 들고 있다). */
  banner?: ReactNode
  fullWidthKeys?: string[]    // 전체 폭으로 펼칠 탭 키(예: ['plan']) — max-w-3xl 해제 + 요약 패널 접힘
  /** 넓게 쓸 탭 키 — max-w-3xl만 풀고 **요약 패널은 유지**(2026-09-23 사용자: 기본정보·건물·시설·관계인 오른쪽이 비어 있다) */
  wideKeys?: string[]
  /** 처음 활성화될 때까지 패널을 렌더하지 않는다 (소방계획서_34 S2 — 마운트가 비싼 패널용).
   *  위 §설명대로 이 셸은 패널을 전부 렌더하므로, 마운트 즉시 서버액션을 왕복하는 패널(별지 서식의
   *  getCustomerRoundsAction)을 그냥 얹으면 **기본정보 탭만 열어도** 그 왕복이 매번 돈다.
   *  단 한 번 방문한 뒤에는 계속 마운트를 유지한다 — 안 그러면 위 '입력 상태 유지' 계약이 깨진다. */
  lazyKeys?: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const validInitial = tabs.some(t => t.key === initialTab) ? initialTab : tabs[0].key
  const [active, setActive] = useState(validInitial)
  // ?tab= 변경 동기화(11-5 누락 칩 router.push, 페이지 내 ?tab= Link) — state는 마운트 시 1회만
  // 초기화되므로 서버 재렌더로 initialTab 프롭이 바뀌면 여기서 반영한다 (렌더 중 상태 조정 패턴)
  const prevInitialRef = useRef(validInitial)
  if (prevInitialRef.current !== validInitial) {
    prevInitialRef.current = validInitial
    setActive(validInitial)
  }
  const dirtyRef = useRef<Set<string>>(new Set())
  const tablistRef = useRef<HTMLDivElement>(null)
  // lazyKeys 지연 마운트 — 방문한 탭을 누적한다. active 변경이 이미 렌더를 일으키므로 ref로 충분하다.
  const visitedRef = useRef<Set<string>>(new Set([validInitial]))
  visitedRef.current.add(active)

  // 미저장 이탈 경고 — 페이지 이탈(새로고침·닫기)
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 미저장 SPA 링크 이탈 확인 — beforeunload는 클라이언트 라우팅(사이드바 Link 등)에는 발화하지 않는다.
  // 다른 경로로 가는 내부 링크 클릭을 캡처 단계에서 가로채 확인창을 태운다 (?tab= 등 같은 경로 이동은 상태가 유지되므로 통과).
  const linkNav = useUnsavedNavGuard<string>({
    onProceed: href => router.push(href),
    message: '지금 페이지를 떠나면 입력한 내용이 저장되지 않습니다.',
  })
  const linkNavRef = useRef(linkNav)
  linkNavRef.current = linkNav
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      if (dirtyRef.current.size === 0 && collectPlanSaveHandlers().length === 0) return
      e.preventDefault()
      e.stopPropagation()
      linkNavRef.current.request(url.pathname + url.search + url.hash)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // 미저장 탭 이동 확인 — [저장하고 이동]은 미저장 폼이 등록한 save()를 await 한다 (ui/unsaved-nav)
  const nav = useUnsavedNavGuard<string>({
    onProceed: applySwitchTab,
    message: '지금 탭을 이동하면 이 탭에 입력한 내용이 저장되지 않습니다.',
    saveLabel: '저장하고 탭 이동',
    discardLabel: '저장하지 않고 탭 이동',
  })
  function switchTab(key: string) {
    if (key === active) return
    // 계획서 서식(1.2~3장)·소방시설(1.4)·보고서 탭 기타 카드는 setTabDirty 배선이 없다 —
    // 미저장 서식이 등록한 save 핸들러(dirty일 때만 등록)를 함께 본다.
    // ⚠ 핸들러 버스는 전역이라 다른 탭의 미저장도 함께 잡힌다(전 패널이 마운트 유지라 등록이 살아 있다) —
    //   과잉 확인이지만 [저장하고 이동]이 그쪽까지 저장하므로 안전한 방향의 오차다.
    if (dirtyRef.current.has(active)
      || (['plan', 'facilities', 'reports', 'annex'].includes(active) && collectPlanSaveHandlers().length > 0)) { nav.request(key); return }
    applySwitchTab(key)
  }
  function applySwitchTab(key: string) {
    setActive(key)
    const sp = new URLSearchParams(window.location.search)
    sp.set('tab', key)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    // 포커스는 **이동이 실제로 일어난 여기서만** 옮긴다 — 키 핸들러에서 옮기면 미저장 확인창이
    // 떠서 이동이 보류된 경우에도 포커스가 앞서 나간다(2026-09-21, 트리와 같은 규약).
    // 확인창에서 [이동]을 고른 경우에도 이 경로를 지나므로 포커스가 목적지 탭을 따라온다.
    tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[tabs.findIndex(t => t.key === key)]?.focus()
  }

  // 키보드 탭 이동 (2026-09-21 사용자 요청) — ←/→로 이웃 탭, Home/End로 첫·마지막(ARIA tablist 규약).
  // 포커스가 탭 바 안에 있을 때만 듣는다. switchTab을 태워 미저장 확인을 존중한다.
  // ↑/↓는 각 탭 안 좌측 트리의 축이라 여기서 잡지 않는다. 포커스 이동은 applySwitchTab이 맡는다.
  function onTablistKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex(t => t.key === active)
    if (i < 0) return
    const next = e.key === 'ArrowRight' ? tabs[i + 1]
      : e.key === 'ArrowLeft' ? tabs[i - 1]
      : e.key === 'Home' ? tabs[0]
      : e.key === 'End' ? tabs[tabs.length - 1]
      : undefined
    if (!next || next.key === active) return
    e.preventDefault()
    switchTab(next.key)
  }

  const ctx: TabsCtx = {
    activeTab: active,
    goTab: switchTab,
    setTabDirty: (key, dirty) => {
      if (dirty) dirtyRef.current.add(key)
      else dirtyRef.current.delete(key)
    },
  }

  // 전체 폭 탭(예: 소방계획서)에서는 768px 제한을 풀고 우측 요약 패널을 접어 화면 전체를 사용 (2026-08-05)
  const isFull = fullWidthKeys?.includes(active) ?? false
  const isWide = wideKeys?.includes(active) ?? false
  return (
    <CustomerTabsContext.Provider value={ctx}>
      {nav.dialog}
      {linkNav.dialog}
      {banner && <div className="mb-4">{banner}</div>}
      {/* 탭 바는 본문 칼럼(max-w-3xl=768px) **밖**에 둔다 — 안에 두면 탭 9개의 자연 폭이
          768을 넘어(2026-09-21 실측 784px, 뱃지가 긴 고객은 ~870px) 회차·청구·수금·이력이
          둘째 줄로 접혔다. 요약 패널까지 지나 본문 전체 폭을 쓰면 1280vw에서도 1008px이라
          한 줄에 들어온다. 접힘(flex-wrap)은 더 좁거나 글꼴 배율이 큰 경우의 안전판으로 남긴다.
          읽기 폭 768은 **패널에만** 남는다 — 폼 레이아웃은 그 폭에 맞춰져 있다. */}
      <div role="tablist" ref={tablistRef} onKeyDown={onTablistKeyDown} className="flex flex-wrap gap-1 border-b border-line">
        {/* roving tabindex — 활성 탭만 Tab 대상. 전부 0이면 패널에 닿는 데 탭 수(9)만큼
            Tab을 눌러야 한다(2026-09-21 실측). 탭 사이 이동은 ←/→가 맡는다(ARIA tablist 규약). */}
        {tabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            tabIndex={active === t.key ? 0 : -1}
            onClick={() => switchTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 h-form-9 text-form-base rounded-t-lg border-b-2 -mb-px transition-colors ${
              active === t.key
                ? 'border-brand text-brand font-semibold bg-brand-tint'
                : 'border-transparent text-ink-sub hover:text-ink hover:bg-paper'
            }`}
          >
            {t.label}
            {t.badge && (
              <span className={`text-form-2xs font-medium ${t.warn ? 'text-amber-600' : 'text-ink-sub'}`}>{t.badge}</span>
            )}
            {t.warn && !t.badge && <span className="text-form-2xs text-amber-500">⚠</span>}
            {t.extra}
          </button>
        ))}
      </div>
      <div className="flex gap-6 items-start">
        <div className={`flex-1 min-w-0 ${isFull || isWide ? '' : 'max-w-3xl'}`}>
          {tabs.map(t => {
            // 지연 마운트(소방계획서_34 S2) — 아직 한 번도 안 연 lazy 탭은 패널 자체를 만들지 않는다
            const deferred = (lazyKeys?.includes(t.key) ?? false) && !visitedRef.current.has(t.key)
            return (
              <div key={t.key} role="tabpanel" hidden={active !== t.key} className="space-y-6 pt-5">
                {deferred ? null : panels[t.key]}
              </div>
            )
          })}
        </div>
        {summary && !isFull && summary}
      </div>
    </CustomerTabsContext.Provider>
  )
}
