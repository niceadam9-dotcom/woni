/** 갑지 워크북 주입본이 정말 열리는가 (소방계획서_27 S6-4 — 로컬 LibreOffice 필요)
 *  실행: npx tsx scripts/_probe-xlsx-opens.mts
 *
 *  test-xlsx-inject가 XML 층에서 무손상을 고정하지만, '뷰어가 실제로 여는가'는 다른 축이다 —
 *  주입본을 soffice로 **3회** PDF 변환해 전부 성공하고, 페이지 수가 템플릿과 같은지 본다
 *  (페이지 수가 달라지면 서식·페이지 나눔이 흔들렸다는 신호). */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const TPL = 'templates/report-workbook.xlsx'
const dir = mkdtempSync(join(tmpdir(), 'wbopen-'))
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

/** PDF 페이지 수 — /Type /Page 객체 수(/Pages 컨테이너는 \b로 제외) */
const pdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length

const toPdf = (bytes: Uint8Array, name: string): number | null => {
  const p = join(dir, name)
  writeFileSync(p, bytes)
  try {
    execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, p],
      { timeout: 180_000, windowsHide: true, stdio: 'pipe' })
    const pdf = p.replace(/\.xlsx$/, '.pdf')
    return existsSync(pdf) ? pdfPages(readFileSync(pdf)) : null
  } catch {
    return null
  }
}

const template = new Uint8Array(readFileSync(TPL))

// 픽스처는 test-xlsx-inject와 같은 부류 — 값 층은 저쪽이 고정하고, 여기는 '열림'만 본다
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
  useApprovalISO: '2011-06-25',
  building: {
    purpose: '근린생활시설', totalArea: 999.99, buildingArea: 300.5, floorsAbove: 5, floorsBelow: 2,
    height: 21.5, households: 12, buildingCount: 2, permitDateISO: '2009-04-25',
  },
  report9: {
    ckOp: true, ckInitial: false, ckCompEtc: false, consent: true, repRole: '관리자',
    managerGrade: '2급', mgrEduDate: '2024년 5월 2일',
    main: { name: '김주된', grade: '소방시설관리사', licenseNo: '제2026-1호' },
    assistants: [
      { name: '이보조', grade: '점검자경력수첩', licenseNo: '수첩-77', period: '2026.08.20 부터 ~ 2026.08.21 까지' },
    ],
  },
})
const result = await injectWorkbook(template, toInjectTargets(values).targets, { forbidden: SCRUB_NEEDLES })
check('주입 대상 미발견 0', result.missed.length === 0, result.missed.join(', '))

console.log('[1] 템플릿 기준 페이지 수')
const basePages = toPdf(template, 'template.xlsx')
check('템플릿 PDF 변환', basePages !== null, `${basePages}쪽`)

console.log('[2] 주입본 3회 변환 — 전부 열리고 페이지 수 동일')
for (let i = 1; i <= 3; i++) {
  const pages = toPdf(result.bytes, `injected${i}.xlsx`)
  check(`시도 ${i}`, pages !== null && pages === basePages, pages === null ? 'PDF 없음' : `${pages}쪽`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
