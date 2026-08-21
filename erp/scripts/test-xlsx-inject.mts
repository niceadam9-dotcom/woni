/** 갑지 워크북 주입 검증 (소방계획서_27 S6-2·S6-3 — 무서버)
 *  실행: npx tsx scripts/test-xlsx-inject.mts
 *
 *  고정하는 것:
 *  ① 서식 무손상 — 주입 후 병합 총수 불변 · xl/styles.xml **바이트 동일** · 인쇄여백 동일 ·
 *     셀(<c>) 총수 불변. JSZip 패치의 존재 이유가 이 넷이다.
 *  ② 값 정확성 — 픽스처를 주입하고 SheetJS로 **읽어**(읽기는 안전) 기대값 대조.
 *  ③ 폐포 전파(D-9) — 허브만 넣어도 스포크(공문 수신·계약서 상호·완료보고서 상호)의
 *     캐시가 함께 바뀐다. LibreOffice가 fullCalcOnLoad를 무시하는 실측 위에 세운 규약이다.
 *  ④ 명시적 공란 — 값 없는 앵커(null)는 캐시를 지운다(잔재도 조용한 생략도 없다). */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { injectWorkbook, isoToSerial } from '../src/lib/xlsx-inject.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const TPL = 'templates/report-workbook.xlsx'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const template = new Uint8Array(readFileSync(TPL))

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
const { targets, unmapped } = toInjectTargets(values)
check('앵커-값 매핑 누락 0', unmapped.length === 0, unmapped.map(a => a.field).join(', '))

const result = await injectWorkbook(template, targets)
check('주입 대상 미발견 0', result.missed.length === 0, result.missed.join(', '))
console.log(`  · 폐포 전파 ${result.propagated}칸`)

// ── ① 서식 무손상 ────────────────────────────────────────────────────
console.log('[1] 서식 무손상')
{
  const before = XLSX.read(template, { cellStyles: true })
  const after = XLSX.read(result.bytes, { cellStyles: true })
  const m = (wb: XLSX.WorkBook) => wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]['!merges'] ?? []).length), 0)
  check('병합 총수 불변', m(before) === m(after), `${m(before)} → ${m(after)}`)
  check('개요 인쇄여백 동일',
    JSON.stringify(before.Sheets['개요']['!margins']) === JSON.stringify(after.Sheets['개요']['!margins']))

  const zb = await JSZip.loadAsync(template)
  const za = await JSZip.loadAsync(result.bytes)
  check('styles.xml 바이트 동일',
    (await zb.file('xl/styles.xml')!.async('string')) === (await za.file('xl/styles.xml')!.async('string')))
  // 셀 총수 불변 — 주입은 교체지 추가·삭제가 아니다
  let cb = 0, ca = 0
  for (const f of Object.keys(zb.files).filter(f => f.startsWith('xl/worksheets/') && f.endsWith('.xml'))) {
    cb += ((await zb.file(f)!.async('string')).match(/<c r="/g) ?? []).length
    ca += ((await za.file(f)!.async('string')).match(/<c r="/g) ?? []).length
  }
  check('셀(<c>) 총수 불변', cb === ca, `${cb} → ${ca}`)
}

// ── ② 값 정확성 ─────────────────────────────────────────────────────
console.log('[2] 주입 값 정확성(SheetJS 읽기)')
const wb = XLSX.read(result.bytes, { cellFormula: true })
const cellV = (sheet: string, cell: string) => (wb.Sheets[sheet]?.[cell] as XLSX.CellObject | undefined)?.v
check('개요!B14 상호', cellV('개요', 'B14') === '검증대상빌딩', String(cellV('개요', 'B14')))
check('개요!B9 년도(숫자)', cellV('개요', 'B9') === 2026)
check('개요!B10 발신일자(시리얼 — 날짜 서식 보존)', cellV('개요', 'B10') === isoToSerial('2026-08-21'),
  String(cellV('개요', 'B10')))
check('개요!B11 문서번호(접두 제거 — 공문 B6와 안 겹침)', cellV('개요', 'B11') === '2608-7', String(cellV('개요', 'B11')))
check('개요!B17 관계인', cellV('개요', 'B17') === '박관계')
check('위임장!N6 대리인 성명(깨진 참조 → 값 대체)', cellV('위임장', 'N6') === '김점검', String(cellV('위임장', 'N6')))
check('위임장!N6 수식 제거됨', (wb.Sheets['위임장']['N6'] as XLSX.CellObject).f === undefined)
check('계약서!D29 대표자', cellV('계약서', 'D29') === '홍대표', String(cellV('계약서', 'D29')))
check('개요!F1 일수(닫는 괄호 포함 — 위임장 S10 여는 괄호와 짝)', cellV('개요', 'F1') === '2일   )', String(cellV('개요', 'F1')))

// ── ③ 폐포 전파 ─────────────────────────────────────────────────────
console.log('[3] 폐포 전파 — 허브만 넣어도 스포크 캐시가 바뀐다')
check('공문!B8 수신', cellV('공문', 'B8') === '검증대상빌딩', String(cellV('공문', 'B8')))
check('공문!B8 수식 보존(Excel에서 수정하면 살아 움직인다)',
  (wb.Sheets['공문']['B8'] as XLSX.CellObject).f !== undefined)
check('계약서!A3 상호', cellV('계약서', 'A3') === '검증대상빌딩')
check('계약서!D24 상호(같은 시트 참조 사슬 A3→D24)', cellV('계약서', 'D24') === '검증대상빌딩', String(cellV('계약서', 'D24')))
check('완료보고서!B5 상호(스포크→스포크 사슬 계획서!B5 경유)', cellV('완료보고서', 'B5') === '검증대상빌딩')
check('위임장!C6 관계인(개요!D10 경유)', cellV('위임장', 'C6') === '박관계', String(cellV('위임장', 'C6')))
check('위임장!C10 점검일자(개요!E1 경유)', cellV('위임장', 'C10') === delegation.periodLabel)
check('위임장!P19 관할소방서', cellV('위임장', 'P19') === '양평')

// ── ④ 명시적 공란 ───────────────────────────────────────────────────
console.log('[4] 값 없는 앵커 = 명시적 공란')
{
  const blankDelegation = { ...delegation, agent: { name: '', position: '', phone: '', birth: '' } }
  const v2 = buildWorkbookValues({
    official, delegation: blankDelegation, customerAddress: '', startISO: null, endISO: null,
  })
  const r2 = await injectWorkbook(template, toInjectTargets(v2).targets)
  const wb2 = XLSX.read(r2.bytes)
  const n6 = (wb2.Sheets['위임장']?.['N6'] as XLSX.CellObject | undefined)?.v
  check('위임장!N6 공란(잔재 없음)', n6 === undefined || String(n6).trim() === '', JSON.stringify(n6))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
