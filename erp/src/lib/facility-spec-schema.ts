/** 소방시설 세부현황 필드 카탈로그 — S3A/H-18 (소방계획서_7.md §4-A-1·4-A-2)
 *
 *  기준 서식: **별지 9호 4~7쪽 "3. 소방시설등의 세부 현황"** (별지 4호 3~7쪽과 동일 — 공용 원본).
 *  구조는 `src/lib/doc-templates/report9.ts`의 page4()~page7() 빈 서식 렌더를 1차 기준으로 코드화.
 *  저장: customer_facility_specs.spec JSONB = { [blockKey]: { [fieldKey]: 값 } } (섹션당 1행).
 *
 *  굵기(granularity) 원칙: 서식 원문의 "한 줄 입력점 = 한 필드".
 *  단, 반복 행 표(3-1 동별 수량)·복수 동명 나열 등 표 반복 패턴은 자유 기입 text 1필드로 완화.
 *  반복 패턴(동명·지상/지하·층·실명, 층 범위, 송풍기 제원)은 공용 헬퍼로 생성.
 */

import { EVAC_TYPES } from './facility-codes'

export type SpecFieldType = 'text' | 'number' | 'check' | 'select' | 'multicheck'

export type SpecField = {
  key: string
  label: string
  type: SpecFieldType
  unit?: string          // number 필드 단위 (㎥, m, ℓ/min …)
  options?: string[]     // select·multicheck 선택지 (서식 원문 표기 그대로)

  // ── 중복 입력 제거 표시 (2026-08-08) ─────────────────────────────────────
  // 같은 정보를 1.4 대장·건물 정보와 두 번 받던 필드들을 **원천 한 곳**으로 정리했다.
  // 판정 규칙: 그 구분이 대장 표준 42종에 이미 있으면 대장이 원천, 하위 세분만 있으면 세부제원이 원천.

  /** multicheck 선택지 → fire_facilities.facility_code. 여기 적힌 선택지는 **대장에서 파생**되는
   *  읽기 전용이고 세부제원에 저장하지 않는다. 매핑에 없는 선택지는 종전대로 세부제원 고유 입력이다
   *  (예: 유도등의 피난구·통로·객석유도등은 대장에 없는 세분이라 계속 입력받는다). */
  derivedFrom?: Record<string, string>
  /** buildings 테이블 컬럼에서 파생되는 읽기 전용 number 필드 (건물·시설 탭이 원천) */
  derivedFromBuilding?: string
  /** 저장소는 세부제원이지만 **1.4 대장 하위 체크박스가 같은 값을 읽고 쓴다**(양방향 창구).
   *  대장에서 체크해도 fire_facilities가 아니라 이 필드가 갱신된다 — 피난기구 종류가 유일한 사례. */
  mirrorInLedger?: boolean
  /** 선택지를 1.4에서 설치(√)된 설비로 제한 — 미설치 설비를 고를 수 없게 해 대장과 어긋나지 않게 한다 */
  limitToInstalled?: boolean
}

export type SpecBlock = {
  key: string
  label: string
  /** fire_facilities.facility_code 연동 힌트(src/lib/facility-codes.ts 표준 42종) —
   *  설치(√)된 설비만 펼침용. 복수 설비 공용 블록은 쉼표 구분, 없으면 항상 표시(공통사항). */
  facilityHint?: string
  fields: SpecField[]
}

export type SpecSection = {
  key: string            // s31_extinguisher ~ s38_activity
  no: string             // 서식 절 번호 (3-1 ~ 3-8)
  label: string
  blocks: SpecBlock[]
}

// ── 공용 필드 세트 헬퍼 ──────────────────────────────────────────────────────

const GROUND = ['지상', '지하']

/** 설치장소: 동명( ) 지상/지하 ( )층, 실명( ) — 단일 지점형 */
function locFields(prefix = '', labelPrefix = ''): SpecField[] {
  const p = prefix ? `${prefix}_` : ''
  const l = labelPrefix ? `${labelPrefix} ` : ''
  return [
    { key: `${p}dong`, label: `${l}동명`, type: 'text' },
    { key: `${p}ground`, label: `${l}지상/지하`, type: 'select', options: GROUND },
    { key: `${p}floor`, label: `${l}층`, type: 'text' },
    { key: `${p}room`, label: `${l}실명`, type: 'text' },
  ]
}

/** 설치장소: 동명( ) 전체층/일부층, 지상/지하( )층 ~ 지상/지하( )층 — 층 범위형.
 *  opts.second=true면 둘째 동을 적는 줄까지 만든다(A4-4) — 서식 원문이 미분무·피난기구·
 *  인명구조기구 세 블록에만 설치장소 줄을 2줄로 두었다(현행 개정판 원문 대조, 2026-08-12).
 *  칸이 하나뿐이면 동이 둘 이상인 대상물의 두 번째 동을 적을 자리가 없다. */
