'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import { X, Loader2, AlertTriangle, MessageSquare, CheckCircle2, ExternalLink, Ban } from 'lucide-react'
import { prepareInspectionSmsAction, sendInspectionSmsAction } from '@/app/(dashboard)/inspections/sms-actions'
import { MessageTemplateModal } from '@/components/settings/message-template-modal'
import { smsByteLength, smsKind } from '@/lib/sms-recipients'

/** 공용 사전 안내 발송 모달 (소방계획서_24 S8)
 *
 *  진입은 셋 — 계획 항목(items) · 날짜 범위(range) · 임의 발송(adhoc).
 *  **번호를 클라이언트에서 계산하지 않는다**: 서버가 그룹·수신자·문구를 만들어 준다.
 *  그래서 달력이 무엇을 로드했는지와 무관하게 어느 진입점에서 열어도 같은 완전한 목록이 뜬다(Q-14).
 */

export type SmsModalSource =
  | { kind: 'items'; planItemIds: string[]; title?: string }
  | { kind: 'range'; from: string; to: string; title?: string }
  | { kind: 'adhoc'; customerId: string; customerName: string; title?: string }

type Recipient = {
  name: string | null; role: string | null; phone: string | null; phoneMasked: string
  text: string; byteLen: number; msgType: 'SMS' | 'LMS'; unresolved: string[]
}
type Group = {
  customerId: string; customerName: string; visitDate: string
  planItemIds: string[]; inspectionTypes: string[]
  sendable: boolean; unsendableReason: string | null; alreadySent: boolean
  recipients: Recipient[]
}
type Prep = {
  body: string; totalMessages: number
  noPhone: Array<{ customerId: string; customerName: string; visitDate: string; reason: string }>
  dryRun: boolean; allowlistOn: boolean; credentialsMissing: boolean
  groups: Group[]
}
type SendRow = { customerName: string; phoneMasked: string; contactName: string | null; status: string; error: string | null }

const btn = 'h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors disabled:opacity-40'
const btnPri = 'h-9 px-4 rounded-lg bg-[#7b68ee] text-white text-xs font-semibold hover:bg-[#6a57dd] transition-colors disabled:opacity-40'

