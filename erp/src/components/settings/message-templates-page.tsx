'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { Loader2, X, Plus, AlertTriangle, MessageSquare, Mail, PenLine } from 'lucide-react'
import { listMessageTemplatesAction } from '@/app/(dashboard)/settings/message-template-actions'
import { getSmsSettingsAction, saveSmsSettingsAction } from '@/app/(dashboard)/inspections/sms-actions'
import { MessageTemplateModal } from '@/components/settings/message-template-modal'
import { dDayLabel } from '@/lib/sms-recipients'
import type { TemplateKey } from '@/lib/message-template'

/** 발송 문구 설정 (소방계획서_24 S7)
 *
 *  두 블록 — ① 사전 안내 시점(Q-13) ② 발송 문구 3종.
 *  문구 편집은 기존 MessageTemplateModal을 재사용한다(미치환 변수 경고·저장 거부가 이미 들어 있다). */

type Item = { key: TemplateKey; label: string; isSms: boolean; subject: string | null; body: string; byteLen: number; msgType: 'SMS' | 'LMS' }

const QUICK = [0, 1, 2, 3, 7]
const btn = 'h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors disabled:opacity-40'
const btnPri = 'h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-semibold hover:bg-[#6a57dd] transition-colors disabled:opacity-40'

export function MessageTemplatesPage() {
  const [items, setItems] = useState<Item[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [storageReady, setStorageReady] = useState(true)
  const [rules, setRules] = useState<number[]>([])
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function load() {
    startTransition(async () => {
      const [t, s] = await Promise.all([listMessageTemplatesAction(), getSmsSettingsAction()])
      if (t.items) { setItems(t.items); setCanEdit(!!t.canEdit); setStorageReady(t.storageReady !== false) }
      if ('rules' in s && s.rules) setRules(s.rules)
    })
  }
  const boot = useRef(false)
  useEffect(() => {
    if (boot.current) return
    boot.current = true
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function saveRules(next: number[]) {
    setMsg('')
    startTransition(async () => {
      const res = await saveSmsSettingsAction(next)
      if ('error' in res && res.error) { setMsg(`❌ ${res.error}`); return }
      setRules((res as { rules: number[] }).rules)
      setMsg('✅ 저장했습니다.')
    })
  }
  function addRule(n: number) {
    if (rules.includes(n)) { setMsg(`❌ 이미 있는 시점입니다: ${dDayLabel(n)}`); return }
    saveRules([...rules, n])
    setDraft('')
  }

  return (
    <div className="space-y-4">
      {!storageReady && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <AlertTriangle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800">문구 저장소가 준비되지 않았습니다(마이그레이션 130 미적용) — 편집해도 저장되지 않습니다.</p>
        </div>
      )}

      {/* ① 사전 안내 시점 (Q-13) */}
      <section className="rounded-2xl border border-[#eceaf8] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">사전 안내 시점</h2>
        <p className="mt-0.5 text-[11px] text-[#8b87b8]">
          방문 <b>며칠 전</b>에 &lsquo;보낼 안내&rsquo; 배너를 띄울지 정합니다. 실제 발송은 배너에서 승인해야 나갑니다.
          문구는 시점을 몇 개 만들든 <b>한 장</b>입니다 — <code className="px-1 bg-[#f5f4ff] rounded">{'{디데이}'}</code>가 자동으로 바뀝니다.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {rules.map(n => (
            <span key={n} data-testid="lead-rule-tag"
              className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-lg bg-[#f5f4ff] border border-[#d0ccf5] text-xs text-[#7b68ee]">
              {dDayLabel(n)}
              {canEdit && (
                <button onClick={() => saveRules(rules.filter(x => x !== n))} disabled={isPending || rules.length <= 1}
                  title={rules.length <= 1 ? '시점은 최소 1개 필요합니다' : '제거'}
                  className="p-0.5 rounded hover:bg-white disabled:opacity-30"><X className="size-3" /></button>
              )}
            </span>
          ))}
          {rules.length === 0 && !isPending && <span className="text-xs text-[#b0acd6]">설정된 시점이 없습니다</span>}
          {isPending && <Loader2 className="size-3.5 animate-spin text-[#b0acd6]" />}
        </div>

        {canEdit && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <input
              data-testid="lead-rule-input"
              type="number" min={0} max={365} value={draft} placeholder="숫자"
              onChange={e => setDraft(e.target.value)}
              className="h-8 w-20 px-2 rounded-lg border border-[#d0ccf5] text-xs" />
            <button className={btn} disabled={draft === '' || isPending}
              data-testid="lead-rule-add"
              onClick={() => addRule(Number(draft))}>
              <Plus className="size-3 inline" /> 추가
            </button>
            <span className="text-[10px] text-[#b0acd6] ml-1">빠른 추가</span>
            {QUICK.filter(n => !rules.includes(n)).map(n => (
              <button key={n} className={btn} disabled={isPending} onClick={() => addRule(n)}>{dDayLabel(n)}</button>
            ))}
          </div>
        )}
        {msg && <p className="mt-2 text-[11px] text-[#514b81]">{msg}</p>}
      </section>

      {/* ② 발송 문구 3종 */}
      <section className="rounded-2xl border border-[#eceaf8] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">발송 문구</h2>
        <p className="mt-0.5 text-[11px] text-[#8b87b8]">고객·관계인에게 나가는 문구입니다. 여기서 고치면 다음 발송부터 적용됩니다.</p>
        <div className="mt-3 space-y-2">
          {items.map(t => (
            <div key={t.key} data-testid="template-card"
              className="rounded-xl border border-[#eceaf8] p-3">
              <div className="flex items-center gap-2">
                {t.isSms ? <MessageSquare className="size-3.5 text-[#7b68ee]" /> : t.key === 'owner_report' ? <Mail className="size-3.5 text-[#7b68ee]" /> : <PenLine className="size-3.5 text-[#7b68ee]" />}
                <span className="text-xs font-semibold text-[#090c1d]">{t.label}</span>
                {t.isSms && (
                  <span data-testid="template-bytes"
                    className={`text-[10px] ${t.msgType === 'LMS' ? 'text-amber-600 font-semibold' : 'text-[#b0acd6]'}`}>
                    {t.byteLen}바이트 · {t.msgType}{t.msgType === 'LMS' && ' — 요금 2~3배'}
                  </span>
                )}
                <div className="ml-auto">
                  <MessageTemplateModal templateKey={t.key} label={t.label} />
                </div>
              </div>
              {t.subject && <p className="mt-1.5 text-[11px] text-[#514b81]">제목: {t.subject}</p>}
              <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-[#8b87b8] font-sans">{t.body}</pre>
            </div>
          ))}
          {items.length === 0 && isPending && (
            <div className="flex items-center gap-2 py-6 justify-center text-xs text-[#514b81]">
              <Loader2 className="size-4 animate-spin" /> 불러오는 중…
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
