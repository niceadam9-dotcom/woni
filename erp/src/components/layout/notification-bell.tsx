'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { Notification } from '@/types'

interface NotificationBellProps {
  userId: string
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const ref = useRef<HTMLDivElement>(null)

  const unread = notifications.filter((n) => !n.is_read).length
  const displayed = tab === 'unread' ? notifications.filter((n) => !n.is_read) : notifications

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (data) setNotifications(data as Notification[])
    }

    load()

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        (payload) => {
          const next = payload.new as Notification
          setNotifications((prev) => (prev.some((n) => n.id === next.id) ? prev : [next, ...prev]))
        }
      )

    // ⚠ 세션 로드 후 조인 (use-sheet-responses-realtime S5-7 실측과 동일): 마운트 직후 바로
    // subscribe하면 소켓에 access_token이 안 실려 anon으로 붙고, notifications RLS가
    // authenticated 한정이라 조인은 성공하는데 이벤트가 0건이다. 지금까지 벨 실시간 수신이
    // 페이지에 따라 되다 말다 한 원인 — 같은 소켓을 쓰는 다른 구독이 setAuth를 먼저 불러줄
    // 때만 우연히 동작했다.
    let disposed = false
    supabase.auth.getSession()
      .then(({ data }) => {
        if (disposed) return
        supabase.realtime.setAuth(data.session?.access_token ?? null)
        channel.subscribe()
      })
      .catch(() => { if (!disposed) channel.subscribe() })

    return () => { disposed = true; supabase.removeChannel(channel) }
  }, [userId])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function markAllRead() {
    const supabase = createClient()
    await supabase
      .from('notifications')
      .update({ is_read: true } as Record<string, unknown>)
      .eq('recipient_id', userId)
      .eq('is_read', false)

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative size-9 flex items-center justify-center rounded-lg text-ink-sub hover:bg-paper hover:text-brand transition-colors"
        aria-label="알림"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 size-4 flex items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-surface rounded-xl shadow-[0_8px_32px_rgba(123,104,238,0.12)] border border-line z-50 overflow-hidden">
          {/* 헤더 */}
          <div className="px-4 pt-4 pb-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-ink">나의 알림</span>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-brand hover:underline"
                >
                  모두 읽음
                </button>
              )}
            </div>

            {/* 탭 */}
            <div className="flex gap-1 border-b border-brand-line-soft">
              <button
                onClick={() => setTab('all')}
                className={cn(
                  'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                  tab === 'all'
                    ? 'border-brand text-brand'
                    : 'border-transparent text-ink-sub hover:text-brand'
                )}
              >
                전체
              </button>
              <button
                onClick={() => setTab('unread')}
                className={cn(
                  'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
                  tab === 'unread'
                    ? 'border-brand text-brand'
                    : 'border-transparent text-ink-sub hover:text-brand'
                )}
              >
                읽지않은 알림
                {unread > 0 && (
                  <span className="inline-flex items-center justify-center size-4 rounded-full bg-brand text-[10px] font-bold text-white leading-none">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 목록 */}
          <div className="max-h-72 overflow-y-auto divide-y divide-brand-line-soft">
            {displayed.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-faint">
                {tab === 'unread' ? '읽지않은 알림이 없습니다' : '알림이 없습니다'}
              </p>
            ) : (
              displayed.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'px-4 py-3',
                    !n.is_read && 'bg-brand-tint'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && (
                      <span className="mt-1.5 size-1.5 rounded-full bg-brand shrink-0" />
                    )}
                    <div className={cn('min-w-0', !n.is_read ? '' : 'pl-3.5')}>
                      <p className="text-sm font-medium text-ink truncate">{n.title}</p>
                      <p className="text-xs text-ink-sub mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[11px] text-ink-faint mt-1">
                        {new Date(n.created_at).toLocaleString('ko-KR', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
