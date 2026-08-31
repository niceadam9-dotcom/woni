'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Eraser, MousePointer2, Undo2, Save } from 'lucide-react'

/** 개략 피난안내도 생성기 (B안 — 2026-08-05 사용자 확정)
 *  실측 평면도가 공공 API로 제공되지 않아(건축물현황도는 세움터 수동 발급) 표준 아이콘 개략도를 직접 그린다.
 *  SVG 편집(배치·드래그 이동·화살표 회전·구획선·삭제) → PNG 변환 → 저장은 호출부의 evac 업로드 파이프라인 위임.
 *  조작: 팔레트 선택 후 도면 클릭=배치, [이동] 모드 드래그=이동·화살표 더블클릭=45° 회전, [삭제] 모드 클릭=제거 */

type ItemType = 'exit' | 'stair' | 'ext' | 'hydrant' | 'here' | 'arrow'
type Item = { id: number; type: ItemType; x: number; y: number; rot: number }
type Wall = { id: number; x1: number; y1: number; x2: number; y2: number }
type Mode = 'move' | 'wall' | 'delete' | `place:${ItemType}`

const PALETTE: Array<{ type: ItemType; label: string }> = [
  { type: 'exit', label: '비상구' },
  { type: 'stair', label: '계단' },
  { type: 'ext', label: '소화기' },
  { type: 'hydrant', label: '소화전' },
  { type: 'here', label: '현위치' },
  { type: 'arrow', label: '대피방향' },
]
const LEGEND_LABEL: Record<ItemType, string> = {
  exit: '비상구', stair: '계단', ext: '소화기', hydrant: '옥내소화전', here: '현위치', arrow: '대피방향',
}

// 캔버스 규격 — 도면 영역 (40,70)~(760,470), 아래 범례 줄
const W = 800, H = 560
const PLAN = { x: 40, y: 70, w: 720, h: 400 }

