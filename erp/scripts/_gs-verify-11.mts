/** 산출물 되읽기 검증 — 값이 **제자리**에 들어갔는지 hwp 원문과 대조한다.
 *  (쓴 것을 그대로 다시 읽는 자기충족 검사가 되지 않도록, 기준은 산출물이 아니라 hwp다) */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWP = resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const OUT = 'F:\\AI\\sjfire\\_강순기_형식비교'

const { bytes } = readSectionStream(readFileSync(HWP))
const records = walkRecords(bytes)
const zipForm = await JSZip.loadAsync(readFileSync(HWPX))
const truth = parseTables(await zipForm.file('Contents/section0.xml')!.async('string'))
  .map(t => t.cells.map(c => ({ row: c.row, col: c.col })))
const cal = calibrateCellOffset(records, truth)!
const T = extractTables(records, cal.offset)
  .map(t => ({ t, s: ['명칭', '도로명주소', '수신기위치', '대상물급수'].filter(k => t.cells.some(c => c.text.replace(/\s/g, '').includes(k))).length }))
  .sort((a, b) => b.s - a.s)[0].t

const want = new Set(T.cells.map(c => c.text.replace(/\s/g, '').trim()).filter(Boolean))
console.log(`hwp 서식 1.1 고유 문자열 ${want.size}개\n`)

/* 고객이 채운 답 = **양식에 없고 강순기에만 있는 글자**. 이게 빠지면 '형식만 그럴듯한' 산출물이다.
 *
 * ⚠ 값을 손으로 박지 않는다. 두 가지 이유가 있다:
 *   ① 실고객 PII(이름·전화·주소)를 저장소에 남기게 된다(소방계획서_42 R-2)
 *   ② 픽스처에 답을 박은 검사는 **그 규칙을 타지 않는다** — 원문이 바뀌어도 늘 같은 것만 본다
 *      (소방계획서_41에서 실제로 23/23 초록인 채 결함이 배포됐다)
 * 그래서 양식 hwpx와 강순기 hwp의 **차집합**으로 답을 그때그때 만든다. */
const formTables = parseTables(await (await JSZip.loadAsync(readFileSync(HWPX))).file('Contents/section0.xml')!.async('string'))
const formT = formTables.find(x => x.cells.some(c => c.text.replace(/\s/g, '').includes('도로명주소')))!
const formWords = new Set(formT.cells.map(c => c.text.replace(/\s/g, '').trim()).filter(Boolean))
const ANSWERS = [...new Set(T.cells.map(c => c.text.replace(/\s/g, '').trim()).filter(Boolean))]
  .filter(v => !formWords.has(v))
console.log(`고객이 채운 답(양식에 없는 글자) ${ANSWERS.length}개 — 값 자체는 찍지 않는다(PII)\n`)

for (const [label, file, sheet] of [
  ['A안(sj 격자)', 'A_sj격자_강순기_서식1.1.xlsx', '소방안전관리계획 (3)'],
  ['B안(리포 형식)', 'B_리포형식_강순기_서식1.1.xlsx', '1.1 건축물 일반현황'],
] as const) {
  const p = join(OUT, file)
  if (!existsSync(p)) { console.log(`${label}: 산출물 없음\n`); continue }
  const wb = XLSX.read(readFileSync(p), { sheetStubs: true })
  const ws = wb.Sheets[sheet]
  const r = XLSX.utils.decode_range(ws['!ref']!)
  const got = new Set<string>()
  for (let R = r.s.r; R <= r.e.r; R++) for (let C = r.s.c; C <= r.e.c; C++) {
    const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
    if (c && c.v !== undefined) { const v = String(c.v).replace(/\s/g, '').trim(); if (v) got.add(v) }
  }
  const missing = [...want].filter(w => !got.has(w))
  const missAns = ANSWERS.filter(a => !got.has(a))
  console.log(`${label}`)
  /* 누락은 **가려서** 찍는다 — 실고객 값이 콘솔·로그로 새지 않게(앞 2자+길이면 자리를 찾기에 충분하다) */
  const redact = (s: string) => `${s.slice(0, 2)}…(${s.length}자)`
  console.log(`  시트 문자열 ${got.size}개 · hwp 문자열 중 누락 ${missing.length}개${missing.length ? ': ' + missing.slice(0, 10).map(redact).join(', ') : ''}`)
  console.log(`  🎯 고객 실답 ${ANSWERS.length}개 중 누락 ${missAns.length}개${missAns.length ? ': ' + missAns.map(redact).join(', ') : ' ✅ 전건 실림'}`)
  const chk = [...got].filter(v => v.includes('■')).length
  console.log(`  체크(■) 칸 ${chk}개\n`)
}
