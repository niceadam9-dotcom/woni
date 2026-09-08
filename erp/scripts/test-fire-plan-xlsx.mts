/** 소방계획서 엑셀 무서버 전수 검사 — 소방계획서_42 S7-2.
 *
 *  DB도 서버도 없이, **자산 파일 자체**와 **앵커·값 축**만으로 판정한다. 라이브 왕복(S7-4)이
 *  잡는 것과 축이 다르다 — 여기서 붉어지는 것은 서식·좌표·규약이고, 저기서 붉어지는 것은 배선이다.
 *
 *  실행: npx tsx scripts/test-fire-plan-xlsx.mts
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_ANCHORS, FIRE_PLAN_FIELDS, ZONE_ROWS, ZONE_SHEET, ZONE_FIRST_ROW } from '../src/lib/fire-plan-anchors.ts'
import { buildFirePlanValues, missingValueFields, planDate, zoneRowOverflow } from '../src/lib/fire-plan-xlsx-values.ts'
import { FIRE_PLAN_MANIFEST, labelAt, boxGlyphAt } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { FIRE_PLAN_SCRUB_NEEDLES, FIRE_PLAN_MARK_CHECKED_RE } from '../src/lib/fire-plan-scrub.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

/* ══════════════════════ [0] 눈멂 가드 ══════════════════════
 *  분모부터 세운다. 0을 훑고 '잔재 0'이라 말하면 항진명제다. */
console.log('\n[0] 눈멂 가드 — 분모')
check('자산 파일이 있다', existsSync(XLSX_PATH), XLSX_PATH)
if (!existsSync(XLSX_PATH)) { console.log('\n자산이 없어 더 볼 수 없다 — build-fire-plan-template.mts 를 먼저 돌려라'); process.exit(1) }
const bytes = new Uint8Array(readFileSync(XLSX_PATH))
check('앵커가 0이 아니다', FIRE_PLAN_ANCHORS.length >= 50, `${FIRE_PLAN_ANCHORS.length}개`)
check('필드가 0이 아니다', FIRE_PLAN_FIELDS.length >= 20, `${FIRE_PLAN_FIELDS.length}종`)
check('manifest 시트가 0이 아니다', FIRE_PLAN_MANIFEST.sheets.length >= 28, `${FIRE_PLAN_MANIFEST.sheets.length}장`)

/* ══════════════════════ [1] 자산 지문 ══════════════════════ */
console.log('\n[1] manifest 지문 — 자산과 manifest가 같은 빌드에서 나왔는가')
{
  const sha = createHash('sha256').update(bytes).digest('hex')
  check('asset sha256 일치', sha === FIRE_PLAN_MANIFEST.asset.sha256,
    `파일 ${sha.slice(0, 12)} vs manifest ${FIRE_PLAN_MANIFEST.asset.sha256.slice(0, 12)}`)
  check('asset 바이트 수 일치', bytes.length === FIRE_PLAN_MANIFEST.asset.bytes,
    `${bytes.length} vs ${FIRE_PLAN_MANIFEST.asset.bytes}`)
}

/* ══════════════════════ [2] 앵커 ══════════════════════ */
console.log('\n[2] 앵커 — 라벨 대조 + 자가치유')
const wb = XLSX.read(bytes, { cellStyles: false })
const av = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
check('validateAnchors ok:true', av.ok, av.ok ? '' : av.failures.slice(0, 5).join(' / '))
if (av.ok) {
  // 🚨 치유가 **일어났다는 것 자체가 결함 신호**다 — 좌표가 이미 밀렸다는 뜻이다.
  check('healed.length === 0 (치유 = 좌표가 이미 밀렸다)', av.healed.length === 0, av.healed.slice(0, 3).join(' / '))
  check('전 앵커 시트 실재', av.anchors.every(a => !!wb.Sheets[a.sheet]))
}
{
  const dup = new Map<string, number>()
  for (const a of FIRE_PLAN_ANCHORS) dup.set(`${a.sheet}!${a.cell}`, (dup.get(`${a.sheet}!${a.cell}`) ?? 0) + 1)
  const bad = [...dup].filter(([, n]) => n > 1)
  check('한 칸에 앵커는 하나', bad.length === 0, bad.map(([k]) => k).join(','))
}
{
  // 라벨은 manifest에서 왔다 — 그 라벨이 자산의 그 칸에 **실제로** 있는지 되짚는다.
  // manifest와 자산이 갈라지면 [1]이 먼저 잡지만, 이건 좌표 오타를 잡는 다른 축이다.
  const bad = FIRE_PLAN_ANCHORS.filter(a => {
    const v = String((wb.Sheets[a.sheet]?.[a.labelCell] as XLSX.CellObject | undefined)?.v ?? '')
    return v.replace(/[\s:：]/g, '') !== a.label.replace(/[\s:：]/g, '')
  })
  check('앵커 라벨이 자산의 그 칸과 일치', bad.length === 0,
    bad.slice(0, 4).map(a => `${a.sheet}!${a.labelCell}`).join(','))
}