function rangeLocFields(opts?: { coverage?: boolean; second?: boolean }): SpecField[] {
  const coverage = opts?.coverage !== false
  const one = (sfx: string, l: string): SpecField[] => [
    { key: `dong${sfx}`, label: `${l}동명`, type: 'text' },
    ...(coverage ? [{ key: `coverage${sfx}`, label: `${l}전체층/일부층`, type: 'select', options: ['전체층', '일부층'] } as SpecField] : []),
    { key: `from_ground${sfx}`, label: `${l}시작 지상/지하`, type: 'select', options: GROUND },
    { key: `from_floor${sfx}`, label: `${l}시작 층`, type: 'text' },
    { key: `to_ground${sfx}`, label: `${l}끝 지상/지하`, type: 'select', options: GROUND },
    { key: `to_floor${sfx}`, label: `${l}끝 층`, type: 'text' },
  ]
  return [...one('', ''), ...(opts?.second ? one('2', '(2행) ') : [])]
}

/** 송풍기 제원: 설치장소(4) + 전동기 ㎾·풍량 ㎥/min·정압 ㎜Aq — 3-8 제연설비 공용 */
function fanFields(prefix: string, labelPrefix: string): SpecField[] {
  return [
    ...locFields(prefix, labelPrefix),
    { key: `${prefix}_motor`, label: `${labelPrefix} 전동기`, type: 'number', unit: '㎾' },
    { key: `${prefix}_airflow`, label: `${labelPrefix} 풍량`, type: 'number', unit: '㎥/min' },
    { key: `${prefix}_pressure`, label: `${labelPrefix} 정압`, type: 'number', unit: '㎜Aq' },
  ]
}

// ── 3-1. 소화기구, 자동소화장치 ─────────────────────────────────────────────

const S31: SpecSection = {
  key: 's31_extinguisher', no: '3-1', label: '소화기구, 자동소화장치',
  blocks: [
    {
      key: 'summary', label: '합계', facilityHint: '소화기구 및 자동소화장치',
      fields: [
        { key: 'types', label: '설치 종류', type: 'multicheck',
          options: ['소화기(분말)', '소화기(기타)', '간이소화용구(투척용)', '간이소화용구(기타)', '자동확산소화기', '자동소화장치'] },
        { key: 'qty_ext_powder', label: '소화기(분말) 수량', type: 'number', unit: '개' },
        { key: 'qty_ext_other', label: '소화기(기타) 수량', type: 'number', unit: '개' },
        { key: 'qty_simple_throw', label: '간이소화용구(투척용) 수량', type: 'number', unit: '개' },
        { key: 'qty_simple_other', label: '간이소화용구(기타) 수량', type: 'number', unit: '개' },
        { key: 'qty_auto_diffuse', label: '자동확산소화기 수량', type: 'number', unit: '개' },
        { key: 'qty_auto_device', label: '자동소화장치 수량', type: 'number', unit: '개' },
        { key: 'note', label: '비고', type: 'text' },
      ],
    },
    {
      // 서식은 동명별 반복 행(최대 5행) — 표 반복 패턴이라 자유 기입으로 완화(파일 머리 주석 참조)
      key: 'by_dong', label: '동별 내역', facilityHint: '소화기구 및 자동소화장치',
      fields: [
        { key: 'rows', label: '동별 수량(동명·구분별 수량 자유 기입, 줄 단위)', type: 'text' },
      ],
    },
  ],
}

// ── 3-2. 수계소화설비(공통사항) ─────────────────────────────────────────────
// 수계 설비(옥내·옥외소화전, 스프링클러류, 물분무·미분무·포)에 공통 — facilityHint 생략(항상 표시)

/** A4-3(소방계획서_19): 서식 원문의 '◦ 설비의 종류' 체크줄 — 주된수원·고가/압력/가압수조·펌프방식 5블록에 있다.
 *  종전엔 스키마·템플릿 모두 이 줄이 없어 **별지4호·9호 세부현황에서 통째로 누락**됐다(공용 원본이라 양쪽 동시).
 *  8종 목록은 송수구(inlet.systems)와 동일 — 현행판(별지9호 placeholder, 법제처) 원문 대조로 확인. */
const WATER_SYSTEM_OPTIONS = [
  '옥내소화전설비', '옥외소화전설비', '스프링클러설비', '간이스프링클러설비',
  '화재조기진압용스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비',
]
const systemsField = () => ([
  { key: 'systems', label: '설비의 종류', type: 'multicheck' as const, limitToInstalled: true, options: WATER_SYSTEM_OPTIONS },
])

