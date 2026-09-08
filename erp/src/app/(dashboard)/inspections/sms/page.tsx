import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { SmsStatusClient } from '@/components/sms/sms-status-client'

/** 문자 발송 (소방계획서_24 S5) — 점검현황 모니터링을 대체한다.
 *
 *  종전 모니터링은 6단계를 inspection_steps와 이중으로 추적했고(P-14·P-15),
 *  정작 "내일 방문할 미발송 고객"은 찾을 수단이 없었다(P-17: 등록순 정렬·월 필터뿐·
 *  미발송 필터 없음·지역 축 없음). 이 화면은 6단계 추적을 버리고 **1단계 점검일만** 본다.
 *
 *  프록시(proxy.ts)가 인증을 거르지만 페이지 가드로 이중 방어한다 — 규약상 필수. */
/** 유효한 상태 값만 통과시킨다 — URL은 사용자가 손댈 수 있고, 모르는 값을 그대로 넘기면
 *  클라이언트 상태가 어떤 선택지에도 안 맞아 필터 UI가 빈 채로 뜬다(무엇이 걸렸는지 못 본다). */
const STATUSES = ['all', 'not_sent', 'unsent', 'sent', 'failed', 'no_phone', 'stuck'] as const
type SmsStatusFilter = (typeof STATUSES)[number]
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export default async function InspectionSmsPage({
  searchParams,
}: {
  /** 발송 모달의 [발송 결과 전체 보기]가 방금 보낸 방문일 범위와 상태를 실어 보낸다 (S8-10).
   *  없으면 종전과 같은 기본값 — 이 화면의 일은 '아직 안 보낸 것'이라 status는 not_sent다. */
  searchParams?: Promise<{ from?: string; to?: string; status?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const sp = (await searchParams) ?? {}
  const initialStatus = STATUSES.includes(sp.status as SmsStatusFilter)
    ? (sp.status as SmsStatusFilter) : undefined

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">문자 발송</h1>
        <p className="mt-0.5 text-xs text-ink-soft">
          방문 전 사전 안내 문자를 보내고, 발송 결과를 확인합니다. 발송은 점검달력에서도 할 수 있습니다.
        </p>
      </div>
      <SmsStatusClient
        canSend={can(profile.role, 'inspection_sms_send')}
        initialFrom={isDate(sp.from) ? sp.from : undefined}
        initialTo={isDate(sp.to) ? sp.to : undefined}
        initialStatus={initialStatus}
      />
    </div>
  )
}
