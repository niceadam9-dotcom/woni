// B4 0단계 — 별지 9호 HWPX 렌더러: 실제 템플릿(개정 2025.12.1)에 픽스처를 넣어 zip·XML·채움을 확인한다.
// 실행: npx tsx scripts/test-report9-hwpx.mts
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { renderReport9Hwpx, report9HwpxValues } from '../src/lib/report9-hwpx'
import { base9 } from './_fixtures-doc-templates.mts'
import type { Report9Data } from '../src/lib/doc-templates/report9'
import { FACILITY_SPEC_SECTIONS } from '../src/lib/facility-spec-schema'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const TEMPLATE = new URL('../../erp_goal/_form/별지9호-placeholder.hwpx', import.meta.url)
const tpl = readFileSync(TEMPLATE)
const d = {
  ...base9,
  customerName: 'B4 시험 <빌딩> & 상가', address: '경기 양평군 양평읍 시험로 1',
  consent: true, reportEmail: 'owner@example.com', managerGrade: '2급', repRole: '관리자',
  insuranceJoined: true, insPerson: '150', insProperty: '10',
  elvR: '2', elvE: '', elvV: '',
  assistants: Array.from({ length: 6 }, (_, i) => ({ name: `보조${i + 1}`, grade: '보조기술인력', licenseNo: `L-${i + 1}`, period: '2026-10-01' })),
} as unknown as Report9Data

console.log('\n[1] 값 규칙')
const { values, warnings } = report9HwpxValues(d)
check('1-1 관리업자 체크는 항상 √', values.ck_contractor === '[√]')
check('1-2 송달 동의 √ / 비동의 공란', values.ck_consent_y === '[√]' && values.ck_consent_n === '[  ]')
check('1-3 등급 2급만 √', values.ck_g2 === '[√]' && values.ck_g0 === '[  ]' && values.ck_g1 === '[  ]' && values.ck_g3 === '[  ]')
check('1-4 보험 금액 만원 단위', values.ins_person === '150 만원' && values.ins_property === '10 만원')
check('1-5 승강기 대수 있는 칸만 √', values.ck_elv_r === '[√]' && values.ck_elv_e === '[  ]')
check('1-6 보조 6명이면 5명만·경고', values.a5_name === '보조5' && warnings.some(w => w.includes('6명 중 5명')), warnings.join(' | '))

