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
      .channel('notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
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
        className="relative size-9 flex items-center justify-center rounded-lg text-[#514b81] hover:bg-[#f8f9fa] hover:text-[#7b68ee] transition-colors"
        aria-label="알림"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 size-4 flex items-center justify-center rounded-full bg-[#7b68ee] text-[10px] font-bold text-white leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white rounded-xl shadow-[0_8px_32px_rgba(123,104,238,0.12)] border border-[#c8c4d0] z-50 overflow-hidden">
          {/* 헤더 */}
          <div className="px-4 pt-4 pb-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-[#090c1d]">나의 알림</span>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-[#7b68ee] hover:underline"
                >
                  모두 읽음
                </button>
              )}
            </div>

            {/* 탭 */}
            <div className="flex gap-1 border-b border-[#e0ddf5]">
              <button
                onClick={() => setTab('all')}
                className={cn(
                  'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                  tab === 'all'
                    ? 'border-[#7b68ee] text-[#7b68ee]'
                    : 'border-transparent text-[#514b81] hover:text-[#7b68ee]'
                )}
              >
                전체
              </button>
              <button
                onClick={() => setTab('unread')}
                className={cn(
                  'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
                  tab === 'unread'
                    ? 'border-[#7b68ee] text-[#7b68ee]'
                    : 'border-transparent text-[#514b81] hover:text-[#7b68ee]'
                )}
              >
                읽지않은 알림
                {unread > 0 && (
                  <span className="inline-flex items-center justify-center size-4 rounded-full bg-[#7b68ee] text-[10px] font-bold text-white leading-none">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 목록 */}
          <div className="max-h-72 overflow-y-auto divide-y divide-[#e0ddf5]">
            {displayed.length === 0 ? (
              <p className="py-8 text-center text-sm text-[#b0acd6]">
                {tab === 'unread' ? '읽지않은 알림이 없습니다' : '알림이 없습니다'}
              </p>
            ) : (
              displayed.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'px-4 py-3',
                    !n.is_read && 'bg-[#faf9ff]'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && (
                      <span className="mt-1.5 size-1.5 rounded-full bg-[#7b68ee] shrink-0" />
                    )}
                    <div className={cn('min-w-0', !n.is_read ? '' : 'pl-3.5')}>
                      <p className="text-sm font-medium text-[#090c1d] truncate">{n.title}</p>
                      <p className="text-xs text-[#514b81] mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[11px] text-[#b0acd6] mt-1">
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
