/** 판정 A 발견 재실측 — 판정자도 틀린다. 수치를 내 축으로 다시 잰다. */
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
const out: string[] = []
const log = (s: string) => out.push(s)

const wb = XLSX.read(readFileSync('templates/report-workbook-full.xlsx'))
const b13 = String((wb.Sheets['정보']?.['B13'] as XLSX.CellObject).v)
const lines = b13.split('\n')
log('### 정보!B13 원문 줄별 실측')
lines.forEach((l, i) => log(`  줄${i + 1} (${l.length}자) ${JSON.stringify(l)}`))

// 줄2 해부 — 고정부와 슬롯 폭
const l2 = lines[1]
const mCo = /^보험사:( +),  가입기간:  (.*)$/.exec(l2)
if (mCo) {
  log(`\n  보험사 슬롯 = ${mCo[1].length}칸`)
  log(`  가입기간 자리 = ${mCo[2].length}자  ${JSON.stringify(mCo[2])}`)
  log(`  고정부 = ${l2.length - mCo[1].length - mCo[2].length}자`)
} else log(`\n  ⚠ 줄2 파싱 실패: ${JSON.stringify(l2)}`)

// 줄3 해부
const l3 = lines[2]
const m3 = /^가입금액:  대인\((.*?)만원 \) {4}대물\((.*?)만원 \)$/.exec(l3)
log(`\n  줄3(${l3.length}자) 대인 슬롯=${m3?.[1].length} 대물 슬롯=${m3?.[2].length}`)

// slot18 경계 실측 — 소스를 고치기 전 현재 동작
const { buildWorkbookValues } = await import('../src/lib/xlsx-workbook.ts')
const base = {
  official: { company: { name: 'X', address: 'X', phone: 'X', fax: 'X' }, docNo: '승 진 2608-1', sendDate: 'X', recipient: 'X', reference: 'X', sender: 'X', senderSign: { name: 'X', title: 'X', rep: 'X' }, year: 2026, typeLabel: 'X' },
  delegation: { typeLabel: 'X', owner: { name: 'X', position: 'X', phone: 'X', birth: 'X' }, agent: { name: 'X', position: 'X', phone: 'X', birth: 'X' }, periodLabel: 'X', daysLabel: '1일', submitDate: 'X', station: 'X' },
  customerAddress: 'X', startISO: null, endISO: null, useApprovalISO: null, building: null,
}
const r9 = {
  ckOp: true, ckInitial: false, ckCompEtc: false, consent: null, repRole: '', managerGrade: '', mgrEduDate: '',
  rampCount: '', main: null, assistants: [], hasFirePlan: false, prevOpDone: false, prevCompDone: false,
  eduDone: false, drillDone: false, insuranceJoined: null, insCompany: '', insPeriod: '',
  insPerson: '', insProperty: '', multiUseNone: false, multiUseCounts: {},
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  stairsCount: '', elvR: '', elvE: '', elvV: '', pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
}
log('\n### slot18 경계 — 입력 길이별 줄3 길이(원문 61자 유지가 목표)')
for (const n of [0, 4, 10, 17, 18, 19, 25]) {
  const v = 'X'.repeat(n)
  const line = String(buildWorkbookValues({ ...base, report9: { ...r9, insPerson: v, insProperty: '' } } as never).get('insuranceLine')).split('\n')[2]
  const slot = /대인\((.*?)만원 \)/.exec(line)?.[1].length
  log(`  ${String(n).padStart(2)}자 → 슬롯 ${slot}칸 · 줄3 ${line.length}자 ${line.length === l3.length ? '(폭 유지)' : '**폭 깨짐**'}`)
}

// 가입기간 미입력 시 줄2 길이
const blankLine2 = String(buildWorkbookValues({ ...base, report9: r9 } as never).get('insuranceLine')).split('\n')[1]
log(`\n### 가입기간 미입력 줄2 = ${blankLine2.length}자 (원문 ${l2.length}자, Δ${blankLine2.length - l2.length})`)

writeFileSync('scripts/_verify-afind.txt', out.join('\n'), 'utf8')
console.log('ok')