const S32: SpecSection = {
  key: 's32_water_common', no: '3-2', label: '수계소화설비(공통사항)',
  blocks: [
    {
      key: 'main_water', label: '수원 — 주된수원',
      fields: [
        ...systemsField(),
        ...locFields(),
        { key: 'intake', label: '흡입방식', type: 'select', options: ['정압', '부압'] },
        { key: 'capacity', label: '유효수량', type: 'number', unit: '㎥' },
      ],
    },
    {
      key: 'aux_water', label: '수원 — 보조수원',
      fields: [
        { key: 'dong', label: '동명', type: 'text' },
        { key: 'room', label: '실명', type: 'text' },
        { key: 'capacity', label: '유효수량', type: 'number', unit: '㎥' },
      ],
    },
    {
      key: 'pump_elevated', label: '가압송수장치 — 고가수조',
      fields: [
        { key: 'used', label: '고가수조 방식', type: 'check' },
        ...systemsField(),
        { key: 'dong', label: '동명', type: 'text' },
        { key: 'room', label: '실명', type: 'text' },
        { key: 'head_drop', label: '유효낙차', type: 'number', unit: 'm' },
      ],
    },
    {
      key: 'pump_pressure', label: '가압송수장치 — 압력수조',
      fields: [
        { key: 'used', label: '압력수조 방식', type: 'check' },
        ...systemsField(),
        ...locFields(),
        { key: 'tank_volume', label: '수조용량', type: 'number', unit: 'ℓ' },
        { key: 'tank_pressure', label: '수조가압압력', type: 'number', unit: 'MPa' },
        { key: 'compressor_capacity', label: '자동식공기압축기 용량', type: 'number', unit: '㎥/min' },
        { key: 'compressor_power', label: '자동식공기압축기 동력', type: 'number', unit: 'Kw' },
      ],
    },
    {
      key: 'pump_pressurized', label: '가압송수장치 — 가압수조',
      fields: [
        { key: 'used', label: '가압수조 방식', type: 'check' },
        ...systemsField(),
        ...locFields(),
        { key: 'tank_volume', label: '수조용량', type: 'number', unit: 'ℓ' },
        { key: 'tank_pressure', label: '수조가압압력', type: 'number', unit: 'MPa' },
        { key: 'gas_type', label: '가압가스의 종류', type: 'select', options: ['공기', '불연성가스'] },
        { key: 'gas_etc', label: '불연성가스 종류', type: 'text' },
      ],
    },
    {
      key: 'pump_type', label: '가압송수장치 — 펌프방식',
      fields: [
        { key: 'used', label: '펌프 방식', type: 'check' },
        ...systemsField(),
        ...locFields(),
        { key: 'main_head', label: '주펌프 전양정', type: 'number', unit: 'm' },
        { key: 'main_flow', label: '주펌프 토출량', type: 'number', unit: 'ℓ/min' },
        { key: 'reserve_head', label: '예비펌프 전양정', type: 'number', unit: 'm' },
        { key: 'reserve_flow', label: '예비펌프 토출량', type: 'number', unit: 'ℓ/min' },
        { key: 'jockey_head', label: '충압펌프 전양정', type: 'number', unit: 'm' },
        { key: 'jockey_flow', label: '충압펌프 토출량', type: 'number', unit: 'ℓ/min' },
        { key: 'priming', label: '물올림장치', type: 'check' },
        { key: 'priming_capacity', label: '물올림장치 유효수량', type: 'number', unit: 'ℓ' },
        { key: 'priming_pipe', label: '물올림장치 급수배관', type: 'number', unit: '㎜' },
        { key: 'starter', label: '기동장치', type: 'multicheck', options: ['기동용수압개폐장치', 'ON/OFF 방식'] },
        { key: 'chamber', label: '압력체임버', type: 'check' },
        { key: 'chamber_capacity', label: '압력체임버 용량', type: 'number', unit: 'ℓ' },
        { key: 'chamber_pressure', label: '압력체임버 사용압력', type: 'number', unit: 'MPa' },
        { key: 'pressure_switch', label: '기동용압력스위치', type: 'select', options: ['부르동관식', '전자식', '그 밖의 것'] },
        { key: 'decompress', label: '감압장치', type: 'check' },
        { key: 'decompress_ground', label: '감압장치 지상/지하', type: 'select', options: GROUND },
        { key: 'decompress_floor', label: '감압장치 층', type: 'text' },
        { key: 'decompress_place', label: '감압장치 설치장소', type: 'text' },
      ],
    },
    {
      key: 'inlet', label: '송수구',
      fields: [
        // 어느 설비용 송수구인지 — 1.4에서 설치(√)한 설비 중에서만 고르게 해 대장과 어긋나지 않게 한다
        { key: 'systems', label: '해당 설비', type: 'multicheck', limitToInstalled: true,
          options: ['옥내소화전설비', '옥외소화전설비', '스프링클러설비', '간이스프링클러설비',
            '화재조기진압용스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비'] },
        { key: 'place', label: '설치장소', type: 'text' },
        { key: 'twin_count', label: '쌍구형 개수', type: 'number', unit: '개' },
        { key: 'single_count', label: '단구형 개수', type: 'number', unit: '개' },
      ],
    },
    {
      key: 'emergency_power', label: '비상전원',
      fields: [
        { key: 'types', label: '비상전원 종류', type: 'multicheck',
          options: ['자가발전설비', '비상전원수전설비', '축전지설비', '전기저장장치'] },
        { key: 'gen_type', label: '자가발전설비 구분', type: 'select',
          options: ['소방전용', '소방부하겸용', '소방전원보존형', '기타'] },
        { key: 'gen_etc', label: '자가발전설비 기타 내용', type: 'text' },
        ...locFields(),
      ],
    },
  ],
}

