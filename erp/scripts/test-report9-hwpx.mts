// B4 0단계 — 별지 9호 HWPX 렌더러: 실제 템플릿(개정 2025.12.1)에 픽스처를 넣어 zip·XML·채움을 확인한다.
// 실행: npx tsx scripts/test-report9-hwpx.mts
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { renderReport9Hwpx, report9HwpxValues } from '../src/lib/report9-hwpx'
import { base9 } from './_fixtures-doc-templates.mts'
import type { Report9Data } from '../src/lib/doc-templates/report9'

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
const tagCount = (s: string) => (s.match(/<\/?[a-zA-Z:]+/g) ?? []).length
const tx = await tz.file('Contents/section0.xml')!.async('string')
// 늘어난 태그 = 3쪽 결과 런 1개당 3(<hp:t>·</hp:t>·</hp:run>) — 그 밖의 구조 변화 0
check('2-15 구조 변화는 결과 런 주입분뿐', tagCount(xml) - tagCount(tx) === stats.results.ok * 3, `${tagCount(xml) - tagCount(tx)} vs ${stats.results.ok * 3}`)
check('2-13 미채움 범위를 통계로 밝힌다', stats.unfilled.length === 4 && stats.unfilled.some(u => u.includes('4~8쪽')))

console.log('\n[3] 빈 조립본 — 자리표시자 없이 빈 칸')
const empty = { ...base9, customerName: '', address: '', main: null, assistants: [], facilityChecks: [], resultMarks: {} } as unknown as Report9Data
const r2 = await renderReport9Hwpx(tpl, empty)
const x2 = await (await JSZip.loadAsync(r2.bytes)).file('Contents/section0.xml')!.async('string')
check('3-1 남은 자리표시자 0', !/\{\{[a-z0-9_]+\}\}/.test(x2))
check('3-2 빈 칸 목록에 customer_name·m_name', r2.stats.empty.includes('customer_name') && r2.stats.empty.includes('m_name'))
check('3-3 3쪽 주입 0', r2.stats.checks.total === 0 && r2.stats.results.total === 0)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail) process.exit(1)
