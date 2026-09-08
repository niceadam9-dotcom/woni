/** 소방계획서_42 S7-5 — LibreOffice 실개봉 판정.
 *
 *  묻는 것은 "열리는가"만이 아니다. **주입까지 끝난 산출물**을 열어서
 *   ① 배너(서식 제목 줄)가 전부 살아 있는가 ② 되읽기 병합 수 == manifest.mergeTotal
 *   ③ 30열 표가 A4 폭을 넘지 않는가(인쇄 축 — 화면에서는 안 보인다)
 *  를 함께 본다. ⚠ 프로필 격리 필수 — LO는 프로필 락이 하나라 타 세션과 겹치면 ETIMEDOUT.
 *
 *  실행: npx tsx scripts/_probe-42-lo-open.mts
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS, ZONE_ROWS } from '../src/lib/fire-plan-anchors.ts'
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${l}${d ? ' — ' + d : ''}`) }
  else { fail++; console.log(`  FAIL ${l}${d ? ' — ' + d : ''}`) }
}

const fixture = {
  year: 2026, buildingName: '가상건물', address: '경기도 어딘가 1-2',
  ownerName: '홍길동', ownerPhone: '010-0000-0001',
  managerName: '이순신', managerPhone: '010-0000-0002',
  receiverLocation: '1층 방재실', purpose: '공동주택',
  useApprovalDate: '2019-03-07', totalArea: '1,234.56', floors: '지상5층',
  height: '15', structure: '철근콘크리트', roof: '슬라브',
  fireStation: '어딘가소방서', managerSelectedAt: '2025-01-14', contractStart: '2025-01-01',
  ops: { insuranceJoined: true, insuranceCompany: '어느화재', insurancePeriod: '2025.1.1~2026.1.1',
    insuranceAmountPerson: '1000', insuranceAmountProperty: '2000',
    opHoursWeekday: '', opHoursHoliday: '', headcountWorker: '', headcountResident: '', headcountMax: '' },
  zones: Array.from({ length: ZONE_ROWS }, (_, i) => ({
    zone: `${i + 1}층`, name: `구역${i + 1}`, area: `${100 + i}`,
    weekday: '', holiday: '', managerCo: '', contact: `010-1111-00${i}` })),
} as unknown as FirePlanGenData

const base = new Uint8Array(readFileSync(XLSX_PATH))
const { targets } = toInjectTargets(buildFirePlanValues(fixture), FIRE_PLAN_ANCHORS)
const inj = await injectWorkbook(base, targets)
console.log('\n[1] 주입')
check('missed 0', inj.missed.length === 0, inj.missed.join(','))

console.log('\n[2] 배너 — 서식 제목 줄이 전부 살아 있는가')
{
  const wb = XLSX.read(inj.bytes, { cellStyles: false })
  const missing: string[] = []
  let banners = 0
  for (const s of FIRE_PLAN_MANIFEST.sheets) {
    const ws = wb.Sheets[s.name]
    for (const r of s.bannerRows) {
      banners++
      const ref = `A${r + 1}`
      const want = s.labels[ref]
      if (!want) continue // 표지 제목처럼 앵커가 덮는 배너는 라벨이 없다
      const got = String((ws?.[ref] as XLSX.CellObject | undefined)?.v ?? '')
      if (got.replace(/\s/g, '') !== want.replace(/\s/g, '')) missing.push(`${s.name}!${ref} 기대'${want.slice(0, 20)}' 실제'${got.slice(0, 20)}'`)
    }
  }
  check('배너 행이 0이 아니다(눈멂 가드)', banners >= 15, `${banners}줄`)
  check('배너 전건 존재', missing.length === 0, missing.slice(0, 4).join(' · '))
  // 표지 제목은 앵커가 덮으므로 값으로 확인한다
  check('표지 제목이 조립됐다', String((wb.Sheets['표지']?.['A3'] as XLSX.CellObject | undefined)?.v ?? '').includes('소방계획서'),
    String((wb.Sheets['표지']?.['A3'] as XLSX.CellObject | undefined)?.v ?? ''))
}

console.log('\n[3] 되읽기 병합 == manifest.mergeTotal')
{
  const wb = XLSX.read(inj.bytes, { cellStyles: false })
  const got = wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]!['!merges'] as unknown[] | undefined)?.length ?? 0), 0)
  const want = FIRE_PLAN_MANIFEST.sheets.reduce((n, s) => n + s.merges, 0)
  check('병합 총수 일치', got === want, `${got}/${want}`)
}

console.log('\n[4] 인쇄 폭 — 30열 표가 A4를 넘는가 (화면에서는 안 보이는 축)')
{
  // fitToWidth=1 이 전 시트에 박혀 있어야 「통합 문서 전체 인쇄」가 한 번에 연속 출력된다(Q-3 a안)
  const zip = await JSZip.loadAsync(inj.bytes)
  const names = Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  let fit = 0, setup = 0
  for (const n of names) {
    const xml = await zip.file(n)!.async('string')
    if (/fitToPage="1"/.test(xml) && /fitToWidth="1"/.test(xml)) fit++
    if (/<pageSetup[^>]*paperSize="9"/.test(xml)) setup++
  }
  check('전 시트 fitToPage+fitToWidth', fit === names.length, `${fit}/${names.length}`)
  check('전 시트 A4 pageSetup', setup === names.length, `${setup}/${names.length}`)
  const widest = FIRE_PLAN_MANIFEST.sheets.reduce((a, b) => (b.cols > a.cols ? b : a))
  console.log(`       가장 넓은 시트: ${widest.name} ${widest.cols}열 — fitToWidth가 이걸 한 쪽으로 접는다`)
}

console.log('\n[5] LibreOffice 실개봉 (프로필 격리)')
{
  const SOFFICE = 'C:/Program Files/LibreOffice/program/soffice.com'
  if (!existsSync(SOFFICE)) { console.log('       (soffice 없음 — 건너뜀)') }
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'p42lo-'))
    const p = join(tmp, 'injected.xlsx')
    writeFileSync(p, inj.bytes)
    const r = spawnSync(SOFFICE, [
      `-env:UserInstallation=file:///${join(tmp, 'loprofile').replace(/\\/g, '/')}`,
      '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, p,
    ], { encoding: 'utf8', timeout: 300_000 })
    const pdf = join(tmp, 'injected.pdf')
    check('LibreOffice 변환 exit 0', r.status === 0, `exit=${r.status} ${(r.stderr ?? '').slice(0, 120)}`)
    check('PDF 생성(=파일이 실제로 열렸다)', existsSync(pdf), existsSync(pdf) ? `${statSync(pdf).size} bytes` : '없음')
    if (existsSync(pdf)) {
      // 쪽수 — 시트 28장이 한 벌로 이어져 나오는가(Q-3 a안의 실물 확인)
      const buf = readFileSync(pdf)
      const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
      check('PDF 쪽수가 시트 수 이상', pages >= FIRE_PLAN_MANIFEST.sheets.length, `${pages}쪽 / 시트 ${FIRE_PLAN_MANIFEST.sheets.length}`)
      console.log(`       육안 확인용: ${pdf}`)
    }
  }
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