/* ══════════════════════ [3] 백지 불변식 ══════════════════════ */
console.log('\n[3] 백지 불변식 — 템플릿에 표본의 답이 남아 있지 않은가')
{
  // 불변식의 뜻은 '값이 없을 때 **표본의 답**이 인쇄되지 않는다'이지 '무조건 빈 칸'이 아니다.
  // 빈 상자 글자 하나만 남은 칸(표지 용도)은 답을 담고 있지 않은 **서식 골격**이고, 오히려
  // 그걸 지우면 용도 미입력 시 원본에 있던 상자가 사라진다. 그 한 갈래만 허용하고 나머지는
  // 여전히 공란을 요구한다 — 느슨하게 푸는 게 아니라 허용 범위를 글자 수준으로 좁힌다.
  const cellText = (a: { sheet: string; cell: string }) =>
    String((wb.Sheets[a.sheet]?.[a.cell] as XLSX.CellObject | undefined)?.v ?? '').trim()
  const dirty = FIRE_PLAN_ANCHORS.filter(a => {
    const t = cellText(a)
    return t && !/^[□☐]$/.test(t)
  })
  check('앵커 셀 공란(빈 상자 하나만 예외)', dirty.length === 0,
    dirty.slice(0, 5).map(a => `${a.sheet}!${a.cell}='${cellText(a)}'`).join(' · '))
  const boxOnly = FIRE_PLAN_ANCHORS.filter(a => /^[□☐]$/.test(cellText(a)))
  check('빈 상자만 남은 앵커는 소수', boxOnly.length <= 3, boxOnly.map(a => `${a.sheet}!${a.cell}`).join(','))
}
{
  // 원시 바이트 축 — 셀 값 스캔은 파트 안에 남은 원문을 못 본다(.xlsx는 zip이다)
  const zip = await JSZip.loadAsync(bytes)
  const hits: string[] = []
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue
    const raw = await zip.file(name)!.async('string')
    for (const n of FIRE_PLAN_SCRUB_NEEDLES) if (raw.includes(n)) hits.push(`${name} ⊃ '${n}'`)
  }
  check(`니들 ${FIRE_PLAN_SCRUB_NEEDLES.length}종 · 전 파트 원시 바이트 0건`, hits.length === 0, hits.slice(0, 3).join(' · '))
  check('sharedStrings.xml 파트 부재(고아 si 사고를 구조로 차단)', !Object.keys(zip.files).includes('xl/sharedStrings.xml'))
  check('xl/media 파트 부재(이미지 0)', !Object.keys(zip.files).some(n => n.startsWith('xl/media/')))
}
{
  // 체크 마크 덮개 — 예외는 manifest의 `bulletCells`(법정 불릿)뿐
  const bullets = new Set<string>()
  for (const s of FIRE_PLAN_MANIFEST.sheets) for (const ref of Object.keys(s.bulletCells)) bullets.add(`${s.name}!${ref}`)
  const bad: string[] = []
  for (const s of FIRE_PLAN_MANIFEST.sheets) {
    const ws = wb.Sheets[s.name]
    if (!ws) continue
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const v = String((ws[k] as XLSX.CellObject).v ?? '')
      if (FIRE_PLAN_MARK_CHECKED_RE.test(v) && !bullets.has(`${s.name}!${k}`)) bad.push(`${s.name}!${k}='${v.slice(0, 20)}'`)
    }
  }
  check(`체크된 표시 0칸 (불릿 예외 ${bullets.size}칸)`, bad.length === 0, bad.slice(0, 5).join(' · '))
  check('불릿 예외가 손목록 크기를 넘지 않는다', bullets.size <= 12, `${bullets.size}칸`)
}
{
  const bad: string[] = []
  for (const s of FIRE_PLAN_MANIFEST.sheets) {
    const ws = wb.Sheets[s.name]
    if (!ws) continue
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      if (String((ws[k] as XLSX.CellObject).v ?? '').includes('{{')) bad.push(`${s.name}!${k}`)
    }
  }
  check('{{token}} 잔존 0칸', bad.length === 0, bad.slice(0, 5).join(','))
}

