import { pickFirePlanManager } from '@/lib/fire-plan-template'
import type { ManagerRow } from '@/components/customers/plan-form17'

/** 소방안전관리자(주 선임자) 해석 — 별지 9호·10·11호·외관점검표·표지/공문/위임장 **공용 1곳**.
 *
 *  종전엔 네 곳이 각자 같은 규칙을 되풀이했고, 전부 같은 한계를 안고 있었다:
 *  성명은 서식 1.7(sections.managers)에서 오는데 **1.7에는 전화 열이 없어서**, "선임자 이름이
 *  대표와 같을 때만 대표 전화를 쓴다"로 우회했다(타인 전화 오기재 방지). 선임자가 대표와 다른
 *  사람이면 별지 9호 2쪽 전화번호가 영원히 공란이었다.
 *
 *  145부터는 **관계인 중 한 명을 지목**(customers.manager_contact_id)한다 — 성명·전화가 그 사람에게서
 *  같이 오므로 한계가 사라진다. 지목이 없으면 종전 규칙(1.7 → 대표)을 그대로 탄다(기존 데이터 무변동).
 *
 *  전화는 **가공하지 않고** 원본을 돌려준다 — 표기(formatTel)는 문서마다 호출부에서 한다. */

export type ContactLite = { id: string; role: string; name: string; phone: string | null; position?: string | null }

export type FireSafetyManager = {
  name: string
  /** 원본 전화 (미포맷). 채울 근거가 없으면 '' */
  phone: string
  /** 직위 — 지목이면 관계인 직위, 1.7이면 그 행의 구분(관리자/보조자). 단정할 근거가 없으면 '' */
  title: string
  /** 어디서 왔는지 — 진단·프로브용 */
  source: 'contact' | 'form17' | 'owner' | 'none'
}

export function resolveFireSafetyManager(i: {
  contacts: ContactLite[]
  /** 145 — 소방안전관리자로 지목된 관계인 id */
  managerContactId?: string | null
  /** 서식 1.7 선임현황 (지목이 없을 때의 폴백) */
  managers?: ManagerRow[] | null
}): FireSafetyManager {
  const owner = i.contacts.find(c => c.role === '대표') ?? i.contacts[0] ?? null

  // ① 지목된 관계인 — 전화까지 같이 온다
  if (i.managerContactId) {
    const hit = i.contacts.find(c => c.id === i.managerContactId)
    if (hit?.name?.trim()) return { name: hit.name, phone: hit.phone ?? '', title: hit.position ?? '', source: 'contact' }
    // 지목했는데 그 관계인이 지워졌다면 폴백으로 내려간다 (포인터는 ON DELETE SET NULL이지만
    // 조회 시점 차이로 남아 있을 수 있다 — 이름 없는 사람을 문서에 싣지는 않는다)
  }

  // ② 서식 1.7 선임현황 1순위 — 1.7엔 전화 열이 없어 대표와 동일인일 때만 대표 전화
  const row = pickFirePlanManager(i.managers ?? null)
  if (row?.name?.trim()) {
    const same = row.name === (owner?.name ?? '')
    return { name: row.name, phone: same ? (owner?.phone ?? '') : '', title: row.role ?? '', source: 'form17' }
  }

  // ③ 관계인 대표 폴백 — 대표라는 사실만으로 '소방안전관리자 직위'를 단정하지 않는다(EX-3 규약)
  if (owner?.name?.trim()) return { name: owner.name, phone: owner.phone ?? '', title: '', source: 'owner' }
  return { name: '', phone: '', title: '', source: 'none' }
}
