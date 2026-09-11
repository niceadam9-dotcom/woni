/** 별지 9호 「다수동일때」 — 동별 인쇄 검사 (PDF + 갑지 엑셀 양쪽).
 *
 *  실데이터에 다동 고객이 아직 0명이므로(2026-09-08 실측 294/294 1동) **합성 표본**으로 판정한다.
 *  DB는 건드리지 않는다 — 조립본의 `otherBuildings`만 갈아 끼운다.
 *
 *  ⭐ 대조군을 반드시 함께 돌린다: **1동(빈 배열)일 때 종전과 같은가**가 이 확장의 안전줄이다.
 *    다동만 검사하면 "새 기능은 되는데 기존 문서가 깨진" 상태를 통과시킨다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-multi-building-form9.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { renderReport9, type Report9Data, type Report9MultiBuilding } from '../src/lib/doc-templates/report9.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const out: string[] = []
let pass = 0, fail = 0
const log = (s = '') => { out.push(s); console.log(s) }
const check = (name: string, ok: boolean, detail = '') => {
  log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); ok ? pass++ : fail++
}

/** 합성 동 — 값을 **서로 다르게** 준다. 같은 값을 넣으면 '2동 값이 3동 칸에 찍히는' 결함을
 *  통과시킨다(한 필드를 세 칸이 공유하던 종전 구조가 정확히 그 모양이었다). */
function bld(n: number, over: Partial<Report9MultiBuilding> = {}): Report9MultiBuilding {
  return {
    name: `${n}동`,
    permitDate: `20${10 + n}년 ${n}월 ${n}일`, useApprovalDate: '2020년 1월 1일',
    totalArea: String(1000 + n), buildingArea: String(500 + n), households: String(10 + n),
    floorsAbove: String(n), floorsBelow: String(n - 1), heightM: String(20 + n), buildingCount: '1',
    rampCount: String(n), stairsCount: String(n + 1), specialStairCount: '',
    elvR: String(n + 2), elvE: '', elvV: '',
    stCon: n === 2, stSteel: n === 3, stBrick: n === 4, stWood: false, stEtc: false,
    rfSlab: n === 2, rfTile: n === 3, rfSlate: n === 4, rfEtc: false,
    pkIn: n === 2, pkInUg: n === 2, pkInGround: false, pkInPiloti: false,
    pkMech: false, pkRoof: n === 3, pkOut: n === 4,
    ...over,
  }
}

/* ── 바탕 Report9Data는 **실조립본**을 쓴다 — 픽스처를 발명하면 그 픽스처가 현실과 갈라진다.
 *  ⚠ 생성물 파일(`_r9-after.json` 등)에 기대지 않는다. 그건 스크래치라 지워지는 순간
 *    이 검사가 영구히 깨진다(1회용 검사). DB에서 직접 조립한다. */
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { data: iRaw } = await admin.from('inspections').select('id, customer_id').order('id').limit(1)
const insp = ((iRaw ?? []) as Array<{ id: string; customer_id: string }>)[0]
if (!insp) { console.log('회차 0건 — 판정 불가(환경 축)'); process.exit(2) }
const real = (await assembleReport9(admin as never, insp.customer_id, insp.id)).data
check('실조립본 표본 확보(픽스처 발명 금지)', !!real && !!real.customerName, insp.id.slice(0, 8))
check('대조군 전제 — 표본은 1동이다(otherBuildings 비어 있음)',
  (real.otherBuildings ?? []).length === 0, JSON.stringify(real.otherBuildings))

const official: OfficialData = {
  company: { name: '㈜테스트', address: 'A', phone: '0', fax: '0' },
  docNo: 'D', sendDate: '2026년 9월', recipient: 'R', reference: '관계인',
  sender: 'S', senderSign: { name: 'N', title: 'T', rep: 'P' }, year: 2026, typeLabel: '작동점검',
}
const delegation: DelegationData = {
  typeLabel: '작동점검', owner: { name: '', position: '', phone: '', birth: '' },
  agent: { name: '', position: '', phone: '', birth: '' },
  periodLabel: '', daysLabel: '', submitDate: '', station: '',
}
const template = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const anchors = validateAnchors(template)
check('앵커 검증 통과(다수동 앵커 45칸 신설 포함)', anchors.ok, (anchors.failures ?? []).join(' · '))

/** 주입된 xlsx에서 시트의 특정 칸들을 되읽는다 — 빈 칸은 자기닫힘이라 별도 처리 */
async function readSheet(bytes: Uint8Array, sheet: string, cells: string[]): Promise<Map<string, string>> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(bytes)
  const wb = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relMap = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
  const dec = (s: string) => s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  let path = ''
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
    if (dec(m[1]) === sheet) path = 'xl/' + (relMap.get(m[2]) ?? '').replace(/^\/?xl\//, '')
  }
  const res = new Map<string, string>()
  if (!path || !zip.file(path)) { for (const c of cells) res.set(c, '<시트없음>'); return res }
  const sstXml = zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml')!.async('string') : ''
  const sst = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => dec(t[1])).join(''))
  const xml = await zip.file(path)!.async('string')
  const found = new Map<string, string>()
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, attrs, tail, body] = m
    if (tail === '/>') { found.set(ref, ''); continue }
    const vm = /<v>([\s\S]*?)<\/v>/.exec(body ?? '')
    const im = /<is>([\s\S]*?)<\/is>/.exec(body ?? '')
    found.set(ref, im
      ? [...im[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => dec(t[1])).join('')
      : vm ? (/\bt="s"/.test(attrs) ? (sst[Number(vm[1])] ?? '') : dec(vm[1])) : '')
  }
  for (const c of cells) res.set(c, found.get(c) ?? '')
  return res
}

