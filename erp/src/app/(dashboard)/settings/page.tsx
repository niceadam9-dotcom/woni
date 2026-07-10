import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Settings, User, KeyRound, PenLine, Building2, Users, Network,
  CalendarDays, Warehouse, ScrollText, ChevronRight, Bell,
} from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PasswordChangeClient } from '@/components/settings/password-change-client'
import { NotificationSettingsClient } from '@/components/settings/notification-settings-client'

const ROLE_LABELS: Record<string, string> = { employee: '일반직원', manager: '팀장', admin: '관리자' }

// 관리 바로가기 (admin 전용) — 흩어진 설정성 화면들의 허브 (제안.md 3단계)
const ADMIN_LINKS = [
  { href: '/company',                 label: '회사 정보',   desc: '업체명·로고·사업자 정보', icon: Building2 },
  { href: '/admin/users',             label: '직원 관리',   desc: '계정·역할·퇴사 처리',     icon: Users },
  { href: '/admin/departments',       label: '부서 관리',   desc: '부서 구성·팀장 지정',     icon: Network },
  { href: '/admin/holidays',          label: '공휴일 관리', desc: '점검 일정 영업일 계산',   icon: CalendarDays },
  { href: '/admin/building-purposes', label: '건물 용도',   desc: '건축물 용도 분류',        icon: Warehouse },
  { href: '/admin/logs',              label: '활동 로그',   desc: '시스템 변경 이력 조회',   icon: ScrollText },
]

export default async function SettingsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  // 부서명 해석
  let deptName: string | null = null
  if (profile.department_id) {
    const { data } = await admin.from('departments').select('name').eq('id', profile.department_id).single()
    deptName = (data as { name: string } | null)?.name ?? null
  }

  // 알림 수신 설정 (notification_prefs는 프로필 캐시 컬럼에 없어 직접 조회)
  const { data: prefsRaw } = await admin
    .from('profiles').select('notification_prefs').eq('id', profile.id).single()
  const notificationPrefs = ((prefsRaw as { notification_prefs: Record<string, boolean> | null } | null)
    ?.notification_prefs ?? {}) as Record<string, boolean>

  const infoRows: Array<[string, string]> = [
    ['이름', profile.name],
    ['사번', profile.employee_id],
    ['이메일', profile.email],
    ['역할', ROLE_LABELS[profile.role] ?? profile.role],
    ['부서', deptName ?? '—'],
    ['직책', profile.position ?? '—'],
    ['입사일', profile.hire_date ?? '—'],
  ]

  const cardCls = 'bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden'

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-2.5">
        <Settings className="size-6 text-[#7b68ee]" />
        <h1 className="text-xl font-bold text-[#090c1d]">설정</h1>
      </div>

      {/* 내 정보 */}
      <section className={cardCls}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#e0ddf5]">
          <User className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">내 정보</h2>
          <span className="ml-auto text-[11px] text-[#b0acd6]">정보 수정은 관리자에게 문의하세요</span>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 px-5 py-4">
          {infoRows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] text-[#b0acd6] mb-0.5">{label}</dt>
              <dd className="text-sm text-[#090c1d] font-medium break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 비밀번호 변경 */}
      <section className={cardCls}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#e0ddf5]">
          <KeyRound className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">비밀번호 변경</h2>
        </div>
        <div className="px-5 py-4">
          <PasswordChangeClient />
        </div>
      </section>

      {/* 알림 수신 설정 */}
      <section className={cardCls}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#e0ddf5]">
          <Bell className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">알림 설정</h2>
          <span className="ml-auto text-[11px] text-[#b0acd6]">끈 항목은 상단 종 알림이 오지 않습니다</span>
        </div>
        <div className="px-5 py-2">
          <NotificationSettingsClient initialPrefs={notificationPrefs} />
        </div>
      </section>

      {/* 결재 서명 바로가기 */}
      <Link href="/my/signature" className={`${cardCls} flex items-center gap-3 px-5 py-4 hover:bg-[#fafafa] transition-colors`}>
        <PenLine className="size-4 text-[#7b68ee] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#090c1d]">결재 서명</p>
          <p className="text-xs text-[#b0acd6]">전자결재에 사용할 서명을 등록·변경합니다</p>
        </div>
        <ChevronRight className="size-4 text-[#b0acd6] shrink-0" />
      </Link>

      {/* 관리 바로가기 — 관리자 전용 */}
      {profile.role === 'admin' && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-[#514b81] px-1">관리 바로가기</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ADMIN_LINKS.map(({ href, label, desc, icon: Icon }) => (
              <Link key={href} href={href} className={`${cardCls} flex items-center gap-3 px-4 py-3.5 hover:bg-[#fafafa] transition-colors`}>
                <Icon className="size-4 text-[#7b68ee] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#090c1d]">{label}</p>
                  <p className="text-[11px] text-[#b0acd6] truncate">{desc}</p>
                </div>
                <ChevronRight className="size-4 text-[#b0acd6] shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
