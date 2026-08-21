/** 소방계획서_27 S1-1 — 갑지 템플릿에 박힌 실고객 정보 전수 색출 (스크럽 대상 목록)
 *  실행: node scripts/_probe-pii-scrub.mjs
 *
 *  왜: 허브(개요!B14)만 주입했더니 LibreOffice 렌더 결과에 옛 값 '정내과의원'이 4회 남았다
 *  (_probe-xlsx-gate S0-4b 실측). 같은 값이 다른 자리에 **리터럴로도** 박혀 있다는 뜻이고,
 *  그 자리를 못 찾으면 다른 고객 문서에 남의 상호·이름·전화·생년월일이 인쇄된다. */
import XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
/** 실측으로 확인된 실고객 흔적 + 사람 이름·번호 패턴 */
const NEEDLES = ['정내과의원', '김미진', '010-7565-3271', '721227', '7565-3271']
const PATTERNS = [
  { name: '휴대폰번호', re: /01[016-9][-\s]?\d{3,4}[-\s]?\d{4}/ },
  { name: '주민/생년월일 6자리', re: /^\d{6}$/ },
  { name: '사업자번호', re: /\d{3}-\d{2}-\d{5}/ },
]

const wb = XLSX.read(readFileSync(SRC), { cellFormula: true, cellStyles: true })
console.log(`템플릿: ${SRC}\n시트 ${wb.SheetNames.length}개 전수 검사\n`)

const literal = [], viaFormula = [], suspect = []
for (const s of wb.SheetNames) {
  const ws = wb.Sheets[s]
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const c = ws[k]
    const v = String(c.v ?? '')
    if (!v) continue
    for (const n of NEEDLES) {
      if (!v.includes(n)) continue
      ;(c.f ? viaFormula : literal).push({ at: `${s}!${k}`, v, f: c.f ?? null, needle: n })
    }
    for (const p of PATTERNS) {
      if (p.re.test(v) && !NEEDLES.some(n => v.includes(n))) suspect.push({ at: `${s}!${k}`, v, f: c.f ?? null, kind: p.name })
    }
  }
}

console.log(`■ 리터럴로 박힌 실고객 값 ${literal.length}건 — **스크럽 필수**(주입해도 안 지워진다)`)
for (const r of literal) console.log(`   ${r.at.padEnd(14)} ${JSON.stringify(r.v)}`)

console.log(`\n■ 수식으로 끌어온 값 ${viaFormula.length}건 — 허브를 채우면 따라 바뀐다`)
const byNeedle = {}
for (const r of viaFormula) (byNeedle[r.needle] ??= []).push(r.at)
for (const [n, ats] of Object.entries(byNeedle)) console.log(`   ${n}: ${ats.join(', ')}`)

console.log(`\n■ 그 밖의 개인정보 의심 값 ${suspect.length}건`)
for (const r of suspect.slice(0, 40)) console.log(`   ${r.at.padEnd(14)} [${r.kind}] ${JSON.stringify(r.v)}${r.f ? ` (수식 ${r.f})` : ''}`)
if (suspect.length > 40) console.log(`   … 외 ${suspect.length - 40}건`)

console.log(`\n요약: 리터럴 ${literal.length} · 수식 ${viaFormula.length} · 의심 ${suspect.length}`)