/* ══════════════════════ [4] 무수식 ══════════════════════ */
console.log('\n[4] 무수식 — 갑지를 괴롭힌 결함군의 발생 자리가 없는가')
{
  const zip = await JSZip.loadAsync(bytes)
  let f = 0
  for (const n of Object.keys(zip.files).filter(x => /^xl\/worksheets\/.*\.xml$/.test(x))) {
    f += ((await zip.file(n)!.async('string')).match(/<f[\s>]/g) ?? []).length
  }
  check('<f> 0개', f === 0, `${f}개`)
  const kf = FIRE_PLAN_ANCHORS.filter(a => a.keepFormulaWhenEmpty || a.dropFormula)
  check('keepFormulaWhenEmpty·dropFormula 0건(수식이 없으므로 쓸 자리가 없다)', kf.length === 0, `${kf.length}건`)
}

/* ══════════════════════ [5] 시트명 규약 ══════════════════════ */
console.log('\n[5] 시트명 규약 (S3-2)')
{
  const names = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)
  check('31자 이내', names.every(n => n.length <= 31), names.filter(n => n.length > 31).join(','))
  check('금지문자 없음', names.every(n => !/[:\\/?*[\]]/.test(n)), names.filter(n => /[:\\/?*[\]]/.test(n)).join(','))
  check('중복 없음', new Set(names).size === names.length)
  check('서식번호로 시작', FIRE_PLAN_MANIFEST.sheets.every(s => !s.no || s.name.startsWith(s.no)),
    FIRE_PLAN_MANIFEST.sheets.filter(s => s.no && !s.name.startsWith(s.no)).map(s => s.name).join(','))
  check('자산의 시트 목록과 manifest가 일치', names.every(n => wb.SheetNames.includes(n)) && wb.SheetNames.length === names.length,
    `자산 ${wb.SheetNames.length} vs manifest ${names.length}`)
}

/* ══════════════════════ [6] 행 삽입 안전성 (S4-4) ══════════════════════
 *  가변 표 본문 행은 **열별로 같은 `s=`** 여야 한다. 그래야 사용자가 행을 복제·삽입해도 위
 *  행과 구분되지 않는다. 한 행만 서식이 다르면 그 행을 늘린 순간 인쇄물에서 티가 난다. */
