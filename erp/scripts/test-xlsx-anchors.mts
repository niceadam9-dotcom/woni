/** 갑지 워크북 앵커·템플릿 검증 (소방계획서_27 S6-1 — 무서버)
 *  실행: npx tsx scripts/test-xlsx-anchors.mts
 *
 *  고정하는 것:
 *  ① 템플릿 지문 — manifest(sha256·시트 수·병합 총수)와 실물이 일치. 갑지가 갱신되면 여기가
 *     먼저 붉어지고, 그때 build-workbook-template 재실행 + 앵커 재실측으로 재승인한다(Q-4).
 *  ② 앵커 전수 라벨 검증 — 좌표만 믿지 않는다(doc-overrides 철학).
 *  ③ 🚨 완전 덮어쓰기 불변식(S3-4) — 개요의 입력 칸 전부가 템플릿에서 공란이고, 실고객 흔적이
 *     캐시 어디에도 없다. 이게 깨지면 다른 고객 문서에 남의 실명·연락처가 인쇄된다.
 *  ④ 값 맵 완결성 — 앵커의 모든 field가 buildWorkbookValues 산출에 실재(코드 누락은 여기서 잡힌다). */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { ANCHORS, HUB_INPUT_CELLS, validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'
import { buildWorkbookValues } from '../src/lib/xlsx-workbook.ts'
import manifest from '../src/lib/xlsx-template-manifest.json' with { type: 'json' }

const TPL = 'templates/report-workbook.xlsx'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const bytes = new Uint8Array(readFileSync(TPL))

// ── ① 템플릿 지문 ────────────────────────────────────────────────────
console.log('[1] 템플릿 지문(manifest 대조)')
const sha = createHash('sha256').update(bytes).digest('hex')
check('sha256 일치', sha === manifest.sha256, sha.slice(0, 16))
const wb = XLSX.read(bytes, { cellStyles: true })
check('시트 수', wb.SheetNames.length === manifest.sheetCount, `${wb.SheetNames.length}`)
const merges = wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]['!merges'] ?? []).length), 0)
check('병합 총수', merges === manifest.mergeTotal, `${merges}`)

// ── ② 앵커 라벨 ─────────────────────────────────────────────────────
console.log('[2] 앵커 전수 라벨 검증')
const v = validateAnchors(bytes)
check(`앵커 ${ANCHORS.length}건 라벨 전수 일치`, v.ok, v.ok ? '' : (v as { failures: string[] }).failures.join(' · '))

// ── ③ 완전 덮어쓰기 불변식 ──────────────────────────────────────────
console.log('[3] 완전 덮어쓰기 불변식 — 개요 입력 칸 공란 + 실고객 흔적 0')
{
  // ⚠ SheetJS는 캐시 없는 수식 셀을 v=0으로 돌려줘 '값 잔존'과 구별이 안 된다 — XML로 판정
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  const hubXml = await zip.file(files.get('개요')!)!.async('string')
  const dirty = HUB_INPUT_CELLS.filter(c => {
    const m = new RegExp(`<c r="${c}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(hubXml)
    return /<v>[\s\S]*?<\/v>|<is>/.test(m?.[1] ?? '')
  })
  check(`개요 입력 칸 ${HUB_INPUT_CELLS.length}개 전부 공란`, dirty.length === 0,
    dirty.length ? `잔존 ${dirty.join(', ')}` : '')

  const NEEDLES = ['정내과의원', '김미진', '010-7565-3271', '721227', '7565-3271']
  const leaks: string[] = []
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const val = String((ws[k] as XLSX.CellObject).v ?? '')
      for (const n of NEEDLES) if (val.includes(n)) leaks.push(`${s}!${k}`)
    }
  }
  check('실고객 흔적 전 시트 0건', leaks.length === 0, leaks.slice(0, 6).join(', '))

  // 앵커 대상 셀이 XML에 실재 — 없는 셀 삽입은 지원하지 않으므로 실재가 전제다
  const absent: string[] = []
  for (const a of ANCHORS) {
    const xml = await zip.file(files.get(a.sheet)!)!.async('string')
    if (!new RegExp(`<c r="${a.cell}"[ />]`).test(xml)) absent.push(`${a.sheet}!${a.cell}`)
  }
  check('앵커 대상 셀 전부 XML에 실재', absent.length === 0, absent.join(', '))
}

// ── ④ 값 맵 완결성 ──────────────────────────────────────────────────
console.log('[4] buildWorkbookValues가 앵커 field 전수를 낸다')
{
  const values = buildWorkbookValues({
    official: {
      company: { name: 'X', address: 'X', phone: 'X', fax: 'X' },
      docNo: '승 진 2608-1', sendDate: 'X', recipient: 'X', reference: 'X', sender: 'X',
      senderSign: { name: 'X', title: 'X', rep: 'X' }, year: 2026, typeLabel: 'X',
    },
    delegation: {
      typeLabel: 'X',
      owner: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
      agent: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
      periodLabel: 'X', daysLabel: '1일', submitDate: 'X', station: 'X',
    },
    customerAddress: 'X', startISO: '2026-08-21', endISO: '2026-08-21',
  })
  const missing = ANCHORS.filter(a => !values.has(a.field)).map(a => a.field)
  check(`앵커 ${ANCHORS.length}개 field 전부 값 맵에 존재`, missing.length === 0, missing.join(', '))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
