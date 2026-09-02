'use client'

import { useMemo, useState, useTransition } from 'react'
import { Save, Loader2, ShieldCheck, Sparkles, ExternalLink, Phone } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { useUnsavedWarning } from '@/components/ui/fields'
import { formatTel } from '@/lib/format-contact'
import { suggestGrade } from '@/lib/fire-plan-suggest'
import { saveFireSafetyManagerAction, type FireSafetyManagerInput } from '@/app/(dashboard)/customers/fire-safety-manager-actions'
import type { CustomerContact } from '@/types'

/** 관계인 탭 [소방안전관리] 구역 — 별지 9호 2쪽 '소방안전정보' 한 블록을 **한 화면에서** 채운다.
 *
 *  종전엔 이 블록 하나가 세 화면에 흩어져 있었고(관계인 탭·계획서 1.1 ②·계획서 1.7),
 *  활성 고객 320곳 중 다 채워진 곳이 1곳이었다. 특히 [소방안전관리자 전화]는 **채울 원천 자체가 없었다** —
 *  성명이 오는 1.7에 전화 열이 없어서다. 여기서는 관계인을 지목하므로 전화가 그 사람에게서 같이 온다(145).
 *
 *  ⚠ 급수는 사람이 아니라 **대상물** 속성이다(별표4 = 연면적·층수·설비). 계획서 1.1에도 같은 칸이 있고
 *     **같은 컬럼**을 쓴다 — 창구가 둘일 뿐 저장소는 하나라 어긋나지 않는다. */

const GRADES = ['특급', '1급', '2급', '3급']
const REP_ROLES = ['소유자', '관리자', '점유자']
const APPOINT_TYPES = ['소방기술자격', '소방안전관리자수첩', '업무대행감독', '겸직', '기타']

const labelCls = 'text-form-xs font-medium text-ink-sub'
const inputCls = 'h-form-8 rounded-lg border border-brand-line bg-surface px-2 text-form-sm outline-none focus:border-brand'
const segBtn = (on: boolean) => `px-2.5 h-form-8 text-form-sm ${on ? 'bg-brand text-white' : 'bg-surface text-ink-sub hover:bg-brand-tint'}`

export type FireSafetyManagerInitial = FireSafetyManagerInput

/** 별표4 자동 산정 입력 — 고객 상세 page.tsx가 이미 계산해 두는 값들 */
export type GradeBasis = {
  purpose: string | null
  totalArea: number | null
  floorsAbove: number | null
  floorsBelow: number | null
  height: string
  facilityCodes: string[]
}

