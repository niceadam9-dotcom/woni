'use client'

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react'
import { setRepRoleAction } from '@/app/(dashboard)/customers/actions'

/** 대표자 구분(`customers.rep_role`) — **창구는 둘, 값은 하나**를 실제로 하나로 만드는 공유 상태.
 *
 *  ## 왜 생겼나 (2026-09-14 실측 재현)
 *  관계인 탭 한 화면에 이 값을 만지는 곳이 둘이다:
 *   · 관계인 대표 카드의 [구분] 세그먼트 — 클릭 즉시 저장(`setRepRoleAction`)
 *   · 아래 [소방안전관리]의 [대표자 구분] — [저장] 버튼으로 `saveFireSafetyManagerAction`
 *  둘 다 같은 컬럼을 쓰는데 **각자 자기 state를 들고** 있었다. 그래서:
 *   ① 카드에서 「관리자」를 고르면 DB엔 들어가는데
 *   ② 바로 아래 [대표자 구분]은 마운트 때의 낡은 값(빈 칸) 그대로이고
 *   ③ 그 상태로 패널 [저장]을 누르면 **낡은 빈 값이 방금 고른 「관리자」를 덮어썼다**(rep_role=null).
 *  E2E로 ①②③을 그대로 재현했다. 화면에는 아무 경고도 없어서, 사용자는 골랐다고 믿고
 *  문서는 폴백인 「소유자」로 인쇄된다 — `actions.ts:1127`이 적어 둔 「강순건물 사고」와 같은 형태다.
 *
 *  ## 규약
 *  값은 여기서만 산다. 어느 창구에서 눌러도 **클릭이 곧 저장**이고(`setRepRoleAction` 단일 경로),
 *  다른 창구는 같은 state를 보므로 즉시 따라온다. 패널의 [저장]은 이 값을 **더 이상 싣지 않는다**
 *  (`FireSafetyManagerInput`에서 뺐다) — 실을 수 있으면 덮어쓰기가 언제든 되살아난다.
 *
 *  ⚠ 폴백을 두지 않는다. Provider 밖에서 부르면 던진다 — 조용히 빈 값으로 떨어지면
 *    위 ③이 「아무도 못 보는 상태」로 되돌아온다. */
type RepRoleCtx = {
  repRole: string
  /** 같은 값을 다시 누르면 해제(빈 값) — 문서는 종전 폴백('소유자')으로 돌아간다 */
  pick: (value: string) => void
  pending: boolean
  error: string
}

const Ctx = createContext<RepRoleCtx | null>(null)

export function RepRoleProvider({ customerId, initial, children }: {
  customerId: string
  initial: string
  children: ReactNode
}) {
  const [repRole, setRepRole] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function pick(value: string) {
    const prev = repRole
    const next = repRole === value ? '' : value
    setRepRole(next)
    setError('')
    startTransition(async () => {
      const res = await setRepRoleAction(customerId, next)
      if (res.error) { setError(res.error); setRepRole(prev) }   // 실패하면 눈에 보이게 되돌린다
    })
  }

  return <Ctx.Provider value={{ repRole, pick, pending, error }}>{children}</Ctx.Provider>
}

export function useRepRole(): RepRoleCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useRepRole은 RepRoleProvider 안에서만 쓸 수 있습니다')
  return c
}