// ── 3-3. 수계소화설비(개별사항) ─────────────────────────────────────────────

const S33: SpecSection = {
  key: 's33_water_each', no: '3-3', label: '수계소화설비(개별사항)',
  blocks: [
    {
      key: 'indoor_hydrant', label: '옥내소화전', facilityHint: '옥내소화전설비',
      fields: [
        ...rangeLocFields(),
        { key: 'max_count', label: '설치개수가 가장 많은 층의 설치개수', type: 'number', unit: '개' },
      ],
    },
    {
      key: 'outdoor_hydrant', label: '옥외소화전', facilityHint: '옥외소화전설비',
      fields: [{ key: 'count', label: '설치개수', type: 'number', unit: '개' }],
    },
    {
      key: 'sprinkler', label: '스프링클러설비', facilityHint: '스프링클러설비',
      fields: [
        { key: 'type', label: '종류', type: 'select', options: ['습식', '부압식', '준비작동식', '건식', '일제살수식'] },
        ...rangeLocFields(),
      ],
    },
    {
      key: 'simple_sprinkler', label: '간이스프링클러설비', facilityHint: '간이스프링클러설비',
      fields: [
        { key: 'type', label: '종류', type: 'select', options: ['펌프', '캐비닛', '상수도'] },
        ...rangeLocFields(),
      ],
    },
    {
      key: 'early_suppression', label: '화재조기진압용 스프링클러설비', facilityHint: '화재조기진압용 스프링클러설비',
      fields: rangeLocFields(),
    },
    {
      key: 'water_spray', label: '물분무소화설비', facilityHint: '물분무소화설비',
      fields: rangeLocFields(),
    },
    {
      key: 'water_mist', label: '미분무소화설비', facilityHint: '미분무소화설비',
      fields: rangeLocFields({ second: true }),   // 서식 원문 설치장소 2줄 (A4-4)
    },
    {
      key: 'foam', label: '포소화설비', facilityHint: '포소화설비',
      fields: [
        { key: 'system', label: '방출 방식', type: 'multicheck',
          options: ['포워터스프링클러설비', '포헤드설비', '고정포방출설비', '기타'] },
        { key: 'system_etc', label: '방출 방식 기타 내용', type: 'text' },
        { key: 'agent', label: '소화약제', type: 'multicheck',
          options: ['단백포', '합성계면활성제포', '수성막포', '내알코올포'] },
        ...rangeLocFields(),
      ],
    },
  ],
}

// ── 3-4. 가스계소화설비(개별사항) ───────────────────────────────────────────
// 서식은 6종 설비가 라벨 체크 + 공용 세부 1칸 — 블록 1개로 유지(설비 종류는 system multicheck)

const S34: SpecSection = {
  key: 's34_gas', no: '3-4', label: '가스계소화설비(개별사항)',
  blocks: [
    {
      key: 'gas_system', label: '가스계 소화설비',
      facilityHint: '이산화탄소소화설비,할론소화설비,할로겐화합물 및 불활성기체소화설비,분말소화설비,강화액소화설비,고체에어로졸소화설비',
      fields: [
        // 대장 표준 42종에 6종이 그대로 있다 → 대장이 원천, 여기는 읽기 전용 파생.
        // 종전엔 대장(1.4 표·별지 9호 3쪽)과 여기(별지 9호 5쪽)가 따로 입력돼 한 문서 안에서 어긋날 수 있었다.
        { key: 'system', label: '설비 종류', type: 'multicheck',
          options: ['이산화탄소', '할론', '할로겐화합물 및 불활성기체', '분말', '강화액', '고체에어로졸'],
          derivedFrom: {
            '이산화탄소': '이산화탄소소화설비',
            '할론': '할론소화설비',
            '할로겐화합물 및 불활성기체': '할로겐화합물 및 불활성기체소화설비',
            '분말': '분말소화설비',
            '강화액': '강화액소화설비',
            '고체에어로졸': '고체에어로졸소화설비',
          } },
        { key: 'discharge', label: '방출 방식', type: 'multicheck', options: ['전역방출', '국소방출', '호스릴'] },
        { key: 'pressure_class', label: '고압/저압', type: 'select', options: ['고압식', '저압식'] },
        { key: 'charge_type', label: '축압/가압', type: 'select', options: ['축압식', '가압식'] },
        ...rangeLocFields(),
        { key: 'storage_ground', label: '저장용기 지상/지하', type: 'select', options: GROUND },
        { key: 'storage_floor', label: '저장용기 층', type: 'text' },
        { key: 'storage_room', label: '저장용기 설치실', type: 'select', options: ['전용실', '기타'] },
        { key: 'storage_room_etc', label: '저장용기 설치실 기타 내용', type: 'text' },
        { key: 'qty_amount', label: '저장 수량', type: 'number' },
        { key: 'qty_unit', label: '저장 수량 단위', type: 'select', options: ['㎏', '㎥'] },
        { key: 'qty_liter', label: '저장 용량', type: 'number', unit: 'ℓ' },
        { key: 'qty_count', label: '저장용기 수', type: 'number', unit: '개' },
        { key: 'agent', label: '소화약제', type: 'multicheck',
          options: ['이산화탄소', '할론1301', '할론2402', '할론1211', '할론104',
            'FC-3-1-10', 'HCFC BLEND A', 'HCFC-124', 'HFC-125', 'HFC-227ea',
            'HFC-23', 'IG-541', 'IG-100', '기타',
            '제1종분말', '제2종분말', '제3종분말', '제4종분말'] },
        { key: 'agent_etc', label: '소화약제 기타 내용', type: 'text' },
      ],
    },
  ],
}

