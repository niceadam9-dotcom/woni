/** 별지 9호 3쪽 / 별지 4호 1쪽 «1. 소방시설등 점검 결과» — 하위 항목 행 분리 검증 (순수 렌더, DB 불필요).
 *  실행: npx tsx scripts/_probe-form3-subrows.mts
 *
 *  서식 원본(image-33): 하위 항목이 **각자 행 + 각자 점검결과 칸**을 갖고, 부모 결과칸은 비어 있다.
 *  종전 우리 출력(image-32)은 부모+하위 6줄을 한 칸에 묶고 결과도 하나였다.
 *
 *  결과칸 규칙(2026-08-20 확정):
 *    미설치 하위 → '/'  ·  설치된 하위 → 부모 롤업을 **첫 설치 행 하나에만**  ·  나머지 설치 행 → 공란
 *    설치된 하위가 0개면 → 롤업을 부모 행에 그대로 (결과를 버리지 않는다)
 */
import { facilityResultSection } from '../src/lib/doc-templates/report9'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`)
}

/** <tr> 단위로 (라벨, 결과마크) 추출 — 결과칸은 class="center mk" */
function rows(html: string): Array<{ label: string; mark: string }> {
  const out: Array<{ label: string; mark: string }> = []
  for (const tr of html.split('<tr>').slice(1)) {
    const label = (/<td class="pre">([\s\S]*?)<\/td>/.exec(tr) ?? [])[1]
    if (label === undefined) continue
    const mark = (/<td class="center mk">([\s\S]*?)<\/td>/.exec(tr) ?? [])[1] ?? ''
    out.push({
      label: label.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
      mark: mark.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim(),
    })
  }
  return out
}
const find = (rs: ReturnType<typeof rows>, needle: string) => rs.find(r => r.label.includes(needle))

const FIRE_SUBS = ['소화기구(소화기, 자확, 간이)', '주거용주방자동소화장치', '상업용주방자동소화장치',
  '캐비닛형자동소화장치', '가스ㆍ분말ㆍ고체자동소화장치']

// ── ① 소화기구: 하위 5종이 각자 행 · 첫 설치 행에 롤업 · 미설치는 '/' ──
{
  const r = rows(facilityResultSection({
    facilityChecks: ['소화기구 및 자동소화장치'],
    resultMarks: { '소화기구 및 자동소화장치': 'X' },
    ledgerCodes: ['소화기(소화기·자동확산·간이)'],   // 하위 1번만 설치
  }))
  check('① 부모가 자기 행을 갖는다', !!find(r, '소화기구 및 자동소화장치'), '')
  for (const s of FIRE_SUBS) check(`① 하위 행 — ${s}`, !!find(r, s), '')
  check('① 부모 결과칸은 비어 있다', find(r, '소화기구 및 자동소화장치')!.mark === '',
    `mark="${find(r, '소화기구 및 자동소화장치')!.mark}"`)
  check('① 설치된 첫 하위에 롤업(×)', find(r, FIRE_SUBS[0])!.mark === '×', find(r, FIRE_SUBS[0])!.mark)
  check('① 미설치 하위는 전부 /',
    FIRE_SUBS.slice(1).every(s => find(r, s)!.mark === '/'),
    FIRE_SUBS.slice(1).map(s => `${s}=${find(r, s)!.mark}`).join(' | '))
  check('① 하위가 부모와 한 칸에 묶이지 않는다(종전 회귀)',
    !find(r, '소화기구 및 자동소화장치')!.label.includes('주거용'), find(r, '소화기구 및 자동소화장치')!.label)
}

// ── ② 설치 하위가 여럿이면 롤업은 첫 행에만, 나머지는 공란 ──
{
  const r = rows(facilityResultSection({
    facilityChecks: ['소화기구 및 자동소화장치'],
    resultMarks: { '소화기구 및 자동소화장치': 'O' },
    ledgerCodes: ['주거용주방자동소화장치', '캐비닛형자동소화장치'],  // 2·4번 설치
  }))
  check('② 미설치 1번은 /', find(r, FIRE_SUBS[0])!.mark === '/', find(r, FIRE_SUBS[0])!.mark)
  check('② 첫 설치(주거용)에 롤업 ○', find(r, FIRE_SUBS[1])!.mark === '○', find(r, FIRE_SUBS[1])!.mark)
  check('② 두 번째 설치(캐비닛형)는 공란 — 값을 복제하지 않는다',
    find(r, FIRE_SUBS[3])!.mark === '', `"${find(r, FIRE_SUBS[3])!.mark}"`)
}

// ── ③ 설치된 하위가 하나도 없으면 롤업을 부모 행에 남긴다 (결과 유실 금지) ──
{
  const r = rows(facilityResultSection({
    facilityChecks: ['소화기구 및 자동소화장치'],
    resultMarks: { '소화기구 및 자동소화장치': 'X' },
    ledgerCodes: [],
  }))
  check('③ 하위 미등록 → 부모 행에 ×', find(r, '소화기구 및 자동소화장치')!.mark === '×',
    find(r, '소화기구 및 자동소화장치')!.mark)
  check('③ 하위는 전부 /', FIRE_SUBS.every(s => find(r, s)!.mark === '/'),
    FIRE_SUBS.map(s => `${s}=${find(r, s)!.mark}`).join(' | '))
}

// ── ④ 피난기구도 같은 방식 · 접힌 후속 줄은 앞 항목과 같은 행 ──
{
  const r = rows(facilityResultSection({
    facilityChecks: ['피난기구'],
    resultMarks: { '피난기구': 'O' },
    specs: { s36_evac: { evac_equipment: { types: ['승강식피난기'] } } } as never,
  }))
  check('④ 부모(피난기구) 행 존재·결과칸 공란',
    !!find(r, '피난기구') && find(r, '피난기구')!.mark === '', find(r, '피난기구')?.mark)
  check('④ 미설치 공기안전매트 행 = /', find(r, '공기안전매트')!.mark === '/', find(r, '공기안전매트')!.mark)
  check('④ 미설치 다수인피난장비 = /', find(r, '다수인피난장비')!.mark === '/', find(r, '다수인피난장비')!.mark)
  check('④ 설치된 승강식피난기에 롤업 ○', find(r, '승강식피난기')!.mark === '○', find(r, '승강식피난기')!.mark)
  check('④ 접힌 후속 줄은 앞 항목과 같은 행 — (간이)완강기',
    find(r, '공기안전매트')!.label.includes('(간이)완강기'), find(r, '공기안전매트')!.label)
  check('④ 접힌 후속 줄 — 하향식피난구용내림식사다리',
    find(r, '승강식피난기')!.label.includes('하향식피난구용내림식사다리'), find(r, '승강식피난기')!.label)
  check('④ 후속 줄이 독립 행이 되지 않는다',
    !r.some(x => x.label.startsWith('(간이)완강기')), r.map(x => x.label).slice(0, 8).join(' | '))
}

// ── ⑤ 다른 설비 행은 종전 그대로 (회귀) ──
{
  const r = rows(facilityResultSection({
    facilityChecks: ['옥내소화전설비'],
    resultMarks: { '옥내소화전설비': 'X' },
  }))
  check('⑤ 옥내소화전설비는 단일 행 · 결과 ×', find(r, '옥내소화전설비')!.mark === '×', find(r, '옥내소화전설비')!.mark)
  check('⑤ 구분 열 머리(소화설비)는 유지', r.length > 20, `행 ${r.length}`)
}

console.log(`\n${fail === 0 ? '✅ 전건 통과' : '❌ 실패 있음'} — ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
