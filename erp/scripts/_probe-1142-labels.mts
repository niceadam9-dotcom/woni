/** 1.14.2 홍보 결과 — 핀에 적을 자구 실측 (2026-09-18)
 *  실행: npx tsx --conditions=react-server scripts/_probe-1142-labels.mts */
import { labelAt, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'

const S = '1.14.2 화재예방 및 홍보 결과'
for (const c of ['A1', 'A2', 'P2', 'AE2', 'AT2', 'A4', 'P4', 'AE4', 'AT4']) {
  const lbl = sheetManifest(S).labels[c]
  console.log(`${c} ${lbl === undefined ? '(라벨 없음 — 빈 칸)' : JSON.stringify(labelAt(S, c))}`)
}
