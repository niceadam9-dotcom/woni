/** 소방계획서 준비율 — 5·6차 연계 필드 입력 여부 체크 (설계 §5)
 *  고객 상세 계획서 정보 패널·생성 페이지 사전 체크·워커 누락 안내가 같은 어휘를 쓴다. */

export type FirePlanReadinessData = {
  receiverLocation: string
  structure: string
  roof: string
  managerSelectedAt: string
  grade: string
  insuranceJoined: boolean | null
  opHoursWeekday: string
  hasHeadcount: boolean
  hasBrigade: boolean
}

export type FirePlanReadiness = { done: number; total: number; missing: string[] }

/** 누락 칩 라벨 → 패널 입력칸 앵커 id (칩 클릭 시 스크롤·포커스, 설계 §5-1) */
export const READINESS_TARGET_IDS: Record<string, string> = {
  '수신기위치': 'fp-receiver', '구조': 'fp-structure', '지붕': 'fp-roof',
  '선임일': 'fp-manager-date', '급수': 'fp-grade', '화재보험': 'fp-insurance',
  '운영시간': 'fp-ophours', '인원': 'fp-headcount', '자위소방대': 'fp-brigade',
}

export function computeFirePlanReadiness(d: FirePlanReadinessData): FirePlanReadiness {
  const checks: Array<[string, boolean]> = [
    ['수신기위치', !!d.receiverLocation.trim()],
    ['구조', !!d.structure.trim()],
    ['지붕', !!d.roof.trim()],
    ['선임일', !!d.managerSelectedAt],
    ['급수', !!d.grade],
    ['화재보험', d.insuranceJoined !== null],
    ['운영시간', !!d.opHoursWeekday],
    ['인원', d.hasHeadcount],
    ['자위소방대', d.hasBrigade],
  ]
  return {
    done: checks.filter(c => c[1]).length,
    total: checks.length,
    missing: checks.filter(c => !c[1]).map(c => c[0]),
  }
}
