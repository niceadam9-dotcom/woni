/**
 * A4-6 — 별지4호·별지9호를 각자 원문대로 찍는가 (소방계획서_19 재판정 2026-08-20 사용자 확정)
 *
 * 왜 필요한가: 1절 점검결과·2절 안전시설등·세부현황 3-1~3-8은 두 서식이 렌더러를 공용한다.
 * 그런데 두 서식은 개정 단계가 달라 같은 항목의 표기가 다르고, 아예 없는 항목도 있다.
 * 종전엔 한 벌로 찍어 자리마다 어느 한쪽이 틀려 있었다.
 *
 * 기대값을 하드코딩하지 않는다 — 실행 때마다 **원문 파일 두 개를 직접 열어** 대조한다.
 * 파생 요약본(_doc01/*.MD·*.htm)이나 이미 떠 있는 추출 txt는 쓰지 않는다(구판이라 틀린다).
 *
 * 검사 3층:
 *   A. 라벨 표가 원문과 맞는가 — **양방향**. 9호 표기는 9호에만, 4호 표기는 4호에만 있어야 한다.
 *      (한 방향만 보면 '양쪽 원문에 다 있는 문구'를 굳이 분기해 둔 잉여를 못 잡는다.)
 *   B. 없는 항목이 정말 없는가 — 화재알림설비는 9호에 있고 4호 원문 전체에 0건이어야 한다.
 *   C. 전수 — 두 서식이 실제로 인쇄하는 체크박스 라벨 전부가 그 서식 원문에 있는가.
 *      새 이웃(분기 안 한 자리)이 생기면 여기서 걸린다. A4-6이 5건으로 닫혔다가 실제로는
 *      10건이었던 게 이 전수 검사가 없어서였다.
 *
 * 실행: npx tsx scripts/_probe-a4-6-annex-labels.mts       (DB·네트워크·환경변수 불필요)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateRawSync, inflateSync } from 'node:zlib'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { facilityResultSection, muResultSection } from '../src/lib/doc-templates/report9'
import { renderSpecSections } from '../src/lib/doc-templates/spec-sections'
import { _ANNEX_LABEL_TABLE, type AnnexForm } from '../src/lib/doc-templates/annex-labels'

const FORM_DIR = resolve(process.cwd(), '../erp_goal/_form')
const A4 = resolve(FORM_DIR, '[별지 4] 소방시설등(작동점검¸ 종합점검(최초점검¸ 그 밖의 점검) 점검표(소방시설 자체점검사항 등에 관한 고시).hwp')
const A9 = resolve(FORM_DIR, '별지9호-placeholder.hwpx')

let pass = 0
const fails: string[] = []
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`) }
  else { fails.push(msg); console.log(`  ❌ ${msg}`) }
}

// ── 원문 추출 ───────────────────────────────────────────────────────────────
/** .hwp 5.0 = OLE 복합문서. BodyText/Section*이 raw deflate, 그 안은 레코드 스트림.
 *  필요한 건 HWPTAG_PARA_TEXT(67) 하나뿐이라 최소만 판다(scripts/_spike-hwp-extract.mjs와 동일 규칙). */
function extractHwp(path: string): string {
  const cfb = XLSX.CFB.read(readFileSync(path), { type: 'buffer' })
  const entries = cfb.FullPaths.map((p: string, i: number) => ({
    path: p, content: cfb.FileIndex[i].content as Uint8Array, size: cfb.FileIndex[i].size as number,
  }))
  const fh = entries.find(e => /FileHeader$/.test(e.path))
  const compressed = fh ? (Buffer.from(fh.content)[36] & 1) === 1 : true
  const inflate = (b: Buffer) => { if (!compressed) return b; try { return inflateRawSync(b) } catch { return inflateSync(b) } }
  const TAG_PARA_TEXT = 0x10 + 51
  const out: string[] = []
  const sections = entries.filter(e => /BodyText\/Section/.test(e.path) && e.size > 0)
  if (!sections.length) throw new Error(`${path} — BodyText 섹션 없음(파일 구조 변경?)`)
  for (const s of sections) {
    const buf = inflate(Buffer.from(s.content))
    let pos = 0
    while (pos + 4 <= buf.length) {
      const header = buf.readUInt32LE(pos)
      const tag = header & 0x3ff
      let size = (header >> 20) & 0xfff
      pos += 4
      if (size === 0xfff) { size = buf.readUInt32LE(pos); pos += 4 }
      const body = buf.subarray(pos, pos + size)
      pos += size
      if (tag !== TAG_PARA_TEXT) continue
      let t = ''
      for (let i = 0; i + 1 < body.length;) {
        const c = body.readUInt16LE(i)
        if (c < 32) {
          if ([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23].includes(c)) { i += 16; t += ' ' }
          else if ([4, 5, 6, 7, 8, 9, 19, 20].includes(c)) { i += 16 }
          else { i += 2; if (c === 10 || c === 13) t += '\n' }
        } else { t += String.fromCharCode(c); i += 2 }
      }
      out.push(t)
    }
  }
  return out.join('\n')
}

