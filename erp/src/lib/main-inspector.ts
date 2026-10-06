import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/** 주된 점검인력 — **배정과 무관하게 회사 대표자(김흥준)가 기본** (2026-10-06 사용자 지시).
 *
 *  사용자: 「배정은 내부 관리 목적이고, 보고서 엑셀 > 보고서 주된 점검인력은 김흥준이 default」.
 *  자격증이 있는 사람이 대표뿐이라, 배정(담당 직원 — 일반관리 계정 포함)은 서류에 나가면 안 된다.
 *
 *  고르는 순서(한 곳에서만 정한다 — 보고서·위임장·점검 상세·B5 실적이 같은 사람을 말해야 한다):
 *   1. 참여자 '주된' 행(마이그 181 트리거가 점검 생성 때 대표자를 넣는다 · 사람이 바꾼 값)
 *   2. 회사 대표자 — `representative_profile_id()`(181, company_profile.representative와 이름이 같은
 *      활성 직원이 정확히 1명). 181이 건너뛴 점검(대표자가 이미 보조였던 경우 등)도 대표자가 된다
 *   3. 배정(담당 직원) — 대표자를 못 정할 때(이름 불일치·동명이인)만의 마지막 폴백
 *  종전엔 2가 없어 '주된' 행이 없으면 곧장 배정으로 떨어졌고, 점검 상세는 아예 배정만 읽어
 *  「주된: 일반관리」로 보였다. */

/** 회사 대표자의 직원 id — 181 SQL 함수 한 벌을 그대로 부른다(같은 판정을 TS로 다시 짜면 갈라진다) */
export async function representativeProfileId(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.rpc('representative_profile_id')
  if (error) {
    console.warn('[main-inspector] representative_profile_id 호출 실패 — 배정 폴백', error.message)
    return null
  }
  return (data as string | null) ?? null
}

type PartLite = { employee_id: string | null; role: string; sort_order?: number | null }

/** 순서 1→2→3으로 주된 점검인력 id를 고른다(순수 함수) */
export function pickMainInspectorId(parts: PartLite[], repId: string | null, assignedId: string | null): string | null {
  const main = parts.filter(p => p.role === '주된' && p.employee_id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.employee_id
  return main ?? repId ?? assignedId ?? null
}
