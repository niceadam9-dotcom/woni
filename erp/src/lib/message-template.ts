import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'
import { getCompanyProfile } from '@/lib/company-profile'

/** 대외 발송 문구 (소방계획서_21 R7 / #3·#4 D-1)
 *
 *  종전에는 관계인 보고 제목·본문·첨부 파일명과 메일 서명이 코드 리터럴이라
 *  상호('승진소방ENG')가 네 곳에 흩어져 있었다. 치환 변수 {회사명}을 company_profile에서 채워
 *  **상호를 한 곳으로 수렴**시키는 것이 이 모듈의 핵심 이득이다.
 *
 *  마이그레이션 130이 적용되지 않아도 동작해야 한다 — 테이블이 없으면 DEFAULT_TEMPLATES로 물러난다.
 *  (문구 관리 기능만 비활성이고 발송 자체는 종전과 동일하게 나간다.) */

type Admin = ReturnType<typeof createAdminClient>

export type TemplateKey = 'owner_report' | 'mail_signature' | 'inspection_sms'

export type MessageTemplate = {
  key: TemplateKey
  subject: string | null
  body: string
  attachmentName: string | null
}

/** 130 미적용·행 없음일 때 쓰는 현행 문구 — 시드와 **같은 내용이어야 한다** */
export const DEFAULT_TEMPLATES: Record<TemplateKey, MessageTemplate> = {
  owner_report: {
    key: 'owner_report',
    subject: '[{회사명}] {고객명} 소방시설 자체점검 결과 보고',
    body: [
      '{고객명} 관계인님께',
      '',
      '소방시설 자체점검 결과 보고서(별지 제9호서식)를 송부드립니다.',
      '본 메일은 전자우편 송달 동의에 따라 발송되었습니다 (소방시설 설치 및 관리에 관한 법률 시행규칙).',
      '',
      '{회사명} 드림',
    ].join('\n'),
    // 별지 9호 저장명 규약과 같은 문구 (마이그레이션 144) — 화면 내려받기는 lib/annex-filename이 만든다.
    // 여기 {연도}는 **점검 연도**라, 해를 넘겨 재생성한 문서를 보내면 내려받기 이름(생성일 연도)과 한 해 갈릴 수 있다.
    attachmentName: '{연도}_소방시설등 자체점검_실시결과보고서_{고객명}',
  },
  mail_signature: {
    key: 'mail_signature',
    subject: null,
    body: ['---', '{회사명} {작성자} 드림', '(본 메일은 회사 공용 계정에서 발송되었습니다)'].join('\n'),
    attachmentName: null,
  },
  // 방문 전 사전 안내 SMS (소방계획서_24 Q-3) — 141 시드와 **같은 내용이어야 한다**.
  // 길이 주의: 90바이트를 넘으면 LMS로 전환돼 요금이 2~3배. 이 문구는 약 78바이트.
  // {디데이}가 발송 시점에 맞춰 오늘/내일/모레/N일 후로 자동 치환되므로,
  // 배너 시점을 몇 개 만들든 문구는 **한 장**이면 된다(Q-13).
  inspection_sms: {
    key: 'inspection_sms',
    subject: null,
    body: [
      '[{회사명}] {디데이} {점검일짧게}',
      '소방시설 점검을 위해 방문합니다.',
      '문의 {회사전화}',
    ].join('\n'),
    attachmentName: null,
  },
}

/** 편집 화면이 받는 묶음 — **타입은 여기 둔다.**
 *  `'use server'` 파일에서는 타입 export도 하지 않는다: 모듈 평가가 깨져 API 라우트가 전부 404가 되는데
 *  tsc·build는 통과해 발견이 늦다(소방계획서_18에서 겪은 사고). */
export type TemplateEditData = {
  template: MessageTemplate
  vars: string[]
  /** 실제 값이 채워진 미리보기 — 변수 오타를 저장 전에 잡는다 */
  preview: { subject: string; body: string; attachmentName: string; unresolved: string[] }
  canEdit: boolean
  /** 마이그레이션 130 미적용 — 편집해도 저장되지 않는다는 사실을 화면이 말해야 한다 */
  storageReady: boolean
}

