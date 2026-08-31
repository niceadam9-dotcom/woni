'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { collectPlanSaveHandlers, useUnsavedNavGuard } from '@/components/ui/unsaved-nav'

/** 고객 상세 탭 셸 (설계 §2·§4·§6-C) — URL ?tab= 동기화 + 상태 뱃지 + 미저장 경고 + 다음 탭 전환.
 *  패널은 전부 서버 렌더 후 show/hide — 탭 전환에도 각 폼의 입력 상태가 유지된다. */

export type CustomerTabDef = {
  key: string
  label: string
  badge?: string   // 표시 텍스트 (예: "6/9", "(2)", "07-10")
  warn?: boolean   // 미완 ⚠ (앰버)
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

export function CustomerTabs({ initialTab, tabs, panels, summary, fullWidthKeys, lazyKeys }: {
  initialTab: string
  tabs: CustomerTabDef[]
  panels: Record<string, ReactNode>
  summary?: ReactNode        // 우측 고객 요약 패널 — fullWidth 탭에서는 접힘(숨김)
  fullWidthKeys?: string[]    // 전체 폭으로 펼칠 탭 키(예: ['plan']) — max-w-3xl 해제 + 요약 패널 접힘
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
    // 계획서 서식(1.2~3장)은 setTabDirty 배선이 없다 — 미저장 서식이 등록한 save 핸들러(dirty일 때만 등록)를 함께 본다
    if (dirtyRef.current.has(active) || (active === 'plan' && collectPlanSaveHandlers().length > 0)) { nav.request(key); return }
    applySwitchTab(key)
  }
  function applySwitchTab(key: string) {
    setActive(key)
    const sp = new URLSearchParams(window.location.search)
    sp.set('tab', key)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
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
  return (
    <CustomerTabsContext.Provider value={ctx}>
      {nav.dialog}
      {linkNav.dialog}
      <div className="flex gap-6 items-start">
        <div className={`flex-1 min-w-0 ${isFull ? '' : 'max-w-3xl'}`}>
          <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
            {tabs.map(t => (
              <button
                key={t.key}
                role="tab"
                aria-selected={active === t.key}
                onClick={() => switchTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 h-9 text-sm rounded-t-lg border-b-2 -mb-px transition-colors ${
                  active === t.key
                    ? 'border-brand text-brand font-semibold bg-brand-tint'
                    : 'border-transparent text-ink-sub hover:text-ink hover:bg-paper'
                }`}
              >
                {t.label}
                {t.badge && (
                  <span className={`text-[10px] font-medium ${t.warn ? 'text-amber-600' : 'text-ink-meta'}`}>{t.badge}</span>
                )}
                {t.warn && !t.badge && <span className="text-[10px] text-amber-500">⚠</span>}
              </button>
            ))}
          </div>
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
