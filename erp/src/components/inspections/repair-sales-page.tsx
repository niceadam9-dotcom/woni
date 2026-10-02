'use client'

/** 보수 견적 전용 페이지 본체 (2026-10-02) — 5단계 칸이 좁아 전체 폭으로 뺐다.
 *
 *  왼쪽: 불량 목록 + 견적 줄 편집(수량·단가). 오른쪽: 견적서 **실시간 미리보기** — PDF와 같은 조립
 *  (quoteDocFrom→renderQuote)을 iframe srcDoc으로 그린다(화면과 인쇄물이 갈리지 않는다).
 *  아래: 보내기(관계인 메일, PDF 첨부 — sendQuoteEmailAction)·사슬(승인·수주·청구 = RepairSalesChain 재사용)·송부 이력.
 *  페이지와 사슬 블록은 같은 액션(getRepairSalesAction)을 각자 읽는다 — 페이지가 바꾼 뒤엔 reloadKey로 사슬도 다시 읽고,
 *  사슬이 바꾼 뒤엔 onChanged로 페이지가 다시 읽는다. */

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Loader2, Mail } from 'lucide-react'
import {
  getRepairSalesAction, createDefectQuoteAction, sendQuoteEmailAction,
  type RepairSalesState, type RepairQuote,
} from '@/app/(dashboard)/inspections/repair-sales-actions'
import {
  createQuoteShareLinkAction, createReportShareLinkAction, listShareLinksAction, revokeShareLinkAction, type ShareLinkRow,
} from '@/app/(dashboard)/inspections/share-link-actions'
import { renderQuote, quoteDocFrom, type QuoteDocBase } from '@/lib/doc-templates/quote'
import { RepairSalesChain, type SalesPerms } from '@/components/inspections/repair-sales-chain'
import type { GridDefect } from '@/components/inspections/defect-grid'
import { DateInput } from '@/components/ui/date-input'
import { todayKst } from '@/lib/kst-date'

type Recipient = { label: string; email: string }

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const addDays = (iso: string, d: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }

