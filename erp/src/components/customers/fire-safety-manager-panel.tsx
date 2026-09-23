'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, ExternalLink, Phone } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { useUnsavedWarning } from '@/components/ui/fields'
import { formatTel } from '@/lib/format-contact'
import { useRepRole } from './rep-role-sync'
import { saveFireSafetyManagerAction, type FireSafetyManagerInput } from '@/app/(dashboard)/customers/fire-safety-manager-actions'
import type { CustomerContact } from '@/types'
import { SubRow, Cell, SaveBar, keyInputCls, emptyRequiredCls } from './key-fields'

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

/** 별표4 자동 산정(GradeBasis)은 급수 입력칸과 함께 계획서 1.1로 갔다 — 2026-09-14 */

export function FireSafetyManagerPanel({ customerId, contacts, canManage, initial }: {
  customerId: string
  contacts: CustomerContact[]
  canManage: boolean
  initial: FireSafetyManagerInitial
}) {
  const router = useRouter()
  const [d, setD] = useState<FireSafetyManagerInput>(initial)
  const [dirty, setDirty] = useState(false)
  // 이 패널의 dirty는 탭 셸(setTabDirty)에 안 잡힌다 — <a> 전체 이동(보조자 링크 등)의 미저장 보호는 여기서
  useUnsavedWarning(dirty)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  const set = <K extends keyof FireSafetyManagerInput>(k: K, v: FireSafetyManagerInput[K]) => {
    setD(p => ({ ...p, [k]: v })); setDirty(true); setMsg('')
  }
  const toggle = (k: keyof FireSafetyManagerInput, v: string) => set(k, d[k] === v ? '' : v)

  // 대표자 구분은 **이 패널이 소유하지 않는다** — 관계인 카드와 같은 값이라 공유 상태에서 읽고
  // 클릭은 그 자리에서 저장된다(2026-09-14). 종전엔 여기 낡은 값이 [저장] 때 카드에서 고른 값을
  // 덮어썼다(E2E 재현: rep_role=null). `d`에서 뺐으므로 실을 방법 자체가 없다.
  const { repRole, pick: pickRepRole, pending: repPending, error: repError } = useRepRole()

  const picked = useMemo(() => contacts.find(c => c.id === d.managerContactId) ?? null, [contacts, d.managerContactId])

  function save() {
    startTransition(async () => {
      const res = await saveFireSafetyManagerAction(customerId, d)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 저장됨 — 별지 9호 2쪽 소방안전정보에 반영됩니다')
      // 계획서 1.1은 여기서 채운 선임일을 prop으로 읽어 준비율·표시에 쓴다. 서버의 revalidatePath는
      // **클라이언트 라우터 캐시**까지 비우지 않으므로 짝으로 걸어 준다(1.1 패널 save()와 같은 규약).
      //
      // ⚠ 이 줄은 dev E2E로 고정되지 않는다 — dev에서는 탭 전환(router.replace)이 어차피 매번
      //   RSC를 다시 받아 와서, 지워도 test-selected-at-preserve가 초록이다(2026-09-14 변이 실험에서
      //   MUTANT-2가 살아남았다). 남겨 두는 근거는 **운영의 라우터 캐시**다: 같은 라우트 재방문이
      //   캐시로 처리되면 방금 저장한 선임일이 안 내려와 "채웠는데 1.1은 누락" 증상이 그대로 돌아온다.
      router.refresh()
    })
  }

  return (
    /* 관계인 탭 ③ 그룹 상자 안의 소그룹 줄들(2026-09-23 「기본정보처럼」). 페이지가 GroupBox로 감싼다.
       ⚠ 칸 안은 **<div><label/>입력</div>** 모양을 지킨다 — E2E가 `div:has(> label:has-text("대표자 구분")) button`
         처럼 라벨과 입력이 **같은 div의 직계**라는 구조로 칸을 잡는다(test-plan-tab·test-selected-at-preserve).
       ⚠ 선임일이 이 패널의 **첫 날짜 칸**이어야 한다(test-selected-at-preserve가 `.first()`로 잡는다). */
    <div id="c-fire-safety-manager" className="scroll-mt-4 divide-y divide-brand-line-soft">
      {/* ★ 소방안전관리자 — 별지 9호 2쪽 «소방안전정보»의 핵심(누가·언제 선임·교육). 기준일 줄과 같은 강조 */}
      <SubRow label="소방안전관리" accent testId="fsm-keyrow">
        <Cell span={2}>
          {/* ① 소방안전관리자 지목 — 성명·전화가 관계인에서 따라온다 */}
          <div className="space-y-1.5">
            <label className={labelCls}>소방안전관리자</label>
            <select value={d.managerContactId} disabled={!canManage}
              onChange={e => set('managerContactId', e.target.value)}
              className={`${inputCls} w-full !h-12 !text-form-base font-semibold`}>
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
        </Cell>
        <Cell>
          <div className="space-y-1.5">
            <label className={labelCls}>선임일</label>
            <DateInput value={d.managerSelectedAt} disabled={!canManage}
              onChange={e => set('managerSelectedAt', e.target.value)} className={`${inputCls} w-full ${keyInputCls}`} />
          </div>
        </Cell>
        <Cell>
          <div className="space-y-1.5">
            <label className={labelCls}>최근 교육이수일</label>
            <DateInput value={d.managerEduDate} disabled={!canManage}
              onChange={e => set('managerEduDate', e.target.value)}
              className={`${inputCls} w-full ${keyInputCls} ${!d.managerEduDate ? emptyRequiredCls : ''}`} />
          </div>
        </Cell>
      </SubRow>

      <SubRow label="자격·구분">
        <Cell>
          {/* ③ 사람의 자격구분 — 아래 대상물 급수(건물)와 다른 축임을 표시 */}
          <div className="space-y-1.5">
            <label className={labelCls}>관리자 자격구분 <span className="text-ink-meta">(사람 · 등급과 별개)</span></label>
            <div className="flex w-fit rounded-lg border border-brand-line overflow-hidden">
              {GRADES.map(g => (
                <button key={g} disabled={!canManage} onClick={() => toggle('managerLicenseGrade', g)}
                  className={segBtn(d.managerLicenseGrade === g)}>{g}</button>
              ))}
            </div>
          </div>
        </Cell>
        <Cell>
          {/* 라벨을 바꾸지 말 것 — '대표자'는 별지 9호 2쪽의 서식 원문 항목명이다
              (_form/별지9호-placeholder.hwpx: "대표자 │ [ ]소유자, [ ]관리자, [ ]점유자 / 성명:, 전화번호:").
              값은 report9.ts:278·xlsx-workbook.ts:226으로 서식에 그대로 인쇄되므로,
              다른 말로 고치면 사용자가 서식의 어느 칸을 채우는 중인지 알 수 없게 된다.
              관계인 카드·선택 목록의 role 표기 '대표'를 걷어낼 때(bb03d14·9614dc2)도 여기만 남겼다. */}
          <div className="space-y-1.5">
            <label className={labelCls}>대표자 구분</label>
            <div className="flex w-fit rounded-lg border border-brand-line overflow-hidden">
              {REP_ROLES.map(r => (
                <button key={r} disabled={!canManage || repPending} onClick={() => pickRepRole(r)}
                  title="관계인 카드의 [구분]과 같은 값 — 누르면 바로 저장됩니다"
                  className={segBtn(repRole === r)}>{r}</button>
              ))}
            </div>
            {repError && <p className="text-form-2xs text-red-500">{repError}</p>}
          </div>
        </Cell>
        <Cell span={2}>
          <div className="space-y-1.5">
            <label className={labelCls}>선임 형태</label>
            <div className="flex flex-wrap rounded-lg border border-brand-line overflow-hidden w-fit">
              {APPOINT_TYPES.map(t => (
                <button key={t} disabled={!canManage} onClick={() => toggle('managerAppointType', t)}
                  className={segBtn(d.managerAppointType === t)}>{t}</button>
              ))}
            </div>
          </div>
        </Cell>
      </SubRow>

      <SubRow label="다른 곳에서 입력">
        <Cell span={2}>
          {/* ② 대상물 급수는 여기 없다 — 사람이 아니라 **건물** 속성이라 계획서 1.1이 정본이다
              (2026-09-14 사용자 확정). 두 화면이 같은 컬럼을 쓰면 늦게 저장하는 쪽의 낡은 상태가
              상대 값을 덮어쓴다 — 선임일이 그렇게 지워졌다. 어디로 가면 되는지만 알려 준다. */}
          <div className="space-y-1.5">
            <label className={labelCls}>소방안전관리등급 <span className="text-ink-meta">(대상물 급수 · 별표4)</span></label>
            <Link href={`/customers/${customerId}?tab=facilities&form=1.1`}
              className="flex w-fit items-center gap-1 h-form-8 px-2.5 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint">
              건물 속성이라 공통 탭 1.1에서 <ExternalLink className="size-2.5" />
            </Link>
          </div>
        </Cell>
        <Cell span={2}>
          {/* 보조자는 여기 없다 — 어디로 가야 하는지 말해준다 (1.7은 보조자 전용).
              D-4(소방계획서_30): 같은 경로 ?tab= Link는 서버를 재렌더하지 않는다 — <a> 전체 이동, 미저장은 beforeunload */}
          <div className="space-y-1.5">
            <label className={labelCls}>보조자</label>
            <a href={`/customers/${customerId}?tab=plan&form=1.7`} data-testid="fsm-assistant-link"
              className="flex w-fit items-center gap-1 h-form-8 px-2.5 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint">
              보조자 선임현황 <ExternalLink className="size-2.5" />
            </a>
          </div>
        </Cell>
      </SubRow>

      {/* 저장 줄 — 기본정보·건물 탭과 같은 모양·같은 자리(상자 아래, 스크롤해도 붙어 있다) */}
      {/* fsm-save — 이 버튼이 '저장' 텍스트 셀렉터의 첫 매치였다. 비활성(!dirty)·비가시(다른 탭)라
          소방계획서 화면의 클릭을 15초씩 잡아먹었다. 표적을 붙여 텍스트로 안 잡히게 한다(saveTestId).
          모양은 공용 SaveBar 한 벌 — [취소]는 처음 값으로 되돌린다. */}
      {canManage && (
        <SaveBar saveTestId="fsm-save" dirty={dirty} pending={isPending} onSave={save}
          onCancel={() => { setD(initial); setDirty(false); setMsg('') }}
          idle={<><ShieldCheck className="inline size-3.5 text-brand mr-1 align-[-2px]" />별지 9호 2쪽 «소방안전정보»에 그대로 실립니다</>}
          status={msg ? <span className={msg.startsWith('❌') ? 'text-red-600' : msg.startsWith('✅') ? 'text-green-600' : 'text-ink-sub'}>{msg}</span> : undefined} />
      )}
    </div>
  )
}
