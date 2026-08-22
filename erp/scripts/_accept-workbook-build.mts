/** S6-7 수동 인수 준비 — 픽스처 주입본과 기대값을 만들어 Excel COM 검사(ps1)에 넘긴다.
 *  실행: npx tsx scripts/_accept-workbook-build.mts
 *  산출: scripts/_out/accept/{template.xlsx, injected.xlsx, expect.json}
 *
 *  LibreOffice 검사는 이미 5/5(_probe-xlsx-opens)지만 사용자의 실제 도구는 Excel이고
 *  페이지 나눔 엔진이 다르다 — Excel 실물 판정은 _accept-workbook-excel.ps1이 한다. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { injectWorkbook, isoToSerial } from '../src/lib/xlsx-inject.ts'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const OUT = 'scripts/_out/accept'
mkdirSync(OUT, { recursive: true })

const official: OfficialData = {
  company: { name: '㈜테스트소방', address: '주소', phone: '031-000-0000', fax: '031-000-0001' },
  docNo: '승 진 2608-7', sendDate: '2026년 8월', recipient: '검증대상빌딩', reference: '소방안전관리자 및 관계인',
  sender: '㈜테스트소방', senderSign: { name: '주식회사 테스트소방', title: '대표이사', rep: '홍대표' },
  year: 2026, typeLabel: '작동점검',
}
const delegation: DelegationData = {
  typeLabel: '작동점검',
  owner: { name: '박관계', position: '소방안전관리자', phone: '010-1111-2222', birth: '1980.01.02' },
  agent: { name: '김점검', position: '과장', phone: '010-3333-4444', birth: '1990.03.04' },
  periodLabel: '2026.08.20 부터 ~ 2026.08.21 까지', daysLabel: '2일', submitDate: '2026년 8월 21일', station: '양평',
}
const values = buildWorkbookValues({
  official, delegation, customerAddress: '경기도 양평군 검증로 1',
  startISO: '2026-08-20', endISO: '2026-08-21',
})

const template = new Uint8Array(readFileSync('templates/report-workbook.xlsx'))
const r = await injectWorkbook(template, toInjectTargets(values).targets, { forbidden: SCRUB_NEEDLES })
if (r.missed.length) throw new Error(`missed: ${r.missed.join(', ')}`)
if (r.scrubbed.length) throw new Error(`unexpected scrub: ${r.scrubbed.join(', ')}`)

writeFileSync(join(OUT, 'template.xlsx'), template)
writeFileSync(join(OUT, 'injected.xlsx'), r.bytes)
writeFileSync(join(OUT, 'expect.json'), JSON.stringify({
  sheetCount: 26,
  // Value2 기준 기대값 — 문자열은 그대로, 날짜 시리얼은 숫자
  cells: [
    { sheet: '개요', cell: 'B14', value: '검증대상빌딩' },
    { sheet: '개요', cell: 'B11', value: '2608-7' },
    { sheet: '개요', cell: 'B10', value: isoToSerial('2026-08-21') },
    { sheet: '공문', cell: 'B8', value: '검증대상빌딩' },
    { sheet: '계약서', cell: 'D24', value: '검증대상빌딩' },
    { sheet: '위임장', cell: 'N6', value: '김점검' },
    { sheet: '계약서', cell: 'D29', value: '홍대표' },
  ],
}, null, 2))
console.log(`✅ ${OUT}/ — template.xlsx · injected.xlsx · expect.json (폐포 전파 ${r.propagated}칸)`)
