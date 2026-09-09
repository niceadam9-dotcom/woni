'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Loader2, Save, MousePointer2, Eraser, Undo2, MoveUpRight, Type, Hash } from 'lucide-react'
import { getPlanAssetDataUrlAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'

/** 이미지 주석 편집기 — 업로드한 지도·위성사진 위에 화살표·글자·번호를 얹는다 (2026-09-08).
 *
 *  왜 필요한가: 진입 경로도는 "어느 길로 들어와 어디에 세우는가"를 보여야 하는데, 캡처한 지도만으로는
 *  그게 드러나지 않는다. 종전엔 사용자가 다른 프로그램에서 화살표를 그려 다시 올려야 했다.
 *
 *  ── 되돌릴 수 있게 만든 이유 ────────────────────────────────────────────────
 *  화살표를 배경에 태워 한 장으로 저장해 버리면 "화살표 하나만 옮기고 싶다"가 영원히 불가능해진다.
 *  그래서 저장 시 ① 합성 PNG(인쇄용) ② 배경 원본 경로 ③ 주석 좌표 JSON 을 함께 남기고,
 *  다시 열 때는 ②를 배경으로 ③을 복원한다. 인쇄 파이프라인은 ①만 보므로 무손상이다.
 *
 *  SVG 편집 → canvas → PNG 경로는 EvacMapBuilder(피난안내도 생성기)와 같다.
 *  다른 점은 배경이 흰 종이가 아니라 실제 사진이고, 화살표가 45° 고정 회전이 아니라
 *  두 점 클릭(자유 각도·길이)이라는 것 — 경로도는 임의 방향이라 고정각으로는 못 맞춘다. */

export type AnnotItem =
  | { id: number; t: 'arrow'; x1: number; y1: number; x2: number; y2: number; c: string }
  | { id: number; t: 'text'; x: number; y: number; s: string; c: string }
  | { id: number; t: 'num'; x: number; y: number; n: number; c: string }

/** w·h는 주석을 찍을 당시의 배경 픽셀 크기 — 배경이 바뀌어도 좌표를 비율로 옮겨 복원한다 */
export type AnnotDoc = { v: 1; w: number; h: number; items: AnnotItem[] }

const COLORS: Array<{ c: string; label: string }> = [
  { c: '#dc2626', label: '빨강' },
  { c: '#2563eb', label: '파랑' },
  { c: '#16a34a', label: '초록' },
]

type Mode = 'move' | 'arrow' | 'text' | 'num' | 'delete'

/** 저장된 JSON 복원 — 손상·구버전은 빈 문서로 떨어뜨린다(편집기가 열리지 않는 것보다 낫다) */
export function parseAnnots(raw: string | null | undefined): AnnotDoc | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<AnnotDoc>
    if (d?.v !== 1 || !Array.isArray(d.items)) return null
    return { v: 1, w: Number(d.w) || 0, h: Number(d.h) || 0, items: d.items as AnnotItem[] }
  } catch {
    return null
  }
}

/** 배경 크기가 달라졌으면 좌표를 비율로 옮긴다 — 원본을 교체하고 다시 열었을 때 화살표가 엉뚱한 곳에 찍히는 것 방지 */
function rescale(items: AnnotItem[], from: { w: number; h: number }, to: { w: number; h: number }): AnnotItem[] {
  if (!from.w || !from.h || (from.w === to.w && from.h === to.h)) return items
  const sx = to.w / from.w, sy = to.h / from.h
  return items.map(i => (i.t === 'arrow'
    ? { ...i, x1: i.x1 * sx, y1: i.y1 * sy, x2: i.x2 * sx, y2: i.y2 * sy }
    : { ...i, x: i.x * sx, y: i.y * sy }))
}