// ── 3-5. 경보설비 ───────────────────────────────────────────────────────────

/** 자동화재탐지설비·화재알림설비 공용 필드 세트 (수신기·경보방식·감지기 동일 구성) */
function detectionFields(): SpecField[] {
  return [
    ...locFields('receiver', '수신기'),
    { key: 'alarm_mode', label: '경보방식', type: 'select', options: ['전층경보', '우선경보'] },
    { key: 'visual_alarm', label: '시각경보기', type: 'select', options: ['유', '무'] },
    ...rangeLocFields(),
    { key: 'detector', label: '감지기종류', type: 'multicheck', options: ['열', '연기', '불꽃', '아날로그식', '복합형'] },
  ]
}

const S35: SpecSection = {
  key: 's35_alarm', no: '3-5', label: '경보설비',
  blocks: [
    {
      key: 'standalone_detector', label: '단독경보형 감지기', facilityHint: '단독경보형감지기',
      fields: [
        ...rangeLocFields(),
        { key: 'power', label: '주전원', type: 'select', options: ['상용전원', '건전지'] },
      ],
    },
    {
      key: 'emergency_bell', label: '비상경보설비', facilityHint: '비상경보설비',
      fields: [
        { key: 'type', label: '설비 종류', type: 'multicheck', options: ['비상벨설비', '자동식사이렌설비'] },
        ...rangeLocFields(),
        ...locFields('panel', '조작장치'),
      ],
    },
    { key: 'fire_detection', label: '자동화재탐지설비', facilityHint: '자동화재탐지설비 및 시각경보기', fields: detectionFields() },
    { key: 'fire_alert', label: '화재알림설비', facilityHint: '화재알림설비', fields: detectionFields() },
    {
      key: 'broadcast', label: '비상방송설비', facilityHint: '비상방송설비',
      fields: [
        { key: 'usage', label: '전용/겸용', type: 'select', options: ['전용', '겸용'] },
        { key: 'alarm_mode', label: '경보방식', type: 'select', options: ['전층경보', '우선경보'] },
        ...locFields('amp', '증폭기'),
      ],
    },
    {
      key: 'integrated_monitor', label: '통합감시시설', facilityHint: '통합감시시설',
      fields: [
        ...locFields('main', '주수신기'),
        ...locFields('sub', '부수신기'),
        { key: 'network', label: '정보통신망', type: 'select', options: ['광케이블', '기타'] },
        { key: 'network_etc', label: '정보통신망 기타 내용', type: 'text' },
        { key: 'spare_line', label: '예비선로', type: 'select', options: ['유', '무'] },
      ],
    },
    {
      key: 'auto_report', label: '자동화재속보설비', facilityHint: '자동화재속보설비',
      fields: locFields('reporter', '속보기'),
    },
    {
      key: 'leakage_alarm', label: '누전경보기', facilityHint: '누전경보기',
      fields: [
        ...locFields('receiver', '수신기'),
        { key: 'grade', label: '수신기 형식', type: 'select', options: ['1급', '2급'] },
        { key: 'breaker', label: '차단기구', type: 'select', options: ['유', '무'] },
        { key: 'breaker_place', label: '차단기구 설치장소', type: 'text' },
      ],
    },
    {
      key: 'gas_leak_alarm', label: '가스누설경보기', facilityHint: '가스누설경보기',
      fields: [
        { key: 'form', label: '형태', type: 'select', options: ['단독형', '분리형'] },
        { key: 'gas', label: '사용가스종류', type: 'select', options: ['LNG', 'LPG'] },
        { key: 'zone_count', label: '경계구역 수', type: 'number', unit: '개' },
        ...locFields('receiver', '수신기'),
        { key: 'breaker', label: '차단기구', type: 'select', options: ['유', '무'] },
        { key: 'breaker_place', label: '차단기구 설치장소', type: 'text' },
      ],
    },
  ],
}

// ── 3-6. 피난구조설비 ───────────────────────────────────────────────────────