function ItemGlyph({ type }: { type: ItemType }) {
  switch (type) {
    case 'exit': return (
      <g>
        <rect x={-24} y={-12} width={48} height={24} rx={3} fill="#16a34a" />
        <text y={4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={700}>비상구</text>
      </g>)
    case 'stair': return (
      <g>
        <rect x={-20} y={-14} width={40} height={28} fill="#fff" stroke="#334155" />
        {[-7, 0, 7].map(y => <line key={y} x1={-20} y1={y} x2={20} y2={y} stroke="#334155" />)}
        <text y={-19} textAnchor="middle" fontSize={10} fill="#334155">계단</text>
      </g>)
    case 'ext': return (
      <g>
        <circle r={10} fill="#dc2626" />
        <text y={3.5} textAnchor="middle" fontSize={9} fill="#fff" fontWeight={700}>소</text>
        <text y={23} textAnchor="middle" fontSize={9} fill="#dc2626">소화기</text>
      </g>)
    case 'hydrant': return (
      <g>
        <rect x={-11} y={-11} width={22} height={22} rx={2} fill="#dc2626" />
        <text y={3.5} textAnchor="middle" fontSize={9} fill="#fff" fontWeight={700}>전</text>
        <text y={25} textAnchor="middle" fontSize={9} fill="#dc2626">소화전</text>
      </g>)
    case 'here': return (
      <g>
        <circle r={7} fill="#2563eb" />
        <circle r={3} fill="#fff" />
        <text y={21} textAnchor="middle" fontSize={9} fill="#2563eb">현위치</text>
      </g>)
    case 'arrow': return (
      <polygon points="-18,-7 6,-7 6,-14 20,0 6,14 6,7 -18,7" fill="#16a34a" opacity={0.9} />)
  }
}

/** 고객별 초안 로드 — 손상·부재 시 빈 캔버스 */
function loadDraft(customerId: string): { floor: string; items: Item[]; walls: Wall[] } {
  try {
    const raw = localStorage.getItem(`evac-map-draft:${customerId}`)
    if (raw) {
      const d = JSON.parse(raw) as { floor?: string; items?: Item[]; walls?: Wall[] }
      return {
        floor: d.floor ?? '1층',
        items: Array.isArray(d.items) ? d.items : [],
        walls: Array.isArray(d.walls) ? d.walls : [],
      }
    }
  } catch { /* 손상된 초안 무시 */ }
  return { floor: '1층', items: [], walls: [] }
}

export function EvacMapBuilder({ customerId, onClose, onSave, saving }: {
  customerId: string
  onClose: () => void
  onSave: (file: File) => void   // 호출부가 evac 슬롯 업로드 (customer-assets-client upload)
  saving: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  // 초안 자동 저장 (2026-08-05 사용자 확정) — 그리던 내용을 고객별로 보존해 닫아도 유실 없이 재편집 가능
  const [draft] = useState(() => loadDraft(customerId))
  const [floor, setFloor] = useState(draft.floor)
  const [mode, setMode] = useState<Mode>('move')
  const [items, setItems] = useState<Item[]>(draft.items)
  const [walls, setWalls] = useState<Wall[]>(draft.walls)
  const [wallStart, setWallStart] = useState<{ x: number; y: number } | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const nextId = useRef(Math.max(0, ...draft.items.map(i => i.id), ...draft.walls.map(w => w.id)) + 1)

  useEffect(() => {
    try { localStorage.setItem(`evac-map-draft:${customerId}`, JSON.stringify({ floor, items, walls })) } catch { /* 저장 공간 부족 등 — 무시 */ }
  }, [customerId, floor, items, walls])

  function svgPoint(e: React.PointerEvent | React.MouseEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.round((e.clientX - rect.left) * (W / rect.width)),
      y: Math.round((e.clientY - rect.top) * (H / rect.height)),
    }
  }
  const inPlan = (p: { x: number; y: number }) =>
    p.x >= PLAN.x && p.x <= PLAN.x + PLAN.w && p.y >= PLAN.y && p.y <= PLAN.y + PLAN.h

  function handleCanvasClick(e: React.MouseEvent) {
    const p = svgPoint(e)
    if (!inPlan(p)) return
    if (mode.startsWith('place:')) {
      const type = mode.slice(6) as ItemType
      setItems(prev => [...prev, { id: nextId.current++, type, x: p.x, y: p.y, rot: 0 }])
      return
    }
    if (mode === 'wall') {
      if (!wallStart) { setWallStart(p); return }
      // 수평/수직 스냅 — 개략도의 구획선은 직교가 보기 좋음
      const dx = Math.abs(p.x - wallStart.x), dy = Math.abs(p.y - wallStart.y)
      const end = dx >= dy ? { x: p.x, y: wallStart.y } : { x: wallStart.x, y: p.y }
      setWalls(prev => [...prev, { id: nextId.current++, x1: wallStart.x, y1: wallStart.y, x2: end.x, y2: end.y }])
      setWallStart(null)
    }
  }

  function handleItemPointerDown(id: number) {
    if (mode === 'move') setDragId(id)
    if (mode === 'delete') setItems(prev => prev.filter(i => i.id !== id))
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (dragId === null) return
    const p = svgPoint(e)
    if (!inPlan(p)) return
    setItems(prev => prev.map(i => (i.id === dragId ? { ...i, x: p.x, y: p.y } : i)))
  }
  function rotateArrow(id: number) {
    if (mode !== 'move') return
    setItems(prev => prev.map(i => (i.id === id && i.type === 'arrow' ? { ...i, rot: (i.rot + 45) % 360 } : i)))
  }

  const usedTypes = [...new Set(items.map(i => i.type))]

  async function exportPng() {
    const svg = svgRef.current
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const img = new Image()
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url })
      const canvas = document.createElement('canvas')
      canvas.width = W * 2; canvas.height = H * 2   // 2배 해상도 — 문서 삽입 선명도
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
      if (!blob) return
      onSave(new File([blob], 'evac_plan.png', { type: 'image/png' }))
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const toolBtn = (active: boolean) =>
    `inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border text-[11px] transition-colors ${
      active ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'
    }`

  return (
    <div className="fixed inset-0 bg-black/30 dark:bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-line w-full max-w-4xl p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-semibold text-ink">피난안내도 생성 <span className="text-[11px] font-normal text-ink-meta">— 표준 아이콘 개략도 (실측 도면 아님)</span></p>
          <button onClick={onClose} className="ml-auto text-ink-faint hover:text-ink-sub"><X className="size-4" /></button>
        </div>

        {/* 팔레트·도구 */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <input value={floor} onChange={e => setFloor(e.target.value)} placeholder="층 표기 (예: 1층)"
            className="h-7 w-24 rounded-lg border border-brand-line px-2 text-[11px] outline-none focus:border-brand" />
          <button onClick={() => setMode('move')} className={toolBtn(mode === 'move')} title="배치된 항목 드래그 이동 · 화살표 더블클릭 = 45° 회전">
            <MousePointer2 className="size-3" /> 이동
          </button>
          {PALETTE.map(p => (
            <button key={p.type} onClick={() => setMode(`place:${p.type}`)} className={toolBtn(mode === `place:${p.type}`)}>
              {p.label}
            </button>
          ))}
          <button onClick={() => { setMode('wall'); setWallStart(null) }} className={toolBtn(mode === 'wall')} title="두 점을 클릭해 구획선을 긋습니다 (직교 스냅)">
            구획선
          </button>
          <button onClick={() => setMode('delete')} className={toolBtn(mode === 'delete')} title="클릭한 항목·구획선을 삭제합니다">
            <Eraser className="size-3" /> 삭제
          </button>
          <button onClick={() => { setItems([]); setWalls([]); setWallStart(null) }} className={toolBtn(false)} title="전체 비우기">
            <Undo2 className="size-3" /> 비우기
          </button>
        </div>

        {/* 도면 캔버스 */}
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg"
          className="w-full rounded-lg border border-brand-line-soft cursor-crosshair select-none"
          onClick={handleCanvasClick} onPointerMove={handlePointerMove}
          onPointerUp={() => setDragId(null)} onPointerLeave={() => setDragId(null)}>
          {/* 흰 배경은 **의도적 라이트 고정**(소방계획서_29 S3-6) — 이 SVG는 그대로 PNG로
              내보내져 소방계획서에 삽입된다. 다크 모드에서도 문서는 흰 종이가 정본이다. */}
          <rect width={W} height={H} fill="#ffffff" />
          <text x={W / 2} y={42} textAnchor="middle" fontSize={20} fontWeight={700} fill="#111827" fontFamily="sans-serif">
            피난안내도 {floor && `— ${floor}`}
          </text>
          {/* 외곽(건물 윤곽) */}
          <rect x={PLAN.x} y={PLAN.y} width={PLAN.w} height={PLAN.h} fill="#f8fafc" stroke="#334155" strokeWidth={2.5} />
          {/* 구획선 */}
          {walls.map(w => (
            <line key={w.id} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#334155" strokeWidth={2}
              className={mode === 'delete' ? 'cursor-pointer' : undefined}
              onClick={e => { if (mode === 'delete') { e.stopPropagation(); setWalls(prev => prev.filter(x => x.id !== w.id)) } }} />
          ))}
          {wallStart && <circle cx={wallStart.x} cy={wallStart.y} r={3} fill="#7b68ee" />}
          {/* 배치 항목 */}
          {items.map(i => (
            <g key={i.id} transform={`translate(${i.x},${i.y}) rotate(${i.rot})`}
              className={mode === 'move' ? 'cursor-move' : mode === 'delete' ? 'cursor-pointer' : undefined}
              onPointerDown={e => { e.stopPropagation(); handleItemPointerDown(i.id) }}
              onDoubleClick={() => rotateArrow(i.id)}
              onClick={e => e.stopPropagation()}>
              <ItemGlyph type={i.type} />
            </g>
          ))}
          {/* 범례 + 안내 문구 */}
          {usedTypes.length > 0 && (
            <g transform={`translate(${PLAN.x},${PLAN.y + PLAN.h + 34})`} fontFamily="sans-serif">
              <text fontSize={11} fontWeight={700} fill="#334155">범례:</text>
              {usedTypes.map((t, idx) => (
                <g key={t} transform={`translate(${60 + idx * 92},-4)`}>
                  <g transform="scale(0.55) translate(0,0)"><ItemGlyph type={t} /></g>
                  <text x={18} y={8} fontSize={10} fill="#334155">{LEGEND_LABEL[t]}</text>
                </g>
              ))}
            </g>
          )}
          <text x={W - 40} y={H - 14} textAnchor="end" fontSize={9} fill="#94a3b8" fontFamily="sans-serif">
            ※ 본 안내도는 개략도입니다 — 화재 시 대피방향 화살표를 따라 비상구로 대피하세요
          </text>
        </svg>

        <div className="flex items-center gap-2 mt-3">
          <p className="text-[10px] text-ink-meta">
            팔레트 선택 후 도면을 클릭해 배치 · [이동]에서 드래그, 화살표 더블클릭 = 회전 · [구획선]은 두 점 클릭 · 그리던 내용은 자동 저장됩니다
          </p>
          <button onClick={onClose} disabled={saving}
            className="ml-auto h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-paper transition-colors disabled:opacity-50">
            취소
          </button>
          <button onClick={exportPng} disabled={saving || items.length === 0}
            className="inline-flex items-center gap-1 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} PNG로 등록
          </button>
        </div>
      </div>
    </div>
  )
}