export function RepairSalesPage({ inspectionId, defects, docBase, recipients, canManage, perms, companyName, customerName }: {
  inspectionId: string
  defects: GridDefect[]
  docBase: QuoteDocBase
  recipients: Recipient[]
  canManage: boolean
  perms: SalesPerms
  companyName: string
  customerName: string
}) {
  const [state, setState] = useState<RepairSalesState | null>(null)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  // ── 왼쪽: 견적 줄 편집(작성 전) 또는 기존 견적 선택 ──────────────────────────
  const [checked, setChecked] = useState<Set<string>>(() => new Set(defects.map(d => d.id)))
  const [qty, setQty] = useState<Record<string, string>>({})
  const [price, setPrice] = useState<Record<string, string>>({})
  const [validUntil, setValidUntil] = useState(addDays(todayKst(), 30))
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null)
  /** 페이지에서 견적을 만들거나 보냈을 때 아래 사슬 블록도 다시 읽게 한다 */
  const [chainKey, setChainKey] = useState(0)

  const apply = useCallback((r: Awaited<ReturnType<typeof getRepairSalesAction>>) => {
    if (r.error) { setMsg(`⚠ ${r.error}`); return }
    setState({ quotes: r.quotes, orders: r.orders, bills: r.bills, deliveries: r.deliveries })
    // 작성 폼의 기본 체크 = 아직 살아 있는 견적에 없는 불량 — 응답 콜백 안에서 맞춘다(effect 안 setState 금지)
    const quoted = new Set<string>()
    for (const q of r.quotes) {
      if (['취소', '만료'].includes(q.status)) continue
      for (const it of q.items ?? []) for (const d of it.defect_ids ?? []) quoted.add(d)
    }
    setChecked(new Set(defects.filter(d => !quoted.has(d.id)).map(d => d.id)))
    // 살아 있는 최신 견적을 기본 선택 — 보내기·미리보기의 대상
    const live = r.quotes.find(q => !['취소', '만료'].includes(q.status))
    setSelectedQuoteId(prev => prev && r.quotes.some(q => q.id === prev) ? prev : live?.id ?? null)
  }, [defects])
  useEffect(() => {
    let alive = true
    getRepairSalesAction(inspectionId).then(r => { if (alive) apply(r) })
    return () => { alive = false }
  }, [inspectionId, apply])
  const reload = useCallback(async () => apply(await getRepairSalesAction(inspectionId)), [inspectionId, apply])

  const selectedQuote: RepairQuote | null = useMemo(
    () => state?.quotes.find(q => q.id === selectedQuoteId) ?? null, [state, selectedQuoteId])

  // 견적에 이미 담긴 불량(살아 있는 견적 기준) — 작성 폼의 기본 체크에서 뺀다
  const quotedDefectIds = useMemo(() => {
    const s = new Set<string>()
    for (const q of state?.quotes ?? []) {
      if (['취소', '만료'].includes(q.status)) continue
      for (const it of q.items ?? []) for (const d of it.defect_ids ?? []) s.add(d)
    }
    return s
  }, [state])

  // ── 미리보기 HTML — 기존 견적을 고르면 그 견적을, 아니면 지금 편집 중인 줄로 ──
  const previewHtml = useMemo(() => {
    if (selectedQuote) return renderQuote(quoteDocFrom(docBase, selectedQuote))
    const lines = defects.filter(d => checked.has(d.id)).map(d => {
      const quantity = Math.max(1, Number(qty[d.id] || 1))
      const unit = Math.round(Number(price[d.id] || 0))
      return { description: d.defect_name, detail: d.defect_detail ?? null, quantity, unit_price: unit, amount: unit * quantity }
    })
    return renderQuote(quoteDocFrom(docBase, {
      quote_number: '(저장 전)', quote_date: todayKst(), valid_until: validUntil, items: lines,
    }))
  }, [selectedQuote, docBase, defects, checked, qty, price, validUntil])

  const draftTotal = useMemo(() => {
    const sub = defects.filter(d => checked.has(d.id))
      .reduce((s, d) => s + Math.round(Number(price[d.id] || 0)) * Math.max(1, Number(qty[d.id] || 1)), 0)
    return sub + Math.round(sub * 0.1)
  }, [defects, checked, qty, price])

  const run = (fn: () => Promise<{ error?: string } & Record<string, unknown>>, okMsg: string | ((r: Record<string, unknown>) => string)) => {
    setMsg(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setMsg(`⚠ ${r.error}`); return }
      setMsg(`✅ ${typeof okMsg === 'function' ? okMsg(r) : okMsg}`)
      await reload()
      const lr = await listShareLinksAction(inspectionId)
      if (!lr.error) setLinks(lr.links)
      setChainKey(k => k + 1)
    })
  }

  // ── 보내기 ───────────────────────────────────────────────────────────────
  const [to, setTo] = useState<Set<string>>(() => new Set(recipients.slice(0, 1).map(r => r.email)))
  const [extraTo, setExtraTo] = useState('')
  const defaultSubject = `[${companyName}] ${customerName} 소방시설 보수 견적서`
  const defaultBody = `안녕하십니까, ${companyName}입니다.\n\n${customerName} 소방시설 자체점검에서 확인된 불량 사항의 보수 견적서를 첨부해 드립니다.\n내용 확인 후 회신 주시면 일정을 협의해 진행하겠습니다.\n\n감사합니다.`
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState(defaultBody)
  /** 2단계 — 메일 본문 끝에 열람·승인 링크(/p/{token})를 붙인다 */
  const [includeLink, setIncludeLink] = useState(true)
  const [links, setLinks] = useState<ShareLinkRow[]>([])
  const [newLink, setNewLink] = useState<string | null>(null)
  /** 링크 만료 판정 기준 시각 — 렌더 중 Date.now() 금지(react-hooks/purity), 마운트 때 한 번 */
  const [nowMs] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    listShareLinksAction(inspectionId).then(r => { if (alive && !r.error) setLinks(r.links) })
    return () => { alive = false }
  }, [inspectionId])

  const sendTargets = useMemo(() => {
    const extra = extraTo.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    return [...to, ...extra]
  }, [to, extraTo])

  const input = 'h-8 rounded border border-brand-line px-2 text-form-xs'

  return (
    <div className="space-y-3" data-testid="repair-sales-page">
      {msg && <p className="text-form-xs text-ink-sub" role="status" data-testid="repair-page-msg">{msg}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ── 왼쪽: 불량 → 견적 줄 ── */}
        <section className="rounded-xl border border-brand-line-soft bg-surface">
          <p className="border-b border-brand-tint bg-brand-tint px-3 py-1.5 text-form-xs font-semibold text-ink-sub">
            불량 {defects.length}건 — 견적에 담을 항목과 단가
          </p>
          <div className="space-y-1.5 p-3">
            {defects.length === 0 && <p className="text-form-xs text-ink-meta">이 회차에 등록된 불량이 없습니다 — 1단계(점검표)에서 불량을 먼저 등록하세요.</p>}
            {defects.map(d => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-line-soft px-2 py-1.5 text-form-xs" data-testid={`repair-line-${d.id}`}>
                <label className="inline-flex min-w-[14rem] flex-1 items-center gap-1.5">
                  <input type="checkbox" checked={checked.has(d.id)} disabled={isPending || !canManage || !!selectedQuote}
                    onChange={e => setChecked(prev => { const n = new Set(prev); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n })} />
                  <span>
                    {d.defect_name}
                    {quotedDefectIds.has(d.id) && <span className="ml-1 rounded-full bg-brand-tint px-1.5 py-0.5 text-form-2xs text-brand">견적 있음</span>}
                    {d.defect_detail && <span className="block text-form-2xs text-ink-meta">{d.defect_detail}</span>}
                  </span>
                </label>
                {checked.has(d.id) && !selectedQuote && (<>
                  <input type="number" min={1} step={1} value={qty[d.id] ?? '1'} title="수량" disabled={isPending || !canManage}
                    onChange={e => setQty(p => ({ ...p, [d.id]: e.target.value }))} className={`${input} w-16 text-right`} />
                  <input type="number" min={0} step={1000} value={price[d.id] ?? ''} placeholder="단가(원)" disabled={isPending || !canManage}
                    onChange={e => setPrice(p => ({ ...p, [d.id]: e.target.value }))} className={`${input} w-28 text-right`} data-testid="page-line-price" />
                </>)}
              </div>
            ))}
            {!selectedQuote && defects.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-brand-line-soft pt-2">
                <label className="inline-flex items-center gap-1 text-form-xs">유효기간 <DateInput value={validUntil} onChange={e => setValidUntil(e.target.value)} className={input} /></label>
                <span className="text-form-xs text-ink-sub">합계(부가세 포함) {won(draftTotal)}</span>
                {canManage && (
                  <button disabled={isPending || checked.size === 0} data-testid="page-quote-create"
                    onClick={() => run(() => createDefectQuoteAction({
                      inspectionId,
                      lines: defects.filter(d => checked.has(d.id)).map(d => ({
                        defectId: d.id, description: d.defect_name, detail: d.defect_detail ?? null,
                        quantity: Math.max(1, Number(qty[d.id] || 1)), unitPrice: Number(price[d.id] || 0),
                      })),
                      validUntil,
                    }), '견적을 만들었습니다 — 아래에서 바로 보낼 수 있습니다')}
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-3 text-form-xs text-white hover:bg-brand-strong disabled:opacity-50">
                    견적 만들기 ({checked.size}건)
                  </button>
                )}
              </div>
            )}
            {selectedQuote && (
              <p className="border-t border-brand-line-soft pt-2 text-form-2xs text-ink-meta">
                미리보기는 선택한 견적 {selectedQuote.quote_number}입니다 —
                <button onClick={() => setSelectedQuoteId(null)} className="ml-1 underline" data-testid="page-new-draft">새 견적 작성으로 전환</button>
              </p>
            )}
          </div>
        </section>

        {/* ── 오른쪽: 미리보기 (PDF와 같은 조립) ── */}
        <section className="rounded-xl border border-brand-line-soft bg-surface">
          <p className="border-b border-brand-tint bg-brand-tint px-3 py-1.5 text-form-xs font-semibold text-ink-sub">
            견적서 미리보기 {selectedQuote ? `— ${selectedQuote.quote_number}` : '(저장 전)'}
          </p>
          {/* sandbox 없음·srcDoc만 — 외부 리소스를 싣지 않는 자체 HTML이다 */}
          <iframe title="견적서 미리보기" srcDoc={previewHtml} className="h-[520px] w-full rounded-b-xl bg-white" data-testid="quote-preview" />
        </section>
      </div>

      {/* ── 보내기 ── */}
      <section className="rounded-xl border border-brand-line-soft bg-surface">
        <p className="border-b border-brand-tint bg-brand-tint px-3 py-1.5 text-form-xs font-semibold text-ink-sub">
          보내기 — 관계인 메일(견적 PDF 첨부)
        </p>
        <div className="space-y-2 p-3 text-form-xs">
          {!selectedQuote && <p className="text-ink-meta">먼저 견적을 만들거나 아래 목록에서 보낼 견적을 고르세요.</p>}
          {selectedQuote && (<>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink-sub">받는 사람:</span>
              {recipients.length === 0 && <span className="text-ink-meta">등록된 관계인 이메일이 없습니다 — 아래에 직접 입력</span>}
              {recipients.map(r => (
                <label key={r.email} className="inline-flex items-center gap-1 rounded-full border border-brand-line px-2 py-0.5">
                  <input type="checkbox" checked={to.has(r.email)} disabled={isPending}
                    onChange={e => setTo(prev => { const n = new Set(prev); if (e.target.checked) n.add(r.email); else n.delete(r.email); return n })} />
                  {r.label} <span className="text-ink-meta">{r.email}</span>
                </label>
              ))}
              <input value={extraTo} onChange={e => setExtraTo(e.target.value)} placeholder="직접 입력(쉼표로 여러 명)"
                className={`${input} w-64`} disabled={isPending} data-testid="send-extra-to" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink-sub">제목:</span>
              <input value={subject} onChange={e => setSubject(e.target.value)} className={`${input} min-w-[24rem] flex-1`} disabled={isPending} data-testid="send-subject" />
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} disabled={isPending}
              className="w-full rounded border border-brand-line px-2 py-1.5 text-form-xs" data-testid="send-body" />
            <div className="flex items-center gap-2">
              <button disabled={isPending || sendTargets.length === 0} data-testid="send-submit"
                onClick={() => run(
                  () => sendQuoteEmailAction({ quoteId: selectedQuote.id, to: sendTargets, subject, body, includeLink }),
                  r => (r as { dryRun?: boolean; sentTo?: string[] }).dryRun
                    ? `시험 수신자라 실제 발송 없이 기록만 남겼습니다 (${(r as { sentTo?: string[] }).sentTo?.join(', ')})`
                    : `견적서를 보냈습니다 (${(r as { sentTo?: string[] }).sentTo?.join(', ')})`)}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-4 text-form-xs text-white hover:bg-brand-strong disabled:opacity-50">
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />} 보내기
              </button>
              <label className="inline-flex items-center gap-1 text-form-xs" title="관계인이 로그인 없이 견적을 보고 [승인]을 누를 수 있는 링크(90일)">
                <input type="checkbox" checked={includeLink} onChange={e => setIncludeLink(e.target.checked)} disabled={isPending} data-testid="send-include-link" />
                본문에 열람·승인 링크 넣기
              </label>
              <span className="text-form-2xs text-ink-meta">보내면 상태가 「발송」이 되고 수신자·시각이 아래 이력에 남습니다.</span>
            </div>
          </>)}
        </div>
      </section>

      {/* ── 견적·수주·청구 사슬 + 선택 ── */}
      <section className="rounded-xl border border-brand-line-soft bg-surface p-3">
        {state && state.quotes.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-form-xs" data-testid="page-quote-picker">
            <span className="text-ink-sub">보낼 견적 선택:</span>
            {state.quotes.map(q => (
              <button key={q.id} onClick={() => setSelectedQuoteId(q.id)}
                className={`rounded-full border px-2 py-0.5 ${selectedQuoteId === q.id ? 'border-brand bg-brand-tint text-brand' : 'border-brand-line-soft text-ink-sub hover:bg-brand-tint'}`}>
                {q.quote_number} · {q.status}
              </button>
            ))}
          </div>
        )}
        <RepairSalesChain inspectionId={inspectionId} defects={defects} canManage={canManage} perms={perms}
          contractFileName={null} onChanged={() => void reload()} hideComposer reloadKey={chainKey} />
      </section>

      {/* ── 열람·승인 링크 (2단계) ── */}
      <section className="rounded-xl border border-brand-line-soft bg-surface" data-testid="share-links-section">
        <p className="border-b border-brand-tint bg-brand-tint px-3 py-1.5 text-form-xs font-semibold text-ink-sub">
          열람·승인 링크 — 관계인이 로그인 없이 보고 승인(90일, 철회 가능)
        </p>
        <div className="space-y-2 p-3 text-form-xs">
          {canManage && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button disabled={isPending || !selectedQuote} data-testid="share-link-create"
                onClick={() => selectedQuote && run(async () => {
                  const r = await createQuoteShareLinkAction(selectedQuote.id)
                  if (r.url) setNewLink(r.url)
                  return r
                }, '견적 링크를 만들었습니다 — 아래 주소를 복사해 문자·카톡으로 보낼 수 있습니다')}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-brand-line px-3 text-brand hover:bg-brand-tint disabled:opacity-50">
                {selectedQuote ? `견적 ${selectedQuote.quote_number} 링크 만들기` : '견적을 먼저 고르세요'}
              </button>
              {(['round', 'report9', 'report10', 'report11'] as const).map(k => (
                <button key={k} disabled={isPending}
                  onClick={() => run(async () => {
                    const r = await createReportShareLinkAction(inspectionId, k)
                    if (r.url) setNewLink(r.url)
                    return r
                  }, '문서 링크를 만들었습니다')}
                  className="inline-flex h-8 items-center rounded-lg border border-brand-line-soft px-2 text-ink-sub hover:bg-brand-tint disabled:opacity-50">
                  {k === 'round' ? '회차 문서 묶음 링크' : `별지 ${k.slice(6)}호 링크`}
                </button>
              ))}
            </div>
          )}
          {newLink && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-brand-line bg-brand-tint/40 p-2">
              <input readOnly value={newLink} className="h-8 min-w-[20rem] flex-1 rounded border border-brand-line px-2 font-mono text-form-2xs" data-testid="share-link-url" onFocus={e => e.currentTarget.select()} />
              <button onClick={() => { void navigator.clipboard?.writeText(newLink); setMsg('✅ 링크를 복사했습니다') }}
                className="h-8 rounded-lg bg-brand px-3 text-white">복사</button>
              <span className="w-full text-form-2xs text-ink-meta">이 주소는 지금 한 번만 보입니다(서버에는 해시만 저장). 잃어버리면 새로 만드세요.</span>
            </div>
          )}
          {links.length === 0
            ? <p className="text-ink-meta">만든 링크가 없습니다.</p>
            : (
              <ul className="space-y-1" data-testid="share-link-list">
                {links.map(l => {
                  const dead = !!l.revoked_at || new Date(l.expires_at).getTime() < nowMs
                  return (
                    <li key={l.id} className={`flex flex-wrap items-center gap-2 ${dead ? 'text-ink-meta line-through' : ''}`}>
                      <span className="font-semibold">{l.label}</span>
                      <span className="text-ink-meta">만든 날 {l.created_at.slice(0, 10)} · ~{l.expires_at.slice(0, 10)}</span>
                      <span>열람 {l.views}회{l.last_viewed_at ? ` (마지막 ${l.last_viewed_at.slice(0, 16).replace('T', ' ')})` : ''}</span>
                      {l.downloads > 0 && <span>내려받기 {l.downloads}회</span>}
                      {l.approved_by && <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-indigo-700">승인 {l.approved_by} {l.approved_at?.slice(0, 10)}</span>}
                      {l.revoked_at && <span>철회됨</span>}
                      {!dead && canManage && (
                        <button onClick={() => { if (confirm(`${l.label} 링크를 철회할까요? 받은 사람이 더 이상 열 수 없습니다.`)) run(() => revokeShareLinkAction(l.id), '링크를 철회했습니다') }}
                          className="rounded border border-red-200 px-1.5 text-red-600 no-underline hover:bg-red-50" data-testid="share-link-revoke">철회</button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
        </div>
      </section>

      {/* ── 송부 이력 ── */}
      <section className="rounded-xl border border-brand-line-soft bg-surface">
        <p className="border-b border-brand-tint bg-brand-tint px-3 py-1.5 text-form-xs font-semibold text-ink-sub">메일 송부 이력</p>
        <div className="p-3 text-form-xs">
          {(state?.deliveries ?? []).length === 0
            ? <p className="text-ink-meta">아직 보낸 기록이 없습니다.</p>
            : (
              <ul className="space-y-1" data-testid="delivery-list">
                {state!.deliveries.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-form-2xs">{d.quote_number || '—'}</span>
                    <span>{d.recipient_email}</span>
                    <span className="text-ink-meta">{d.sent_at.slice(0, 16).replace('T', ' ')}</span>
                    {d.dry_run && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-form-2xs text-amber-800">시험 발송(실발송 없음)</span>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      </section>
      {isPending && <p className="flex items-center gap-1 text-form-2xs text-ink-meta"><Loader2 className="size-3 animate-spin" /> 처리 중…</p>}
    </div>
  )
}
