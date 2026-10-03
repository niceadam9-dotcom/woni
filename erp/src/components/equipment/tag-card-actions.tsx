'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2, PlusCircle } from 'lucide-react'
import {
  recordTagScanAction, markTagGoodAction, registerTagDefectAction, replaceTagAssetAction,
  registerUnknownTagAction, searchCustomersForTagAction, listBuildingsForTagAction,
} from '@/app/(dashboard)/t/tag-actions'
import { CATEGORIES, CATEGORY_LABEL, type EquipmentCategory } from '@/lib/equipment-lifespan'

/** QR 카드(/t/{code}) 현장 동작 (통합 실행계획 C4 2단계 웹, 2026-10-03)
 *  폰 화면 기준 — 버튼은 손가락 크기(h-11), 한 번에 하나의 폼만 펼친다. */

const btn = 'inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium disabled:opacity-50'
const field = 'h-11 w-full rounded-lg border border-brand-line px-3 text-sm'

/** 카드를 연 사실을 이력에 — 같은 개체·같은 날 1행(서버가 거른다). 렌더 중 쓰기를 피하려고 마운트 뒤에 */
export function TagScanRecorder({ assetId }: { assetId: string }) {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    void recordTagScanAction(assetId)
  }, [assetId])
  return null
}

export function TagCardActions({ assetId, canReplace }: { assetId: string; canReplace: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState<'defect' | 'replace' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [name, setName] = useState('')
  const [detail, setDetail] = useState('')
  const [severity, setSeverity] = useState<'경미' | '보통' | '중대'>('보통')

  const run = (fn: () => Promise<{ error?: string }>, okText: string) => {
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.error) { setMsg({ ok: false, text: r.error }); return }
      setMsg({ ok: true, text: okText })
      setOpen(null); setName(''); setDetail('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-2" data-testid="tag-actions">
      <div className="flex gap-2">
        <button className={`${btn} border-green-300 text-green-800`} disabled={pending} data-testid="tag-good"
          onClick={() => run(() => markTagGoodAction(assetId), '이상 없음으로 기록했습니다.')}>
          <CheckCircle2 className="size-4" /> 이상 없음
        </button>
        <button className={`${btn} border-red-300 text-red-700`} disabled={pending} data-testid="tag-defect-open"
          onClick={() => setOpen(open === 'defect' ? null : 'defect')}>
          <AlertTriangle className="size-4" /> 불량 등록
        </button>
        {canReplace && (
          <button className={`${btn} border-brand-line text-ink`} disabled={pending} data-testid="tag-replace-open"
            onClick={() => setOpen(open === 'replace' ? null : 'replace')}>
            <RefreshCw className="size-4" /> 교체
          </button>
        )}
      </div>

      {open === 'defect' && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/40 p-3" data-testid="tag-defect-form">
          <input className={field} placeholder="불량 내용 (예: 압력 미달)" value={name} onChange={e => setName(e.target.value)} data-testid="tag-defect-name" />
          <textarea className={`${field} h-20 py-2`} placeholder="상세 (선택)" value={detail} onChange={e => setDetail(e.target.value)} />
          <select className={field} value={severity} onChange={e => setSeverity(e.target.value as typeof severity)}>
            <option value="경미">경미</option><option value="보통">보통</option><option value="중대">중대</option>
          </select>
          <p className="text-xs text-ink-meta">이 고객의 진행 중 점검 회차에 붙고, 위치는 자동으로 적힙니다.</p>
          <button className={`${btn} w-full border-red-400 bg-red-600 text-white`} disabled={pending || !name.trim()} data-testid="tag-defect-submit"
            onClick={() => run(() => registerTagDefectAction({ assetId, defectName: name, defectDetail: detail, severity }), '불량을 등록했습니다.')}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : '불량 등록'}
          </button>
        </div>
      )}

      {open === 'replace' && (
        <div className="space-y-2 rounded-lg border border-brand-line p-3" data-testid="tag-replace-form">
          <p className="text-sm text-ink">이 설비를 「교체됨」으로 닫습니다. 새 설비는 새 라벨을 붙여 찍으면 등록됩니다.</p>
          <button className={`${btn} w-full border-ink bg-ink text-white`} disabled={pending} data-testid="tag-replace-submit"
            onClick={() => run(() => replaceTagAssetAction(assetId), '교체로 닫았습니다.')}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : '교체로 닫기'}
          </button>
        </div>
      )}

      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`} data-testid="tag-action-msg">{msg.text}</p>}
    </div>
  )
}

/** 미등록 코드 = 첫 등록 — 선인쇄 라벨을 붙이며 찍은 코드로 설비 1대를 만든다 */
export function TagRegisterForm({ code }: { code: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Array<{ id: string; name: string }>>([])
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)
  const [buildings, setBuildings] = useState<Array<{ id: string; building_name: string }>>([])
  const [buildingId, setBuildingId] = useState('')
  const [cat, setCat] = useState<EquipmentCategory>('powder')
  const [loc, setLoc] = useState('')
  const [ym, setYm] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // 결과는 비동기로만 넣고, 보일지는 렌더에서 고른다(effect 안 동기 setState 금지 — react-hooks 규칙)
  useEffect(() => {
    if (customer || q.trim().length < 1) return
    const t = setTimeout(() => { void searchCustomersForTagAction(q).then(setHits) }, 250)
    return () => clearTimeout(t)
  }, [q, customer])
  const shownHits = !customer && q.trim().length > 0 ? hits : []

  const pick = (c: { id: string; name: string }) => {
    setCustomer(c); setBuildingId('')
    void listBuildingsForTagAction(c.id).then(bs => { setBuildings(bs); if (bs.length === 1) setBuildingId(bs[0].id) })
  }

  const submit = () => {
    if (!customer) return
    setErr(null)
    start(async () => {
      const r = await registerUnknownTagAction(code, customer.id, { category: cat, buildingId: buildingId || null, location: loc, manufacturedYm: ym })
      if (r.error) { setErr(r.error); return }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand-line p-3" data-testid="tag-register-form">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><PlusCircle className="size-4" /> 이 라벨로 새 설비 등록</h2>
      {customer ? (
        <div className="flex items-center justify-between rounded-lg bg-brand-tint px-3 py-2 text-sm">
          <span data-testid="tag-register-customer">{customer.name}</span>
          <button className="text-xs underline" onClick={() => { setCustomer(null); setBuildings([]); setQ('') }}>바꾸기</button>
        </div>
      ) : (
        <div>
          <input className={field} placeholder="고객 이름 검색" value={q} onChange={e => setQ(e.target.value)} data-testid="tag-register-q" />
          {shownHits.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-auto rounded-lg border border-brand-line text-sm">
              {shownHits.map(h => <li key={h.id}><button className="w-full px-3 py-2 text-left hover:bg-brand-tint" onClick={() => pick(h)} data-testid="tag-register-hit">{h.name}</button></li>)}
            </ul>
          )}
        </div>
      )}
      {customer && buildings.length > 1 && (
        <select className={field} value={buildingId} onChange={e => setBuildingId(e.target.value)}>
          <option value="">건물 공통</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.building_name}</option>)}
        </select>
      )}
      <select className={field} value={cat} onChange={e => setCat(e.target.value as EquipmentCategory)} data-testid="tag-register-category">
        {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
      </select>
      <input className={field} placeholder="위치 (예: 3층 계단 옆)" value={loc} onChange={e => setLoc(e.target.value)} data-testid="tag-register-location" />
      <input className={field} placeholder="제조연월 (예: 2015-03, 선택)" value={ym} onChange={e => setYm(e.target.value)} data-testid="tag-register-ym" />
      <button className={`${btn} w-full border-brand bg-brand text-white`} disabled={pending || !customer} onClick={submit} data-testid="tag-register-submit">
        {pending ? <Loader2 className="size-4 animate-spin" /> : '등록'}
      </button>
      {err && <p className="text-sm text-red-600" data-testid="tag-register-error">{err}</p>}
    </div>
  )
}