export function FireSafetyManagerPanel({ customerId, contacts, canManage, initial, gradeBasis }: {
  customerId: string
  contacts: CustomerContact[]
  canManage: boolean
  initial: FireSafetyManagerInitial
  gradeBasis: GradeBasis
}) {
  const [d, setD] = useState<FireSafetyManagerInput>(initial)
  const [dirty, setDirty] = useState(false)
  // 이 패널의 dirty는 탭 셸(setTabDirty)에 안 잡힌다 — <a> 전체 이동(보조자 링크 등)의 미저장 보호는 여기서
  useUnsavedWarning(dirty)
  const [msg, setMsg] = useState('')
  const [gradeReason, setGradeReason] = useState('')
  const [isPending, startTransition] = useTransition()

  const set = <K extends keyof FireSafetyManagerInput>(k: K, v: FireSafetyManagerInput[K]) => {
    setD(p => ({ ...p, [k]: v })); setDirty(true); setMsg('')
  }
  const toggle = (k: keyof FireSafetyManagerInput, v: string) => set(k, d[k] === v ? '' : v)

  const picked = useMemo(() => contacts.find(c => c.id === d.managerContactId) ?? null, [contacts, d.managerContactId])

  function applySuggest() {
    const g = suggestGrade({
      purpose: gradeBasis.purpose, totalArea: gradeBasis.totalArea,
      floorsAbove: gradeBasis.floorsAbove, floorsBelow: gradeBasis.floorsBelow,
      height: parseFloat(gradeBasis.height) || null, facilityCodes: gradeBasis.facilityCodes,
    })
    if (!g) {
      // 왜 못 냈는지를 말한다 — "산정 불가"만 띄우면 사용자가 할 수 있는 게 없다
      setGradeReason('')
      setMsg('별표4 조건에 걸리는 값이 없습니다 — 2·3급은 설비 설치 여부로 갈립니다. [건물·시설] 탭에서 연면적·층수·설비를 먼저 채워주세요.')
      return
    }
    set('buildingGrade', g.grade)
    setGradeReason(g.reason)
    setMsg(`제안: ${g.grade} — 확인 후 저장하세요`)
  }

  function save() {
    startTransition(async () => {
      const res = await saveFireSafetyManagerAction(customerId, d)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 저장됨 — 별지 9호 2쪽 소방안전정보에 반영됩니다')
    })
  }

  return (
    <div id="c-fire-safety-manager" className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-3.5 space-y-3">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-brand" />
        <p className="text-form-sm font-semibold text-ink">소방안전관리</p>
        <span className="text-form-2xs text-ink-sub">별지 9호 2쪽 «소방안전정보»에 그대로 실립니다</span>
        {dirty && <span className="ml-auto text-form-2xs text-amber-600 font-medium">미저장</span>}
      </div>

      {/* ① 소방안전관리자 지목 — 성명·전화가 관계인에서 따라온다 */}
      <div className="space-y-1">
        <label className={labelCls}>소방안전관리자</label>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={d.managerContactId} disabled={!canManage}
            onChange={e => set('managerContactId', e.target.value)}
            className={`${inputCls} min-w-44`}>
            <option value="">지정 안 함 (계획서 1.7 선임현황 → 첫 관계인 순으로 폴백)</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.position ? ` (${c.position})` : ''}</option>
            ))}
          </select>
          {picked ? (
            <span className="inline-flex items-center gap-1 text-form-xs text-ink-sub">
              <Phone className="size-3 text-ink-faint" />
              {picked.phone
                ? formatTel(picked.phone)
                : <span className="text-amber-600">전화 없음 — 위 관계인 카드에서 번호를 채우면 문서에 실립니다</span>}
            </span>
          ) : (
            <span className="text-form-xs text-ink-meta">지정하면 성명·전화가 그 관계인에서 자동으로 옵니다</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        {/* ② 대상물 등급 — 사람이 아니라 건물 속성이라는 걸 라벨에 못박는다 */}
        <div>
          <label className={labelCls}>소방안전관리등급 <span className="text-ink-meta">(대상물 급수 · 별표4)</span></label>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="flex rounded-lg border border-brand-line overflow-hidden">
              {GRADES.map(g => (
                <button key={g} disabled={!canManage} onClick={() => toggle('buildingGrade', g)}
                  className={segBtn(d.buildingGrade === g)}>{g}</button>
              ))}
            </div>
            {canManage && (
              <button onClick={applySuggest} title="연면적·층수·높이·설비로 별표4 등급을 계산합니다 (제안 — 저장은 직접)"
                className="inline-flex items-center gap-1 h-form-8 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint">
                <Sparkles className="size-3" /> 자동 산정
              </button>
            )}
          </div>
          {gradeReason && <p className="text-form-2xs text-brand mt-0.5">근거: {gradeReason}</p>}
        </div>

        {/* ③ 사람의 자격구분 — 위 등급과 다른 축임을 표시 */}
        <div>
          <label className={labelCls}>관리자 자격구분 <span className="text-ink-meta">(사람 · 등급과 별개)</span></label>
          <div className="flex rounded-lg border border-brand-line overflow-hidden mt-0.5">
            {GRADES.map(g => (
              <button key={g} disabled={!canManage} onClick={() => toggle('managerLicenseGrade', g)}
                className={segBtn(d.managerLicenseGrade === g)}>{g}</button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>선임일</label><br />
          <DateInput value={d.managerSelectedAt} disabled={!canManage}
            onChange={e => set('managerSelectedAt', e.target.value)} className={`${inputCls} w-32 mt-0.5`} />
        </div>
        <div>
          <label className={labelCls}>최근 교육이수일</label><br />
          <DateInput value={d.managerEduDate} disabled={!canManage}
            onChange={e => set('managerEduDate', e.target.value)} className={`${inputCls} w-32 mt-0.5`} />
        </div>
        <div>
          {/* 라벨을 바꾸지 말 것 — '대표자'는 별지 9호 2쪽의 서식 원문 항목명이다
              (_form/별지9호-placeholder.hwpx: "대표자 │ [ ]소유자, [ ]관리자, [ ]점유자 / 성명:, 전화번호:").
              값은 report9.ts:278·xlsx-workbook.ts:226으로 서식에 그대로 인쇄되므로,
              다른 말로 고치면 사용자가 서식의 어느 칸을 채우는 중인지 알 수 없게 된다.
              관계인 카드·선택 목록의 role 표기 '대표'를 걷어낼 때(bb03d14·9614dc2)도 여기만 남겼다. */}
          <label className={labelCls}>대표자 구분</label>
          <div className="flex rounded-lg border border-brand-line overflow-hidden mt-0.5">
            {REP_ROLES.map(r => (
              <button key={r} disabled={!canManage} onClick={() => toggle('repRole', r)}
                className={segBtn(d.repRole === r)}>{r}</button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className={labelCls}>선임 형태</label>
        <div className="flex flex-wrap rounded-lg border border-brand-line overflow-hidden mt-0.5 w-fit">
          {APPOINT_TYPES.map(t => (
            <button key={t} disabled={!canManage} onClick={() => toggle('managerAppointType', t)}
              className={segBtn(d.managerAppointType === t)}>{t}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* fsm-save — 이 버튼이 '저장' 텍스트 셀렉터의 첫 매치였다. 비활성(!dirty)·비가시(다른 탭)라
            소방계획서 화면의 클릭을 15초씩 잡아먹었다. 표적을 붙여 텍스트로 안 잡히게 한다. */}
        {canManage && (
          <button onClick={save} disabled={isPending || !dirty} data-testid="fsm-save"
            className="inline-flex items-center gap-1 h-form-7 px-2.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 저장
          </button>
        )}
        {/* 보조자는 여기 없다 — 어디로 가야 하는지 말해준다 (1.7은 보조자 전용).
            D-4(소방계획서_30): 같은 경로 ?tab= Link는 서버를 재렌더하지 않는다 — <a> 전체 이동, 미저장은 beforeunload */}
        <a href={`/customers/${customerId}?tab=plan&form=1.7`} data-testid="fsm-assistant-link"
          className="text-form-xs text-brand hover:underline inline-flex items-center gap-0.5">
          보조자 선임현황 <ExternalLink className="size-2.5" />
        </a>
        {msg && <span className={`text-form-xs ${msg.startsWith('❌') ? 'text-red-600' : msg.startsWith('✅') ? 'text-green-600' : 'text-ink-sub'}`}>{msg}</span>}
      </div>
    </div>
  )
}
