/** 소방계획서 한글파일(HWPX) — 서식·사상·채움 검증 (2026-10-06)
 *
 *  단언: ①엑셀 앵커가 표지 소재지·작성(엑셀 전용 사진 표지) 둘만 빼고 전부 HWPX 칸으로 되돌아간다
 *  ②커밋된 서식에 이전 작성분 흔적(manifest 니들·「리젠시빌」·표본 개정일) 0 · mimetype 첫 항목·무압축
 *  ③픽스처로 채우면 칸 없음·중첩 0, 표·칸·그림 수 불변 ④**전수 대조** — 되돌아간 모든 칸의 글자가 그 앵커의
 *  값과 같다(공백 무시, 단위만 인쇄된 칸은 값+단위) ⑤런 보존 — 표지 제목의 빨간 건물명 런·장식 그림,
 *  체크 칸은 상자 글자만 ⑥다시 채워도 같은 결과(멱등)
 *  ⚠ 개수 하한을 먼저 단언한다(공허 통과 방지 — feedback_exhaustive_has_an_axis).
 *  실행: npx tsx --conditions=react-server scripts/test-fire-plan-hwpx.mts */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import { anchorToHwpx, fillFirePlanHwpx } from '../src/lib/fire-plan-hwpx.ts'
import { parseTables } from '../src/lib/hwpx-table.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}
const tpl = new Uint8Array(readFileSync('templates/fire-plan-form.hwpx'))
const ALL = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)
const sec = async (b: Uint8Array) => (await JSZip.loadAsync(b)).file('Contents/section0.xml')!.async('string')

console.log('── A. 사상 ──')
{
  const unm = FIRE_PLAN_ANCHORS.filter(a => !anchorToHwpx(a.sheet, a.cell)).map(a => a.field)
  check('앵커가 충분히 많다(공허 통과 방지)', FIRE_PLAN_ANCHORS.length >= 1400, `${FIRE_PLAN_ANCHORS.length}`)
  check('사상 안 되는 것 = 표지 소재지·작성 둘뿐', unm.length === 2 && unm.includes('cover_address') && unm.includes('cover_issued'), unm.join(','))
  const t = anchorToHwpx('1.1 건축물 일반현황', 'AW6')
  check('1.1 AW6(소방안전관리자) → 표5 (3,8)', t?.table === 5 && t.row === 3 && t.col === 8, JSON.stringify(t))
  const c = anchorToHwpx('표지', 'A3')
  check('표지 A3(제목 띠) → 표1 (0,0)', c?.table === 1 && c.row === 0 && c.col === 0, JSON.stringify(c))
}

console.log('── B. 커밋된 서식 ──')
{
  const zip = await JSZip.loadAsync(tpl)
  const x = await sec(tpl)
  const needles = [...FIRE_PLAN_MANIFEST.scrubNeedles, '리젠시빌', '25.1.14']
  const left = needles.filter(n => x.includes(n))
  check(`흔적 니들 ${needles.length}종 0건`, needles.length >= 10 && left.length === 0, left.join(','))
  const raw = readFileSync('templates/fire-plan-form.hwpx')
  check('mimetype이 첫 항목·무압축', raw.subarray(30, 38).toString() === 'mimetype' && raw.readUInt16LE(8) === 0)
  check('표 95·칸 4033', (x.match(/<hp:tbl /g) ?? []).length === 95 && (x.match(/<hp:tc /g) ?? []).length === 4033)
  check('미리보기 글 비움', (await zip.file('Preview/PrvText.txt')!.async('string')) === '')
}

const fixture = {
  year: 2026, buildingName: '테스트빌딩', address: '경기 양평군 양평읍 시험로 1',
  ownerName: '홍길동', ownerPhone: '010-1111-2222', managerName: '김관리', managerPhone: '010-3333-4444',
  receiverLocation: '1층 계단 옆', grade: '3급', purpose: '근린생활시설', useApprovalDate: '2012-08-16',
  totalArea: '691.85', buildingArea: '195.49', floors: '지하 1층 / 지상 3층', height: '12',
  structure: '철근콘크리트구조', roof: '슬래브', elevators: { passenger: '1', emergency: '', evac: '' },
  parkingSummary: '옥외 자주식 3대', fireStation: '양평소방서',
} as unknown as FirePlanGenData
const values = buildFirePlanValues(fixture)

console.log('── C. 채움 ──')
const { bytes, stats } = await fillFirePlanHwpx(tpl, values, ALL)
const out = await sec(bytes)
{
  check('칸 없음 0·중첩 0', stats.missingCell.length === 0 && stats.skippedNested.length === 0,
    [...stats.missingCell, ...stats.skippedNested].slice(0, 3).join(' | '))
  check('쓴 칸이 충분하다', stats.written >= 1400, `${stats.written}`)
  check('표·칸·그림 수 불변', (out.match(/<hp:tbl /g) ?? []).length === 95 && (out.match(/<hp:tc /g) ?? []).length === 4033
    && (out.match(/<hp:pic /g) ?? []).length === ((await sec(tpl)).match(/<hp:pic /g) ?? []).length)
}

