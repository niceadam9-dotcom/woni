/** 독립 판정자 A — D4(추출기)·D6(치환 함정 회귀축)의 **이빨**을 변이로 확인한다.
 *  읽기 전용: 자산은 메모리에서만 변형하고 디스크에 쓰지 않는다.
 *  실행: npx tsx scripts/_judgeD-A-d4d6.mts */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { extractDonorItemMap, readCells, expandSqref } from '../src/lib/xlsx-donor-itemmap-extract.ts'
import { allDonorSheets } from '../src/lib/xlsx-donors.ts'

let pass = 0, fail = 0
const ck = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  OK   ${label}`) } else { fail++; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}

// ─────────── [A] readCells 3형 + 속성순서 + 자기닫힘 ───────────
console.log('[A] readCells — 형태별 표본')
{
  const sst = ['sst0', 'sst1', '공유문자열2']
  const xml = `<sheetData><row r="1">`
    + `<c r="A1" t="inlineStr"><is><t>인라인</t></is></c>`
    + `<c s="734" r="B1" t="inlineStr"><is><t xml:space="preserve">순서역전</t></is></c>`
    + `<c r="C1" t="s"><v>2</v></c>`
    + `<c s="5" r="D1" t="s"><v>1</v></c>`
    + `<c r="E1"><v>42</v></c>`
    + `<c r="F1" s="9"/>`
    + `<c r="G1" t="inlineStr"><is><t>뒤</t></is></c>`
    + `<c r="H1" t="inlineStr"><is><t>a&amp;amp;lt;b</t></is></c>`
    + `<c r="I1" t="inlineStr"><is><t>x</t></is><is><t>y</t></is></c>`
    + `</row></sheetData>`
  const { val, refs } = readCells(xml, sst)
  ck('(a) 속성순서 무관 — s= 가 앞선 B1/D1도 읽힌다', val.get('B1') === '순서역전' && val.get('D1') === 'sst1',
    `B1=${JSON.stringify(val.get('B1'))} D1=${JSON.stringify(val.get('D1'))}`)
  ck('(b) 자기닫힘 F1 — refs에 있고 val에 없다', refs.has('F1') && !val.has('F1'))
  ck('(b) 자기닫힘 뒤 셀이 밀리지 않는다 — G1=뒤', val.get('G1') === '뒤', JSON.stringify(val.get('G1')))
  ck('(c) inlineStr', val.get('A1') === '인라인', JSON.stringify(val.get('A1')))
  ck('(c) t="s" 공유문자열', val.get('C1') === '공유문자열2', JSON.stringify(val.get('C1')))
  ck('(c) 그냥 <v>', val.get('E1') === '42', JSON.stringify(val.get('E1')))
  ck('언이스케이프 순서 — &amp;amp;lt; 가 <가 되지 않는다', val.get('H1') === 'a&amp;lt;b', JSON.stringify(val.get('H1')))
  ck('refs 는 값 없는 셀도 포함(F-4 판정 축)', refs.size === 9, String(refs.size))
}

// ─────────── [A2] 대조군 — 옛 정규식이 정말 못 읽는가 ───────────
console.log('[A2] 대조군 — 순진한 정규식으로는 무엇이 깨지는가')
{
  const xml = `<c r="A1" t="inlineStr"><is><t>v1</t></is></c><c r="A2" s="1"/><c r="A3" t="inlineStr"><is><t>v3</t></is></c>`
  // 자기닫힘 미수용 정규식(빌드 주석이 경고한 함정)
  const naive = new Map<string, string>()
  for (const m of xml.matchAll(/<c\s([^>]*?)>([\s\S]*?)<\/c>/g)) {
    const ref = /\br="([A-Z]+\d+)"/.exec(m[1])?.[1]
    if (ref) naive.set(ref, [...m[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
  }
  ck('대조군: 자기닫힘 미수용이면 A2가 v3을 삼킨다(경고가 사실)', naive.get('A2') === 'v3', JSON.stringify(naive.get('A2')))
  // `<c r="` 고정
  const fixedR = [...xml.matchAll(/<c r="([A-Z]+\d+)"/g)].length
  console.log(`     참고: 이 표본은 r=가 전부 첫 속성이라 <c r=" 고정도 ${fixedR}개를 잡는다`)
}

