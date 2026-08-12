/** [독립 재판정] 소방계획서_19 A4-4 — 설치장소 2줄 블록 원문↔구현 대조 + 렌더 실증
 *  실행: npx tsx --conditions=react-server scripts/_judge-a44-recheck.mts
 *  판정자 작성(구현자≠판정자). DB·서버 불필요 — 원문 hwpx를 직접 열어 기대 집합을 **동적으로 산출**한다.
 *  (기대 목록을 하드코딩한 _judge-af-19b.mts와 달리, 여기서는 원문이 곧 기댓값이다.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import r4mod from '../src/lib/doc-templates/report4.ts'
import type { Report4Data } from '../src/lib/doc-templates/report4.ts'
import r9mod from '../src/lib/doc-templates/report9.ts'
import type { Report9Data } from '../src/lib/doc-templates/report9.ts'
import schemamod from '../src/lib/facility-spec-schema.ts'

const { renderReport4 } = r4mod as unknown as typeof import('../src/lib/doc-templates/report4.ts')
const { renderReport9 } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')
const { FACILITY_SPEC_SECTIONS } = schemamod as unknown as typeof import('../src/lib/facility-spec-schema.ts')

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── ① 원문 파싱: hwpx(zip) → section0.xml → 문단 전수 ─────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url))
const HWPX = path.resolve(here, '../../erp_goal/_form/별지9호-placeholder.hwpx')
const zip = await JSZip.loadAsync(fs.readFileSync(HWPX))
const xml = await zip.file('Contents/section0.xml')!.async('string')

/** hp:p는 표 셀 안에서 중첩되므로 스택으로 최내곽 문단에 텍스트를 귀속시킨다(정규식 non-greedy 금지) */
function paragraphs(src: string): string[] {
  const out: Array<{ id: number; text: string }> = []
  const stack: Array<{ id: number; text: string }> = []
  const tagRe = /<(\/?)([A-Za-z0-9_:.-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&')
  let m: RegExpExecArray | null, seq = 0, inT = false
  while ((m = tagRe.exec(src))) {
    if (m[5] !== undefined) { if (inT && stack.length) stack[stack.length - 1].text += unesc(m[5]); continue }
    const close = m[1] === '/', name = m[2], self = m[4] === '/'
    if (name === 'hp:p') {
      if (close) { const p = stack.pop(); if (p) out.push(p) }
      else if (!self) stack.push({ id: seq++, text: '' })
      else out.push({ id: seq++, text: '' })
    } else if (name === 'hp:t') { if (close) inT = false; else if (!self) inT = true }
    else if (name === 'hp:lineBreak' && stack.length) stack[stack.length - 1].text += ' '
  }
  return out.sort((a, b) => a.id - b.id).map(p => p.text)
}
const paras = paragraphs(xml)

/** 2줄 판정: 다음 문단이 들여쓰기로 시작하고, 그 내용이 '설치장소:' 뒤 값 부분과 **축자 동일**이면 이음줄.
 *  구분자(':::', ': : :', ':') 모양에 의존하지 않고, 원문이 같은 빈 서식을 한 번 더 찍었는지로 판정한다. */
const locParas = paras.map((t, i) => ({ t, i })).filter(x => x.t.includes('설치장소'))
const twoLine = locParas.filter(({ t, i }) => {
  const nxt = paras[i + 1] ?? ''
  if (!/^\s{2,}\S/.test(nxt)) return false
  const value = t.slice(t.indexOf('설치장소') + '설치장소'.length).replace(/^\s*:?\s*/, '').trim()
  return nxt.trim() === value
})

/** 원문 라벨 앵커 → 스키마 블록 키 (앵커는 원문 고유 문자열, 역방향 최근접 매칭) */
const ANCHORS: Array<{ anchor: string; sec: string; blk: string }> = [
  { anchor: '옥내 소화전', sec: 's33_water_each', blk: 'indoor_hydrant' },
  { anchor: '조기진압용', sec: 's33_water_each', blk: 'early_suppression' },
  { anchor: '물분무소화설비', sec: 's33_water_each', blk: 'water_spray' },
  { anchor: '미분무소화설비', sec: 's33_water_each', blk: 'water_mist' },
  { anchor: '자동화재탐지설비', sec: 's35_alarm', blk: 'fire_detection' },
  { anchor: '화재알림설비', sec: 's35_alarm', blk: 'fire_alert' },
  { anchor: '피난기구', sec: 's36_evac', blk: 'evac_equipment' },
  { anchor: '인명구조기구', sec: 's36_evac', blk: 'rescue_equipment' },
  // 1줄 블록의 앵커도 넣어 오매칭 시 드러나게 한다
  { anchor: '스프링클러설비', sec: 's33_water_each', blk: 'sprinkler' },
  { anchor: '간이스프링클러설비', sec: 's33_water_each', blk: 'simple_sprinkler' },
  { anchor: '포', sec: 's33_water_each', blk: 'foam' },
  { anchor: '유도등', sec: 's36_evac', blk: 'guide_light' },
  { anchor: '비상조명등', sec: 's36_evac', blk: 'emergency_light' },
  { anchor: '휴대용 비상조명등', sec: 's36_evac', blk: 'portable_light' },
]
function ownerOf(i: number): string {
  for (let j = i - 1; j >= 0 && j > i - 12; j--) {
    const s = paras[j].trim()
    if (!s.startsWith('[')) continue                        // 설비 라벨 셀만
    const hit = ANCHORS.filter(a => s.includes(a.anchor))
      .sort((x, y) => y.anchor.length - x.anchor.length)[0]  // 최장 일치
    if (hit) return `${hit.sec}.${hit.blk}`
    return `?${j}:${s.slice(0, 30)}`
  }
  return '?'
}
// 화재조기진압용은 라벨이 '[ ] 화재' + '조기진압용' 두 문단으로 쪼개져 있어 앵커를 뒷 문단에서도 찾는다
function ownerOf2(i: number): string {
  const a = ownerOf(i)
  if (!a.startsWith('?')) return a
  for (let j = i - 1; j >= 0 && j > i - 12; j--) {
    const s = paras[j].trim()
    const hit = ANCHORS.filter(x => s.includes(x.anchor)).sort((x, y) => y.anchor.length - x.anchor.length)[0]
    if (hit) return `${hit.sec}.${hit.blk}`
  }
  return a
}

const formSecond = new Set(twoLine.map(x => ownerOf2(x.i)))
console.log('— ① 원문(별지9호-placeholder.hwpx) 전수 조사')
console.log(`  설치장소 문단 ${locParas.length}개 · 이음줄 보유 ${twoLine.length}개`)
twoLine.forEach(x => console.log(`     idx=${x.i}  →  ${ownerOf2(x.i)}`))
ok('원문 설치장소 문단 51개', locParas.length === 51, `실제 ${locParas.length}`)
ok('원문 2줄 블록 8개', twoLine.length === 8, `실제 ${twoLine.length}`)
ok('2줄 블록 라벨 매핑 전건 해석됨(미상 0)', ![...formSecond].some(k => k.startsWith('?')), [...formSecond].join(', '))
ok('원문 2줄 집합에 화재알림설비 포함', formSecond.has('s35_alarm.fire_alert'))

// ── ② 구현 스키마의 dong2 보유 집합과 대조 ────────────────────────────────────
console.log('\n— ② 구현 스키마(dong2 보유) ↔ 원문 집합 대조')
const schemaSecond = new Set<string>()
for (const s of FACILITY_SPEC_SECTIONS) for (const b of s.blocks) {
  if (b.fields.some(f => f.key === 'dong2')) schemaSecond.add(`${s.key}.${b.key}`)
}
const missing = [...formSecond].filter(k => !schemaSecond.has(k))     // 과소
const extra = [...schemaSecond].filter(k => !formSecond.has(k))       // 과다
console.log(`  구현 ${schemaSecond.size}개: ${[...schemaSecond].sort().join(', ')}`)
ok('과소 0 (원문 2줄인데 dong2 없음)', missing.length === 0, missing.join(', '))
ok('과다 0 (원문 1줄인데 dong2 있음)', extra.length === 0, extra.join(', '))
ok('집합 크기 동일(8)', schemaSecond.size === formSecond.size && schemaSecond.size === 8,
  `원문 ${formSecond.size} / 구현 ${schemaSecond.size}`)
// 둘째 동 필드 6종이 모두 열렸는지
const SECOND_KEYS = ['dong2', 'coverage2', 'from_ground2', 'from_floor2', 'to_ground2', 'to_floor2']
for (const key of [...formSecond].sort()) {
  const [sk, bk] = key.split('.')
  const blk = FACILITY_SPEC_SECTIONS.find(s => s.key === sk)?.blocks.find(b => b.key === bk)
  ok(`둘째 줄 필드 6종 — ${key}`, !!blk && SECOND_KEYS.every(k => blk.fields.some(f => f.key === k)))
}

// ── ③ 렌더 실증: 별지9호·별지4호 양쪽에 둘째 줄 값이 인쇄되는가 ────────────────
console.log('\n— ③ 렌더 실증 (renderReport9 · renderReport4)')
const r9base = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '재판정빌딩', purpose: '', address: '', inspPeriod: '', inspDays: '',
  companyName: '', companyPhone: '', consent: null, reportEmail: '',
  main: null, assistants: [], reportDate: '', submitTo: '',
  repRole: '', ownerName: '', ownerPhone: '', managerGrade: '',
  mgrName: '', mgrPhone: '', mgrEduDate: '',
  hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
  insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
  multiUseNone: false, multiUseCounts: {}, permitDate: '', useApprovalDate: '',
  totalArea: '', buildingArea: '', households: '', floorsAbove: '', floorsBelow: '',
  heightM: '', buildingCount: '',
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  elvR: '', elvE: '', elvV: '', pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  rampCount: '', stairsCount: '',
  facilityChecks: [], resultMarks: {}, muResults: {}, specs: {}, defectRows: [],
} as unknown as Report9Data
const r4base = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '재판정빌딩', purpose: '', address: '',
  facilityChecks: [], resultMarks: {}, muResults: {},
  main: null, assistants: [], inspStart: '', inspEnd: '', inspDays: '',
  companyName: '', specs: {},
} as unknown as Report4Data