function ArrowGlyph({ a, unit }: { a: Extract<AnnotItem, { t: 'arrow' }>; unit: number }) {
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1
  const len = Math.hypot(dx, dy) || 1
  const ang = Math.atan2(dy, dx)
  const head = Math.min(unit * 3.2, len * 0.6)      // 짧은 화살표에서 머리가 몸통을 넘지 않게
  const halfW = head * 0.55
  const sw = unit * 0.9
  // 몸통은 머리 밑동까지만 — 끝까지 그으면 머리 안쪽으로 선이 비친다
  const bx = a.x2 - Math.cos(ang) * head * 0.92
  const by = a.y2 - Math.sin(ang) * head * 0.92
  const nx = -Math.sin(ang), ny = Math.cos(ang)
  const p1 = `${a.x2},${a.y2}`
  const p2 = `${a.x2 - Math.cos(ang) * head + nx * halfW},${a.y2 - Math.sin(ang) * head + ny * halfW}`
  const p3 = `${a.x2 - Math.cos(ang) * head - nx * halfW},${a.y2 - Math.sin(ang) * head - ny * halfW}`
  return (
    <g>
      {/* 흰 테두리 — 위성사진·항공뷰는 색이 잡다해서 단색 선이 묻힌다 */}
      <line x1={a.x1} y1={a.y1} x2={bx} y2={by} stroke="#ffffff" strokeWidth={sw * 2.2} strokeLinecap="round" />
      <line x1={a.x1} y1={a.y1} x2={bx} y2={by} stroke={a.c} strokeWidth={sw} strokeLinecap="round" />
      <polygon points={`${p1} ${p2} ${p3}`} fill={a.c} stroke="#ffffff" strokeWidth={sw * 0.7} strokeLinejoin="round" />
    </g>
  )
}

function ItemGlyph({ it, unit }: { it: AnnotItem; unit: number }) {
  if (it.t === 'arrow') return <ArrowGlyph a={it} unit={unit} />
  if (it.t === 'text') {
    const fs = unit * 4
    return (
      <text x={it.x} y={it.y} fontSize={fs} fontWeight={700} fontFamily="sans-serif" textAnchor="middle"
        fill={it.c} stroke="#ffffff" strokeWidth={fs * 0.26} paintOrder="stroke" strokeLinejoin="round">
        {it.s}
      </text>
    )
  }
  const r = unit * 2.8
  return (
    <g>
      <circle cx={it.x} cy={it.y} r={r} fill={it.c} stroke="#ffffff" strokeWidth={r * 0.22} />
      <text x={it.x} y={it.y + r * 0.38} fontSize={r * 1.2} fontWeight={700} fontFamily="sans-serif"
        textAnchor="middle" fill="#ffffff">{it.n}</text>
    </g>
  )
}

