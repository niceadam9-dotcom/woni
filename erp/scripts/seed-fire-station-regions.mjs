/**
 * 관할 소방서 매핑 확장 시드 (소방계획서_11.md §13-C C-2 · 마이그레이션 116 동반)
 *
 *   node scripts/seed-fire-station-regions.mjs           # .env.local (스테이징)
 *   node scripts/seed-fire-station-regions.mjs --prod    # .env.production (운영)
 *   node scripts/seed-fire-station-regions.mjs --dry     # 저장 없이 대조만
 *
 * 왜: 065의 22행(경기 양평 주변 읍·면)만으로는 그 밖의 지역이 전부 '시군명+소방서' **추정**으로 떨어졌다.
 *     추정이 틀리는 사례가 실재하고(성남시→성남소방서 추정이나 분당구는 분당소방서),
 *     자치구 단위로 갈리는 지역은 종전 스키마로 표현조차 못 했다(독립검증 2026-08-07).
 *
 * region_type:
 *   'gu'    자치구 단위 — region_si에 시/군 또는 시/도, region에 구명
 *   'emd'   읍면동 단위 — region_si에 시/군, region에 접미사 뗀 지역명(065 기존 방식)
 *   'sigun' 시·군 전역 대표행 — region에 '' (해당 시/군에 소방서 1개)
 *
 * ⚠ 주소 출처는 각 행 SOURCES 주석 참조. 소방서 신설·통폐합이 있으면 이 표만 고치고 다시 실행하면 된다.
 *   119안전센터가 아니라 **소방서(본서)** 기준이다.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

const prod = process.argv.includes('--prod')
const dry = process.argv.includes('--dry')
config({ path: resolve(process.cwd(), prod ? '.env.production' : '.env.local') })

// 출처(2026-08-07 조사): 서울소방재난본부 fire.seoul.go.kr · 경기도소방재난본부 119.gg.go.kr
//                        강원소방본부 fire.gwd.go.kr · 인천소방본부 fire.incheon.go.kr · 위키백과 소방서 목록
const SEOUL = '서울특별시'
const GG = '경기도'

/** 서울 — 자치구 25개가 소방서 25개와 1:1. 규칙(`구명+소방서`)이 깨지는 곳은 **중구 → 중부소방서** 하나뿐이다.
 *  금천소방서는 2022-01-27 개서(그 전엔 구로소방서 관할) — 낡은 조례 별표만 보면 틀린다. */
const SEOUL_GU = [
  ['종로구', '종로소방서'], ['중구', '중부소방서'], ['용산구', '용산소방서'],
  ['성동구', '성동소방서'], ['광진구', '광진소방서'], ['동대문구', '동대문소방서'],
  ['중랑구', '중랑소방서'], ['성북구', '성북소방서'], ['강북구', '강북소방서'],
  ['도봉구', '도봉소방서'], ['노원구', '노원소방서'], ['은평구', '은평소방서'],
  ['서대문구', '서대문소방서'], ['마포구', '마포소방서'], ['양천구', '양천소방서'],
  ['강서구', '강서소방서'], ['구로구', '구로소방서'], ['금천구', '금천소방서'],
  ['영등포구', '영등포소방서'], ['동작구', '동작소방서'], ['관악구', '관악소방서'],
  ['서초구', '서초소방서'], ['강남구', '강남소방서'], ['송파구', '송파소방서'],
  ['강동구', '강동소방서'],
]

/** 경기 — 한 시에 소방서가 둘 이상이라 **자치구 단위로 갈리는 곳**. 구를 못 뽑으면 매핑이 불가능하다. */
const GG_GU = [
  ['수원시', '장안구', '수원소방서'], ['수원시', '영통구', '수원소방서'],
  ['수원시', '권선구', '수원남부소방서'], ['수원시', '팔달구', '수원남부소방서'],
  ['성남시', '수정구', '성남소방서'], ['성남시', '중원구', '성남소방서'],
  ['성남시', '분당구', '분당소방서'],
  ['고양시', '덕양구', '고양소방서'], ['고양시', '일산동구', '일산소방서'],
  ['고양시', '일산서구', '일산소방서'],
  ['용인시', '처인구', '용인소방서'],
  ['용인시', '기흥구', '용인서부소방서'], ['용인시', '수지구', '용인서부소방서'],  // 2024-06-03 개서
]

/** 경기 — 시·군 전역이 소방서 1곳인 곳. 안산·안양·부천은 자치구가 있어도 전역 동일하다.
 *  ⚠ 평택시는 **의도적으로 제외**했다 — 송탄소방서/평택소방서가 **행정동 단위**로 갈리는데
 *    조사 확신도가 '중'이고 신도시 분동으로 현행성이 불확실하다. 매핑 없이 추정('평택소방서')으로
 *    떨어지면 화면에 확인 배지가 뜨므로, 확신 없는 값을 확정처럼 심는 것보다 낫다. */
const GG_SIGUN = [
  '의정부시', '안양시', '부천시', '광명시', '동두천시', '안산시', '과천시', '구리시',
  '남양주시', '오산시', '시흥시', '군포시', '의왕시', '하남시', '파주시', '이천시',
  '안성시', '김포시', '화성시', '광주시', '양주시', '포천시', '여주시',
  '연천군', '가평군', '양평군',
]

const GW = '강원특별자치도'
const IC = '인천광역시'