const S36: SpecSection = {
  key: 's36_evac', no: '3-6', label: '피난구조설비',
  blocks: [
    {
      key: 'evac_equipment', label: '피난기구', facilityHint: '피난기구',
      fields: [
        // 통합 어휘 11종(EVAC_TYPES)이 단일 저장소 — 1.4 대장 하위 체크박스도 이 값을 읽고 쓴다.
        { key: 'types', label: '종류', type: 'multicheck', options: EVAC_TYPES, mirrorInLedger: true },
        ...rangeLocFields({ second: true }),   // 서식 원문 설치장소 2줄 (A4-4)
      ],
    },
    {
      key: 'rescue_equipment', label: '인명구조기구', facilityHint: '인명구조기구',
      fields: [
        { key: 'types', label: '종류', type: 'multicheck', options: ['방열복/방화복', '공기호흡기', '인공소생기'] },
        ...rangeLocFields({ second: true }),   // 서식 원문 설치장소 2줄 (A4-4)
        { key: 'target_usage', label: '대상물의 용도', type: 'multicheck',
          options: ['5층이상 병원', '7층이상 관광호텔', '이산화탄소소화설비 설치',
            '지하역사ㆍ백화점ㆍ대형점포ㆍ쇼핑센타ㆍ지하상가ㆍ영화상영관'] },
      ],
    },
    {
      key: 'guide_light', label: '유도등', facilityHint: '유도등,유도표지,피난유도선',
      fields: [
        // 유도표지·피난유도선은 대장 표준 42종에 독립 항목으로 있어 대장이 원천(읽기 전용).
        // 피난구·통로·객석유도등은 '유도등'의 세분이라 대장에 없다 → 계속 여기서 입력한다.
        { key: 'types', label: '종류', type: 'multicheck',
          options: ['피난구', '통로', '객석유도등', '유도표지', '피난유도선'],
          derivedFrom: { '유도표지': '유도표지', '피난유도선': '피난유도선' } },
        ...rangeLocFields(),
      ],
    },
    {
      key: 'emergency_light', label: '비상조명등', facilityHint: '비상조명등',
      fields: [
        ...rangeLocFields(),
        { key: 'power', label: '비상전원', type: 'multicheck', options: ['자가발전설비', '축전지설비', '내장형'] },
      ],
    },
    {
      key: 'portable_light', label: '휴대용 비상조명등', facilityHint: '휴대용비상조명등',
      fields: [
        ...rangeLocFields(),
        { key: 'power', label: '전원', type: 'select', options: ['건전지식', '충전식 배터리식'] },
      ],
    },
  ],
}

// ── 3-7. 소화용수설비 ───────────────────────────────────────────────────────

const S37: SpecSection = {
  key: 's37_supply', no: '3-7', label: '소화용수설비',
  blocks: [
    {
      key: 'waterworks', label: '상수도 소화용수', facilityHint: '상수도소화용수설비',
      fields: [
        { key: 'place', label: '설치장소', type: 'text' },
        { key: 'diameter', label: '소화전 호칭지름', type: 'number', unit: '㎜' },
      ],
    },
    {
      key: 'water_tank', label: '소화수조', facilityHint: '소화수조 및 저수조',
      fields: [
        { key: 'pump', label: '가압송수장치', type: 'text' },
        { key: 'priming', label: '물올림장치', type: 'check' },
        { key: 'priming_capacity', label: '물올림장치 유효수량', type: 'number', unit: 'ℓ' },
        { key: 'priming_pipe', label: '물올림장치 급수배관', type: 'number', unit: '㎜' },
      ],
    },
  ],
}

// ── 3-8. 소화활동설비 ───────────────────────────────────────────────────────

