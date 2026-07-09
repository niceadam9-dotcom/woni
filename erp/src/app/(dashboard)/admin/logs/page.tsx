import { redirect } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const ACTION_LABELS: Record<string, string> = {
  document_created:   '기안서 작성',
  document_updated:   '기안서 수정',
  document_submitted: '기안서 상신',
  document_recalled:  '기안서 회수',
  document_approved:  '기안서 승인',
  document_rejected:  '기안서 반려',
  leave_applied:      '휴가 신청',
  leave_approved:     '휴가 승인',
  leave_rejected:     '휴가 반려',
  login_success:      '로그인',
  login_failed:       '로그인 실패',
  logout:             '로그아웃',
}

const ACTION_COLOR: Record<string, string> = {
  document_approved: 'bg-green-50 text-green-700',
  document_rejected: 'bg-red-50 text-red-600',
  document_recalled: 'bg-orange-50 text-orange-600',
  document_submitted:'bg-blue-50 text-blue-600',
  leave_approved:    'bg-green-50 text-green-700',
  leave_rejected:    'bg-red-50 text-red-600',
  leave_applied:     'bg-blue-50 text-blue-600',
  login_failed:      'bg-red-50 text-red-600',
}

type LogRow = {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export default async function ActivityLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; actor?: string; per_page?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const actorFilter = params.actor ?? ''
  const pageSize = Math.max(0, parseInt(params.per_page ?? '25', 10))  // 0 = 전체

  const admin = createAdminClient()

  const { data: profilesRaw } = await admin
    .from('profiles')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  const allProfiles = (profilesRaw ?? []) as Array<{ id: string; name: string }>
  const profileMap = new Map(allProfiles.map(p => [p.id, p.name]))

  const from = pageSize > 0 ? (page - 1) * pageSize : 0
  const to = pageSize > 0 ? page * pageSize - 1 : 99999

  let query = admin
    .from('activity_logs')
    .select('id, actor_id, action, entity_type, entity_id, metadata, ip_address, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (actorFilter) {
    query = query.eq('actor_id', actorFilter) as typeof query
  }

  const { data: logsRaw, count } = await query
  const logs = (logsRaw ?? []) as LogRow[]
  const totalPages = pageSize === 0 ? 1 : Math.ceil((count ?? 0) / pageSize)

  function buildUrl(p: number, actor?: string) {
    const q = new URLSearchParams()
    if (pageSize !== 25) q.set('per_page', String(pageSize))
    if (p > 1) q.set('page', String(p))
    if (actor) q.set('actor', actor)
    return `/admin/logs${q.size ? `?${q}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardList className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">활동 로그</h1>
          <p className="text-sm text-[#514b81] mt-0.5">
            전체 직원 활동 내역 조회 — 접속기록은 감사 무결성을 위해 수정·삭제할 수 없으며, 2년 보관 후 매월 자동 아카이브·파기됩니다
          </p>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3">
        <form method="GET" action="/admin/logs" className="flex items-center gap-2">
          <select
            name="actor"
            defaultValue={actorFilter}
            className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition"
          >
            <option value="">전체 직원</option>
            {allProfiles.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            name="per_page"
            defaultValue={String(pageSize)}
            className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
          >
            <option value="25">25건</option>
            <option value="50">50건</option>
            <option value="0">전체</option>
          </select>
          <button
            type="submit"
            className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
          >
            검색
          </button>
          {actorFilter && (
            <a
              href="/admin/logs"
              className="h-9 px-4 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center"
            >
              초기화
            </a>
          )}
        </form>
        {count !== null && (
          <span className="text-xs text-[#514b81] ml-auto">총 {count}건</span>
        )}
      </div>

      {/* 로그 테이블 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {logs.length === 0 ? (
          <div className="py-16 text-center">
            <ClipboardList className="size-10 text-[#c4bff5] mx-auto mb-3" />
            <p className="text-sm text-[#514b81]">활동 로그가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#514b81] w-40">시각</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] w-28">직원</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] w-32">액션</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#514b81]">상세</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] w-32 hidden md:table-cell">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {logs.map(log => {
                  const actionColor = ACTION_COLOR[log.action] ?? 'bg-[#f5f4ff] text-[#514b81]'
                  const actorName = log.actor_id ? (profileMap.get(log.actor_id) ?? '탈퇴 직원') : '시스템'
                  const metaStr = log.metadata
                    ? Object.entries(log.metadata)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(', ')
                    : ''
                  return (
                    <tr key={log.id} className="hover:bg-[#f8f9fa] transition-colors">
                      <td className="px-5 py-3 text-xs text-[#514b81] whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('ko-KR', {
                          month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-[#090c1d]">{actorName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${actionColor}`}>
                          {ACTION_LABELS[log.action] ?? log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#292d34]">
                          {log.entity_type}
                          {metaStr && <span className="text-[#514b81] ml-1">· {metaStr}</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-[#b0acd6]">{log.ip_address ?? '-'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <a
              href={buildUrl(page - 1, actorFilter)}
              className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center"
            >
              이전
            </a>
          )}
          <span className="text-sm text-[#514b81] px-2">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={buildUrl(page + 1, actorFilter)}
              className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center"
            >
              다음
            </a>
          )}
        </div>
      )}
    </div>
  )
}
