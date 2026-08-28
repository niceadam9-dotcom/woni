import { LogOut, User } from 'lucide-react'
import { NotificationBell } from './notification-bell'
import { HeaderTitle } from './header-title'
import { ThemeToggle } from './theme-toggle'
import { CommandPalette } from '@/components/reports/command-palette'
import { logoutAction } from '@/app/(dashboard)/actions'
import { can } from '@/lib/permissions'
import type { Profile, UserRole } from '@/types'

interface HeaderProps {
  profile: Profile
}

export function Header({ profile }: HeaderProps) {
  const showPalette = can(profile.role as UserRole, 'inspection_register')
  return (
    <header className="h-16 shrink-0 flex items-center justify-between gap-4 px-6 bg-surface border-b border-line print:hidden">
      {/* 좌: 현재 페이지 브레드크럼 (2026-07-14 상단 공백 활용 A안) */}
      <HeaderTitle />

      <div className="flex items-center gap-2">
        {/* Ctrl+K 전역 팔레트 (소방계획서_5 R0-4) */}
        {showPalette && <CommandPalette />}
        {/* 테마 빠른 토글 (소방계획서_29 S1-7) — 전 사용자 노출(S4-3, 2026-08-28 승인) */}
        <ThemeToggle />
        <NotificationBell userId={profile.id} />

        {/* Profile */}
        <div className="flex items-center gap-2 pl-2 ml-1 border-l border-line">
          <div className="size-8 rounded-full bg-brand/10 flex items-center justify-center">
            <User className="size-4 text-brand" />
          </div>
          <div className="leading-none">
            <p className="text-sm font-medium text-ink">{profile.name}</p>
            <p className="text-[11px] text-ink-sub">
              {profile.role === 'admin' ? '관리자' : profile.role === 'manager' ? '팀장' : '일반직원'}
            </p>
          </div>
        </div>

        {/* Logout */}
        <form action={logoutAction}>
          <button
            type="submit"
            className="size-9 flex items-center justify-center rounded-lg text-ink-sub hover:bg-red-50 hover:text-red-500 transition-colors"
            aria-label="로그아웃"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </header>
  )
}