const S38: SpecSection = {
  key: 's38_activity', no: '3-8', label: '소화활동설비',
  blocks: [
    {
      key: 'smoke_room', label: '제연설비 — 거실', facilityHint: '거실제연설비',
      fields: [
        ...rangeLocFields(),
        { key: 'method', label: '방식', type: 'select', options: ['단독', '공동', '상호', '기타'] },
        { key: 'method_etc', label: '방식 기타 내용', type: 'text' },
        { key: 'starter', label: '기동장치', type: 'multicheck', options: ['자동(감지기 연동)', '수동', '원격'] },
        { key: 'zone_area', label: '제연구획면적 최대', type: 'number', unit: '㎡' },
        { key: 'zone_structure', label: '제연구획 구조', type: 'select', options: ['내화', '불연', '그 밖의 것'] },
        { key: 'zone_structure_etc', label: '제연구획 구조 기타 내용', type: 'text' },
        { key: 'door', label: '제연구역 출입문', type: 'select',
          options: ['상시폐쇄(자동폐쇄장치)', '상시개방(감지기에 의한 닫힘)'] },
        ...fanFields('supply_fan', '급기용송풍기'),
        ...fanFields('exhaust_fan', '배출용송풍기'),
        { key: 'outlet_pos', label: '배출구 위치', type: 'select', options: ['천장면', '천장직하', '기타'] },
        { key: 'outlet_pos_etc', label: '배출구 위치 기타 내용', type: 'text' },
        { key: 'outdoor_outlet', label: '옥외배출구', type: 'select', options: ['옥상', '기타'] },
        { key: 'outdoor_outlet_etc', label: '옥외배출구 기타 내용', type: 'text' },
        { key: 'exhaust_duct', label: '배출 풍도구조', type: 'select', options: ['내화', '불연', '그 밖의 것'] },
        { key: 'exhaust_duct_etc', label: '배출 풍도구조 기타 내용', type: 'text' },
        { key: 'exhaust_damper', label: '배출 구획댐퍼', type: 'select', options: ['유', '무'] },
        { key: 'air_exhaust', label: '유입공기배출', type: 'multicheck', options: ['자연배출', '기계배출', '배출구', '제연설비'] },
        { key: 'inlet_mode', label: '급기구', type: 'multicheck', options: ['강제유입', '자연유입', '인접구역유입'] },
        { key: 'inlet_duct', label: '급기 풍도구조', type: 'select', options: ['내화', '불연', '그 밖의 것'] },
        { key: 'inlet_duct_etc', label: '급기 풍도구조 기타 내용', type: 'text' },
        { key: 'inlet_damper', label: '급기 구획댐퍼', type: 'select', options: ['유', '무'] },
      ],
    },
    {
      key: 'smoke_lobby', label: '제연설비 — 전실', facilityHint: '부속실 등 제연설비',
      fields: [
        { key: 'targets', label: '설치대상 동명(복수 자유 기입)', type: 'text' },
        { key: 'stair_count', label: '특별피난계단', type: 'number', unit: '개소' },
        // 건물 정보(건물·시설 탭)에 이미 있는 값 — 원천은 그쪽, 여기는 읽기 전용 파생
        { key: 'elevator_count', label: '비상용승강기', type: 'number', unit: '대',
          derivedFromBuilding: 'emergency_elevator_count' },
        { key: 'method', label: '방식', type: 'select',
          options: ['부속실', '계단실 및 부속실', '계단실', '비상용승강기승강장'] },
        { key: 'start_mode', label: '기동방식', type: 'select', options: ['전층', '부분층'] },
        { key: 'partial_floors', label: '부분층 개층 수', type: 'number', unit: '개층' },
        { key: 'damper_detector', label: '댐퍼개방감지기', type: 'select', options: ['전용', '겸용'] },
        ...fanFields('supply_fan', '급기용송풍기'),
        ...fanFields('exhaust_fan', '배출용송풍기'),
        { key: 'door', label: '제연구역 출입문', type: 'select',
          options: ['상시폐쇄(자동폐쇄장치)', '상시개방(연기감지기에 의한 닫힘)'] },
        { key: 'air_exhaust', label: '유입공기배출', type: 'multicheck', options: ['자연배출', '기계배출', '배출구', '제연설비'] },
        { key: 'overpressure', label: '과압방지장치', type: 'select',
          options: ['플랩댐퍼', '자동차압(과압조절형)댐퍼', '그 밖의 것', '해당없음'] },
      ],
    },
    {
      key: 'riser', label: '연결송수관', facilityHint: '연결송수관설비',
      fields: [
        { key: 'usage', label: '전용/겸용', type: 'select', options: ['전용', '겸용'] },
        // '기타'는 대장에 없는 자유 항목이라 항상 선택 가능 (limitToInstalled는 대장에 있는 코드만 제한한다)
        { key: 'shared_with', label: '겸용 설비', type: 'multicheck', limitToInstalled: true,
          options: ['옥내소화전설비', '스프링클러설비', '기타'] },
        { key: 'shared_etc', label: '겸용 설비 기타 내용', type: 'text' },
        ...rangeLocFields(),
        { key: 'inlet_place', label: '송수구 설치장소', type: 'text' },
        { key: 'mid_tank', label: '중간수조용량', type: 'number', unit: '㎥' },
        ...locFields('pump', '가압송수장치'),
        { key: 'pump_head', label: '가압송수장치 전양정', type: 'number', unit: 'm' },
        { key: 'pump_flow', label: '가압송수장치 토출량', type: 'number', unit: 'ℓ/min' },
        { key: 'start_switch', label: '기동스위치 설치장소', type: 'multicheck', options: ['송수구', '방재실', '기타'] },
        { key: 'start_switch_etc', label: '기동스위치 기타 내용', type: 'text' },
      ],
    },
    {
      key: 'sprinkler_connect', label: '연결살수', facilityHint: '연결살수설비',
      fields: [
        { key: 'targets', label: '설치대상 동명(복수 자유 기입)', type: 'text' },
        { key: 'method', label: '방식', type: 'select', options: ['습식', '건식'] },
        { key: 'target_type', label: '설치 부분', type: 'multicheck',
          options: ['지하층', '판매시설', '가스시설', '부속된 연결통로'] },
        { key: 'inlet_place', label: '송수구 설치장소', type: 'text' },
        { key: 'zone_count', label: '송수구역수', type: 'number', unit: '구역' },
      ],
    },
    {
      key: 'emergency_outlet', label: '비상콘센트', facilityHint: '비상콘센트설비',
      fields: [
        ...rangeLocFields({ coverage: false }),
        { key: 'power', label: '전원 방식', type: 'multicheck', options: ['3상 380V', '단상 220V'] },
        { key: 'plug', label: '플러그접속기', type: 'multicheck',
          options: ['접지형 2극 플러그접속기', '접지형 3극 플러그접속기'] },
      ],
    },
    {
      key: 'wireless', label: '무선통신보조', facilityHint: '무선통신보조설비',
      fields: [
        ...rangeLocFields({ coverage: false }),
        { key: 'usage', label: '전용/공용', type: 'select', options: ['전용', '공용'] },
        { key: 'method', label: '방식', type: 'select',
          options: ['누설동축케이블', '누설동축케이블과 안테나', '안테나'] },
        // 서식 원문은 '◦ 접속단자 설치장소( ), ( )' — 칸이 둘이다(A4-4)
        { key: 'terminals', label: '접속단자 설치장소 1', type: 'text' },
        { key: 'terminals2', label: '접속단자 설치장소 2', type: 'text' },
      ],
    },
    {
      key: 'fire_spread', label: '연소방지', facilityHint: '연소방지설비',
      fields: [
        { key: 'target', label: '방호대상물', type: 'multicheck', options: ['전력사업용', '통신사업용', '그 밖의 것'] },
        { key: 'target_etc', label: '방호대상물 기타 내용', type: 'text' },
        { key: 'zone_count', label: '송수구역수', type: 'number', unit: '구역' },
        { key: 'partition', label: '구역간의 구획', type: 'select', options: ['있다', '일부 있다', '없다'] },
      ],
    },
  ],
}

