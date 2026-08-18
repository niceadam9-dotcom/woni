'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import {
  loadTemplate, companyVars, renderTemplate, TEMPLATE_VARS, TEMPLATE_LABEL, TEMPLATE_IS_SMS,
  type TemplateKey, type TemplateEditData,
} from '@/lib/message-template'
import { smsByteLength, smsKind } from '@/lib/sms-recipients'
import type { UserRole } from '@/types'

/** 발송 문구 편집 (소방계획서_21 R7-3) — 전용 페이지를 만들지 않고 **쓰는 자리**(③ 관계인 보고 단계,
 *  메일 작성 화면)의 모달에서 고친다. /company는 requireRole(['admin'])이라 매니저가 못 들어가는 문제도 함께 피한다.
 *
 *  ⚠ 이 파일은 `'use server'`다 — **async 함수 외에는 아무것도 export하지 않는다.** 타입까지 내보내면
 *  모듈 평가가 깨져 API 라우트가 전부 404가 되는데 tsc·build는 통과한다(소방계획서_18 교훈).
 *  TemplateEditData는 lib/message-template.ts에 둔다. */

/** 편집 화면 로드 — 현재 문구 + 샘플 값으로 렌더한 미리보기 */
export async function getMessageTemplateAction(
  key: TemplateKey, sampleVars: Record<string, string> = {},
): Promise<{ data?: TemplateEditData; error?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const template = await loadTemplate(admin, key)
  const vars = { ...(await companyVars()), ...sampleVars }
  const s = renderTemplate(template.subject ?? '', vars)
  const b = renderTemplate(template.body, vars)
  const a = renderTemplate(template.attachmentName ?? '', vars)

  // 130 적용 여부 — 테이블이 없으면 편집은 되지만 저장이 불가하다
  const probe = await admin.from('message_templates').select('key').limit(1)

  return {
    data: {
      template,
      vars: TEMPLATE_VARS[key],
      preview: {
        subject: s.text, body: b.text, attachmentName: a.text,
        unresolved: [...new Set([...s.unresolved, ...b.unresolved, ...a.unresolved])],
      },
      canEdit: can(profile.role as UserRole, 'message_template_manage'),
      storageReady: !probe.error,
    },
  }
}

/** 문구 저장 — 매니저 이상. 변경 자체도 대외 문서에 영향을 주므로 activity_logs에 남긴다 */
export async function saveMessageTemplateAction(
  key: TemplateKey,
  input: { subject: string | null; body: string; attachmentName: string | null },
): Promise<{ error?: string; unresolved?: string[] }> {
  const profile = await requirePermission('message_template_manage')
  if (!input.body?.trim()) return { error: '본문을 입력해주세요.' }

  // 알 수 없는 변수는 그대로 고객에게 인쇄된다 — 저장 자체를 막는다
  const known = Object.fromEntries(TEMPLATE_VARS[key].map(v => [v, '']))
  const bad = [
    ...renderTemplate(input.subject ?? '', known).unresolved,
    ...renderTemplate(input.body, known).unresolved,
    ...renderTemplate(input.attachmentName ?? '', known).unresolved,
  ]
  if (bad.length > 0) {
    return { error: `알 수 없는 변수가 있습니다: ${[...new Set(bad)].map(v => `{${v}}`).join(', ')}`, unresolved: [...new Set(bad)] }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('message_templates').upsert({
    key, subject: input.subject, body: input.body, attachment_name: input.attachmentName,
    updated_by: profile.id, updated_at: new Date().toISOString(),
  } as Record<string, unknown>)
  if (error) {
    return { error: /message_templates/.test(error.message)
      ? '문구 저장소가 아직 준비되지 않았습니다 (마이그레이션 130 미적용).'
      : `저장 실패: ${error.message}` }
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id, action: 'message_template_updated',
    entity_type: 'message_template', entity_id: null,
    metadata: { key, subject: input.subject, bodyLength: input.body.length },
  } as Record<string, unknown>)

  revalidatePath('/mail')
  revalidatePath('/settings/message-templates')
  revalidatePath('/inspections/sms')
  return {}
}

/** 발송 문구 3종을 한 번에 — 설정 화면이 카드 목록을 그린다 (소방계획서_24 S7).
 *
 *  종전에는 문구를 고치러 갈 자리가 없었다(P-7 정정판): 편집 자체는 작업대 ③ 칸·메일 작성 화면에서
 *  됐지만 **개별 건 안에 숨어 있어** "문구를 바꾸려면 어디로"에 답이 없었다.
 *  SMS 문구는 아예 키가 없어 컴포넌트 상수 + 개인 localStorage에만 있었다(P-6). */
export async function listMessageTemplatesAction(): Promise<{
  items?: Array<{ key: TemplateKey; label: string; isSms: boolean; subject: string | null; body: string; byteLen: number; msgType: 'SMS' | 'LMS' }>
  canEdit?: boolean
  storageReady?: boolean
  error?: string
}> {
  const profile = await getProfile()
  if (!profile) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const keys: TemplateKey[] = ['inspection_sms', 'owner_report', 'mail_signature']
  const items = []
  for (const key of keys) {
    const t = await loadTemplate(admin, key)
    items.push({
      key,
      label: TEMPLATE_LABEL[key],
      isSms: TEMPLATE_IS_SMS[key],
      subject: t.subject,
      body: t.body,
      byteLen: smsByteLength(t.body),
      msgType: smsKind(t.body),
    })
  }
  const probe = await admin.from('message_templates').select('key').limit(1)
  return { items, canEdit: can(profile.role as UserRole, 'message_template_manage'), storageReady: !probe.error }
}
