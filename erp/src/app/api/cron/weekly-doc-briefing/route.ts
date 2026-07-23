import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findDueReport9, findMissingCerts, SELF_INSPECTION_OR } from '@/lib/doc-status'
import { isGoogleConfigured, gmailSendMail } from '@/lib/google'
import { getCompanyProfile } from '@/lib/company-profile'

// P-2 주간 문서 브리핑 (소방계획서_5 §8 P-2 — 모니터링 0층)
// 매주 월 아침: 이번 주 자체점검·별지 9호 제출 기한 임박·배치확인서 누락 요약을
// manager/admin 알림 + 회사 메일로 자동 발송. 판정은 lib/doc-status 공유(이중 판정 금지).
// VPS 크론 주 1회 호출 — Authorization: Bearer {CRON_SECRET}
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() + 9 * 60 * 60 * 1000)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const weekAgoStr = weekAgo.toISOString().split('T')[0]

  // 판정 함수 공유 — 별지 9호 제출 기한 임박(D-7 이내)·배치확인서 누락
  const [dueSoon, missingCerts, weekDoneRes] = await Promise.all([
    findDueReport9(admin, { withinDays: 7 }),
    findMissingCerts(admin),
    admin.from('inspections').select('id', { count: 'exact', head: true })
      .eq('status', 'completed').neq('inspection_type', '일반관리').or(SELF_INSPECTION_OR)
      .gte('inspection_end_date', weekAgoStr),
  ])
  const weekDone = weekDoneRes.count ?? 0
  const overdue = dueSoon.filter(d => d.dday < 0).length

  const lines = [
    `[주간 문서 브리핑] ${todayStr}`,
    ``,
    `· 최근 7일 자체점검 완료: ${weekDone}건`,
    `· 별지 9호 제출 기한 임박(D-7 이내): ${dueSoon.length}건${overdue > 0 ? ` (기한 초과 ${overdue}건)` : ''}`,
    `· 배치확인서 누락: ${missingCerts.length}건`,
    ``,
    ...(dueSoon.length > 0 ? ['[제출 기한 임박]', ...dueSoon.slice(0, 10).map(d => ` - ${d.customerName} ${d.year}년 ${d.sequenceNum}차 · ${d.dday < 0 ? `기한 초과 ${-d.dday}일` : `D-${d.dday}`} (기한 ${d.due})`), ''] : []),
    ...(missingCerts.length > 0 ? ['[배치확인서 누락]', ...missingCerts.slice(0, 10).map(c => ` - ${c.customerName} ${c.year}년 ${c.sequenceNum}차${c.daysSince !== null ? ` · 완료 후 ${c.daysSince}일 경과` : ''}`), ''] : []),
    `보고서 센터 제출 현황: /reports?form=submissions`,
  ]
  const bodyText = lines.join('\n')
  const summaryTitle = `주간 문서 브리핑 — 완료 ${weekDone} · 기한 임박 ${dueSoon.length} · 누락 ${missingCerts.length}`

  // ── 1) 알림 (manager/admin), 오늘 중복 발송 방지 ──
  const { data: managersRaw } = await admin.from('profiles')
    .select('id').in('role', ['manager', 'admin']).eq('is_active', true).eq('is_system', false)
  const managerIds = ((managersRaw ?? []) as Array<{ id: string }>).map(p => p.id)

  const { data: existingRaw } = await admin.from('notifications')
    .select('recipient_id').eq('type', 'weekly_doc_briefing').gte('created_at', `${todayStr}T00:00:00+09:00`)
  const already = new Set(((existingRaw ?? []) as Array<{ recipient_id: string }>).map(n => n.recipient_id))

  const batch = managerIds.filter(id => !already.has(id)).map(id => ({
    recipient_id: id, title: summaryTitle, message: bodyText, type: 'weekly_doc_briefing',
  }))
  // best-effort: 마이그레이션 109(type CHECK 확장) 미적용 환경에서도 이메일·요약은 계속 — 알림만 건너뜀
  let notified = 0
  let notifyError: string | null = null
  if (batch.length > 0) {
    const { error } = await admin.from('notifications').insert(batch)
    if (error) notifyError = error.message
    else notified = batch.length
  }

  // ── 2) 회사 메일 (설정된 경우만 — best-effort) ──
  let emailed = false
  let emailError: string | null = null
  try {
    const company = await getCompanyProfile()
    if (company?.email && await isGoogleConfigured()) {
      await gmailSendMail({ to: [company.email], subject: summaryTitle, bodyText })
      emailed = true
    }
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json({
    ok: true, date: todayStr,
    summary: { weekDone, dueSoon: dueSoon.length, overdue, missingCerts: missingCerts.length },
    notified, notifyError, emailed, emailError,
  })
}
