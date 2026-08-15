/** 원클릭 번들 상태 타입·판정 (소방계획서_22 S13 — Q-13, 2026-08-14 사용자 확정)
 *
 *  번들 구성요소가 6~7종(공문·표지·별지9·4·10·11·외관)으로 늘면서 종류별 개별 생성은
 *  클릭 수와 stale 혼입(점검표 고친 뒤 별지4만 재생성, 표지·공문은 옛 날짜)을 함께 늘린다.
 *  [번들 생성] 1버튼이 미생성·stale을 자동 판정해 병렬 생성 후 병합 라우트로 넘긴다.
 *
 *  ⚠ 타입은 여기(일반 lib)에 둔다 — 'use server' 파일의 타입 재노출은 API 라우트 404를 만든
 *  전례가 있다(소방계획서_18 교훈). bundle-actions.ts는 async 함수만 export 한다. */

import type { AnnexType } from '@/app/(dashboard)/inspections/report9-actions'

export type BundleItemStatus = {
  type: AnnexType
  label: string
  /** 최신 생성물 시각(ISO) — 파일명 스탬프 기준. null = 미생성 */
  generatedAt: string | null
  /** 재생성 대상인가 — 미생성이거나 generatedAt < dataMaxAt (S13-1) */
  stale: boolean
  /** '미생성' | 'stale' | null(최신) — UI 뱃지 문구 축 */
  reason: '미생성' | 'stale' | null
}

export type BundleBlankRow = { sheetName: string; blank: number; total: number }

export type BundleChecklist = {
  items: BundleItemStatus[]
  /** 관련 데이터(점검표 응답·불량·서식 고유 값·펌프성능시험)의 최신 수정 시각 */
  dataMaxAt: string | null
  /** 생성 전 사전 리포트(S13-3) — 시트별 공란(미점검) 수. 경고만, 차단 아님 */
  blanks: BundleBlankRow[]
  /** S15(Q-12) — 과거 건 재생성 차단이면 번들 생성 자체가 불가 */
  regenBlocked: boolean
}

export type BundleGenResult = { type: AnnexType; label: string; ok: boolean; error?: string }

/** stale 판정(S13-1) — 생성물이 없거나, 관련 데이터가 생성 이후에 바뀌었으면 재생성 대상 */
export function judgeStale(generatedAt: string | null, dataMaxAt: string | null): { stale: boolean; reason: '미생성' | 'stale' | null } {
  if (!generatedAt) return { stale: true, reason: '미생성' }
  if (dataMaxAt && generatedAt < dataMaxAt) return { stale: true, reason: 'stale' }
  return { stale: false, reason: null }
}
