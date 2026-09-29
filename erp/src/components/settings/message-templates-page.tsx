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
/** 「사용 안 함」으로 끄기 직전의 시점 — 다시 켤 때 되살린다 */
const LAST_RULES_KEY = 'sms:lastLeadRules'
const btn = 'h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-brand-tint transition-colors disabled:opacity-40'
const btnPri = 'h-8 px-3 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-strong transition-colors disabled:opacity-40'

export function MessageTemplatesPage() {
  const [items, setItems] = useState<Item[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [storageReady, setStorageReady] = useState(true)
  const [rules, setRules] = useState<number[]>([])
  // 설정을 **읽은 뒤**에만 「사용 안 함」을 말한다 — 초기값 []을 그대로 읽으면 로딩 중에 체크된 것처럼 보인다
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function load() {
    startTransition(async () => {
      const [t, s] = await Promise.all([listMessageTemplatesAction(), getSmsSettingsAction()])
      if (t.items) { setItems(t.items); setCanEdit(!!t.canEdit); setStorageReady(t.storageReady !== false) }
      if ('rules' in s && s.rules) { setRules(s.rules); setLoaded(true) }
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
  /** 사용 안 함 — 저장값은 **빈 배열**이다(열을 늘리지 않는다).
   *  끄기 직전의 시점은 이 브라우저에 기억해 두었다가 다시 켤 때 되살린다 — 끄는 순간
   *  [3일 후·내일]이 사라지고 켜면 [내일]만 남으면, 껐다 켠 것만으로 설정을 잃는다.
   *  기억이 없으면(다른 PC 등) 기본값 [1]로 켠다. */
  const off = loaded && rules.length === 0
  function toggleOff(next: boolean) {
    if (next) {
      try { localStorage.setItem(LAST_RULES_KEY, JSON.stringify(rules)) } catch { /* 기억 못 하는 것뿐 */ }
      saveRules([])
      return
    }
    let back: number[] = [1]
    try {
      const raw = JSON.parse(localStorage.getItem(LAST_RULES_KEY) ?? 'null')
      if (Array.isArray(raw) && raw.length > 0 && raw.every(n => Number.isInteger(n))) back = raw
    } catch { /* 기본값으로 켠다 */ }
    saveRules(back)
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
          <p className="text-form-xs text-amber-800">문구 저장소가 준비되지 않았습니다(마이그레이션 130 미적용) — 편집해도 저장되지 않습니다.</p>
        </div>
      )}

      {/* ① 사전 안내 시점 (Q-13) */}
      <section className="rounded-2xl border border-brand-line-soft bg-surface p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-ink">사전 안내 시점</h2>
          {/* 사용 안 함 (2026-09-29 사용자 요청) — 끄면 달력 문자 패널의 「자동 준비」와
              뱃지·대시보드 위젯이 조용해진다. 직접 보내기(날짜·고객 골라 보내기)는 그대로다. */}
          <label data-testid="lead-rule-off-label"
            className={`ml-auto flex items-center gap-1.5 text-xs ${canEdit ? 'cursor-pointer text-ink-sub' : 'text-ink-faint'}`}
            title={canEdit ? undefined : '문구 관리 권한이 있어야 바꿀 수 있습니다'}>
            <input type="checkbox" data-testid="lead-rule-off"
              checked={off} disabled={!canEdit || !loaded || isPending}
              onChange={e => toggleOff(e.target.checked)} className="accent-brand" />
            사용 안 함
          </label>
        </div>
        <p className="mt-0.5 text-form-xs text-ink-soft">
          방문 <b>며칠 전</b>에 점검 달력의 [문자 보내기]에 &lsquo;보낼 안내&rsquo;를 미리 골라 둘지 정합니다. 실제 발송은 거기서 확인하고 눌러야 나갑니다.
          문구는 시점을 몇 개 만들든 <b>한 장</b>입니다 — <code className="px-1 bg-brand-tint rounded">{'{디데이}'}</code>가 자동으로 바뀝니다.
        </p>

        {off && (
          <p data-testid="lead-rule-off-note"
            className="mt-3 rounded-lg bg-paper border border-line px-3 py-2 text-form-xs text-ink-sub">
            사전 안내 시점을 <b>사용하지 않습니다.</b> 보낼 안내를 미리 골라 두지 않고, 메뉴 뱃지와 대시보드 알림도 뜨지 않습니다.
            문자는 점검 달력에서 날짜나 고객을 골라 <b>직접</b> 보낼 수 있습니다.
          </p>
        )}

        <div className={`mt-3 flex flex-wrap items-center gap-1.5 ${off ? 'hidden' : ''}`}>
          {rules.map(n => (
            <span key={n} data-testid="lead-rule-tag"
              className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-lg bg-brand-tint border border-brand-line text-xs text-brand">
              {dDayLabel(n)}
              {canEdit && (
                <button onClick={() => saveRules(rules.filter(x => x !== n))} disabled={isPending || rules.length <= 1}
                  title={rules.length <= 1 ? '마지막 시점은 지울 수 없습니다 — 쓰지 않으려면 [사용 안 함]을 체크하세요' : '제거'}
                  className="p-0.5 rounded hover:bg-surface disabled:opacity-30"><X className="size-3" /></button>
              )}
            </span>
          ))}
          {isPending && <Loader2 className="size-3.5 animate-spin text-ink-faint" />}
        </div>

        {canEdit && !off && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <input
              data-testid="lead-rule-input"
              type="number" min={0} max={365} value={draft} placeholder="숫자"
              onChange={e => setDraft(e.target.value)}
              className="h-8 w-20 px-2 rounded-lg border border-brand-line text-xs" />
            <button className={btn} disabled={draft === '' || isPending}
              data-testid="lead-rule-add"
              onClick={() => addRule(Number(draft))}>
              <Plus className="size-3 inline" /> 추가
            </button>
            <span className="text-form-2xs text-ink-faint ml-1">빠른 추가</span>
            {QUICK.filter(n => !rules.includes(n)).map(n => (
              <button key={n} className={btn} disabled={isPending} onClick={() => addRule(n)}>{dDayLabel(n)}</button>
            ))}
          </div>
        )}
        {msg && <p className="mt-2 text-form-xs text-ink-sub">{msg}</p>}
      </section>

      {/* ② 발송 문구 3종 */}
      <section className="rounded-2xl border border-brand-line-soft bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">발송 문구</h2>
        <p className="mt-0.5 text-form-xs text-ink-soft">고객·관계인에게 나가는 문구입니다. 여기서 고치면 다음 발송부터 적용됩니다.</p>
        <div className="mt-3 space-y-2">
          {items.map(t => (
            <div key={t.key} data-testid="template-card"
              className="rounded-xl border border-brand-line-soft p-3">
              <div className="flex items-center gap-2">
                {t.isSms ? <MessageSquare className="size-3.5 text-brand" /> : t.key === 'owner_report' ? <Mail className="size-3.5 text-brand" /> : <PenLine className="size-3.5 text-brand" />}
                <span className="text-xs font-semibold text-ink">{t.label}</span>
                {t.isSms && (
                  <span data-testid="template-bytes"
                    className={`text-form-2xs ${t.msgType === 'LMS' ? 'text-amber-600 font-semibold' : 'text-ink-faint'}`}>
                    {t.byteLen}바이트 · {t.msgType}{t.msgType === 'LMS' && ' — 요금 2~3배'}
                  </span>
                )}
                <div className="ml-auto">
                  <MessageTemplateModal templateKey={t.key} label={t.label} />
                </div>
              </div>
              {t.subject && <p className="mt-1.5 text-form-xs text-ink-sub">제목: {t.subject}</p>}
              <pre className="mt-1 whitespace-pre-wrap text-form-xs leading-snug text-ink-soft font-sans">{t.body}</pre>
            </div>
          ))}
          {items.length === 0 && isPending && (
            <div className="flex items-center gap-2 py-6 justify-center text-xs text-ink-sub">
              <Loader2 className="size-4 animate-spin" /> 불러오는 중…
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