export function InspectionSmsModal({ source, onClose, onSent }: {
  source: SmsModalSource
  onClose: () => void
  onSent?: () => void
}) {
  const [prep, setPrep] = useState<Prep | null>(null)
  const [err, setErr] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()

  // 체크 상태: 그룹 키 → 선택된 번호들. 기본값 = 서버가 준 수신자 전부(고객관리 지정값)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [body, setBody] = useState<string | null>(null)   // null이면 저장된 문구 사용
  const [visitDate, setVisitDate] = useState('')          // adhoc 전용
  const [confirmDup, setConfirmDup] = useState(false)
  const [result, setResult] = useState<{ rows: SendRow[]; sent: number; failed: number; unverified: number; noPhone: number; skipped: number; error?: string } | null>(null)

  const key = (g: { customerId: string; visitDate: string }) => `${g.customerId}|${g.visitDate}`

  function load(overrideBody?: string, dateForAdhoc?: string) {
    setErr('')
    startTransition(async () => {
      const res = await prepareInspectionSmsAction({
        kind: source.kind,
        planItemIds: source.kind === 'items' ? source.planItemIds : undefined,
        from: source.kind === 'range' ? source.from : undefined,
        to: source.kind === 'range' ? source.to : undefined,
        customerId: source.kind === 'adhoc' ? source.customerId : undefined,
        visitDate: source.kind === 'adhoc' ? (dateForAdhoc ?? visitDate) : undefined,
        overrideBody,
      })
      if ('error' in res && res.error) { setErr(res.error); setLoaded(true); return }
      const p = res as unknown as Prep
      setPrep(p)
      setPicked(Object.fromEntries(p.groups.map(g => [key(g), g.recipients.map(r => r.phone ?? '')])))
      setLoaded(true)
    })
  }

  // 열리면 곧바로 대상을 계산한다. adhoc만 예외 — 방문일을 먼저 물어야 계산할 게 생긴다.
  // 모달은 열릴 때 마운트되므로 1회만 돈다(ref 가드는 StrictMode 이중 호출 방어).
  const bootRef = useRef(false)
  useEffect(() => {
    if (bootRef.current || source.kind === 'adhoc') return
    bootRef.current = true
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups = prep?.groups ?? []
  const sendableGroups = groups.filter(g => g.sendable)
  const selectedCount = sendableGroups.filter(g => (picked[key(g)] ?? []).length > 0).length
  const messageCount = sendableGroups.reduce((n, g) => n + (picked[key(g)] ?? []).length, 0)
  const dupSelected = sendableGroups.some(g => g.alreadySent && (picked[key(g)] ?? []).length > 0)
  const blockedCount = groups.length - sendableGroups.length

  function toggleRecipient(g: Group, phone: string) {
    setPicked(p => {
      const cur = p[key(g)] ?? []
      return { ...p, [key(g)]: cur.includes(phone) ? cur.filter(x => x !== phone) : [...cur, phone] }
    })
  }
  function toggleGroup(g: Group) {
    setPicked(p => {
      const cur = p[key(g)] ?? []
      return { ...p, [key(g)]: cur.length > 0 ? [] : g.recipients.map(r => r.phone ?? '') }
    })
  }

  function send() {
    if (dupSelected && !confirmDup) { setConfirmDup(true); return }
    setErr('')
    startTransition(async () => {
      const override: Record<string, string[]> = {}
      for (const g of sendableGroups) override[key(g)] = picked[key(g)] ?? []
      const res = await sendInspectionSmsAction({
        kind: source.kind,
        planItemIds: source.kind === 'items' ? source.planItemIds : undefined,
        from: source.kind === 'range' ? source.from : undefined,
        to: source.kind === 'range' ? source.to : undefined,
        customerId: source.kind === 'adhoc' ? source.customerId : undefined,
        visitDate: source.kind === 'adhoc' ? visitDate : undefined,
        overrideBody: body ?? undefined,
        recipientOverride: override,
      })
      setResult(res as typeof result)
      setConfirmDup(false)
      if ((res as { sent: number }).sent > 0) onSent?.()
    })
  }

  const title = source.title ??
    (source.kind === 'adhoc' ? `임의 발송 — ${source.customerName}` : '사전 안내 문자')

  return (
    <div className="fixed inset-0 z-[10000] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        data-testid="sms-modal"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#eceaf8]">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#090c1d]">
            <MessageSquare className="size-4 text-[#7b68ee]" /> {title}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#f5f4ff] text-[#8b87b8]"><X className="size-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* 운영 상태 경고 — 나가지 않는데 나간 줄 알면 안 된다 */}
          {prep?.credentialsMissing && (
            <div data-testid="sms-cred-warn" className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <AlertTriangle className="size-3.5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-snug text-red-700">
                발송 설정(API 키·발신번호)이 없어 <b>실제로 문자가 나가지 않습니다.</b> 눌러도 전부 실패로 기록됩니다.
              </p>
            </div>
          )}
          {prep?.dryRun && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
              <b>리허설 모드(SMS_DRY_RUN)</b> — 실제 발송도, 이력 기록도 하지 않습니다.
            </div>
          )}
          {prep?.allowlistOn && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
              <b>허용 번호 목록이 켜져 있습니다</b> — 목록 밖 번호는 발송되지 않습니다.
            </div>
          )}

          {/* adhoc — 방문일부터 묻는다(고객은 이미 정해져 있다) */}
          {source.kind === 'adhoc' && (
            <div className="flex items-end gap-2 rounded-xl border border-[#eceaf8] p-3">
              <label className="text-[11px] text-[#514b81]">
                방문일<span className="text-red-500">*</span>
                <input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)}
                  data-testid="adhoc-date"
                  className="block mt-1 h-8 px-2 rounded-lg border border-[#d0ccf5] text-xs" />
              </label>
              <button className={btn} disabled={!visitDate || isPending}
                onClick={() => { setLoaded(false); load(body ?? undefined, visitDate) }}>대상 확인</button>
              <p className="text-[10px] text-[#8b87b8] pb-1.5">재방문·불량 보수·AS 등 계획에 없는 방문. <b>점검 회차로 잡히지 않습니다.</b></p>
            </div>
          )}

          {isPending && !prep && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#514b81]">
              <Loader2 className="size-4 animate-spin" /> 대상을 계산하는 중…
            </div>
          )}
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">{err}</div>}

          {/* 결과 — 발송 후에도 닫지 않는다 */}
          {result && (
            <div data-testid="sms-result" className="rounded-xl border border-[#eceaf8] overflow-hidden">
              <div className="px-3 py-2 bg-[#faf9ff] text-[11px] font-semibold text-[#090c1d]">
                발송됨 {result.sent} · 실패 {result.failed} · 확인불가 {result.unverified} · 번호없음 {result.noPhone}
                {result.skipped > 0 && ` · 제외 ${result.skipped}`}
              </div>
              {result.error && <div className="px-3 py-2 text-[11px] text-red-600 border-t border-[#eceaf8]">{result.error}</div>}
              <ul className="max-h-40 overflow-y-auto divide-y divide-[#f2f0fb]">
                {result.rows.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                    <span className={r.status === 'sent' ? 'text-emerald-600' : r.status === 'failed' ? 'text-red-500' : 'text-amber-600'}>
                      {r.status === 'sent' ? '발송' : r.status === 'failed' ? '실패' : r.status === 'dry_run' ? '리허설' : '확인불가'}
                    </span>
                    <span className="text-[#090c1d]">{r.customerName}</span>
                    <span className="text-[#8b87b8]">{r.contactName} {r.phoneMasked}</span>
                    {r.error && <span className="text-red-500 truncate">{r.error}</span>}
                  </li>
                ))}
              </ul>
              {/* 주 발송 경로는 달력인데 결과 창구는 문자 발송 화면이다(Q-15) —
                  링크가 없으면 달력에서 보낸 사용자의 확인 동선이 끊긴다 (S8-10) */}
              <Link href="/inspections/sms"
                data-testid="sms-result-link"
                className={`flex items-center justify-center gap-1 px-3 py-2 border-t border-[#eceaf8] text-[11px] ${
                  result.failed > 0 ? 'bg-red-50 text-red-700 font-semibold' : 'text-[#7b68ee] hover:bg-[#f5f4ff]'}`}>
                {result.failed > 0 ? '실패한 건을 확인하고 재발송하기' : '발송 결과 전체 보기'} <ExternalLink className="size-3" />
              </Link>
            </div>
          )}

          {/* 대상 목록 */}
          {!result && prep && groups.length === 0 && !isPending && (
            <p className="py-8 text-center text-xs text-[#8b87b8]">보낼 대상이 없습니다.</p>
          )}
          {!result && groups.map(g => {
            const sel = picked[key(g)] ?? []
            return (
              <div key={key(g)}
                data-testid="sms-group"
                className={`rounded-xl border p-3 ${g.sendable ? 'border-[#eceaf8]' : 'border-[#eceaf8] bg-[#fafafa]'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="checkbox" disabled={!g.sendable} checked={sel.length > 0}
                    onChange={() => toggleGroup(g)} className="accent-[#7b68ee]" />
                  <span className={`text-xs font-semibold ${g.sendable ? 'text-[#090c1d]' : 'text-[#b0acd6]'}`}>{g.customerName}</span>
                  <span className="text-[11px] text-[#514b81]">{g.visitDate}</span>
                  {g.inspectionTypes.map(t => (
                    <span key={t} className="px-1.5 py-0.5 rounded bg-[#f5f4ff] text-[10px] text-[#7b68ee]">{t}</span>
                  ))}
                  {g.planItemIds.length > 1 && (
                    <span className="text-[10px] text-[#8b87b8]">계획 {g.planItemIds.length}건 — 1통으로 묶임</span>
                  )}
                  {g.alreadySent && (
                    <span data-testid="badge-already-sent" className="px-1.5 py-0.5 rounded bg-amber-50 text-[10px] text-amber-700 border border-amber-200">이미 발송됨</span>
                  )}
                </div>

                {/* 미확정 건 — 목록에서 빼지 않는다. 조용히 빼면 '달력엔 있는데 여긴 없다'가 된다 (S8-11) */}
                {!g.sendable && (
                  <div data-testid="sms-unsendable" className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#8b87b8]">
                    <Ban className="size-3" /> {g.unsendableReason ?? '발송할 수 없습니다'}
                    <Link href="/inspection-plans" className="text-[#7b68ee] hover:underline">점검확정으로 이동 →</Link>
                  </div>
                )}

                {g.sendable && (
                  <ul className="mt-2 space-y-1">
                    {g.recipients.map(r => (
                      <li key={r.phone ?? r.name} className="flex items-center gap-2 text-[11px]">
                        <input type="checkbox" checked={sel.includes(r.phone ?? '')}
                          onChange={() => toggleRecipient(g, r.phone ?? '')} className="accent-[#7b68ee]" />
                        <span className="text-[#090c1d]">{r.name}</span>
                        <span className="px-1 rounded bg-[#f5f4ff] text-[10px] text-[#7b68ee]">{r.role}</span>
                        <span className="text-[#8b87b8]">{r.phoneMasked}</span>
                        <span className={`ml-auto text-[10px] ${r.msgType === 'LMS' ? 'text-amber-600 font-semibold' : 'text-[#b0acd6]'}`}>
                          {r.byteLen}바이트 · {r.msgType}
                        </span>
                      </li>
                    ))}
                    {g.recipients.length === 0 && (
                      <li className="text-[11px] text-red-500">발송 가능한 번호가 없습니다 — 발송되지 않고 &lsquo;번호없음&rsquo;으로 기록됩니다.</li>
                    )}
                  </ul>
                )}
              </div>
            )
          })}

          {!result && (prep?.noPhone.length ?? 0) > 0 && (
            <div data-testid="sms-nophone" className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-[11px] font-semibold text-red-700">전화번호 없음 {prep!.noPhone.length}곳</p>
              <p className="text-[10px] text-red-600 mt-0.5">발송되지 않지만 &lsquo;번호없음&rsquo;으로 기록에 남습니다 — 나중에 연락처를 채우면 보낼 수 있습니다.</p>
              <ul className="mt-1 text-[11px] text-red-700">
                {prep!.noPhone.map(n => <li key={n.customerId + n.visitDate}>· {n.customerName} ({n.visitDate})</li>)}
              </ul>
            </div>
          )}

          {/* 문구 */}
          {!result && prep && groups.length > 0 && (
            <div className="rounded-xl border border-[#eceaf8] p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-[#090c1d]">문구</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${smsKind(body ?? prep.body) === 'LMS' ? 'text-amber-600 font-semibold' : 'text-[#b0acd6]'}`}>
                    {smsByteLength(body ?? prep.body)}바이트 · {smsKind(body ?? prep.body)}
                    {smsKind(body ?? prep.body) === 'LMS' && ' (요금 2~3배)'}
                  </span>
                  <MessageTemplateModal templateKey="inspection_sms" label="점검 안내 SMS" />
                </div>
              </div>
              <textarea
                data-testid="sms-body"
                value={body ?? prep.body}
                onChange={e => setBody(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#d0ccf5] px-2 py-1.5 text-xs"
              />
              <p className="mt-1 text-[10px] text-[#8b87b8]">
                여기서 고친 문구는 <b>이번 발송에만</b> 적용됩니다. 기본 문구를 바꾸려면 [문구 편집].
              </p>
              {body !== null && (
                <button className="mt-1 text-[10px] text-[#7b68ee] hover:underline"
                  onClick={() => { setBody(null); setLoaded(false); load() }}>기본 문구로 되돌리기</button>
              )}
            </div>
          )}
        </div>

        {/* 하단 — 비용이 눌리기 전에 보인다 */}
        {!result && (
          <div className="px-5 py-3 border-t border-[#eceaf8] flex items-center gap-3">
            <div className="text-[11px] text-[#514b81]">
              <b className="text-[#090c1d]">{selectedCount}곳</b> 선택 · 예상 <b className="text-[#090c1d]">{messageCount}통</b>
              {blockedCount > 0 && <span className="text-[#8b87b8]"> · 발송 불가 {blockedCount}곳</span>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {confirmDup && (
                <span data-testid="sms-dup-warn" className="flex items-center gap-1 text-[11px] text-amber-700">
                  <AlertTriangle className="size-3.5" /> 이미 보낸 건이 있습니다. 다시 보내려면 한 번 더 누르세요.
                </span>
              )}
              <button onClick={onClose} className={btn}>닫기</button>
              <button
                data-testid="sms-send"
                onClick={send}
                disabled={isPending || messageCount === 0}
                className={btnPri}>
                {isPending ? <Loader2 className="size-3.5 animate-spin inline" /> : <>{messageCount}통 발송</>}
              </button>
            </div>
          </div>
        )}
        {result && (
          <div className="px-5 py-3 border-t border-[#eceaf8] flex items-center justify-end gap-2">
            <span className="mr-auto flex items-center gap-1 text-[11px] text-emerald-600">
              <CheckCircle2 className="size-3.5" /> 발송 처리를 마쳤습니다.
            </span>
            <button onClick={onClose} className={btnPri}>닫기</button>
          </div>
        )}
      </div>
    </div>
  )
}
