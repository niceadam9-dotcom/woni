'use client'

import { useEffect, useId, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/** 점검표 응답 실시간 구독 (소방계획서_16 S5 — D-3 양방향 신선도).
 *
 *  - 재구독 deps는 ids.join(',') — 배열 아이덴티티가 아니라 내용 변경에만 반응 (S5-2)
 *  - 600ms 트레일링 디바운스: [전체 양호]가 수백 행을 한 번에 넣어도 콜백은 1회 (S5-3)
 *  - 에코 억제: payload.new.updated_by === 내 uid 면 무시 — 내 저장은 화면이 이미 반영했다 (S5-4)
 *    (DELETE·백필처럼 updated_by가 없는 이벤트는 원격 변경으로 취급)
 *  - 폴백: 구독이 CHANNEL_ERROR/TIMED_OUT/CLOSED 로 끝나면 focus·visibilitychange 갱신으로 전환 (S5-6)
 *    — publication 미등록·Realtime 서비스 OFF 환경에서도 종전(재진입 시 갱신) 수준은 유지된다
 *
 *  덮어쓰기 정책은 호출부 소유 — 이 훅은 "어느 점검 건에 원격 변경이 있었다"만 알린다.
 *  편집 중(dirty) 자동 갱신 금지·[최신 불러오기] 배너(S5-5)는 호출부가 콜백 안에서 판단한다. */
export function useSheetResponsesRealtime(
  inspectionIds: Array<string | null | undefined>,
  onRemoteChange: (inspectionId: string) => void,
) {
  // 콜백은 ref로 — 최신 클로저를 쓰되 재구독은 id 목록 변경 시에만
  const cbRef = useRef(onRemoteChange)
  cbRef.current = onRemoteChange
  // 같은 점검 건을 트리·점검 상세가 동시에 구독해도 topic이 겹치지 않게 (채널명은 클라이언트 전역)
  const uid = useId()
  const key = inspectionIds.filter(Boolean).join(',')

  useEffect(() => {
    if (!key) return
    const ids = key.split(',')
    const supabase = createClient()
    let disposed = false
    let selfId: string | null = null
    supabase.auth.getUser().then(({ data }) => { selfId = data.user?.id ?? null }).catch(() => {})

    // 디바운스는 점검 건별 — 서로 다른 건의 이벤트가 상대 타이머를 밀지 않는다
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const fire = (id: string) => {
      const prev = timers.get(id)
      if (prev) clearTimeout(prev)
      timers.set(id, setTimeout(() => { if (!disposed) cbRef.current(id) }, 600))
    }
    const onWake = () => { if (!document.hidden) ids.forEach(fire) }

    let fallback = false
    const channel = supabase.channel(`sheet-responses:${uid}`)
    for (const id of ids) {
      channel.on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'inspection_sheet_responses', filter: `inspection_id=eq.${id}` },
        payload => {
          const by = (payload.new as { updated_by?: string | null } | null)?.updated_by
          if (by && selfId && by === selfId) return
          fire(id)
        })
      channel.on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'inspection_sheet_responses', filter: `inspection_id=eq.${id}` },
        payload => {
          const by = (payload.new as { updated_by?: string | null } | null)?.updated_by
          if (by && selfId && by === selfId) return
          fire(id)
        })
    }
    // DELETE 제약(2026-08-10 스모크 실측): filter를 걸면 아예 안 오고, 무필터라도 old에는
    // PK(id)만 실린다(REPLICA IDENTITY FULL이어도) — inspection_id 매칭이 불가능하다.
    // 삭제는 드문 이벤트(점검표 삭제·정리)이고 갱신은 멱등·저비용이므로, 수신 시 구독 중인
    // 건 전체를 갱신한다 (다른 건의 삭제로 과잉 갱신될 수 있으나 읽기 재조회뿐이라 무해)
    channel.on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'inspection_sheet_responses' },
      () => { ids.forEach(fire) })
    channel.subscribe(status => {
      if (disposed || fallback) return
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        fallback = true
        window.addEventListener('focus', onWake)
        document.addEventListener('visibilitychange', onWake)
      }
    })

    return () => {
      disposed = true
      for (const t of timers.values()) clearTimeout(t)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
      supabase.removeChannel(channel)
    }
  }, [key, uid])
}
