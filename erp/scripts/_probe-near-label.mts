/** 이웃 라벨이 **맞는** 라벨인지 눈으로 확인 — 변이 M9(행/열 뒤집기)가 [5]를 뚫어서 만들었다. */
import { sheetBlankReport } from '../src/lib/fire-plan-blanks.ts'
for (const s of ['1.2.1 구역별 세부현황', '1.7.1 소방안전관리자 선임현황', '1.10.4 화재·비화재보 이력']) {
  const r = await sheetBlankReport(s, null)
  console.log(`\n${s} — 빈칸 ${r.blanks.length}`)
  for (const b of r.blanks.slice(0, 6)) console.log(`   ${b.ref.padEnd(6)}「${b.near}」`)
}