console.log('── D. 전수 대조(되돌아간 모든 칸 = 앵커 값) ──')
{
  const before = parseTables(await sec(tpl)), after = parseTables(out)
  const cellAt = (ts: ReturnType<typeof parseTables>, t: number, r: number, c: number) =>
    ts[t]?.cells.find(x => x.row === r && x.col === c)?.text ?? null
  const sq = (s: string) => s.replace(/\s+/g, '')
  const UNIT = /^(㎡|m|급|명|층|대|개소|km|분)$/
  // 같은 칸을 둘 이상의 앵커가 가리키면 마지막 것이 이긴다(fillFirePlanHwpx와 같은 순서)
  const want = new Map<string, { field: string; v: string; t: number; r: number; c: number }>()
  for (const a of FIRE_PLAN_ANCHORS) {
    const t = anchorToHwpx(a.sheet, a.cell)
    if (!t) continue
    const v = values.get(a.field)
    want.set(`${t.table},${t.row},${t.col}`, { field: a.field, v: v === null || v === undefined ? '' : String(v), t: t.table, r: t.row, c: t.col })
  }
  const bad: string[] = []
  for (const w of want.values()) {
    const orig = (cellAt(before, w.t, w.r, w.c) ?? '').trim()
    const exp = UNIT.test(orig) ? (w.v ? (w.v.endsWith(orig) ? w.v : w.v + orig) : orig) : w.v
    const got = cellAt(after, w.t, w.r, w.c)
    if (got === null || sq(got) !== sq(exp)) bad.push(`${w.field}@표${w.t}(${w.r},${w.c}) 기대「${exp.slice(0, 20)}」 실제「${(got ?? '없음').slice(0, 20)}」`)
  }
  check(`대조 칸 수가 충분하다`, want.size >= 1400, `${want.size}`)
  check('되돌아간 모든 칸 = 앵커 값', bad.length === 0, bad.length ? `${bad.length}건 예: ${bad.slice(0, 3).join(' / ')}` : `${want.size}칸`)
  check('연면적 = 691.85㎡ · 높이 = 12m · 급수 = 3급',
    cellAt(after, 5, 7, 3) === '691.85㎡' && cellAt(after, 5, 8, 3) === '12m' && cellAt(after, 5, 6, 3) === '3급',
    `${cellAt(after, 5, 7, 3)} · ${cellAt(after, 5, 8, 3)} · ${cellAt(after, 5, 6, 3)}`)
}

console.log('── E. 런·그림 보존 ──')
{
  const st = [...out.matchAll(/<hp:tbl /g)].map(m => m.index!)
  const title = out.slice(st[1], st[2])
  // 깨끗한 서식은 빨간 건물명 런이 비어 있다 — 이름은 그 런으로 들어간다(앞 「[ 」 파란 런에 붙으면 이름이 파랗게 찍힌다).
  // 이름 뒤 띄어쓰기 한 칸이 빨간 런에 붙는 것은 무해하다(보이지 않는 글자)
  check('표지 제목 — 건물명이 빨간 런(147)에', /<hp:run charPrIDRef="147"><hp:t>테스트빌딩 ?<\/hp:t>/.test(title))
  check('표지 제목 — 괄호 런(127) 둘 다 남는다', /<hp:run charPrIDRef="127"><hp:t>\[ <\/hp:t>/.test(title) && /<hp:run charPrIDRef="127"><hp:t> ?\]<\/hp:t>/.test(title))
  check('표지 제목 칸의 장식 그림 보존', title.includes('<hp:pic '))
  const f11 = out.slice(st[5], st[6])
  check('승용 체크 — 상자 런만 ■, 라벨 런 그대로', /<hp:run charPrIDRef="45"><hp:t>■<\/hp:t><\/hp:run><hp:run charPrIDRef="46"><hp:t> 승용<\/hp:t>/.test(f11))
  check('비상용 — 빈 상자 유지', /☐ 비상용|☐<\/hp:t><\/hp:run><hp:run charPrIDRef="\d+"><hp:t> 비상용/.test(f11))
}

console.log('── F. 멱등 ──')
{
  const again = await fillFirePlanHwpx(bytes, values, ALL)
  const a = parseTables(out).map(t => t.cells.map(c => c.text).join('|')).join('#')
  const b = parseTables(await sec(again.bytes)).map(t => t.cells.map(c => c.text).join('|')).join('#')
  check('같은 값으로 다시 채워도 칸 글자 동일', a === b)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
