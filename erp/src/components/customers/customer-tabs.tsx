'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

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
  /** 저장 성공 후 다음 탭으로 (§6-C-4) */
  goNextTab: () => void
  /** 각 탭 폼의 미저장 변경 등록 (§6-C-5) */
  setTabDirty: (key: string, dirty: boolean) => void
}

const CustomerTabsContext = createContext<TabsCtx | null>(null)
/** 탭 셸 밖(단독 사용)에서는 null — 호출부는 옵셔널 체이닝으로 사용 */
export function useCustomerTabs() {
  return useContext(CustomerTabsContext)
}

export function CustomerTabs({ initialTab, tabs, panels }: {
  initialTab: string
  tabs: CustomerTabDef[]
  panels: Record<string, ReactNode>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [active, setActive] = useState(tabs.some(t => t.key === initialTab) ? initialTab : tabs[0].key)
  const dirtyRef = useRef<Set<string>>(new Set())

  // 미저장 이탈 경고 — 페이지 이탈(새로고침·닫기)
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  function switchTab(key: string) {
    if (key === active) return
    if (dirtyRef.current.has(active) &&
        !window.confirm('저장하지 않은 변경사항이 있습니다. 탭을 이동할까요?')) return
    setActive(key)
    const sp = new URLSearchParams(window.location.search)
    sp.set('tab', key)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  const ctx: TabsCtx = {
    activeTab: active,
    goTab: switchTab,
    goNextTab: () => {
      const i = tabs.findIndex(t => t.key === active)
      if (i >= 0 && i < tabs.length - 1) switchTab(tabs[i + 1].key)
    },
    setTabDirty: (key, dirty) => {
      if (dirty) dirtyRef.current.add(key)
      else dirtyRef.current.delete(key)
    },
  }

  return (
    <CustomerTabsContext.Provider value={ctx}>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-[#c8c4d0]">
        {tabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            onClick={() => switchTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 h-9 text-sm rounded-t-lg border-b-2 -mb-px transition-colors ${
              active === t.key
                ? 'border-[#7b68ee] text-[#7b68ee] font-semibold bg-[#f5f4ff]'
                : 'border-transparent text-[#514b81] hover:text-[#090c1d] hover:bg-[#f8f9fa]'
            }`}
          >
            {t.label}
            {t.badge && (
              <span className={`text-[10px] font-medium ${t.warn ? 'text-amber-600' : 'text-[#b0acd6]'}`}>{t.badge}</span>
            )}
            {t.warn && !t.badge && <span className="text-[10px] text-amber-500">⚠</span>}
          </button>
        ))}
      </div>
      {tabs.map(t => (
        <div key={t.key} role="tabpanel" hidden={active !== t.key} className="space-y-6 pt-5">
          {panels[t.key]}
        </div>
      ))}
    </CustomerTabsContext.Provider>
  )
}
