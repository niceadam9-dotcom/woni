/** 자산 계약 — 갑지 템플릿 `완료보고서!I19~I22`(이행조치 일자 4행)가 **날짜 서식**을 갖는가.
 *
 *  🚨 2026-09-15 사용자 신고: 이행조치 일자에 `46299`가 인쇄됐다. 값은 옳았다(총 이행기간
 *    종료일 2026-10-04) — **표시만** 틀렸다. 원본 자산이 4행 중 **I20만** 날짜 서식을 갖고
 *    있었고(나머지 General), 주입기는 스타일을 일부러 보존하므로 그 General이 그대로 적용됐다.
 *
 *  ⚠ **불량 1건일 때만 드러난다** — 2건이면 둘째 행이 I20(정상)에 들어가 가려진다. 그래서
 *    「지금 화면이 멀쩡하다」로는 이 축을 지킬 수 없다. 자산에서 직접 단언한다.
 *
 *  🎯 계측기 자기검사를 함께 둔다(아래 B) — 판별기가 살아 있지 않으면 A의 초록은 무의미하다.
 *    A만 두면 「전부 날짜 서식인 자산」과 「판별기가 늘 true를 주는 버그」를 구별할 수 없다.
 *
 *  실행: npx tsx scripts/test-donedate-numfmt.mts     (서버 불필요 — 파일 축만 본다)
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import {
  patchDoneDateNumFmt, isDateNumFmt, DONEDATE_SHEET, DONEDATE_CELLS,
} from '../src/lib/xlsx-donedate-numfmt.ts'

let pass = 0, fail = 0
function ok(cond: boolean, label: string, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const TPL = 'templates/report-workbook-full.xlsx'

console.log('── A. 자산: 이행조치 일자 4행이 전부 날짜 서식인가 ──')
const zip = await JSZip.loadAsync(readFileSync(TPL))
const stylesXml = await zip.file('xl/styles.xml')!.async('string')
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const shs = [...wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(m => ({ name: m[1], rid: m[2] }))
const relMap = new Map([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sh = shs.find(s => s.name === DONEDATE_SHEET)
ok(!!sh, `시트 「${DONEDATE_SHEET}」가 있다(과녁 존재 — 이름이 바뀌면 여기서 먼저 빨강)`)
const sheetXml = sh ? await zip.file('xl/' + relMap.get(sh.rid)!.replace(/^\/?xl\//, ''))!.async('string') : ''

const customFmt = new Map([...stylesXml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)]
  .map(m => [Number(m[1]), m[2]] as [number, string]))
const xfsOpen = stylesXml.indexOf('>', stylesXml.indexOf('<cellXfs')) + 1
const xfsInner = stylesXml.slice(xfsOpen, stylesXml.indexOf('</cellXfs>'))
const xfs = [...xfsInner.matchAll(/<xf[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0])

for (const ref of DONEDATE_CELLS) {
  const m = sheetXml.match(new RegExp(`<c[^>]*\\br="${ref}"([^>]*)`))
  const si = m ? /s="(\d+)"/.exec(m[1])?.[1] : null
  const id = si == null ? 0 : Number(/numFmtId="(\d+)"/.exec(xfs[Number(si)] ?? '')?.[1] ?? 0)
  ok(si != null && isDateNumFmt(id, customFmt),
    `${ref} 날짜 서식`, `numFmtId=${id} "${customFmt.get(id) ?? `(내장 ${id})`}"`)
}

/* 🚨 Excel **만** 복구창을 띄우는 축 — cellXfs count가 실제 개수와 어긋나면 그렇다
   (LibreOffice는 통과하므로 PDF 검사로는 안 잡힌다). 수리가 count를 갱신했음을 여기서 고정한다. */
const declared = Number(/count="(\d+)"/.exec(stylesXml.slice(stylesXml.indexOf('<cellXfs'), xfsOpen))?.[1] ?? -1)
ok(declared === xfs.length, 'cellXfs count 선언 = 실제', `${declared} vs ${xfs.length}`)
ok(xfsInner.split(/<xf[^>]*(?:\/>|>[\s\S]*?<\/xf>)/).join('').trim().length === 0,
  'cellXfs 파싱 잔여물 0(수리가 XML을 깨지 않았다)')

console.log('\n── B. 계측기 자기검사: 판별기가 살아 있는가 ──')
{
  /* A가 초록인 이유가 「자산이 옳다」인지 「판별기가 늘 true」인지 가른다.
     합성 픽스처로 **General 자산**을 만들어 수리 함수가 그걸 잡아내는지 본다. */
  const fakeStyles =
    '<styleSheet><numFmts count="1"><numFmt numFmtId="189" formatCode="yyyy\\-m\\-d;@"/></numFmts>'
    + '<cellXfs count="2">'
    + '<xf numFmtId="164" fontId="1" borderId="9"/>'      // s=0 — General(결함)
    + '<xf numFmtId="189" fontId="1" borderId="9"/>'      // s=1 — 날짜(정상)
    + '</cellXfs></styleSheet>'
  const fakeSheet = '<worksheet><sheetData><row r="19">'
    + '<c r="I19" s="0"><v>46299</v></c><c r="I20" s="1"><v>46299</v></c>'
    + '<c r="I21" s="0"><v>1</v></c><c r="I22" s="0"><v>1</v></c>'
    + '</row></sheetData></worksheet>'
  const r1 = patchDoneDateNumFmt(fakeStyles, fakeSheet).result
  ok(r1.changed.length === 3 && r1.skipped.length === 1,
    '결함 자산에서 General 3칸을 잡고 날짜 1칸은 건너뛴다', `changed=${r1.changed.join(',')} skipped=${r1.skipped.join(',')}`)
  ok(r1.dateFmtId === 189, '날짜 서식 id를 **자산에서 재사용**한다(새로 만들지 않는다)', String(r1.dateFmtId))

  // 멱등 — 한 번 고친 것을 다시 돌리면 0칸
  const once = patchDoneDateNumFmt(fakeStyles, fakeSheet)
  const twice = patchDoneDateNumFmt(once.stylesXml, once.sheetXml).result
  ok(twice.changed.length === 0 && twice.skipped.length === 4, '(멱등) 재실행은 0칸', `changed=${twice.changed.length}`)

  // 음성: 4행 중 날짜가 하나도 없으면 **지어내지 않고 선다**
  const noDate = patchDoneDateNumFmt(
    '<styleSheet><cellXfs count="1"><xf numFmtId="164"/></cellXfs></styleSheet>',
    '<worksheet><c r="I19" s="0"><v>1</v></c></worksheet>').result
  ok(noDate.dateFmtId === null && noDate.changed.length === 0,
    '(음성) 기준 서식이 없으면 아무것도 안 바꾸고 알린다', noDate.notes.join(' / '))

  // 🎯 테두리 보존 — I20 스타일을 복사하면 borderId가 바뀐다. 복제는 numFmtId만 바꿔야 한다
  const kept = /borderId="9"/.test(once.stylesXml.slice(once.stylesXml.indexOf('<cellXfs')))
  ok(kept, 'borderId를 유지한다(I20 스타일 복사가 아니다)')
}

console.log(`\n${fail === 0 ? `✅ ${pass}/${pass}` : `❌ ${pass}/${pass + fail}`} 통과`)
process.exit(fail > 0 ? 1 : 0)
