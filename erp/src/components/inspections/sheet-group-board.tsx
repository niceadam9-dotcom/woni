'use client'

import { useMemo, useState } from 'react'
import { CircleCheck, Search } from 'lucide-react'
import type { SheetProgress } from '@/lib/sheet-overview'

/** 왼쪽 머더 카드 보드 — 전 시트·전 머더 상시 조회, **접이 없음** (소방계획서_23 S7-3, Q-2).
 *
 *  자체 fetch 없음 — progress prop에서 파생만 한다. ⚠ progress는 서버 prop 원본이 아니라
 *  **오케스트레이터가 로컬 응답을 오버레이한 값**이어야 한다(G-9) — 저장·일괄 직후 카드가
 *  새로고침 없이 즉시 갱신된다. 시트 클릭 = 시트 전체 열기(첫 머더), 카드 클릭 = 그 머더로 점프(Q-14). */
export function SheetGroupBoard({ progress, noFacilityInfo, canEdit, busy, onOpen, onSheetNA }: {
  /** 오버레이 적용된 시트 진행률(withGroups) — sheetId 순회 순서는 호출부 배열 순서 유지 */
  progress: SheetProgress[]
  noFacilityInfo: boolean
  canEdit: boolean
  busy: boolean
  /** groupCode=null이면 시트 첫 머더로 */
  onOpen: (sheetId: string, groupCode: string | null) => void
  /** 시트 단위 ／ 일괄(Q-20) — 확인창·apply/release 판단은 오케스트레이터 소유 */
  onSheetNA: (sheetId: string) => void
}) {
  // Q-12 — installedOnly 기본 on. 설치 정보가 아예 없는 고객은 전체 표시 + 유도 배너
  const [installedOnly, setInstalledOnly] = useState(true)
  const [q, setQ] = useState('')
  const effectiveOnly = installedOnly && !noFacilityInfo

  const visible = useMemo(() => {
    const needle = q.trim().replace(/\s+/g, '')
    return progress
      .filter(s => !effectiveOnly || s.installed || s.responded > 0)   // 입력이 이미 있는 시트는 필터로 숨기지 않는다
      .map(s => ({
        ...s,
        groups: (s.groups ?? []).filter(g => {
          if (!needle) return true
          const hay = `${s.sheetName}${g.groupCode}${g.groupName}${g.subgroupNames.join('')}`.replace(/\s+/g, '')
          return hay.includes(needle)
        }),
      }))
      .filter(s => !needle || s.groups.length > 0 || s.sheetName.replace(/\s+/g, '').includes(needle))
  }, [progress, effectiveOnly, q])

  return (
    <div data-testid="sheet-group-board">
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1 text-[11px] text-[#514b81] select-none">
          <input type="checkbox" checked={installedOnly} onChange={e => setInstalledOnly(e.target.checked)}
            disabled={noFacilityInfo} className="accent-[#7b68ee]" />
          설치 설비만
        </label>
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          {/* 상단 '빠른 결과 입력'(항목 검색→불량 태깅)과 역할 구분 — 여기는 목록 필터 */}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="설비·중분류 찾기"
            className="h-8 w-full rounded-lg border border-[#d0ccf5] bg-white pl-7 pr-2 text-xs outline-none focus:border-[#7b68ee]" />
        </div>
      </div>
      {noFacilityInfo && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          설치 시설 정보가 없어 전체 시트를 표시합니다 — 고객 상세 › 소방계획서 탭 › 1.4 소방시설에서
          설치 시설을 등록하면 해당 설비만 추려 보입니다.
        </div>
      )}

      {visible.map(s => {
        const full = s.total > 0 && s.responded >= s.total
        return (
          <section key={s.sheetId} className="mb-2">
            <div className="sticky top-0 z-[1] flex items-center gap-1.5 bg-white/95 backdrop-blur-sm border-b border-[#e0ddf5] py-1">
              {/* 열기는 조회 전용 계정도 가능(드로어가 읽기 전용으로 뜬다) — 편집 게이트는 에디터 canEdit */}
              <button onClick={() => onOpen(s.sheetId, null)}
                title={`${s.sheetName} — 시트 전체 열기`} data-board-sheet={s.sheetId}
                className="flex items-center gap-1.5 min-w-0 text-left text-xs font-semibold text-[#090c1d] hover:text-[#7b68ee]">
                {/* Q-22 ① — 전 항목 처리(○/✕/／) 완료 시 ✓ */}
                {full && <CircleCheck className="size-3.5 shrink-0 text-green-500" data-sheet-done />}
                <span className="truncate">{s.sheetName}</span>
              </button>
              <span className={`ml-auto shrink-0 text-[10px] ${full ? 'text-green-600' : s.responded > 0 ? 'text-amber-600' : 'text-[#b0acd6]'}`}
                data-sheet-count={`${s.responded}/${s.total}`}>
                {s.responded}/{s.total}{s.counts.X > 0 ? ` ✕${s.counts.X}` : ''}
              </span>
              {canEdit && (
                <button onClick={() => onSheetNA(s.sheetId)} disabled={busy} data-sheet-na={s.sheetId}
                  title="이 시트의 미입력 항목을 전부 ／(해당없음)로 — 입력된 ○/✕는 보존 (재실행 시 ／만 해제)"
                  className="shrink-0 h-6 px-2 rounded text-[10px] font-medium border border-[#d0ccf5] text-[#514b81] hover:bg-[#ebe9ff] disabled:opacity-40">
                  ／ 전체
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-1.5 mt-1.5">
              {s.groups.map(g => {
                const gFull = g.total > 0 && g.responded >= g.total
                return (
                  <button key={g.groupKey} onClick={() => onOpen(s.sheetId, g.groupCode)}
                    data-group-key={g.groupKey} data-installed={s.installed ? '1' : '0'} data-responded={g.responded}
                    className={`rounded-lg border border-[#e0ddf5] px-2.5 py-1.5 text-left hover:bg-[#f5f4ff] hover:border-[#c3bdf5] transition-colors ${
                      s.installed ? '' : 'opacity-45'}`}>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] font-bold text-[#7b68ee] shrink-0">[{g.groupCode}]</span>
                      {g.groupName !== g.groupCode && (
                        <span className="text-[11px] text-[#090c1d] truncate flex-1 min-w-0">{g.groupName}</span>
                      )}
                      <span className={`ml-auto text-[9px] shrink-0 ${gFull ? 'text-green-600' : g.responded > 0 ? 'text-amber-600' : 'text-[#b0acd6]'}`}>
                        {g.responded > 0 || g.total === 0 ? `${g.responded}/${g.total}` : '미입력'}{g.x > 0 ? ` ✕${g.x}` : ''}
                      </span>
                    </span>
                    <span className="block h-1 mt-1 rounded bg-[#f0eefb] overflow-hidden">
                      <span className={`block h-full ${gFull ? 'bg-green-400' : 'bg-[#c3bdf5]'}`}
                        style={{ width: `${g.total > 0 ? Math.round(g.responded / g.total * 100) : 0}%` }} />
                    </span>
                    {g.subgroupNames.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {g.subgroupNames.map(n => (
                          <span key={n} className="text-[9px] text-[#b0acd6] bg-[#fafaff] border border-[#f0eefb] rounded px-1 truncate max-w-40">[{n}]</span>
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
      {visible.length === 0 && (
        <p className="text-[11px] text-[#b0acd6] py-4 text-center">표시할 시트가 없습니다 — 검색어나 [설치 설비만] 필터를 확인하세요.</p>
      )}
    </div>
  )
}
