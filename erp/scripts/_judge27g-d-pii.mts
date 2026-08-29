/** 판정자 D — S0-6/S1-1 문서 수치 재측정: 원본 갑지의 표본 PII '리터럴 6셀 · 고유 39셀'이 맞는가.
 *
 *  구현자 스크립트(_fix27-pii-count.mts)를 실행하지 않고 **내 코드로 다시 센다**. 더해:
 *   · '41'이 니들별 중복 계수인지 산술로 재현
 *   · 옛 표기 '4셀'이 니들 5종 축의 값인지 재현
 *   · 리터럴 좌표가 문서가 적은 6좌표와 **집합으로 같은지**(개수만 맞고 좌표가 다를 수 있다)
 *   · 반증: 없는 니들 → 0, 흔한 문자열 → 큰 수(검사가 항진명제가 아님)
 *   · 수식 셀 축이 실재하는지 — .xls 파싱이 f를 안 주면 전부 리터럴로 보여 수치가 통째로 틀린다
 *  실행: npx tsx scripts/_judge27g-d-pii.mts */
import XLSX from 'xlsx'
import { readFileSync, writeFileSync } from 'node:fs'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'

const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const wb = XLSX.read(readFileSync(SRC), { cellFormula: true, cellStyles: false })
const OUT: string[] = [`[대상] ${SRC} · 시트 ${wb.SheetNames.length}`]

type Hit = { ref: string; v: string; f?: string; needles: string[] }
const scan = (needles: readonly string[]): Hit[] => {
  const hits: Hit[] = []
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const c = ws[k] as XLSX.CellObject
      const v = String(c.v ?? '')
      const n = needles.filter(x => v.includes(x))
      if (n.length) hits.push({ ref: `${s}!${k}`, v, f: c.f, needles: n })
    }
  }
  return hits
}

// 파싱 건전성 — .xls에서 f가 실제로 채워지는가(안 채워지면 아래 분류가 통째로 무의미하다)
let totalCells = 0, totalFormula = 0
for (const s of wb.SheetNames) for (const k of Object.keys(wb.Sheets[s])) {
  if (k.startsWith('!')) continue
  totalCells++
  if ((wb.Sheets[s][k] as XLSX.CellObject).f) totalFormula++
}
OUT.push(`[건전성] 전체 셀 ${totalCells} · <f> 있는 셀 ${totalFormula} — 0이면 리터럴/수식 분류 자체가 불가`)

const all = scan(SCRUB_NEEDLES)
const lit = all.filter(h => !h.f), form = all.filter(h => h.f)
OUT.push('')
OUT.push(`[니들 7종] 히트 셀(고유) ${all.length} = 리터럴 ${lit.length} + 수식 ${form.length}`)
OUT.push(`  리터럴 좌표: ${lit.map(h => h.ref).join(', ')}`)
for (const h of lit) OUT.push(`    ${h.ref} = ${JSON.stringify(h.v).slice(0, 70)}  (니들 ${h.needles.join('·')})`)
const multi = all.reduce((n, h) => n + h.needles.length, 0)
OUT.push(`  니들별 중복 계수(같은 칸을 니들마다 셈) = ${multi} · 수식만 = ${form.reduce((n, h) => n + h.needles.length, 0)}`)

const OLD5 = ['정내과의원', '김미진', '010-7565-3271', '721227', '7565-3271']
const old = scan(OLD5)
OUT.push('')
OUT.push(`[옛 니들 5종] 히트 셀(고유) ${old.length} = 리터럴 ${old.filter(h => !h.f).length} + 수식 ${old.filter(h => h.f).length}`)
OUT.push(`  → 옛 표기 '리터럴 4셀'과 대조: ${old.filter(h => !h.f).length === 4 ? '재현됨(4)' : `재현 안 됨(${old.filter(h => !h.f).length})`}`)
OUT.push(`  → 옛 표기 '수식 41건'과 대조(중복 계수): ${old.filter(h => h.f).reduce((n, h) => n + h.needles.length, 0)}`)

// 문서가 적은 6좌표와 집합 비교
const DOC6 = ['개요!D13', '개요!B14', '개요!B16', '개요!B17', '개요!D17', '개요!B19']
const got = new Set(lit.map(h => h.ref))
const missing = DOC6.filter(r => !got.has(r)), extra = [...got].filter(r => !DOC6.includes(r))
OUT.push('')
OUT.push(`[좌표 집합] 문서 6좌표 중 실측에 없는 것 ${missing.length}${missing.length ? ': ' + missing.join(', ') : ''}`
  + ` · 실측에 더 있는 것 ${extra.length}${extra.length ? ': ' + extra.join(', ') : ''}`)

// 반증 가능성
const none = scan(['ZZZ판정자D없는니들'])
const common = scan(['점검'])
OUT.push('')
OUT.push(`[반증] 없는 니들 → ${none.length}건(0이어야 함) · 흔한 문자열 '점검' → ${common.length}건(커야 함)`)

writeFileSync('F:/AI/ERP/_j27d-pii.txt', OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
