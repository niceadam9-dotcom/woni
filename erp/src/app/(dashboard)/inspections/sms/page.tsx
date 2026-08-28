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
export default async function InspectionSmsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">문자 발송</h1>
        <p className="mt-0.5 text-xs text-ink-soft">
          방문 전 사전 안내 문자를 보내고, 발송 결과를 확인합니다. 발송은 점검달력에서도 할 수 있습니다.
        </p>
      </div>
      <SmsStatusClient canSend={can(profile.role, 'inspection_sms_send')} />
    </div>
  )
}