const keys = [...formSecond].sort()
const specs: Record<string, Record<string, unknown>> = {}
keys.forEach((k, i) => {
  const [sk, bk] = k.split('.')
  specs[sk] = { ...(specs[sk] ?? {}), [bk]: {
    dong: `일동${i}`, coverage: '전체층', from_ground: '지상', from_floor: '1', to_ground: '지상', to_floor: '5',
    dong2: `이동${i}`, coverage2: '일부층', from_ground2: '지하', from_floor2: '2', to_ground2: '지하', to_floor2: '1',
  } }
})
const h9 = renderReport9({ ...r9base, specs })
const h4 = renderReport4({ ...r4base, specs })
keys.forEach((k, i) => {
  ok(`별지9호 둘째 동 인쇄 — ${k}`, h9.includes(`이동${i}`) && h9.includes(`일동${i}`), '둘째 동 값 소실')
  ok(`별지4호 둘째 동 인쇄 — ${k}`, h4.includes(`이동${i}`) && h4.includes(`일동${i}`), '둘째 동 값 소실')
})
// 둘째 줄이 '이어짐(:)' 형태로 나오는지 — 라벨 반복 없이
ok('둘째 줄은 ":"로 이어진 형태(라벨 반복 없음)', (h9.match(/<br>: 동명\(/g) ?? []).length === 8,
  `실제 ${(h9.match(/<br>: 동명\(/g) ?? []).length}`)
ok('별지4호도 동일 형태 8줄', (h4.match(/<br>: 동명\(/g) ?? []).length === 8,
  `실제 ${(h4.match(/<br>: 동명\(/g) ?? []).length}`)

// ── ④ 과다 없음(회귀): 원문 1줄 블록에 둘째 줄이 생기지 않았는가 ───────────────
console.log('\n— ④ 과다 없음(원문 1줄 블록)')
const ONE_LINE: Array<[string, string, string]> = [
  ['s33_water_each', 'sprinkler', '스프링클러설비'],
  ['s33_water_each', 'simple_sprinkler', '간이스프링클러설비'],
  ['s33_water_each', 'foam', '포소화설비'],
  ['s34_gas', 'gas_system', '가스계소화설비'],
  ['s35_alarm', 'standalone_detector', '단독경보형감지기'],
  ['s35_alarm', 'emergency_bell', '비상경보설비'],
  ['s36_evac', 'guide_light', '유도등'],
  ['s36_evac', 'emergency_light', '비상조명등'],
  ['s36_evac', 'portable_light', '휴대용비상조명등'],
]
for (const [sk, bk, label] of ONE_LINE) {
  const blk = FACILITY_SPEC_SECTIONS.find(s => s.key === sk)?.blocks.find(b => b.key === bk)
  ok(`스키마 dong2 없음 — ${label}`, !!blk && !blk.fields.some(f => f.key === 'dong2'), `${sk}.${bk} 미발견 또는 과다`)
}
{
  // 1줄 블록에 dong2를 억지로 넣어도 인쇄되지 않아야 한다(템플릿 과다 방지)
  const forced: Record<string, Record<string, unknown>> = {}
  ONE_LINE.forEach(([sk, bk], i) => {
    forced[sk] = { ...(forced[sk] ?? {}), [bk]: { dong: `단일${i}`, dong2: `과다${i}` } }
  })
  const hf = renderReport9({ ...r9base, specs: forced })
  const leaked = ONE_LINE.map((_, i) => `과다${i}`).filter(v => hf.includes(v))
  ok('1줄 블록에 둘째 동 값이 새지 않음', leaked.length === 0, leaked.join(', '))
  // 이음줄 자체는 빈 서식으로 늘 8개(원문과 동일) — 늘어나지도 줄지도 않아야 한다
  ok('1줄 블록에 값을 넣어도 이음줄 수 불변(8)', (hf.match(/<br>: 동명\(/g) ?? []).length === 8,
    `실제 ${(hf.match(/<br>: 동명\(/g) ?? []).length}`)
}

// ── ⑤ 값 미입력 회귀 ─────────────────────────────────────────────────────────
console.log('\n— ⑤ 값 미입력 회귀(빈 서식 유지)')
const empty9 = renderReport9(r9base)
const empty4 = renderReport4(r4base)
ok('별지9호 undefined/null 문자열 없음', !/undefined/.test(empty9) && !/>null</.test(empty9))
ok('별지4호 undefined/null 문자열 없음', !/undefined/.test(empty4) && !/>null</.test(empty4))
ok('빈 서식에도 둘째 줄 8개 유지(원문처럼 빈 칸)', (empty9.match(/<br>: 동명\(/g) ?? []).length === 8,
  `실제 ${(empty9.match(/<br>: 동명\(/g) ?? []).length}`)
ok('별지4호 빈 서식도 8개', (empty4.match(/<br>: 동명\(/g) ?? []).length === 8,
  `실제 ${(empty4.match(/<br>: 동명\(/g) ?? []).length}`)

// ── ⑥ 무선통신 접속단자 2칸 ──────────────────────────────────────────────────
console.log('\n— ⑥ 무선통신 접속단자 2칸(원문 일치)')
const termPara = paras.find(p => p.includes('접속단자 설치장소')) ?? ''
ok('원문 접속단자 칸 2개', (termPara.match(/\(\s+\)/g) ?? []).length === 2, `원문: ${termPara.trim()}`)
const hw = renderReport9({ ...r9base, specs: { s38_activity: { wireless: { terminals: '단자가', terminals2: '단자나' } } } })
ok('접속단자 1·2칸 모두 인쇄', hw.includes('단자가') && hw.includes('단자나'))
ok('빈 값이면 종전대로 빈 칸 2개', /◦ 접속단자 설치장소\([^)]*\), \([^)]*\)/.test(empty9))

console.log(`\n${fail === 0 ? '✅' : '❌'} A4-4 재판정 프로브 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
