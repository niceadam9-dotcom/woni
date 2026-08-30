// 감사(_audit-32-status.mjs) 지적 B·C축 보강 — 1회용.
//  B: S14/X-1~X-7이 implemented인데 근거 블록이 없다(Json_Rule 규칙 2). 판정자 측정을 verified로 명시.
//  C: S12-D의 증거가 `_judgeD-D-{1db,2cols,…}.mts` 축약형이라 실재하는 경로가 아니다 → 실파일로 펼친다.
import { readFileSync, writeFileSync, existsSync } from 'fs'

const P = 'F:/AI/ERP/erp_goal/소방계획서_32.json'
const doc = JSON.parse(readFileSync(P, 'utf8'))
const find = (sid, cid) => {
  const s = doc.sections.find(x => x.id === sid)
  return (s?.criteria ?? []).find(c => c.id === cid)
}

// ── B: X-1~X-7 근거 명시 ───────────────────────────────────────────────
// 이 7건은 '문서 문장이 틀렸다'는 판정이고, 근거는 판정자의 실측이다. 어느 판정자가 무엇으로
// 뒤집었는지를 verified로 남긴다 — note에만 있으면 규칙 2를 만족하지 못한다.
const B = {
  'X-1': ['판정자 B·D 독립 합의', ['워크북 67시트에 `간4` 실재 · allDonorSheets() 41장에 등재 · 서림사 keptSheets 18장에도 포함', 'A열 item_code 0행이라 추출기 `if (!codes.length) continue`에 걸려 매핑에서만 빠진다', '매핑 없는 도너 4장 = 목 차·간4·CO2-4·할3']],
  'X-2': ['판정자 D', ['시트별 앵커 실측 — 개요 57·위임장 4·계약서 1·대상처 1·보고서 8·**정보 14**·다수동일때 15·현황 92 = 192']],
  'X-3': ['판정자 D', ['git으로 확정 — 개요!D21 rampCount 앵커는 `c2d4dc6`, 정보 시트 리터럴은 `d363b31`(둘 다 2026-08-24)', 'F 인계서가 함께 지목한 `G10`·`I9`·`J9`는 지금도 미배선(F 문서 스스로 Phase 3 몫이라 분류)']],
  'X-4': ['판정자 C', ['프로브 출력이 스스로 「넓은 서식 2시트」라 찍는다(서림사 기준 4시트 중 2장만 생존)', '_judgeD-C-allcodes.mts — 720코드 전수 왕복으로 4/4 전부 원문 보존 확인 · 주입 대상 아닌 도너 2,081칸 부수 피해 0']],
  'X-5': ['판정자 C', ['종전 프로브의 「표본 3칸」은 `wb.Sheets[...]` 즉 SheetJS 셀 값이다 — 렌더 산출물에서 좌표를 찾은 적이 없다', '_judgeD-C-render-locate.mts로 행 결속 축을 독립으로 세워 불량 3건 확인(렌더 행 1,348개·표본 40건 불일치 0)']],
  'X-6': ['판정자 B·D 독립 합의', ['`sheetRemoved` 27건 = 할1 18 + 할2 9이고 그 27코드 전부가 `annex4.sheetSections`에 있다(_probe-s15-divergence.mts 재현: PDF에 실리는 것 27/27)', '⚠후속 추적에서 이 갈라짐 자체는 **설계된 동작**임이 확인됐다 — V-1 resolution 참조. 다만 「정상 시나리오」라는 원래 단정에 근거가 없었다는 지적은 유효하다']],
  'X-7': ['판정자 B', ['`annex4.sheetSections` 610코드 · 응답 243건 중 sheetSections에 없는 것 **0건**', '`report9-assemble.ts:293`이 `sheetMatchesFacilities(...) || respSheetIds.has(s.id)`로 응답 있는 시트를 구제한다', '실제 사유는 ①분모 610(카탈로그 항목)이라 무응답과 미착지가 섞임 ②`resByCode` last-wins로 month 축 소멸']],
}
let n = 0
for (const [id, [by, ev]] of Object.entries(B)) {
  const c = find('S14', id)
  if (!c) { console.log(`  ⚠ S14/${id} 없음`); continue }
  if (c.verified) continue
  c.verified = { date: '2026-08-30', method: `독립 판정자 실측 (${by})`, evidence: ev }
  n++
}
console.log(`B축 verified 추가 ${n}건`)

// ── C: S12-D 증거 경로를 실파일로 ───────────────────────────────────────
{
  const c = find('S12', 'S12-D')
  const ev = c?.verified?.evidence
  const i = ev?.findIndex(e => String(e).includes('_judgeD-D-{'))
  if (i != null && i >= 0) {
    const names = ['1db', '2cols', '2detail', '3form4', '3merge', '10closure', '10merge', 'headsha', 'hub', 'worktreedv']
    const real = names.map(x => `erp/scripts/_judgeD-D-${x}.mts`).filter(p => existsSync('F:/AI/ERP/' + p))
    const missing = names.filter(x => !existsSync(`F:/AI/ERP/erp/scripts/_judgeD-D-${x}.mts`))
    ev[i] = `프로브 ${real.length}종: ${real.map(p => p.split('/').pop()).join(' · ')}`
    if (missing.length) ev.splice(i + 1, 0, `⚠기록에 있었으나 저장소에 없는 이름: ${missing.join(', ')} — 축약형(_judgeD-D-{a,b}) 표기가 실경로가 아니었다`)
    console.log(`C축 — 실재 ${real.length}종으로 펼침${missing.length ? ` · 부재 ${missing.length}종 고지` : ''}`)
  } else console.log('C축 — 대상 없음(이미 수정됐거나 구조가 다르다)')
}

writeFileSync(P, JSON.stringify(doc, null, 2) + '\n', 'utf8')
JSON.parse(readFileSync(P, 'utf8'))
console.log('JSON OK')
