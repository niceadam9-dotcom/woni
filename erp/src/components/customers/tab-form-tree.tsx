'use client'

import { useState, type ReactNode } from 'react'
import { collectPlanSaveHandlers, useUnsavedNavGuard } from '@/components/ui/unsaved-nav'

/** 공통·보고서 탭의 좌측 목차 트리 셸 (2026-09-20 3분리 — 사용자 확정: 「형식은 소방계획서 트리 구조」).
 *
 *  plan-tab-view의 트리 규약을 그대로 축소 이식했다:
 *   · 좌측 목차(데스크톱) + 모바일 드롭다운 폴백 · data-plan-node/aria-current 구조 표식
 *   · ?form= 딥링크 동기화(서버 왕복 없는 replaceState) · 미저장 이동 확인([저장하고 이동] await)
 *   · 완성도 점(✓/○/게이지)
 *  ⚠ plan-tab-view를 직접 재사용하지 않는 이유: 그쪽은 생성 바·누락 칩·대장 자동반영 등
 *    소방계획서 고유 짐이 절반이다. 트리 골격만 나눠 쓰면 세 탭이 같은 조작감을 갖는다. */

export type TreeNodeDef = {
  key: string
  label: string
  /** 완성도 — true=✓ / false=○ / {done,total}=게이지. 생략 = 표시 없음 */
  status?: boolean | { done: number; total: number }
  /** 사용처 칩(2026-09-20 사용자 요청 — 「이 입력이 어느 문서에 실리는가」를 서식마다 표시).
   *  plan-form14-specs의 사용처 칩과 같은 규약 — 문서명을 짧게, 쓰이는 곳 전부. */
  usage?: string[]
}

export function TabFormTree({ tabKey, groupLabel, nodes, panels, initialForm, footer }: {
  /** 이 트리가 사는 최상위 탭 key — ?tab= 유지용 (예: 'facilities' | 'reports') */
  tabKey: string
  /** 트리 머리글 (예: '📘 공통 입력') */
  groupLabel: string
  nodes: TreeNodeDef[]
  panels: Record<string, ReactNode>
  /** 딥링크 ?form= 초기 선택 — 없거나 모르는 키면 첫 노드 */
  initialForm?: string
  /** 트리 아래 부가 안내(확장 규칙 문구 등) */
  footer?: ReactNode
}) {
  const valid = new Set(nodes.map(n => n.key))
  const [sel, setSel] = useState<string>(initialForm && valid.has(initialForm) ? initialForm : nodes[0]?.key ?? '')

  // 미저장 이동 확인 — 서식이 등록한 save 핸들러(usePlanSaveHandler, dirty일 때만 등록)를 신호로 쓴다.
  // ⚠ 핸들러 버스는 전역이라 다른 탭의 미저장도 함께 잡힌다 — 과잉 확인이지만 [저장하고 이동]이
  //   그쪽까지 저장하므로 안전한 방향의 오차다(customer-tabs switchTab과 같은 결정).
  const nav = useUnsavedNavGuard<string>({
    onProceed: applySelect,
    message: '지금 이동하면 이 서식에 입력한 내용이 저장되지 않습니다.',
  })
  function select(key: string) {
    if (key === sel) return
    if (collectPlanSaveHandlers().length > 0) { nav.request(key); return }
    applySelect(key)
  }
  function applySelect(key: string) {
    setSel(key)
    // 딥링크 동기화 (plan-tab-view applySelect와 같은 규약 — 서버 왕복 없이)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tabKey)
    url.searchParams.set('form', key)
    window.history.replaceState(null, '', url.toString())
  }

  const dot = (s: TreeNodeDef['status']) => {
    if (s === undefined) return null
    if (typeof s === 'object') {
      const full = s.done >= s.total
      return <span className={`ml-auto text-form-2xs shrink-0 ${full ? 'text-green-600' : 'text-amber-600'}`}>{full ? '✓' : `${s.done}/${s.total}`}</span>
    }
    return <span className={`ml-auto text-form-2xs shrink-0 ${s ? 'text-green-600' : 'text-ink-meta'}`}>{s ? '✓' : '○'}</span>
  }

  return (
    <div className="flex gap-4 items-start">
      {nav.dialog}
      <aside className="hidden md:block w-48 shrink-0 rounded-xl border border-brand-line-soft bg-brand-tint p-2 space-y-0.5 sticky top-2">
        <p className="px-2 py-1 text-form-2xs font-bold text-ink-soft">{groupLabel}</p>
        {nodes.map(n => (
          <button key={n.key} onClick={() => select(n.key)}
            data-plan-node={n.key} aria-current={sel === n.key ? 'true' : undefined}
            className={`w-full flex items-center gap-1.5 h-form-7 rounded-lg text-form-xs text-left transition-colors pl-5 pr-2 ${
              sel === n.key ? 'bg-brand text-white [&>span]:!text-white' : 'text-ink-sub hover:bg-brand-tint'
            }`}>
            <span className="truncate">{n.label}</span>
            {dot(n.status)}
          </button>
        ))}
        {footer}
      </aside>

      <div className="flex-1 min-w-0">
        {/* 모바일 목차 드롭다운 (plan-tab-view 7-6 폴백과 같은 모양) */}
        <select value={sel} data-plan-nav onChange={e => select(e.target.value)}
          className="md:hidden mb-3 h-form-8 w-full rounded-lg border border-brand-line bg-surface px-2 text-form-sm outline-none">
          {nodes.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}
        </select>
        {/* 패널은 전부 렌더 후 show/hide — 탭 셸과 같은 계약(노드를 오가도 입력 상태 유지) */}
        {nodes.map(n => (
          <div key={n.key} hidden={sel !== n.key}>
            {n.usage && n.usage.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap text-form-2xs mb-3" data-testid={`usage-${n.key}`}>
                <span className="text-ink-meta font-medium">사용처:</span>
                {n.usage.map(u => (
                  <span key={u} className="px-1.5 py-0.5 rounded-full bg-brand-line-soft text-ink-sub font-medium">{u}</span>
                ))}
              </div>
            )}
            {panels[n.key]}
          </div>
        ))}
      </div>
    </div>
  )
}