/** 3블록의 대표 칸 — 오프셋 0/10/20 */
const blockCells = (off: number) => ({
  permit: `B${3 + off}`, area: `B${4 + off}`, households: `J${4 + off}`,
  height: `H${5 + off}`, ramp: `J${7 + off}`,
  struct: `B${6 + off}`, roof: `B${7 + off}`, stairs: `B${8 + off}`, park: `B${10 + off}`,
})

async function scenario(name: string, others: Report9MultiBuilding[], overflow: number) {
  log(`\n── ${name} (otherBuildings=${others.length}, overflow=${overflow})`)
  const d: Report9Data = { ...real, otherBuildings: others, buildingOverflow: overflow }

  // ① PDF
  const html = renderReport9(d)
  const hasPage = html.includes('특정소방대상물 정보 (동별)')
  check(`PDF 다수동 쪽 ${others.length ? '있음' : '없음'}`, hasPage === others.length > 0)
  for (const b of others) {
    check(`  PDF에 ${b.name} 이름이 인쇄된다`, html.includes(b.name))
    check(`  PDF에 ${b.name} 연면적 ${b.totalArea}`, html.includes(b.totalArea))
    check(`  PDF에 ${b.name} 건축허가일`, html.includes(b.permitDate))
  }
  check(`PDF 넘침 고지 ${overflow ? '있음' : '없음'}`,
    html.includes('인쇄되지 않았습니다') === overflow > 0)

  // ② 엑셀 — 주입 후 실제 셀 되읽기
  const values = buildWorkbookValues({
    official, delegation, report9: d as never, customerAddress: '',
    startISO: null, endISO: null, useApprovalISO: null, installedCodes: [], evacTypes: [], building: null,
  })
  const { targets, unmapped } = toInjectTargets(values, anchors.anchors)
  check('주입 값 누락 0', unmapped.length === 0, unmapped.map(a => a.field).join(','))
  const r = await injectWorkbook(template, targets)
  check('주입 미착지 0', r.missed.length === 0, r.missed.slice(0, 5).join(','))

  const cells = [0, 10, 20].flatMap(off => Object.values(blockCells(off)))
  const got = await readSheet(r.bytes, '다수동일때', cells)
  for (const [i, off] of [0, 10, 20].entries()) {
    const c = blockCells(off)
    const b = others[i]
    if (b) {
      check(`  블록${i + 1} 연면적 = ${b.totalArea}`, got.get(c.area) === b.totalArea, got.get(c.area))
      check(`  블록${i + 1} 세대수 = ${b.households} (단위 미포함)`, got.get(c.households) === b.households, got.get(c.households))
      check(`  블록${i + 1} 높이 = ${b.heightM}`, got.get(c.height) === b.heightM, got.get(c.height))
      check(`  블록${i + 1} 건축허가일`, got.get(c.permit) === b.permitDate, got.get(c.permit))
      // √ 위치가 **그 동의 것**인가 — 블록끼리 값이 새면 여기서 잡힌다
      const st = got.get(c.struct) ?? ''
      const want = b.stCon ? '콘크리트구조' : b.stSteel ? '철골구조' : b.stBrick ? '조적조' : ''
      check(`  블록${i + 1} 구조 √ = ${want}`, new RegExp(`\\[√\\]${want}`).test(st), st)
      const rfWant = b.rfSlab ? '슬라브' : b.rfTile ? '기와' : b.rfSlate ? '슬레이트' : ''
      check(`  블록${i + 1} 지붕 √ = ${rfWant}`, new RegExp(`\\[√\\]${rfWant}`).test(got.get(c.roof) ?? ''), got.get(c.roof))
    } else {
      // 🚨 값 없는 블록은 **빈 서식**이어야 한다 — 서식의 표본 답이 남으면 남의 건물이 인쇄된다
      check(`  블록${i + 1} 미사용 — 숫자칸 공란`, [c.area, c.households, c.height, c.permit, c.ramp].every(x => (got.get(x) ?? '') === ''),
        [c.area, c.households, c.height, c.permit, c.ramp].map(x => `${x}=${JSON.stringify(got.get(x))}`).join(' '))
      check(`  블록${i + 1} 미사용 — √ 잔존 0`, ![c.struct, c.roof, c.stairs, c.park].some(x => (got.get(x) ?? '').includes('√')),
        [c.struct, c.roof, c.stairs, c.park].map(x => got.get(x)).join(' | '))
      check(`  블록${i + 1} 미사용 — 표본 '( 1 개소 )' 잔존 0`, !(got.get(c.stairs) ?? '').includes('( 1 개소 )'), got.get(c.stairs))
    }
  }
}

await scenario('대조군 — 1동(현재 전 고객)', [], 0)
await scenario('2동', [bld(2)], 0)
await scenario('4동 — 서식 만재', [bld(2), bld(3), bld(4)], 0)
await scenario('5동 — 서식 초과', [bld(2), bld(3), bld(4)], 1)

log(`\n결과: ${pass} PASS / ${fail} FAIL`)
writeFileSync('scripts/test-multi-building-form9.txt', out.join('\n'), 'utf8')
process.exit(fail ? 1 : 0)