export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  owner_report: '관계인 보고 메일',
  mail_signature: '메일 서명',
  inspection_sms: '점검 안내 SMS',
}

/** 종류별 사용 가능한 치환 변수 — 편집 화면 안내·미치환 경고 판정에 함께 쓴다 */
export const TEMPLATE_VARS: Record<TemplateKey, string[]> = {
  owner_report: ['회사명', '대표자', '회사전화', '고객명', '연도', '차수', '점검일'],
  mail_signature: ['회사명', '대표자', '회사전화', '작성자'],
  // {담당자연락처}는 만들지 않는다 — profiles에 전화 컬럼이 없어 채울 값이 없다
  inspection_sms: ['회사명', '대표자', '회사전화', '고객명', '관계인명', '디데이', '점검일', '점검일짧게', '점검종류', '담당자'],
}

/** SMS만 문자 수 제한이 실제 요금으로 이어진다 — 편집 화면이 바이트·SMS/LMS를 보여줄 종류 */
export const TEMPLATE_IS_SMS: Record<TemplateKey, boolean> = {
  owner_report: false,
  mail_signature: false,
  inspection_sms: true,
}

/** 문구 1건 조회 — 테이블·행이 없으면 기본값. **절대 throw하지 않는다**(발송을 막으면 안 된다) */
export async function loadTemplate(admin: Admin, key: TemplateKey): Promise<MessageTemplate> {
  try {
    const { data, error } = await admin.from('message_templates')
      .select('key, subject, body, attachment_name').eq('key', key).maybeSingle()
    if (error || !data) return DEFAULT_TEMPLATES[key]
    const row = data as { key: string; subject: string | null; body: string; attachment_name: string | null }
    if (!row.body?.trim()) return DEFAULT_TEMPLATES[key]
    return { key, subject: row.subject, body: row.body, attachmentName: row.attachment_name }
  } catch {
    return DEFAULT_TEMPLATES[key]
  }
}

/** 회사 정보 기반 공통 변수 — 상호가 여기 한 곳에서만 온다 */
export async function companyVars(): Promise<Record<string, string>> {
  const c = await getCompanyProfile()
  return {
    회사명: c?.company_name ?? '',
    대표자: c?.representative ?? '',
    회사전화: c?.phone ?? '',
    회사이메일: c?.email ?? '',
  }
}

/** {변수} 치환. 값이 없는 변수는 **빈 문자열로 지운다** — 미치환 표기가 그대로 고객에게 나가면 안 된다.
 *  알 수 없는 변수는 남겨 두고 unresolved로 보고한다(편집 화면 경고용). */
export function renderTemplate(
  text: string, vars: Record<string, string>,
): { text: string; unresolved: string[] } {
  const unresolved: string[] = []
  const out = text.replace(/\{([^{}\n]{1,20})\}/g, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name] ?? ''
    unresolved.push(name)
    return whole
  })
  return { text: out, unresolved: [...new Set(unresolved)] }
}

/** 발송 직전 한 번에 렌더 — 제목·본문·첨부 파일명 */
export async function renderMessage(
  admin: Admin, key: TemplateKey, extraVars: Record<string, string>,
): Promise<{ subject: string; body: string; attachmentName: string; unresolved: string[] }> {
  const tpl = await loadTemplate(admin, key)
  const vars = { ...(await companyVars()), ...extraVars }
  const s = renderTemplate(tpl.subject ?? '', vars)
  const b = renderTemplate(tpl.body, vars)
  const a = renderTemplate(tpl.attachmentName ?? '', vars)
  return {
    subject: s.text, body: b.text, attachmentName: a.text,
    unresolved: [...new Set([...s.unresolved, ...b.unresolved, ...a.unresolved])],
  }
}
