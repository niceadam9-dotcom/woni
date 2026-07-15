/** 소방계획서 7차 — 공통 수기 프리셋 (건물 유형별, 2026-07-15)
 *  표준양식에 미리 채워진 예시 수기 문구(양식 기본값)를 유형별 문구로 치환한다.
 *  저장: fire-plans 버킷 `_presets/{유형}.json` — 워커(make-fireplan.py)가 생성 시 다운로드·적용.
 *  우선순위: 고객 필드 > 프리셋 > 양식 기본값 (value가 비어 있거나 find와 같으면 양식 기본값 유지) */

export const PRESET_TYPES = ['주택형', '상가형', '공장형'] as const
export type PresetType = (typeof PRESET_TYPES)[number]

/** 스토리지 객체 키 — Supabase Storage는 한글 키를 거부(InvalidKey)하므로 ASCII 매핑 사용 */
export const PRESET_FILE_KEYS: Record<PresetType, string> = {
  주택형: 'house',
  상가형: 'retail',
  공장형: 'factory',
}

export type PresetEntry = {
  /** 양식 내 위치 (표시용) */
  section: string
  /** 항목명 (표시용) */
  title: string
  /** 양식 기본값 — 이 문구를 찾아 value로 치환 (앵커) */
  find: string
  /** 프리셋 문구 — 비우면 양식 기본값 유지 */
  value: string
}

export type FirePlanPreset = {
  type: PresetType
  description: string
  entries: PresetEntry[]
  updatedAt?: string
  updatedBy?: string
}

/** 건물 용도 → 프리셋 유형 자동 추천 */
export function recommendPresetType(purpose: string | null | undefined): PresetType {
  const p = (purpose ?? '').trim()
  if (/주택|아파트|빌라|연립|다세대|기숙사|주거/.test(p)) return '주택형'
  if (/공장|창고|위험물|제조|물류/.test(p)) return '공장형'
  return '상가형'
}

/** 공통 앵커 — 표준양식(25년 이후 소방계획서 양식.hwp)의 예시 수기 문구.
 *  양식이 바뀌어 앵커가 없으면 해당 항목만 조용히 건너뛴다(fail-soft). */
const ANCHORS: Array<Pick<PresetEntry, 'section' | 'title' | 'find'>> = [
  { section: '서식 1.11.3 훈련 시나리오', title: '훈련상황', find: '2층 주방 초기화재' },
  { section: '서식 1.11.3 훈련 시나리오', title: '화재발생 인지', find: '1. 2층 세대에서 연기발생' },
  { section: '서식 1.11.3 훈련 시나리오', title: '화재전파·신고', find: '1. 2층에서 화재발생 구두로 각 세대 전파' },
  { section: '서식 1.11.3 훈련 시나리오', title: '초기소화(훈련)', find: '소화기를 이용하여 화재진압 실시' },
  { section: '서식 1.11.3 훈련 시나리오', title: '피난 확인', find: '자위소방대 피난유도팀은 피난이 안된 세대 확인 후 소방서 도착시 통보' },
  { section: '서식 1.11 안내방송', title: '안내방송 문구', find: '1층 화재 발생 (최대한 빨리 집결 요함)' },
  { section: '서식 3.4 피난유도 절차', title: '비화재보 대응', find: '피난 실시 및 1층 주차장 대기 후 오동작 각 세대 전파' },
  { section: '서식 3.4 피난경로', title: '피난경로', find: '각 세대 출입구 앞 직통계단 이용' },
  { section: '서식 3.4 집결지', title: '집결지', find: '1층 주차장' },
  { section: '서식 2.9 초기소화 개요', title: '초기소화방법(지상·지하)', find: '소화기를 이용하여 초기 진압 실시' },
  { section: '서식 2.9 초기소화 개요', title: '가스시설 조치', find: '가스공급 밸브 차단' },
  { section: '피난·대피 방법', title: '대피방법', find: '2층 화재 초기에 1층 출입문으로 대피 및 피난 늦은 자는 옥상으로 대피' },
]

function preset(type: PresetType, description: string, values: string[]): FirePlanPreset {
  return { type, description, entries: ANCHORS.map((a, i) => ({ ...a, value: values[i] ?? a.find })) }
}

/** 기본 프리셋 — 관리 UI 최초 진입·기본값 복원, 요청 시 파일 시딩에 사용 */
export const DEFAULT_PRESETS: FirePlanPreset[] = [
  // 주택형: 표준양식 예시가 이미 주택(세대) 기준 → 양식 기본값 유지
  preset('주택형', '공동주택·아파트·빌라 등 주거시설 (양식 기본값 기준)', [
    '2층 주방 초기화재',
    '1. 2층 세대에서 연기발생',
    '1. 2층에서 화재발생 구두로 각 세대 전파',
    '소화기를 이용하여 화재진압 실시',
    '자위소방대 피난유도팀은 피난이 안된 세대 확인 후 소방서 도착시 통보',
    '1층 화재 발생 (최대한 빨리 집결 요함)',
    '피난 실시 및 1층 주차장 대기 후 오동작 각 세대 전파',
    '각 세대 출입구 앞 직통계단 이용',
    '1층 주차장',
    '소화기를 이용하여 초기 진압 실시',
    '가스공급 밸브 차단',
    '2층 화재 초기에 1층 출입문으로 대피 및 피난 늦은 자는 옥상으로 대피',
  ]),
  preset('상가형', '근린생활·판매·업무·숙박 등 상업시설', [
    '2층 매장 초기화재',
    '1. 2층 매장에서 연기발생',
    '1. 2층에서 화재발생 구두 및 방송으로 각 매장 전파',
    '소화기를 이용하여 화재진압 실시',
    '자위소방대 피난유도팀은 피난이 안된 매장·사무실 확인 후 소방서 도착시 통보',
    '1층 화재 발생 (영업을 중단하고 최대한 빨리 집결 요함)',
    '피난 실시 및 건물 앞 주차장 대기 후 오동작 각 매장 전파',
    '각 매장 주 출입구 및 직통계단 이용',
    '건물 앞 주차장',
    '소화기 및 옥내소화전을 이용하여 초기 진압 실시',
    '가스공급 밸브 차단',
    '2층 화재 초기에 1층 주 출입구로 대피 및 피난 늦은 자는 옥상으로 대피',
  ]),
  preset('공장형', '공장·창고·위험물 저장시설', [
    '생산동 작업장 초기화재',
    '1. 작업장에서 연기발생',
    '1. 작업장 화재발생 구두 및 방송으로 전 구역 전파',
    '소화기를 이용하여 화재진압 실시 및 전원·가스 차단',
    '자위소방대 피난유도팀은 작업장·창고 잔류 인원 확인 후 소방서 도착시 통보',
    '작업장 화재 발생 (설비 정지 후 최대한 빨리 집결 요함)',
    '피난 실시 및 정문 앞 공터 대기 후 오동작 각 작업장 전파',
    '작업장 비상구 및 직통계단 이용',
    '정문 앞 공터',
    '소화기 및 옥내소화전을 이용하여 초기 진압 실시, 위험물은 안전거리 확보',
    '가스·위험물 공급 밸브 차단 및 전원 차단',
    '화재 초기에 작업장 비상구로 대피 및 피난 늦은 자는 외부 공터로 대피',
  ]),
]

export function defaultPreset(type: PresetType): FirePlanPreset {
  return DEFAULT_PRESETS.find(p => p.type === type)!
}