// ─────────── [B] 실자산 로드 ───────────
const ASSET = 'templates/report-workbook-full.xlsx'
const zip = await JSZip.loadAsync(readFileSync(ASSET))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(x => [x[1], x[2]]))
const donorNames = new Set(allDonorSheets())
const sheets: Array<{ name: string; xml: string }> = []
for (const x of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  if (!donorNames.has(x[1])) continue
  sheets.push({ name: x[1], xml: await zip.file('xl/' + relMap.get(x[2])!.replace(/^\/?xl\//, ''))!.async('string') })
}
const base = extractDonorItemMap(sheets)
console.log(`\n[B] 기준선 — 도너 ${sheets.length}시트 · 엔트리 ${base.entries.length} · 실패 ${base.failures.length}`)
ck('기준선 실패 0', base.failures.length === 0, base.failures.slice(0, 3).join(' | '))
const cols = base.resultCols
console.log(`     결과열 C${Object.values(cols).filter(c => c === 'C').length} / J${Object.values(cols).filter(c => c === 'J').length}`
  + ` · 코드보유시트 ${Object.keys(cols).length} · dvOnly합 ${Object.values(base.dvOnly).reduce((a, b) => a + b, 0)}`)

const clone = () => sheets.map(s => ({ name: s.name, xml: s.xml }))
const mut = (name: string, f: (xml: string) => string) => {
  const c = clone(); const t = c.find(s => s.name === name)!
  const before = t.xml; t.xml = f(t.xml)
  if (t.xml === before) throw new Error(`변이 무효 — ${name} XML이 그대로다`)
  return c
}
const codesOf = (fs: string[], pre: string) => fs.filter(f => f.startsWith(pre))

// ─────────── [C] F-1..F-7 변이 검사 ───────────
console.log('\n[C] 변이 — 각 실패조건에 이빨이 있는가')
{
  // F-6 단독: 같은 시트 안 두 코드행의 코드를 맞바꾼다(중복 아님) → F-6만 붉어야
  const s1 = sheets.find(s => s.name === '옥1')!
  const { val } = readCells(s1.xml)
  const aCodes = [...val].filter(([r, v]) => /^A\d+$/.test(r) && /^\d{1,2}-[A-Z]-\d{3}$/.test(v.trim()))
    .map(([r, v]) => ({ row: +r.slice(1), code: v.trim() })).sort((a, b) => a.row - b.row)
  const [p, q] = [aCodes[0], aCodes[1]]
  const swapped = mut('옥1', x => x
    .replace(new RegExp(`(<c r="A${p.row}"[^>]*><is><t[^>]*>)${p.code}(</t>)`), `$1@@ONE@@$2`)
    .replace(new RegExp(`(<c r="A${q.row}"[^>]*><is><t[^>]*>)${q.code}(</t>)`), `$1${p.code}$2`)
    .replace('@@ONE@@', q.code))
  const rSwap = extractDonorItemMap(swapped)
  ck(`F-6 단독(코드 교환 ${p.code}<->${q.code}) — F-6 발생`, codesOf(rSwap.failures, 'F-6').length > 0, rSwap.failures.slice(0, 2).join(' | '))
  ck('F-6 단독 — F-3(중복)은 발생하지 않는다 = 두 축 독립', codesOf(rSwap.failures, 'F-3').length === 0)

  // F-3 단독: 다른 시트의 코드를 이 시트 코드로 덮어씀(시트 간 중복) → F-3만
  const other = sheets.find(s => s.name === '옥2')!
  const { val: v2 } = readCells(other.xml)
  const a2 = [...v2].filter(([r, v]) => /^A\d+$/.test(r) && /^\d{1,2}-[A-Z]-\d{3}$/.test(v.trim()))
    .map(([r, v]) => ({ row: +r.slice(1), code: v.trim() })).sort((a, b) => a.row - b.row)
  // 옥2의 마지막 코드행을 옥1 첫 코드로 바꾼다(옥2 안에서는 여전히 단조 증가가 깨지므로
  // 시트 간 순수 중복을 만들기 위해 옥1의 코드가 옥2 마지막보다 작은지 확인 후 조정)
  const last2 = a2[a2.length - 1]
  const dupCross = mut('옥2', x => x.replace(
    new RegExp(`(<c r="A${last2.row}"[^>]*><is><t[^>]*>)${last2.code}(</t>)`), `$1${p.code}$2`))
  const rDup = extractDonorItemMap(dupCross)
  ck(`F-3(시트간 중복 ${p.code}) 발생`, codesOf(rDup.failures, 'F-3').length > 0, rDup.failures.slice(0, 2).join(' | '))

  // 실사고 재현: 스1!A5 를 A4와 같은 코드로 되돌린다(R-1 회귀) → F-3·F-6 둘 다
  const s1sheet = sheets.find(s => s.name === '스1')!
  const { val: v3 } = readCells(s1sheet.xml)
  const a4 = (v3.get('A4') ?? '').trim(), a5 = (v3.get('A5') ?? '').trim()
  console.log(`     스1!A4=${a4} A5=${a5} (수리 후 상태)`)
  const r1 = mut('스1', x => x.replace(new RegExp(`(<c r="A5"[^>]*><is><t[^>]*>)${a5}(</t>)`), `$1${a4}$2`))
  const rR1 = extractDonorItemMap(r1)
  const f3 = codesOf(rR1.failures, 'F-3'), f6 = codesOf(rR1.failures, 'F-6')
  ck('R-1 재현(스1!A5=A4코드) — F-3 발생', f3.length > 0, rR1.failures.join(' | '))
  ck('R-1 재현 — F-6 발생 (서로 독립으로 잡는다는 주장)', f6.length > 0, rR1.failures.join(' | '))

  // F-1: 「점검결과」 헤더를 하나 더 만든다
  const dupHead = mut('옥1', x => x.replace(/(<c r="A2"[^>]*><is><t[^>]*>)([\s\S]*?)(<\/t>)/, `$1점검결과$3`))
  const rH = extractDonorItemMap(dupHead)
  ck('F-1(헤더 2개) 발생', codesOf(rH.failures, 'F-1').length > 0, rH.failures.slice(0, 2).join(' | '))

  // F-2: 옥1의 dv를 통째로 제거
  const noDv = mut('옥1', x => x.replace(/<dataValidation[\s\S]*?<\/dataValidation>/g, ''))
  const rNoDv = extractDonorItemMap(noDv)
  ck('F-2(dv 제거) 발생', codesOf(rNoDv.failures, 'F-2').length > 0, String(codesOf(rNoDv.failures, 'F-2').length))

  // F-2b: formula1 을 #REF! 로 되돌린다 → 유효 dv 아님
  const refDv = mut('옥1', x => x.replace(/<formula1>[\s\S]*?<\/formula1>/g, '<formula1>#REF!</formula1>'))
  const rRef = extractDonorItemMap(refDv)
  ck('F-2(#REF! dv는 무효로 친다) 발생', codesOf(rRef.failures, 'F-2').length > 0, String(codesOf(rRef.failures, 'F-2').length))

  // F-4: 결과셀 하나를 XML에서 삭제
  const firstEntry = base.entries.find(e => e.sheet === '옥1')!
  const delCell = mut('옥1', x => x.replace(new RegExp(`<c r="${firstEntry.cell}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), ''))
  const rDel = extractDonorItemMap(delCell)
  ck(`F-4(${firstEntry.sheet}!${firstEntry.cell} 셀 삭제) 발생`, codesOf(rDel.failures, 'F-4').length > 0, rDel.failures.slice(0, 2).join(' | '))

  // F-5: 결과셀에 표본 답을 심는다
  const dirty = mut('옥1', x => x.replace(new RegExp(`<c r="${firstEntry.cell}"([^>]*)\\/>`),
    `<c r="${firstEntry.cell}"$1 t="inlineStr"><is><t>○</t></is></c>`))
  const rDirty = extractDonorItemMap(dirty)
  ck(`F-5(표본 답 심기) 발생`, codesOf(rDirty.failures, 'F-5').length > 0, rDirty.failures.slice(0, 2).join(' | '))

  // F-7: 결과셀을 병합 비앵커로 만든다 (한 칸 위와 병합)
  const col = /^([A-Z]+)/.exec(firstEntry.cell)![1]
  const merged = mut('옥1', x => x.replace(/<mergeCells([^>]*)>/,
    `<mergeCells$1><mergeCell ref="${col}${firstEntry.row - 1}:${col}${firstEntry.row}"/>`))
  const rMerge = extractDonorItemMap(merged)
  ck('F-7(병합 비앵커) 발생', codesOf(rMerge.failures, 'F-7').length > 0, rMerge.failures.slice(0, 2).join(' | '))
}

// ─────────── [D] D6 — $ 치환 함정과 formula1 오염 단언 ───────────
console.log('\n[D] D6 — 치환 함정 재현 + 빌드 단언의 이빨')
{
  const so = sheets.find(s => s.name === '소')!
  const re = /(<dataValidation[^>]*sqref="C4"[^>]*>[\s\S]*?<formula1>)([\s\S]*?)(<\/formula1>)/
  const m = re.exec(so.xml)
  ck('소!C4 dv 존재 · 현재 formula1 = $F$16:$F$18', m?.[2].trim() === '$F$16:$F$18', JSON.stringify(m?.[2]))

  // (1) 문자열 replacer 함정 재현 — 원본을 #REF! 로 되돌린 사본에 옛 코드를 적용
  const preFix = so.xml.replace(re, (_x, a: string, _b: string, c: string) => `${a}#REF!${c}`)
  const TO = '$F$16:$F$18'
  const bugged = preFix.replace(re, `$1${TO}$3`)          // 옛(결함) 코드
  const fixed = preFix.replace(re, (_x, a: string, _b: string, c: string) => `${a}${TO}${c}`) // 현행 코드
  const gb = /<dataValidation[^>]*sqref="C4"[^>]*>[\s\S]*?<formula1>([\s\S]*?)<\/formula1>/.exec(bugged)?.[1] ?? ''
  const gf = /<dataValidation[^>]*sqref="C4"[^>]*>[\s\S]*?<formula1>([\s\S]*?)<\/formula1>/.exec(fixed)?.[1] ?? ''
  ck('문자열 replacer는 실제로 formula1을 오염시킨다(함정 실재)', gb.includes('<') && gb.length > 40,
    `len=${gb.length} head=${JSON.stringify(gb.slice(0, 50))}`)
  ck('함수 replacer는 $를 그대로 쓴다(수리 유효)', gf === TO, JSON.stringify(gf))

  // (2) 빌드 ⑤b 단언(build-workbook-full.mts:496-502)의 술어를 그대로 적용
  const assertF1 = (name: string, xml: string): string[] => {
    const fails: string[] = []
    for (const mm of xml.matchAll(/<formula1>([\s\S]*?)<\/formula1>/g)) {
      if (mm[1].includes('#REF!')) fails.push(`#REF! 잔존: ${name}`)
      if (/[<>]/.test(mm[1])) fails.push(`오염(XML 혼입): ${name}`)
      if (mm[1].length > 40) fails.push(`비정상 길이 ${mm[1].length}: ${name}`)
    }
    return fails
  }
  ck('단언에 이빨: 오염된 사본은 빨강', assertF1('소', bugged).length > 0, assertF1('소', bugged).slice(0, 2).join(' | '))
  ck('단언에 이빨: #REF! 사본은 빨강', assertF1('소', preFix).length > 0)
  ck('대조군: 현행 자산 전 도너 시트는 초록(무죄)', sheets.flatMap(s => assertF1(s.name, s.xml)).length === 0,
    sheets.flatMap(s => assertF1(s.name, s.xml)).slice(0, 3).join(' | '))

  // (3) 실사고 재현 — 오염돼도 추출기·#REF!축은 초록이었나?
  const polluted = clone(); polluted.find(s => s.name === '소')!.xml = bugged
  const rp = extractDonorItemMap(polluted)
  console.log(`     오염 사본에 대한 추출기 실패 ${rp.failures.length}건 (자백대로면 0이어야 한다)`)
  ck('자백 재현: 오염돼도 추출기는 초록 → ②③축이 없으면 못 잡는다', rp.failures.length === 0, rp.failures.slice(0, 3).join(' | '))
  ck('자백 재현: #REF! 축만 보면 오염을 못 잡는다', !bugged.includes('#REF!'))

  // (4) 닫힌 덮개(build:242-243)의 술어 — 오염 시 붉어지는가
  const back = /<dataValidation[^>]*sqref="C4"[^>]*>[\s\S]*?<formula1>([\s\S]*?)<\/formula1>/.exec(bugged)?.[1]
  ck('닫힌 덮개 술어: 되읽은 값 !== to → throw 조건 성립', back !== TO)
}

// ─────────── [E] expandSqref 2열 범위 ───────────
console.log('\n[E] expandSqref — 다열 범위(C-2 유령의 원인)')
{
  const s = expandSqref('J4:K9 $J$11:$K$12 C4')
  ck('J4:K9 = 12칸 전개', ['J4', 'K4', 'J9', 'K9'].every(c => s.has(c)))
  ck('$ 포함 범위도 전개', s.has('J11') && s.has('K12'))
  ck('단일 셀', s.has('C4'))
  ck('총 칸 수 12+4+1=17', s.size === 17, String(s.size))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