/** 강원 — 18개 시·군 ↔ 18개 소방서 **완전 1:1**. 추정 규칙이 18/18 맞지만,
 *  '추정(배지)'이 아니라 '확정'으로 만들기 위해 명시 시드한다. */
const GW_SIGUN = [
  '춘천시', '원주시', '강릉시', '동해시', '태백시', '속초시', '삼척시',
  '홍천군', '횡성군', '영월군', '평창군', '정선군', '철원군', '화천군',
  '양구군', '인제군', '고성군', '양양군',
]

/** 인천 — 구명과 소방서명이 거의 일치하지 않고(중부·서부·공단·송도·영종·검단),
 *  2026-07-01 행정구역 개편(중구·동구 폐지 → 제물포구·영종구 / 서구 분리 → 검단구)까지 겹쳤다.
 *  **구 단위로 확정되는 곳만** 담는다. */
const IC_GU = [
  ['제물포구', '인천중부소방서'],   // 구 중구 내륙 + 구 동구
  ['영종구', '인천영종소방서'],     // 구 중구 영종도
  ['미추홀구', '인천미추홀소방서'],
  ['부평구', '인천부평소방서'],
  ['계양구', '인천계양소방서'],
  ['서구', '인천서부소방서'],
  ['검단구', '인천검단소방서'],
]

/** ⚠ 인천에서 **의도적으로 뺀 것** — 구 단위로 결정되지 않아 동·면까지 봐야 한다.
 *    연수구: 송도1~5동 → 인천송도소방서 / 나머지 → 인천공단소방서
 *    남동구: 논현1·2동·논현고잔동·남촌도림동 → 인천공단소방서 / 나머지 → 인천남동소방서
 *    옹진군: 백령·대청·덕적·자월·연평면 → 인천중부 / 북도면 → 인천영종 / 영흥면 → 인천송도
 *  다수 소방서를 심으면 '그럴듯한 오답'이 확정값으로 들어간다 — 독립검증이 지적한 바로 그 실패 패턴이라
 *  매핑 없이 두어 사용자가 직접 입력하게 한다(현재 인천 고객 없음).
 *  또 구 주소('중구'·'동구')가 남아 있으면 개편 후 구와 매칭되지 않는다 — 중구는 내륙/영종도에 따라
 *  소방서가 갈리므로 단순 치환도 불가하다. */
const IC_SIGUN = [
  ['강화군', '인천강화소방서'],
]

// [region_sido, region_si, region, region_type, fire_station]
const ROWS = [
  ...SEOUL_GU.map(([gu, st]) => [SEOUL, SEOUL, gu, 'gu', st]),
  ...GG_GU.map(([si, gu, st]) => [GG, si, gu, 'gu', st]),
  ...GG_SIGUN.map(si => [GG, si, '', 'sigun', `${si.replace(/[시군]$/, '')}소방서`]),
  ...GW_SIGUN.map(si => [GW, si, '', 'sigun', `${si.replace(/[시군]$/, '')}소방서`]),
  ...IC_GU.map(([gu, st]) => [IC, IC, gu, 'gu', st]),
  ...IC_SIGUN.map(([si, st]) => [IC, si, '', 'sigun', st]),
]

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Supabase 환경변수가 없습니다.'); process.exit(1) }
const admin = createClient(url, key, { auth: { persistSession: false } })

if (ROWS.length === 0) { console.error('ROWS가 비어 있습니다 — 매핑 표를 먼저 채우세요.'); process.exit(1) }

const payload = ROWS.map(([region_sido, region_si, region, region_type, fire_station]) =>
  ({ region_sido, region_si, region, region_type, fire_station }))

// 같은 키가 두 번 들어가면 upsert가 조용히 덮어써 조사 실수가 묻힌다 — 먼저 걸러낸다
const seen = new Map()
for (const r of payload) {
  const k = `${r.region_sido}|${r.region_si}|${r.region}`
  if (seen.has(k)) {
    console.error(`✗ 중복 키: ${k} → '${seen.get(k)}' vs '${r.fire_station}'`)
    process.exit(1)
  }
  seen.set(k, r.fire_station)
}

console.log(`대상 ${payload.length}행 (${prod ? '운영' : '스테이징'})${dry ? ' — dry run' : ''}`)
const byStation = new Map()
for (const r of payload) byStation.set(r.fire_station, (byStation.get(r.fire_station) ?? 0) + 1)
console.log(`소방서 ${byStation.size}곳`)

if (dry) {
  for (const r of payload) console.log(`  ${r.region_sido} ${r.region_si} ${r.region || '(전역)'} [${r.region_type}] → ${r.fire_station}`)
  process.exit(0)
}

// 100행씩 나눠 upsert — PK(region_sido, region_si, region) 충돌 시 갱신
let done = 0
for (let i = 0; i < payload.length; i += 100) {
  const chunk = payload.slice(i, i + 100)
  const { error } = await admin.from('region_fire_stations')
    .upsert(chunk, { onConflict: 'region_sido,region_si,region' })
  if (error) { console.error(`✗ ${i}~: ${error.message}`); process.exit(1) }
  done += chunk.length
  console.log(`  ✓ ${done}/${payload.length}`)
}

const { count } = await admin.from('region_fire_stations').select('*', { count: 'exact', head: true })
console.log(`\n완료 — 테이블 총 ${count}행`)
console.log('※ 좌표는 scripts/seed-fire-station-coords.mjs 가 별도로 채운다(신규 소방서는 주소 추가 필요)')
