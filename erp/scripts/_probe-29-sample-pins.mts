/** 2.9 예시문칸 핀 자구 실측 — labelAt 바이트 그대로 (2026-09-18)
 *  실행: npx tsx --conditions=react-server scripts/_probe-29-sample-pins.mts */
import { labelAt } from '../src/lib/fire-plan-xlsx-manifest.ts'

const SHEET = '2.9 초기소화팀(진압반)'
for (const cell of ['AC6', 'AC7', 'AC9', 'AC10', 'O12', 'V12', 'AC12', 'I12']) {
  console.log(`${cell}: ${JSON.stringify(labelAt(SHEET, cell))}`)
}