console.log('\n[6] 행 삽입 안전성 — 반복 구간의 열별 스타일 동일성')
{
  const zip = await JSZip.loadAsync(bytes)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relTarget = new Map<string, string>()
  for (const m of relXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget.set(m[1], m[2])
  const sheetPath = new Map<string, string>()
  for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const t = relTarget.get(m[2])
    if (t) sheetPath.set(m[1].replace(/&amp;/g, '&'), `xl/${t}`)
  }

  /** 시트 XML → 'A1' → s= 값 */
  const styleMap = async (sheet: string) => {
    const p = sheetPath.get(sheet)
    if (!p) return null
    const xml = await zip.file(p)!.async('string')
    const out = new Map<string, string>()
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"(?:\s+s="(\d+)")?/g)) out.set(m[1], m[2] ?? '-')
    return out
  }

  /* ── xf 인덱스 → 테두리 정의 ──
   *  마지막 행이 왜 다른지를 **인덱스가 다르다**로 넘기지 않기 위해 실제 정의를 본다.
   *  실측(#23 1.9.3): 본문은 thin 사방, 마지막 행만 bottom=medium — **표를 닫는 줄**이다.
   *  어느 격자 표든 마지막 줄은 그렇게 생겼고, 그걸 본문과 같게 만들면 원본과 갈라진다. */
  const stylesXml = await zip.file('xl/styles.xml')!.async('string')
  const borderDefs = [...(/<borders[^>]*>([\s\S]*?)<\/borders>/.exec(stylesXml)?.[1] ?? '')
    .matchAll(/<border>[\s\S]*?<\/border>/g)].map(m => m[0])
  const xfBorderId = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '')
    .matchAll(/<xf\b[^>]*borderId="(\d+)"/g)].map(m => Number(m[1]))
  /** 아래 테두리를 뺀 나머지 — '표를 닫는 줄'만 다른지 보려면 그 축을 제거하고 비교해야 한다 */
  const borderSansBottom = (s: string): string => {
    const b = borderDefs[xfBorderId[Number(s)] ?? -1]
    if (b === undefined) return `?${s}`
    return b.replace(/<bottom(?:\/>|[^>]*>[\s\S]*?<\/bottom>)/, '')
  }
  check('styles.xml 파싱이 비지 않았다(눈멂 가드)', borderDefs.length > 1 && xfBorderId.length > 1,
    `borders ${borderDefs.length} · cellXfs ${xfBorderId.length}`)

  const runs: { sheet: string; startRow: number; rows: number; why: string }[] = [
    { sheet: ZONE_SHEET, startRow: ZONE_FIRST_ROW, rows: ZONE_ROWS, why: '구역별 세부현황' },
  ]
  // 번호 매겨진 반복 구간(개정이력 11행·입주사 15행)도 manifest에서 파생해 함께 본다
  for (const s of FIRE_PLAN_MANIFEST.sheets) {
    for (const r of s.numberedRuns) runs.push({ sheet: s.name, startRow: r.startRow + 1, rows: r.rows, why: '번호 반복행' })
  }
  check('검사할 반복 구간이 0이 아니다', runs.length >= 3, `${runs.length}구간`)

  for (const run of runs) {
    const sm = await styleMap(run.sheet)
    if (!sm) { check(`${run.sheet} 시트 XML 접근`, false); continue }
    const cols = new Set<string>()
    for (const ref of sm.keys()) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref)!
      const r = Number(m[2])
      if (r >= run.startRow && r < run.startRow + run.rows) cols.add(m[1])
    }
    const lastRow = run.startRow + run.rows - 1
    const bad: string[] = []
    const closing: string[] = []
    for (const c of cols) {
      // ① 본문(마지막 줄 제외)은 **완전히** 같아야 한다 — 여기가 진짜 '행 삽입 안전성'이다
      const inner = new Set<string>()
      for (let r = run.startRow; r < lastRow; r++) inner.add(sm.get(`${c}${r}`) ?? '(없음)')
      if (inner.size > 1) { bad.push(`${c}열 본문 ${[...inner].join('/')}`); continue }

      // ② 마지막 줄은 표를 닫는 줄이라 아래 테두리가 다를 수 있다. 다만 **아래 말고 다른 게
      //    다르면** 그건 닫는 줄이 아니라 서식 결함이다 — 정의를 꺼내 그 축만 빼고 비교한다.
      const innerS = [...inner][0]
      const lastS = sm.get(`${c}${lastRow}`) ?? '(없음)'
      if (lastS === innerS) continue
      if (borderSansBottom(innerS) === borderSansBottom(lastS)) { closing.push(c); continue }
      bad.push(`${c}열 마지막줄이 아래테두리 말고도 다르다 (${innerS}→${lastS})`)
    }
    check(`${run.sheet} ${run.why} r${run.startRow}×${run.rows} 본문 열별 s= 동일`,
      bad.length === 0, bad.slice(0, 4).join(' · '))
    if (closing.length) console.log(`       (마지막 줄 ${closing.join(',')}열은 표를 닫는 아래 테두리만 다름 — 원본 그대로)`)
  }
}