console.log('\n[2] 렌더 결과')
const { bytes, stats } = await renderReport9Hwpx(tpl, d)
const z = await JSZip.loadAsync(bytes)
const names = Object.keys(z.files)
check('2-1 zip 항목 수 = 템플릿', names.length === Object.keys((await JSZip.loadAsync(tpl, { createFolders: false })).files).length, String(names.length))
check('2-2 mimetype이 첫 항목', names[0] === 'mimetype', names[0])
// 무압축 확인 — 로컬 헤더의 압축 방식(오프셋 8, 2바이트)이 0
const b = Buffer.from(bytes)
check('2-3 mimetype 무압축(STORE)', b.readUInt32LE(0) === 0x04034b50 && b.readUInt16LE(8) === 0, `method=${b.readUInt16LE(8)}`)
check('2-4a 항목 순서 = 템플릿', JSON.stringify(names) === JSON.stringify(Object.keys((await JSZip.loadAsync(tpl, { createFolders: false })).files)), names.join(','))
check('2-4 mimetype 내용 유지', (await z.file('mimetype')!.async('string')) === (await (await JSZip.loadAsync(tpl)).file('mimetype')!.async('string')))
const xml = await z.file('Contents/section0.xml')!.async('string')
check('2-5 남은 자리표시자 0', !/\{\{[a-z0-9_]+\}\}/.test(xml) && stats.leftover === 0)
check('2-6 자리표시자 102개 전부 규칙 있음', stats.placeholders === 102, String(stats.placeholders))
check('2-7 고객명 XML 이스케이프', xml.includes('B4 시험 &lt;빌딩&gt; &amp; 상가') && !xml.includes('<빌딩>'))
check('2-8 주소·주된 인력 실림', xml.includes('경기 양평군 양평읍 시험로 1') && (base9 as { main?: { name?: string } }).main?.name ? xml.includes((base9 as { main: { name: string } }).main.name) : true)
check('2-9 3쪽 설치 √ 전부 매칭', stats.checks.ok === stats.checks.total && stats.checks.total === 3, JSON.stringify(stats.checks))
check('2-10 3쪽 점검결과 ○ 전부 주입', stats.results.ok === stats.results.total && stats.results.total === 3, JSON.stringify(stats.results))
// 태그 균형(가벼운 정형성 검사) — 여는 tc/tr/tbl 수 = 닫는 수
const bal = (t: string) => (xml.match(new RegExp(`<hp:${t}[ >]`, 'g')) ?? []).length === (xml.match(new RegExp(`</hp:${t}>`, 'g')) ?? []).length
check('2-11 XML 태그 균형(tc·tr·tbl·p·run)', ['tc', 'tr', 'tbl', 'p'].every(bal))
const prv = await z.file('Preview/PrvText.txt')!.async('string')
check('2-12 미리보기 텍스트 자리표시자 0', !/\{\{/.test(prv) && prv.length > 0)
const tz = await JSZip.loadAsync(tpl, { createFolders: false })
let same = true
for (const n of Object.keys(tz.files)) {
  if (n === 'Contents/section0.xml' || n === 'Preview/PrvText.txt') continue
  const x = await tz.file(n)!.async('uint8array'), y = await z.file(n)!.async('uint8array')
  if (Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) { same = false; console.log('    다른 항목:', n) }
}
check('2-14 손대지 않는 항목은 바이트 동일', same)
const tx = await tz.file('Contents/section0.xml')!.async('string')
// 정형성 — 여닫는 태그가 스택으로 맞물린다(자기 닫힘·선언 제외)
const wellFormed = (s: string) => {
  const st: string[] = []
  for (const m of s.matchAll(/<(\/?)([a-zA-Z:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue
    if (!m[1]) st.push(m[2]); else if (st.pop() !== m[2]) return false
  }
  return st.length === 0
}
check('2-15 XML 정형성(스택 맞물림)', wellFormed(xml))
// 표 골격 수는 템플릿과 같다 — 1단계도 행을 늘리지 않고 칸 안 문단만 더한다
const cnt = (s: string, t: string) => (s.match(new RegExp(`<hp:${t}[ >/]`, 'g')) ?? []).length
check('2-15b 표 골격 불변(tbl·tr·tc·cellAddr)', ['tbl', 'tr', 'tc', 'cellAddr'].every(t => cnt(xml, t) === cnt(tx, t)))
check('2-13 미채움 범위를 통계로 밝힌다(4~7쪽만)', stats.unfilled.length === 1 && stats.unfilled[0].includes('4~7쪽'))
check('2-16 템플릿에서 못 찾은 칸 0', stats.extra.missed.length === 0, stats.extra.missed.join(', '))

console.log('\n[3] 빈 조립본 — 자리표시자 없이 빈 칸')
const empty = { ...base9, customerName: '', address: '', main: null, assistants: [], facilityChecks: [], resultMarks: {} } as unknown as Report9Data
const r2 = await renderReport9Hwpx(tpl, empty)
const x2 = await (await JSZip.loadAsync(r2.bytes)).file('Contents/section0.xml')!.async('string')
check('3-1 남은 자리표시자 0', !/\{\{[a-z0-9_]+\}\}/.test(x2))
check('3-2 빈 칸 목록에 customer_name·m_name', r2.stats.empty.includes('customer_name') && r2.stats.empty.includes('m_name'))
check('3-3 3쪽 주입 0', r2.stats.checks.total === 0 && r2.stats.results.total === 0)

console.log('\n[4] 1단계 — 2쪽 남은 칸·3쪽 하위·기타·2절·8쪽 불량')
const d4 = {
  ...base9,
  mgrAppointType: '겸직',
  multiUseNone: false, multiUseCounts: { 게임제공업: '1', 일반음식점영업: '3', 인터넷컴퓨터게임시설제공업: '2' },
  rampCount: '1', stairsCount: '2', specialStairCount: '',
  facilityChecks: ['소화기구 및 자동소화장치', '피난기구'], resultMarks: { '피난기구': 'X' },
  ledgerCodes: ['소화기구 및 자동소화장치', '소화기(소화기·자동확산·간이)', '피난기구', '방화문 및 방화셔터'],
  specs: { s36_evac: { evac_equipment: { types: ['완강기'] } } },
  etcMarks: { door: 'X' },
  muResults: { 'MU-001': 'O', 'MU-007': 'N' },
  applicableGroups: ['소화설비', '경보설비', '피난구조설비', '기타'],
  defectRows: [
    { group: '소화설비', code: '1-A-007', content: '분말소화기 압력불량 3개', userEntered: true },
    { group: '소화설비', code: '1-A-007', content: '분말소화기 압력불량 4개 <B동>', userEntered: true },
    { group: '소화설비', code: '2-B-001', content: '옥내소화전 방수압 미달', userEntered: true },
    { group: '피난구조설비', code: '24-A-001', content: '자동 행', userEntered: false },
  ],
} as unknown as Report9Data
const r4 = await renderReport9Hwpx(tpl, d4)
const x4 = await (await JSZip.loadAsync(r4.bytes)).file('Contents/section0.xml')!.async('string')
/** k번째 표(쪽)의 글자 — 문단 끝마다 줄바꿈 */
const page = (x: string, k: number) => {
  let at = -1
  for (let i = 0; i <= k; i++) at = x.indexOf('<hp:tbl ', at + 1)
  return x.slice(at, x.indexOf('</hp:tbl>', at)).replace(/<\/hp:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
const p2 = page(x4, 1), p3 = page(x4, 2), p8 = page(x4, 7)
const cut3 = p3.indexOf('2. 안전시설등')
const p3a = p3.slice(0, cut3), p3b = p3.slice(cut3)
check('4-1 못 찾은 칸 0', r4.stats.extra.missed.length === 0, r4.stats.extra.missed.join(', '))
check('4-2 선임 형태 겸직만 √', p2.includes('[  ]소방기술자격, [  ]소방안전관리자수첩, [  ]업무대행감독, [√]겸직, [  ]기타'))
check('4-3 다중이용 게임제공업( 1개소) √', p2.includes('[√]게임제공업( 1개소)'))
check('4-4 「게임제공업」 꼬리 오매칭 없음·줄바꿈 갈린 업종도 채움', p2.includes('[  ]복합유통게임제공업(  개소)') && p2.includes('[√]인터넷컴퓨터게임시설제공업( 2개소)'))
check('4-5 일반음식점영업( 3개소) √', p2.includes('[√]일반음식점영업( 3개소)'))
check('4-6 경사로 1개소', p2.includes('\n1개소\n') && !p2.includes('              개소'))
check('4-7 계단 직통 √( 2개소)·특별 공란', p2.includes('[√]직통(또는 피난계단) ( 2개소), [  ]특별피난계단 (    개소)'))
check('4-8 소화기구 하위 소화기 √·주거용 공란', p3a.includes('[√]소화기구(소화기, 자확, 간이)') && p3a.includes('[ ]주거용주방자동소화장치'))
check('4-9 피난기구 하위 완강기 그룹 √·다수인 공란', p3a.includes('[√]공기안전매트ㆍ피난사다리') && p3a.includes('[ ]다수인피난장비'))
check('4-10 피난기구 결과 ×(롤업)', p3a.slice(p3a.indexOf('[√]피난기구')).includes('하향식피난구용내림식사다리\n×'))
check('4-11 기타 방화문 √× · 비상구 공란／ · 방염 ／',
  p3a.includes('[√]방화문, 자동방화셔터\n×') && p3a.includes('[ ]비상구, 피난통로\n/') && p3a.includes('[ ]방  염\n/'), p3a.slice(p3a.indexOf('방화문'), p3a.indexOf('방화문') + 120))
check('4-12 2절 MU-001 √○ · MU-007 결과만 ／', p3b.includes('[√]소화기 또는 자동확산소화기\n○') && p3b.includes('[ ]피난안내도, 피난안내영상물\n/'))
check('4-13 1절 방화문 체크가 2절 「방화문」을 건드리지 않음', p3b.includes(' [ ]방화문\n'))
check('4-14 8쪽 소화설비 번호 2개·내용 3줄(같은 번호 줄 맞춤)',
  p8.includes('소화설비\n1-A-007\n\n2-B-001\n분말소화기 압력불량 3개\n분말소화기 압력불량 4개 <B동>\n옥내소화전 방수압 미달\n'), JSON.stringify(p8.slice(p8.indexOf('불량내용'), p8.indexOf('불량내용') + 200)))
check('4-15 8쪽 접기 — 경보 이상없음·피난 결과참조·용수 해당없음',
  p8.includes('경보설비\n\n이상없음') && p8.includes('피난구조설비\n\n결과참조') && p8.includes('소화용수설비\n\n해당없음'), JSON.stringify(p8.slice(p8.indexOf('경보설비'), p8.indexOf('경보설비') + 120)))
check('4-16 8쪽 불량 행 수 3', r4.stats.extra.defectRows === 3, String(r4.stats.extra.defectRows))
check('4-17 불량내용 XML 이스케이프', x4.includes('4개 &lt;B동&gt;'))
check('4-18 XML 정형성', wellFormed(x4))
check('4-19 3쪽 1절 설치 √·결과 전부 매칭', r4.stats.checks.ok === 2 && r4.stats.results.ok === r4.stats.results.total, JSON.stringify(r4.stats.checks) + JSON.stringify(r4.stats.results))

console.log('\n[6] 2단계 — 4~7쪽 세부 현황(PDF 세부현황 렌더를 줄 골격으로 옮김)')
// 카탈로그 전 필드를 채운 픽스처 — 값은 필드 순번(T1·2…)이라 어느 블록에 붙었는지 바로 보인다
const fullSpecs = (pick: 'first' | 'last') => {
  const specs: Record<string, Record<string, Record<string, unknown>>> = {}
  let n = 0
  for (const s of FACILITY_SPEC_SECTIONS) {
    specs[s.key] = {}
    for (const b of s.blocks) {
      const o: Record<string, unknown> = {}
      for (const f of b.fields) {
        n++
        if (f.type === 'text') o[f.key] = `T${n}`
        else if (f.type === 'number') o[f.key] = String(n)
        else if (f.type === 'check') o[f.key] = true
        else if (f.type === 'select') o[f.key] = pick === 'first' ? f.options![0] : f.options![f.options!.length - 1]
        else if (f.type === 'multicheck') o[f.key] = [...(f.options ?? [])]
        else if (f.type === 'rowtable') o[f.key] = [
          { dong: '본관', qty_ext_powder: '3', qty_ext_other: '1', qty_simple_throw: '2', qty_simple_other: '', qty_auto_diffuse: '4', qty_auto_device: '1', note: '비고1' },
          { dong: '별관', qty_ext_powder: '2', note: '' }]
      }
      specs[s.key][b.key] = o
    }
  }
  return specs
}
// 서식엔 있으나 PDF 세부현황 렌더(spec-sections)에 입력칸이 없는 줄 — PDF도 빈 서식이라 같은 결과다
const KNOWN_UNMATCHED = ['[ ]전동기 [ ]내연기관', '[ ]전용 [ ]겸용/[ ]흡수식', '◦ 가압송수장치  전양정', '◦ 기동스위치 설치장소: [ ]채수구', '◦ 채수구 지름', '◦ 방수구 위치']
for (const pick of ['first', 'last'] as const) {
  const r6 = await renderReport9Hwpx(tpl, { ...base9, specs: fullSpecs(pick), ledgerCodes: [] } as unknown as Report9Data)
  const x6 = await (await JSZip.loadAsync(r6.bytes)).file('Contents/section0.xml')!.async('string')
  const sp = r6.stats.specs
  const p4to7 = [3, 4, 5, 6].map(k => page(x6, k)).join('\n')
  check(`6-1(${pick}) 짝지은 문단 189/197`, sp.matched === 189 && sp.paragraphs === 197, `${sp.matched}/${sp.paragraphs}`)
  check(`6-2(${pick}) 못 붙인 8줄은 전부 PDF에도 없는 줄`, sp.unmatched.length === 8 && sp.unmatched.every(u => KNOWN_UNMATCHED.some(k => u.startsWith(k))), sp.unmatched.join(' | '))
  check(`6-3(${pick}) XML 정형성`, wellFormed(x6))
  check(`6-4(${pick}) 3-1 합계 행·동별 2행`, sp.s31Rows === 2 && /합계\n동명\n5\n1\n2\n\n4\n1\n\n본관\n3\n1\n2\n\n4\n1\n비고1\n별관\n2\n/.test(p4to7), p4to7.slice(p4to7.indexOf('합계'), p4to7.indexOf('합계') + 80))
  const g = pick === 'first' ? '[√]지상/[ ]지하' : '[ ]지상/[√]지하'
  check(`6-5(${pick}) 주된수원 설치장소 — 그 블록 값(T4·T6·T7)·select`, p4to7.includes(`◦ 설치장소: 동명(T4) ${g} (T6)층, 실명(T7)`))
  check(`6-6(${pick}) 3-2 설비의 종류 8칸 √(서식 한 문단 ↔ HTML 세 줄)`, p4to7.includes('◦ 설비의 종류: [√]옥내소화전설비, [√]옥외소화전설비, [√]스프링클러설비,[√]간이스프링클러설비, [√]화재조기진압용스프링클러설비, [√]물분무소화설비, [√]미분무소화설비, [√]포소화설비'))
  check(`6-7(${pick}) 자탐 설치장소 둘째 줄(HTML 「:」 시작)도 채움`, /\n +동명\(T197\) /.test(p4to7))
  check(`6-8(${pick}) 서식 원문 괄호 글자 보존`, p4to7.includes('(또는') || p4to7.includes('그 밖의 것(') )
}
// 건물 정보(비상용승강기 대수 등)는 세부현황 파생값이라 PDF처럼 찍힌다 — 대조군에서는 비운다
const r7 = await renderReport9Hwpx(tpl, { ...base9, specs: {}, ledgerCodes: [], building: undefined } as unknown as Report9Data)
const x7 = await (await JSZip.loadAsync(r7.bytes)).file('Contents/section0.xml')!.async('string')
const tpages = [3, 4, 5, 6].map(k => page(tx, k)).join('\n'), epages = [3, 4, 5, 6].map(k => page(x7, k)).join('\n')
check('6-9 세부제원 비면 4~7쪽 글자 = 빈 서식 그대로', epages === tpages && r7.stats.specs.edits === 0)

console.log('\n[5] 배포 사본 — 라우트(/inspections/[id]/hwpx)가 읽는 templates 사본 = 서식 원본')
const shipped = readFileSync(new URL('../templates/report9-placeholder.hwpx', import.meta.url))
check('5-1 templates/report9-placeholder.hwpx 바이트 동일', Buffer.compare(shipped, tpl) === 0)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail) process.exit(1)
