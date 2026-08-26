/** EXT 퍼지 실패가 입력 화면(노출 필터·영구공란 경고)에 미치는 영향 — 순수 함수, DB 무관. */
import { sheetMatchesFacilities } from '../src/lib/sheet-facility-map'

const CASES: Array<[string, string[]]> = [
  ['옥내·외 소화전 설비', ['옥내소화전설비']],
  ['옥내·외 소화전 설비', ['옥외소화전설비']],
  ['제연설비, 특별피난계단의 계단실 및 부속실 제연설비', ['거실제연설비']],
  ['제연설비, 특별피난계단의 계단실 및 부속실 제연설비', ['부속실 등 제연설비']],
  ['이산화탄소, 할론소화설비, 할로겐화합물 및 불활성기체소화설비, 분말소화설비', ['이산화탄소소화설비']],
  ['자동화재탐지설비, 비상경보설비, 시각경보기, 비상방송설비, 자동화재속보설비', ['자동화재탐지설비 및 시각경보기']],
  // 대조군 — 이건 잘 걸린다
  ['피난기구, 유도등(유도표지), 비상조명등 및 휴대용비상조명등', ['피난기구']],
  ['연결송수관설비, 연결살수설비', ['연결송수관설비']],
]

let bad = 0
for (const [sheet, codes] of CASES) {
  const hit = sheetMatchesFacilities(sheet, codes)
  if (!hit) bad++
  console.log(`${hit ? 'MATCH  ' : 'MISS ❌'} | 설비 ${codes[0]} → 시트 "${sheet.slice(0, 34)}${sheet.length > 34 ? '…' : ''}"`)
}
console.log(`\n미매칭 ${bad}/${CASES.length}`)
console.log('미매칭이면 그 시트는 [설치 설비만 보기]에서 숨겨지고(responded=0일 때),')
console.log('그 설비는 uncoveredFacilityCodes(=영구 공란 경고)에 거짓으로 올라간다.')