export function ImageAnnotator({ customerId, basePath, initial, label, saving, onClose, onSave }: {
  customerId: string
  basePath: string                  // 배경으로 깔 원본 이미지 (plan-assets 경로)
  initial: AnnotDoc | null
  label: string
  saving: boolean
  onClose: () => void
  onSave: (file: File, doc: AnnotDoc) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [bg, setBg] = useState<{ url: string; w: number; h: number } | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [items, setItems] = useState<AnnotItem[]>([])
  const [mode, setMode] = useState<Mode>('arrow')
  const [color, setColor] = useState(COLORS[0].c)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)   // 화살표 첫 점
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)   // 고무줄 미리보기 끝점
  const [dragId, setDragId] = useState<number | null>(null)
  const dragFrom = useRef<{ x: number; y: number } | null>(null)
  const nextId = useRef(1)
  const [exporting, setExporting] = useState(false)

  // 배경 로드 — 서명 URL이 아니라 data URL이다(canvas 오염 방지, getPlanAssetDataUrlAction 주석 참조)
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await getPlanAssetDataUrlAction(customerId, basePath)
      if (!alive) return
      if (!r.dataUrl) { setLoadErr(r.error ?? '배경 이미지를 불러오지 못했습니다.'); return }
      const img = new Image()
      img.onload = () => {
        if (!alive) return
        const dims = { w: img.naturalWidth || 1000, h: img.naturalHeight || 700 }
        setBg({ url: r.dataUrl!, ...dims })
        const restored = initial ? rescale(initial.items, { w: initial.w, h: initial.h }, dims) : []
        setItems(restored)
        nextId.current = Math.max(0, ...restored.map(i => i.id)) + 1
      }
      img.onerror = () => { if (alive) setLoadErr('배경 이미지를 해석하지 못했습니다.') }
      img.src = r.dataUrl
    })()
    return () => { alive = false }
    // initial은 열릴 때 한 번만 복원한다 — 편집 중 재복원되면 방금 그린 것이 날아간다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, basePath])

  const unit = bg ? Math.max(bg.w, bg.h) / 100 : 10
  const undo = useCallback(() => { setStart(null); setItems(p => p.slice(0, -1)) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (start) setStart(null); else onClose(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, undo, start])

  function pt(e: React.MouseEvent | React.PointerEvent): { x: number; y: number } {
    const r = svgRef.current!.getBoundingClientRect()
    const w = bg?.w ?? 1000, h = bg?.h ?? 700
    return { x: (e.clientX - r.left) * (w / r.width), y: (e.clientY - r.top) * (h / r.height) }
  }

  function onCanvasClick(e: React.MouseEvent) {
    if (!bg || dragId !== null) return
    const p = pt(e)
    if (mode === 'arrow') {
      if (!start) { setStart(p); setHover(p); return }
      // 클릭이 겹쳐 길이 0짜리 화살표가 생기는 것 방지
      if (Math.hypot(p.x - start.x, p.y - start.y) < unit) { setStart(null); return }
      setItems(prev => [...prev, { id: nextId.current++, t: 'arrow', x1: start.x, y1: start.y, x2: p.x, y2: p.y, c: color }])
      setStart(null)
      return
    }
    if (mode === 'text') {
      const s = window.prompt('표시할 글자 (예: 정문, 소방차 진입, 주차장)')?.trim()
      if (!s) return
      setItems(prev => [...prev, { id: nextId.current++, t: 'text', x: p.x, y: p.y, s, c: color }])
      return
    }
    if (mode === 'num') {
      const n = Math.max(0, ...items.filter(i => i.t === 'num').map(i => (i as Extract<AnnotItem, { t: 'num' }>).n)) + 1
      setItems(prev => [...prev, { id: nextId.current++, t: 'num', x: p.x, y: p.y, n, c: color }])
    }
  }

  function onItemDown(e: React.PointerEvent, id: number) {
    e.stopPropagation()
    if (mode === 'delete') { setItems(prev => prev.filter(i => i.id !== id)); return }
    if (mode !== 'move') return
    dragFrom.current = pt(e)
    setDragId(id)
  }

  function onMove(e: React.PointerEvent) {
    if (start) { setHover(pt(e)); return }
    if (dragId === null || !dragFrom.current) return
    const p = pt(e)
    const dx = p.x - dragFrom.current.x, dy = p.y - dragFrom.current.y
    dragFrom.current = p
    setItems(prev => prev.map(i => (i.id !== dragId ? i : i.t === 'arrow'
      ? { ...i, x1: i.x1 + dx, y1: i.y1 + dy, x2: i.x2 + dx, y2: i.y2 + dy }
      : { ...i, x: i.x + dx, y: i.y + dy })))
  }

  async function exportPng() {
    const svg = svgRef.current
    if (!svg || !bg) return
    setExporting(true)
    try {
      // 편집 전용 표시(고무줄·시작점)는 인쇄물에 남으면 안 된다 — 복제본에서 걷어낸다
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.querySelectorAll('[data-editor-only]').forEach(n => n.remove())
      clone.removeAttribute('class')
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('width', String(bg.w))
      clone.setAttribute('height', String(bg.h))
      const xml = new XMLSerializer().serializeToString(clone)
      const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
      try {
        const img = new Image()
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('svg')); img.src = url })
        // 장변 1800px 상한 — 문서 삽입 선명도는 확보하되 10MB 업로드 제한에 걸리지 않는 크기
        const scale = Math.min(2, 1800 / Math.max(bg.w, bg.h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bg.w * scale))
        canvas.height = Math.max(1, Math.round(bg.h * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        let blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
        let name = 'annotated.png'
        // 지도 사진은 PNG로 커질 수 있다 — 업로드 상한(10MB)에 닿기 전에 JPEG로 떨어뜨린다
        if (blob && blob.size > 7 * 1024 * 1024) {
          const jpg = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.9))
          if (jpg) { blob = jpg; name = 'annotated.jpg' }
        }
        if (!blob) throw new Error('blob')
        onSave(new File([blob], name, { type: blob.type }), { v: 1, w: bg.w, h: bg.h, items })
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch {
      setLoadErr('이미지를 만들지 못했습니다 — 다시 시도해주세요.')
    } finally {
      setExporting(false)
    }
  }

  const toolBtn = (active: boolean) =>
    `inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border text-form-xs transition-colors ${
      active ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`
  const busy = saving || exporting
  const hint = mode === 'arrow'
    ? (start ? '끝점을 클릭하세요 (Esc = 시작점 취소)' : '시작점을 클릭한 뒤 끝점을 클릭하면 화살표가 그려집니다')
    : mode === 'text' ? '이미지를 클릭하면 글자를 입력합니다'
    : mode === 'num' ? '클릭할 때마다 ①②③ 번호가 순서대로 붙습니다'
    : mode === 'move' ? '항목을 끌어 옮깁니다'
    : '클릭한 항목을 지웁니다'

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 z-[70] flex items-center justify-center p-4"
      onClick={onClose} role="dialog" aria-modal="true" aria-label={`${label} 화살표 넣기`}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-line w-full max-w-5xl p-4" onClick={e => e.stopPropagation()}
        data-testid="image-annotator">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-semibold text-ink">
            {label} — 화살표 넣기
            <span className="ml-1.5 text-form-xs font-normal text-ink-meta">원본은 그대로 두고 위에 얹습니다 (언제든 다시 고칠 수 있음)</span>
          </p>
          <button onClick={onClose} className="ml-auto text-ink-faint hover:text-ink-sub" aria-label="닫기"><X className="size-4" /></button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <button onClick={() => { setMode('arrow'); setStart(null) }} className={toolBtn(mode === 'arrow')} data-testid="annot-tool-arrow">
            <MoveUpRight className="size-3" /> 화살표
          </button>
          <button onClick={() => { setMode('text'); setStart(null) }} className={toolBtn(mode === 'text')}>
            <Type className="size-3" /> 글자
          </button>
          <button onClick={() => { setMode('num'); setStart(null) }} className={toolBtn(mode === 'num')}>
            <Hash className="size-3" /> 번호
          </button>
          <button onClick={() => { setMode('move'); setStart(null) }} className={toolBtn(mode === 'move')}>
            <MousePointer2 className="size-3" /> 이동
          </button>
          <button onClick={() => { setMode('delete'); setStart(null) }} className={toolBtn(mode === 'delete')}>
            <Eraser className="size-3" /> 삭제
          </button>
          <span className="mx-1 h-4 w-px bg-brand-line-soft" />
          {COLORS.map(c => (
            <button key={c.c} onClick={() => setColor(c.c)} title={c.label} aria-label={c.label}
              className={`size-6 rounded-full border-2 transition-transform ${color === c.c ? 'border-ink scale-110' : 'border-brand-line-soft'}`}
              style={{ backgroundColor: c.c }} />
          ))}
          <span className="mx-1 h-4 w-px bg-brand-line-soft" />
          <button onClick={undo} disabled={items.length === 0} className={`${toolBtn(false)} disabled:opacity-40`}>
            <Undo2 className="size-3" /> 되돌리기
          </button>
          <button onClick={() => { setItems([]); setStart(null) }} disabled={items.length === 0} className={`${toolBtn(false)} disabled:opacity-40`}>
            비우기
          </button>
        </div>

        <div className="rounded-lg border border-brand-line-soft bg-paper overflow-hidden">
          {loadErr ? (
            <p className="p-6 text-center text-form-sm text-red-600">{loadErr}</p>
          ) : !bg ? (
            <p className="p-6 text-center text-form-sm text-ink-meta"><Loader2 className="inline size-4 animate-spin" /> 배경 이미지 불러오는 중…</p>
          ) : (
            <svg ref={svgRef} viewBox={`0 0 ${bg.w} ${bg.h}`} xmlns="http://www.w3.org/2000/svg" data-testid="annot-canvas"
              className="w-full max-h-[60vh] select-none touch-none cursor-crosshair"
              onClick={onCanvasClick} onPointerMove={onMove}
              onPointerUp={() => { setDragId(null); dragFrom.current = null }}
              onPointerLeave={() => { setDragId(null); dragFrom.current = null }}>
              <image href={bg.url} x={0} y={0} width={bg.w} height={bg.h} preserveAspectRatio="none" />
              {items.map(it => (
                <g key={it.id}
                  className={mode === 'move' ? 'cursor-move' : mode === 'delete' ? 'cursor-pointer' : undefined}
                  onPointerDown={e => onItemDown(e, it.id)} onClick={e => { if (mode !== 'arrow') e.stopPropagation() }}>
                  <ItemGlyph it={it} unit={unit} />
                </g>
              ))}
              {/* 고무줄 미리보기 — 내보내기 전에 걷어낸다 */}
              {start && hover && (
                <g data-editor-only="1">
                  <ArrowGlyph a={{ id: -1, t: 'arrow', x1: start.x, y1: start.y, x2: hover.x, y2: hover.y, c: color }} unit={unit} />
                  <circle cx={start.x} cy={start.y} r={unit * 0.8} fill="#ffffff" stroke={color} strokeWidth={unit * 0.4} />
                </g>
              )}
            </svg>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <p className="text-form-2xs text-ink-meta flex-1 min-w-48">{hint} · Ctrl+Z 되돌리기</p>
          <button onClick={onClose} disabled={busy}
            className="h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-paper transition-colors disabled:opacity-50">
            취소
          </button>
          <button onClick={exportPng} disabled={busy || !bg || items.length === 0} data-testid="annot-save"
            className="inline-flex items-center gap-1 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium transition-colors disabled:opacity-50">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 이 그림으로 저장
          </button>
        </div>
      </div>
    </div>
  )
}