async function extractHwpx(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const entry = zip.file('Contents/section0.xml')
  if (!entry) throw new Error(`${path} — Contents/section0.xml 없음(hwpx 구조 변경?)`)
  const xml = await entry.async('string')
  return [...xml.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'))
    .join('\n')
}

/** 대조 축 — 공백만 무시한다(원문은 표 폭 맞춤 공백이 자리마다 제각각).
 *  구분자·글자는 절대 정규화하지 않는다 — 그게 바로 이 프로브가 지키려는 차이다. */
const norm = (s: string) => s.replace(/\s+/g, '')

const src4 = norm(extractHwp(A4))
const src9 = norm(await extractHwpx(A9))
console.log(`원문 로드 — 4호 ${src4.length}자 · 9호 ${src9.length}자\n`)
// 추출 자체가 망가지면 이하 단언이 전부 '없음'으로 통과할 수 있다 — 먼저 살아 있음을 증명한다.
ok(src4.length > 30000 && src9.length > 8000, '두 원문 모두 본문이 추출됐다(추출 실패를 통과로 읽지 않기 위한 선행 단언)')
// 두 단언을 붙이지 않는다 — 붙이면 어느 쪽 파일이 어긋났는지 실패 메시지가 말해 주지 못한다.
// (4호 표제는 원문에서 '소방시설등'/'점검표'가 서로 다른 문단으로 쪼개져 있어 표제로는 못 쓴다 — 근거 조문으로 짚는다.)
ok(src4.includes(norm('소방시설 자체점검사항 등에 관한 고시[별지 제4호서식]')),
  '4호 파일이 별지 제4호서식(고시)이 맞다')
ok(src9.includes(norm('소방시설 설치 및 관리에 관한 법률 시행규칙 [별지 제9호서식]')),
  '9호 파일이 별지 제9호서식(시행규칙)이 맞다')

// ── A. 라벨 표 ↔ 원문 (양방향) ──────────────────────────────────────────────
console.log('\n── A. 서식별 라벨 표가 원문과 맞는가 (양방향)')
for (const [a9, a4] of Object.entries(_ANNEX_LABEL_TABLE.labels)) {
  ok(src9.includes(norm(a9)), `9호 원문에 "${a9}" 있다`)
  ok(src4.includes(norm(a4)), `4호 원문에 "${a4}" 있다`)
  ok(!src4.includes(norm(a9)), `4호 원문엔 9호 표기 "${a9}" 없다 — 분기가 필요한 자리가 맞다`)
  ok(!src9.includes(norm(a4)), `9호 원문엔 4호 표기 "${a4}" 없다 — 분기가 필요한 자리가 맞다`)
}

// ── B. 별지4호에 없는 항목 ──────────────────────────────────────────────────
console.log('\n── B. 별지4호 원문에 행 자체가 없는 항목')
for (const item of _ANNEX_LABEL_TABLE.absent) {
  ok(src9.includes(norm(item)), `9호 원문엔 "${item}" 있다`)
  ok(!src4.includes(norm(item)), `4호 원문엔 "${item}" 없다`)
}

// ── C. 인쇄 라벨 전수 대조 ──────────────────────────────────────────────────
/** 체크박스 표기는 자리마다 다르다 — `[ ]`·`[√]`·`[&nbsp;&nbsp;]`(2칸).
 *  라벨은 '이 체크박스부터 다음 체크박스(또는 줄끝)까지'로 자른다. 괄호를 잘라내면
 *  '자동차압'처럼 짧아져 4호의 '자동차압급기댐퍼'에 부분일치로 먹혀 차이가 가려진다. */
function renderedLabels(html: string): string[] {
  const text = html.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ')
  const out = new Set<string>()
  const BOX = /\[[\s√]*\]/g
  for (const line of text.split('\n')) {
    const marks = [...line.matchAll(BOX)]
    marks.forEach((m, i) => {
      const start = m.index! + m[0].length
      const end = i + 1 < marks.length ? marks[i + 1].index! : line.length
      const v = line.slice(start, end).replace(/\s+/g, ' ').trim().replace(/[,ㆍ·:、]$/, '')
      if (v.length >= 2 && v.length <= 60 && (v.match(/[가-힣]/g) ?? []).length >= 2) out.add(v)
    })
  }
  return [...out]
}

function printedLabels(form: AnnexForm): Array<{ where: string; label: string }> {
  const empty = { facilityChecks: [], resultMarks: {}, muResults: {} }
  return [
    ...renderedLabels(facilityResultSection(empty, { form })).map(label => ({ where: '1절 점검결과', label })),
    ...renderedLabels(muResultSection(empty, { form })).map(label => ({ where: '2절 안전시설등', label })),
    ...renderSpecSections({}, { form }).flatMap(sec => renderedLabels(sec).map(label => ({ where: '세부현황', label }))),
  ]
}

console.log('\n── C. 두 서식이 인쇄하는 체크박스 라벨 전수 대조')
for (const [form, src, name] of [['annex4', src4, '별지4호'], ['annex9', src9, '별지9호']] as const) {
  const labels = printedLabels(form)
  const missing = labels.filter(l => !src.includes(norm(l.label)))
  ok(labels.length > 250, `${name} 인쇄 라벨 ${labels.length}종을 뽑았다(렌더가 비지 않았다)`)
  ok(missing.length === 0,
    missing.length === 0
      ? `${name} 인쇄 라벨 ${labels.length}종이 전부 ${name} 원문에 있다`
      : `${name} 원문에 없는 인쇄 라벨 ${missing.length}종: ${missing.map(m => `[${m.where}] ${m.label}`).join(' / ')}`)
}

// ── D. 분기가 조회 키를 건드리지 않았는가 ───────────────────────────────────
// 라벨만 바꾸고 키는 9호 표기로 두는 게 규약이다. 키까지 바뀌면 체크·결과가 조용히 빈칸이 된다.
console.log('\n── D. 별지4호에서도 체크·결과가 살아 있는가 (키는 9호 표기 그대로)')
const marked = {
  facilityChecks: ['강화액소화설비', '고체에어로졸소화설비', '옥내소화전설비'],
  resultMarks: { 강화액소화설비: 'X', 옥내소화전설비: 'O' } as Record<string, 'O' | 'X' | 'N'>,
  muResults: { 'MU-007': 'X' } as Record<string, 'O' | 'X' | 'N'>,
}
const p1of4 = facilityResultSection(marked, { form: 'annex4' })
ok(/\[√\]\s*강화액소화전설비/.test(p1of4.replace(/&nbsp;/g, ' ')),
  '별지4호: 9호 어휘로 들어온 설치(√)가 4호 표기 행에 그대로 찍힌다')
ok(p1of4.includes('×'), '별지4호: 점검결과(×)가 사라지지 않았다')
const mu4 = muResultSection(marked, { form: 'annex4' })
ok(/\[√\]\s*피난안내도ㆍ피난안내영상물/.test(mu4.replace(/&nbsp;/g, ' ')),
  '별지4호: MU-007 체크가 4호 표기 라벨에 찍힌다')
const mu9 = muResultSection(marked, { form: 'annex9' })
ok(/\[√\]\s*피난안내도, 피난안내영상물/.test(mu9.replace(/&nbsp;/g, ' ')),
  '별지9호: 같은 값이 9호 표기 라벨에 찍힌다')
// 없는 항목은 4호에서만 사라지고 9호에는 남는다 — 한쪽만 보면 '지웠다'와 '둘 다 없다'를 구별 못 한다
ok(!facilityResultSection(marked, { form: 'annex4' }).includes('화재알림설비'),
  '별지4호 1절에 화재알림설비 행이 없다')
ok(facilityResultSection(marked, { form: 'annex9' }).includes('화재알림설비'),
  '별지9호 1절엔 화재알림설비 행이 그대로 있다')
ok(!renderSpecSections({}, { form: 'annex4' }).join('').includes('화재알림설비'),
  '별지4호 세부현황 3-5에 화재알림설비 블록이 없다')
ok(renderSpecSections({}, { form: 'annex9' }).join('').includes('화재알림설비'),
  '별지9호 세부현황 3-5엔 화재알림설비 블록이 그대로 있다')
// C의 사각지대 메우기 — 체크박스가 앞에 없는 **이어짐 줄**은 전수 대조가 못 잡는다.
// 피난기구 하위 둘째 줄이 그 자리다(4호만 U+00B7). 변이 검사에서 C가 이 8→9번째 차이를 놓쳤다.
ok(facilityResultSection(marked, { form: 'annex4' }).includes('(간이)완강기·미끄럼대·구조대'),
  '별지4호: 피난기구 하위 이어짐 줄이 4호 구분자(U+00B7)로 찍힌다')
ok(facilityResultSection(marked, { form: 'annex9' }).includes('(간이)완강기ㆍ미끄럼대ㆍ구조대'),
  '별지9호: 같은 줄이 9호 구분자(U+318D)로 찍힌다')
ok(!facilityResultSection(marked, { form: 'annex4' }).includes('(간이)완강기ㆍ미끄럼대ㆍ구조대'),
  '별지4호에 9호 구분자가 섞여 남지 않았다')

// 섹션 번호 축(종전 numbering)이 이름만 바뀌고 동작은 그대로인가
ok(renderSpecSections({}, { form: 'annex4' })[0].includes(' 1. '),
  '별지4호 세부현황 섹션 번호는 1.부터 (종전 numbering 동작 유지)')
ok(renderSpecSections({}, { form: 'annex9' })[0].includes('3-1.'),
  '별지9호 세부현황 섹션 번호는 3-1. (기본값이 9호)')

console.log(`\n${'='.repeat(60)}`)
console.log(`${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log(`  · ${f}`)
  process.exit(1)
}