/* ══════════════════════ [7] 값 축 ══════════════════════ */
console.log('\n[7] 값 맵 완결성 · 표기 규약')
{
  // 픽스처는 `buildFirePlanValues`가 **실제로 읽는 필드만** 채운다. 전 필드를 채운 척하는
  // 픽스처는 값 함수가 다른 필드를 읽기 시작해도 초록으로 남는다(그 경우는 [7]의 완결성이 잡는다).
  const fixture = {
    year: 2026,
    buildingName: '가상건물', address: '경기도 어딘가 1-2',
    ownerName: '홍길동', ownerPhone: '010-0000-0001',
    managerName: '이순신', managerPhone: '010-0000-0002',
    receiverLocation: '1층 방재실', purpose: '공동주택',
    useApprovalDate: '2019-03-07', totalArea: '1,234.56', floors: '지상5층',
    height: '15', structure: '철근콘크리트', roof: '슬라브',
    fireStation: '어딘가소방서', managerSelectedAt: '2025-01-14',
    contractStart: '2025-01-01',
    ops: {
      insuranceJoined: true, insuranceCompany: '어느화재', insurancePeriod: '2025.1.1~2026.1.1',
      insuranceAmountPerson: '1000', insuranceAmountProperty: '2000',
      opHoursWeekday: '', opHoursHoliday: '', headcountWorker: '', headcountResident: '', headcountMax: '',
    },
    zones: Array.from({ length: ZONE_ROWS + 2 }, (_, i) => ({
      zone: `${i + 1}층`, name: `구역${i + 1}`, area: `${100 + i}`,
      weekday: '', holiday: '', managerCo: '', contact: `010-1111-00${i}`,
    })),
  } as unknown as FirePlanGenData

  const values = buildFirePlanValues(fixture)
  const gaps = missingValueFields(values)
  // 🚨 `?? '(없음)'`로 감싸면 오타 난 필드가 공허 통과한다 — 여기서 전건을 요구한다
  check('앵커 전 필드가 값 맵에 실재', gaps.length === 0, gaps.slice(0, 8).join(','))
  check('값 맵 크기 = 고유 필드 수', values.size === FIRE_PLAN_FIELDS.length, `${values.size}/${FIRE_PLAN_FIELDS.length}`)

  check('날짜 표기 YYYY. M. D.', planDate('2019-03-07') === '2019. 3. 7.', planDate('2019-03-07'))
  check('ISO가 아니면 손대지 않는다', planDate('2025년 상반기') === '2025년 상반기')
  check('빈 값은 빈 문자열', planDate(null) === '' && planDate(undefined) === '')
  // S5-2 — 시리얼이 아니라 문자열이어야 한다(우리 셀엔 numFmt가 없다)
  check('날짜가 숫자로 새지 않는다', typeof values.get('use_approval_date') === 'string',
    typeof values.get('use_approval_date'))
  check('전 값이 문자열(숫자 셀 0개)', [...values.values()].every(v => typeof v === 'string'))

  check('1.8 계약기간이 원문 물결표를 지킨다', String(values.get('agency_contract_period')).includes('~'),
    String(values.get('agency_contract_period')))
  check('구역 넘침을 센다', zoneRowOverflow(fixture) === 2, `${zoneRowOverflow(fixture)}`)
  check(`구역 행 예산이 manifest에서 파생됐다`, ZONE_ROWS === 8, `${ZONE_ROWS}행`)
  check('넘친 구역이 표에 새어 들어가지 않는다', !values.has(`zone_${ZONE_ROWS}_floor`))

  // 상자 글자 — 원본이 두 글자를 섞어 쓰므로 셀마다 다를 수 있다(F-6)
  const glyphs = new Set(FIRE_PLAN_MANIFEST.sheets.flatMap(s => Object.values(s.boxes)))
  check('빈 상자 어휘가 원본대로 둘 다 실재(F-6)', glyphs.has('□') && glyphs.has('☐'), [...glyphs].join(''))
  check('boxGlyphAt이 셀별 글자를 준다', boxGlyphAt('1.4 소방시설 현황', 'B4') === '□', boxGlyphAt('1.4 소방시설 현황', 'B4'))
  check('boxGlyphAt이 ☐ 시트도 준다', boxGlyphAt('1.1 건축물 일반현황', 'F12') === '☐', boxGlyphAt('1.1 건축물 일반현황', 'F12'))

  // 라벨 접근기는 없는 좌표에 throw 해야 한다 — 조용한 폴백이면 오타가 통과한다
  let threw = false
  try { labelAt('1.1 건축물 일반현황', 'ZZ999') } catch { threw = true }
  check('labelAt은 없는 좌표에 throw', threw)

  /* ── 왕복: 실제로 주입해 본다 ── */
  const { targets, unmapped } = toInjectTargets(values, av.ok ? av.anchors : FIRE_PLAN_ANCHORS)
  check('unmapped 0', unmapped.length === 0, unmapped.slice(0, 5).map(a => a.field).join(','))
  check('targets = 앵커 수', targets.length === FIRE_PLAN_ANCHORS.length, `${targets.length}/${FIRE_PLAN_ANCHORS.length}`)
  const inj = await injectWorkbook(bytes, targets)
  check('missed 0 — 전 대상 착지', inj.missed.length === 0, inj.missed.slice(0, 5).join(','))
  check('전파 0 — 수식이 없으므로 폐포도 없다', inj.propagated === 0, `${inj.propagated}`)

  const wb2 = XLSX.read(inj.bytes, { cellStyles: false })
  const at = (s: string, c: string) => String((wb2.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '')
  check('표지에 고객명이 조립돼 들어갔다', at('표지', 'A3').includes('가상건물') && at('표지', 'A3').includes('소방계획서'), at('표지', 'A3'))
  check('1.1 명칭 착지', at('1.1 건축물 일반현황', 'C4') === '가상건물')
  check('1.1 사용승인일이 사람이 읽는 날짜', at('1.1 건축물 일반현황', 'J9') === '2019. 3. 7.', at('1.1 건축물 일반현황', 'J9'))
  // 🚨 R-1 — 씨앗대로였다면 여기에 **대표자 전화**가 들어갔다
  check('1.1 소방안전관리자 연락처 = 관리자 전화(대표자 아님)',
    at('1.1 건축물 일반현황', 'I7') === '010-0000-0002' && at('1.1 건축물 일반현황', 'E7') === '010-0000-0001',
    `관리자칸='${at('1.1 건축물 일반현황', 'I7')}' 대표칸='${at('1.1 건축물 일반현황', 'E7')}'`)
  check('1.2.1 구역 첫 행 착지', at(ZONE_SHEET, `B${ZONE_FIRST_ROW}`) === '1층', at(ZONE_SHEET, `B${ZONE_FIRST_ROW}`))
  check('1.2.1 구역 마지막 행 착지', at(ZONE_SHEET, `B${ZONE_FIRST_ROW + ZONE_ROWS - 1}`) === `${ZONE_ROWS}층`)
  check('1.3 관할소방서 착지', at('1.3 소방차 진입경로', 'C5') === '어딘가소방서')

  // 주입 후에도 니들·수식·공유문자열이 생기지 않았는가(산출물 축)
  const z2 = await JSZip.loadAsync(inj.bytes)
  const outHits: string[] = []
  for (const name of Object.keys(z2.files)) {
    if (z2.files[name].dir) continue
    const raw = await z2.file(name)!.async('string')
    for (const n of FIRE_PLAN_SCRUB_NEEDLES) if (raw.includes(n)) outHits.push(`${name}⊃${n}`)
  }
  check('주입 산출물에도 니들 0건', outHits.length === 0, outHits.slice(0, 3).join(','))
  check('주입 산출물에 sharedStrings 없음', !Object.keys(z2.files).includes('xl/sharedStrings.xml'))
  check('병합 보존', wb2.SheetNames.reduce((n, s) => n + ((wb2.Sheets[s]!['!merges'] as unknown[] | undefined)?.length ?? 0), 0)
    === FIRE_PLAN_MANIFEST.sheets.reduce((n, s) => n + s.merges, 0))

  /* ── 값이 전부 빈 경우: 완전 덮어쓰기로 잔재가 없어야 한다(S5-4) ── */
  const empty = buildFirePlanValues({ ...fixture, zones: [], ops: undefined } as unknown as FirePlanGenData)
  check('빈 데이터에서도 필드 완결', missingValueFields(empty).length === 0)
  const injE = await injectWorkbook(bytes, toInjectTargets(empty, FIRE_PLAN_ANCHORS).targets)
  check('빈 데이터 주입도 missed 0', injE.missed.length === 0, injE.missed.slice(0, 4).join(','))
  const wbE = XLSX.read(injE.bytes, { cellStyles: false })
  check('빈 값 칸에 잔재 없음', !String((wbE.Sheets[ZONE_SHEET]?.[`B${ZONE_FIRST_ROW}`] as XLSX.CellObject | undefined)?.v ?? '').trim())
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
