import { LogOut, User } from 'lucide-react'
import { NotificationBell } from './notification-bell'
import { HeaderTitle } from './header-title'
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
    <header className="h-16 shrink-0 flex items-center justify-between gap-4 px-6 bg-white border-b border-[#c8c4d0]">
      {/* 좌: 현재 페이지 브레드크럼 (2026-07-14 상단 공백 활용 A안) */}
      <HeaderTitle />

      <div className="flex items-center gap-2">
        {/* Ctrl+K 전역 팔레트 (소방계획서_5 R0-4) */}
        {showPalette && <CommandPalette />}
        <NotificationBell userId={profile.id} />

        {/* Profile */}
        <div className="flex items-center gap-2 pl-2 ml-1 border-l border-[#c8c4d0]">
          <div className="size-8 rounded-full bg-[#7b68ee]/10 flex items-center justify-center">
            <User className="size-4 text-[#7b68ee]" />
          </div>
          <div className="leading-none">
            <p className="text-sm font-medium text-[#090c1d]">{profile.name}</p>
            <p className="text-[11px] text-[#514b81]">
              {profile.role === 'admin' ? '관리자' : profile.role === 'manager' ? '팀장' : '일반직원'}
            </p>
          </div>
        </div>

        {/* Logout */}
        <form action={logoutAction}>
          <button
            type="submit"
            className="size-9 flex items-center justify-center rounded-lg text-[#514b81] hover:bg-red-50 hover:text-red-500 transition-colors"
            aria-label="로그아웃"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </header>
  )
}
