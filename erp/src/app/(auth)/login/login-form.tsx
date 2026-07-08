'use client'

import { useActionState } from 'react'
import { loginAction } from './actions'
import { Button } from '@/components/ui/button'

const initialState: { error: string } = { error: '' }

interface LoginFormProps {
  /** 회사 정보(company_profile)의 업체명 — 미설정 시 기본 브랜드명 */
  companyName: string
  /** 회사 정보의 로고 URL — 있으면 기본 아이콘 대신 표시 */
  logoUrl: string | null
}

export function LoginForm({ companyName, logoUrl }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState as { error: string } | undefined)

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 mb-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={companyName} className="size-8 rounded-lg object-contain shrink-0" />
          ) : (
            <div className="size-8 rounded-lg bg-[#7b68ee] flex items-center justify-center">
              <svg className="size-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M4 6h16M4 18h16" />
              </svg>
            </div>
          )}
          <span className="text-xl font-bold text-[#090c1d]">{companyName}</span>
        </div>
        <p className="text-sm text-[#514b81]">업무 계정으로 로그인하세요</p>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(123,104,238,0.08)] border border-[#c8c4d0] p-8">
        <h1 className="text-lg font-semibold text-[#090c1d] mb-6">로그인</h1>

        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-[#292d34]">
              이메일
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="name@company.com"
              className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] placeholder:text-[#b0acd6] outline-none transition focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-[#292d34]">
              비밀번호
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] placeholder:text-[#b0acd6] outline-none transition focus:border-[#7b68ee] focus:ring-3 focus:ring-[#7b68ee]/20"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {state?.error}
            </p>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-10 bg-[#7b68ee] hover:bg-[#6647f0] text-white font-medium rounded-lg transition-colors"
          >
            {isPending ? '로그인 중...' : '로그인'}
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-[#514b81]">
        계정 문의는 관리자에게 연락하세요
      </p>
    </div>
  )
}