// ── 카탈로그 ────────────────────────────────────────────────────────────────

export const FACILITY_SPEC_SECTIONS: SpecSection[] = [S31, S32, S33, S34, S35, S36, S37, S38]

/** 섹션 key → 섹션 정의 (저장 액션 화이트리스트·조회용) */
export const FACILITY_SPEC_SECTION_KEYS: string[] = FACILITY_SPEC_SECTIONS.map(s => s.key)

export function getSpecSection(key: string): SpecSection | undefined {
  return FACILITY_SPEC_SECTIONS.find(s => s.key === key)
}

// ── 파생 값 계산 (2026-08-08 중복 입력 제거) ─────────────────────────────────
// 파생 필드는 **세부제원에 저장하지 않는다**. 화면과 문서가 렌더 직전에 이 헬퍼로 값을 얹는다 —
// 사본을 저장하면 원천(대장·건물)이 바뀌었을 때 낡은 값이 남아 애초의 불일치가 되살아난다.

/** 파생 원천 — 1.4 설치(√) 코드 집합과 건물 정보 */
export type DerivedCtx = {
  installed?: Iterable<string>
  building?: Record<string, number | string | null | undefined>
}

function installedSet(ctx: DerivedCtx): Set<string> {
  return ctx.installed instanceof Set ? ctx.installed : new Set(ctx.installed ?? [])
}

/** 이 필드가 전부 파생인가 — 선택지 전체가 derivedFrom에 있으면 사용자가 건드릴 게 없다(가스계) */
export function isFullyDerived(f: SpecField): boolean {
  if (!f.derivedFrom) return false
  return (f.options ?? []).every(o => f.derivedFrom![o])
}

/** multicheck 최종 값 = 사용자가 고른 비파생 선택지 + 대장에서 설치된 파생 선택지.
 *  선택지 정의 순서를 유지해 서식 인쇄 순서와 어긋나지 않게 한다. */
export function mergeDerivedMulti(f: SpecField, stored: unknown, ctx: DerivedCtx): string[] {
  const arr = Array.isArray(stored) ? stored.map(String) : []
  if (!f.derivedFrom) return arr
  const inst = installedSet(ctx)
  return (f.options ?? []).filter(o => {
    const code = f.derivedFrom![o]
    return code ? inst.has(code) : arr.includes(o)
  })
}

/** 건물 파생 number 필드의 표시 값 — 값이 없으면 빈 문자열(서식 빈칸) */
export function derivedBuildingValue(f: SpecField, ctx: DerivedCtx): string {
  if (!f.derivedFromBuilding) return ''
  const v = ctx.building?.[f.derivedFromBuilding]
  return v == null || v === '' ? '' : String(v)
}

/** 저장 대상에서 제외할 필드 — 파생 필드는 원천에만 존재해야 한다 */
export function isDerivedField(f: SpecField): boolean {
  return !!f.derivedFromBuilding || isFullyDerived(f)
}

/** 섹션 값 전체에 파생을 반영한 사본 — 문서 렌더러(spec-sections)가 인쇄 직전에 호출한다.
 *  입력: { [blockKey]: { [fieldKey]: 값 } } */
export function applyDerived(
  sectionKey: string,
  vals: Record<string, unknown>,
  ctx: DerivedCtx,
): Record<string, unknown> {
  const sec = getSpecSection(sectionKey)
  if (!sec) return vals
  const out: Record<string, unknown> = { ...vals }
  for (const bl of sec.blocks) {
    const blVals = { ...((out[bl.key] ?? {}) as Record<string, unknown>) }
    let touched = false
    for (const f of bl.fields) {
      if (f.derivedFrom) { blVals[f.key] = mergeDerivedMulti(f, blVals[f.key], ctx); touched = true }
      else if (f.derivedFromBuilding) { blVals[f.key] = derivedBuildingValue(f, ctx); touched = true }
    }
    if (touched) out[bl.key] = blVals
  }
  return out
}
