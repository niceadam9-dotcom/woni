import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Settings, User, KeyRound, PenLine, Building2, Users, Network,
  CalendarDays, Warehouse, ScrollText, ChevronRight, Bell, MessageSquare, Palette, Type,
} from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { readProfileTheme } from '@/lib/theme'
import { readProfileFontScale } from '@/lib/font-scale'
import { PasswordChangeClient } from '@/components/settings/password-change-client'
import { NotificationSettingsClient } from '@/components/settings/notification-settings-client'
import { ThemeSettingsClient } from '@/components/settings/theme-settings-client'
import { FontScaleSettingsClient } from '@/components/settings/font-scale-settings-client'

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

  // 화면 테마 (소방계획서_29) — 관용 조회(151 미적용이면 null → light).
  // 전 사용자 노출(S4-3, 2026-08-28 승인) — 독립 판정·28화면 스캔 통과 후 D-6 게이트 해제
  // 소방계획서 글자 배율(소방계획서_35) — 같은 관용 조회 규약(154 미적용이면 null → md).
  // 두 조회를 병렬로 — 순차면 설정 화면 진입에 왕복 2개가 직렬로 붙는다.
  const [themeRaw, fsRaw] = await Promise.all([
    readProfileTheme(profile.id),
    readProfileFontScale(profile.id),
  ])
  const theme = themeRaw ?? 'light'
  const fontScale = fsRaw ?? 'md'
  const showThemeCard = true

  const infoRows: Array<[string, string]> = [
    ['이름', profile.name],
    ['사번', profile.employee_id],
    ['이메일', profile.email],
    ['역할', ROLE_LABELS[profile.role] ?? profile.role],
    ['부서', deptName ?? '—'],
    ['직책', profile.position ?? '—'],
    ['입사일', profile.hire_date ?? '—'],
  ]

  const cardCls = 'bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden'

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-2.5">
        <Settings className="size-6 text-brand" />
        <h1 className="text-xl font-bold text-ink">설정</h1>
      </div>

      {/* 내 정보 */}
      <section className={cardCls}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-brand-line-soft">
          <User className="size-4 text-brand" />
          <h2 className="text-sm font-semibold text-ink">내 정보</h2>
          <span className="ml-auto text-[11px] text-ink-faint">정보 수정은 관리자에게 문의하세요</span>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 px-5 py-4">
          {infoRows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] text-ink-faint mb-0.5">{label}</dt>
              <dd className="text-sm text-ink font-medium break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 비밀번호 변경 */}
      <section className={cardCls}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-brand-line-soft">
          <KeyRound className="size-4 text-brand" />
          <h2 className="text-sm font-semibold text-ink">비밀번호 변경</h2>
        </div>
        <div className="px-5 py-4">
          <PasswordChangeClient />
        </div>
      </section>

      {/* 화면 테마 (소방계획서_29 S1-6) — 롤아웃 전 관리자만 */}
      {showThemeCard && (
        <section className={cardCls} data-testid="theme-settings-card">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-brand-line-soft">
            <Palette className="size-4 text-brand" />
            <h2 className="text-sm font-semibold text-ink">화면 테마</h2>
            <span className="ml-auto text-[11px] text-ink-faint">이 계정의 모든 기기에 적용됩니다</span>
          </div>
          <div className="px-5 py-4">
            <ThemeSettingsClient initialTheme={theme} />
          </div>
        </section>
      )}

      {/* 소방계획서 글자 크기 (소방계획서_35 S5-2)
          ⚠ 테마 카드와 달리 관리자 제한을 두지 않는다 — 이 기능이 필요한 사람이
          바로 현장 실무자(시니어)이고, 숨기면 기능이 없는 것과 같기 때문이다. */}
      <section className={cardCls} data-testid="font-scale-settings-card">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-brand-line-soft">
          <Type className="size-4 text-brand" />
          <h2 className="text-sm font-semibold text-ink">소방계획서 글자 크기</h2>
          <span className="ml-auto text-[11px] text-ink-faint">이 계정의 모든 기기에 적용됩니다</span>
        </div>
        <div className="px-5 py-4">
          <FontScaleSettingsClient initialScale={fontScale} />
        </div>
      </section>

      {/* 알림 수신 설정 */}
      <section className={cardCls}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-brand-line-soft">
          <Bell className="size-4 text-brand" />
          <h2 className="text-sm font-semibold text-ink">알림 설정</h2>
          <span className="ml-auto text-[11px] text-ink-faint">끈 항목은 상단 종 알림이 오지 않습니다</span>
        </div>
        <div className="px-5 py-2">
          <NotificationSettingsClient initialPrefs={notificationPrefs} />
        </div>
      </section>

      {/* 결재 서명 바로가기 */}
      <Link href="/my/signature" className={`${cardCls} flex items-center gap-3 px-5 py-4 hover:bg-paper transition-colors`}>
        <PenLine className="size-4 text-brand shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">결재 서명</p>
          <p className="text-xs text-ink-faint">전자결재에 사용할 서명을 등록·변경합니다</p>
        </div>
        <ChevronRight className="size-4 text-ink-faint shrink-0" />
      </Link>

      {/* 발송 문구 (소방계획서_24 S7) — 사이드바 '설정' 구역과 이 허브 양쪽에서 들어갈 수 있게.
          종전에는 문구를 고치러 갈 자리가 없어, 관계인 보고 문구를 바꾸려면 아무 점검 건이나 열어
          작업대 ③ 칸까지 들어가야 했다(P-7). 조회는 전 직원, 저장은 매니저↑ */}
      <Link href="/settings/message-templates" className={`${cardCls} flex items-center gap-3 px-5 py-4 hover:bg-paper transition-colors`}>
        <MessageSquare className="size-4 text-brand shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">발송 문구</p>
          <p className="text-xs text-ink-faint">점검 안내 문자·관계인 보고 메일 문구와 사전 안내 시점</p>
        </div>
        <ChevronRight className="size-4 text-ink-faint shrink-0" />
      </Link>

      {/* 관리 바로가기 — 관리자 전용 */}
      {profile.role === 'admin' && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-sub px-1">관리 바로가기</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ADMIN_LINKS.map(({ href, label, desc, icon: Icon }) => (
              <Link key={href} href={href} className={`${cardCls} flex items-center gap-3 px-4 py-3.5 hover:bg-paper transition-colors`}>
                <Icon className="size-4 text-brand shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{label}</p>
                  <p className="text-[11px] text-ink-faint truncate">{desc}</p>
                </div>
                <ChevronRight className="size-4 text-ink-faint shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
