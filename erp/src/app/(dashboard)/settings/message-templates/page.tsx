import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { MessageTemplatesPage } from '@/components/settings/message-templates-page'

/** 발송 문구 설정 (소방계획서_24 S7 / Q-6·Q-13)
 *
 *  이 앱의 **첫 `/settings` 라우트**다 — 사이드바 '설정' 구역은 도메인 경로(/inspection-sheets,
 *  /fire-plans/library …)를 모아 부르는 이름일 뿐이었다.
 *
 *  왜 필요한가(P-7 정정판): 관계인 보고 문구는 작업대 ③ 칸에서 편집이 되긴 했지만
 *  **개별 점검 건 안에 숨어 있어** "문구를 바꾸려면 어디로 가야 하나"에 답이 없었다.
 *  SMS 문구는 아예 컴포넌트 상수 + 개인 브라우저 localStorage였다(P-6).
 *
 *  조회는 전 직원, 저장은 message_template_manage(매니저↑) — 컴포넌트가 canEdit로 가린다. */
export default async function MessageTemplateSettingsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-[#090c1d]">발송 문구</h1>
        <p className="mt-0.5 text-xs text-[#8b87b8]">
          사전 안내 문자의 시점과, 고객에게 나가는 문구를 관리합니다.
        </p>
      </div>
      <MessageTemplatesPage />
    </div>
  )
}
