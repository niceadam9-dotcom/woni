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
import { ANCHORS, HUB_INPUT_CELLS, HUB_LABEL_CELLS, SCRUB_NEEDLES, MARK_CHECKED_RE, VERDICT_MARKS, SAMPLE_OPINION_NEEDLES, validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { allDonorSheets } from '../src/lib/xlsx-donors.ts'
import { sheetFileMap, buildFullRefGraph, transitiveClosure } from '../src/lib/xlsx-inject.ts'
import { buildWorkbookValues } from '../src/lib/xlsx-workbook.ts'
import manifest from '../src/lib/xlsx-template-manifest.json' with { type: 'json' }

const TPL = 'templates/report-workbook.xlsx'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const bytes = new Uint8Array(readFileSync(TPL))

/** report9 픽스처 기본형 — 전부 '답 없음'. 정보 시트 12칸(§7)이 이 위에 답을 얹어 쓴다 */
type R9 = Parameters<typeof buildWorkbookValues>[0]['report9']
const R9_BLANK: R9 = {
  ckOp: true, ckInitial: false, ckCompEtc: false, consent: null, repRole: '',
  managerGrade: '', mgrEduDate: '', rampCount: '', main: null, assistants: [],
  hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
  insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
  multiUseNone: false, multiUseCounts: {},
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  stairsCount: '', elvR: '', elvE: '', elvV: '',
  pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
}
/** 값 1건 뽑기 — 픽스처 조립을 짧게 유지한다.
 *  ⚠ 없는 field는 **던진다**. 종전엔 `?? '(없음)'`을 돌려줘, field 이름이 바뀌거나 오타가 나면
 *  "니들이 없다"는 단언이 **자동으로 참**이 됐다(공허참 — 2026-08-24 독립 판정 실측: 오타 field
 *  3건을 넣어도 오염 축·백지 축이 전부 통과). 검사가 없는 것을 검사하고 있으면 안 된다. */
const oneValue = (report9: R9, field: string): string => {
  const v = valueMap(report9).get(field)
  if (v === undefined) throw new Error(`buildWorkbookValues에 field '${field}'가 없다 — 오타이거나 이름이 바뀌었다`)
  return String(v ?? '')
}
const valueMap = (report9: R9) => buildWorkbookValues({
  official: {
    company: { name: 'X', address: 'X', phone: 'X', fax: 'X' },
    docNo: '승 진 2608-1', sendDate: 'X', recipient: 'X', reference: 'X', sender: 'X',
    senderSign: { name: 'X', title: 'X', rep: 'X' }, year: 2026, typeLabel: 'X',
  },
  delegation: {
    typeLabel: 'X', owner: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    agent: { name: 'X', position: 'X', phone: 'X', birth: 'X' },
    periodLabel: 'X', daysLabel: '1일', submitDate: 'X', station: 'X',
  },
  customerAddress: 'X', startISO: '2026-08-21', endISO: '2026-08-21', useApprovalISO: null,
  building: null, report9,
})

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
check('현 템플릿에서 자가치유 0건(원좌표 그대로)', v.ok && v.healed.length === 0,
  v.ok ? v.healed.join(' · ') : '')

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

  // 단일 원천(SCRUB_NEEDLES) — 종전엔 여기만 5종이라 주소·연면적 잔존을 못 보는 축이었다
  const NEEDLES = SCRUB_NEEDLES
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

  // 원시 바이트 축 — 셀 값 스캔은 sharedStrings **고아 항목**을 못 본다(2026-08-22 판정 실측:
  // 고아 si 5건이 셀에는 안 보여도 전 산출물 바이트에 표본 PII를 실어 나갔다). zip 전 파트 검사
  {
    const rawLeaks: string[] = []
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) continue
      const raw = await zip.file(name)!.async('string')
      for (const n of NEEDLES) if (raw.includes(n)) rawLeaks.push(`${name}⊃'${n}'`)
    }
    check('원시 바이트(전 zip 파트) 니들 0건', rawLeaks.length === 0, rawLeaks.slice(0, 5).join(', '))
  }

  // 허브 영향 캐시 축 — 복합 수식(교차·산술)은 단일 참조 폐포 밖이라 표본 캐시가 남을 수 있다
  // (판정 실측: 정보!I16 교육이수일·완료보고서!G25 이행조치일 — 날짜 시리얼이라 니들로도 안 잡혔다).
  // 허브에서 전체 그래프로 닿는 셀은 템플릿에서 캐시가 전무해야 한다
  {
    const full = await buildFullRefGraph(zip, files)
    const affected = new Set<string>()
    for (const c of HUB_INPUT_CELLS)
      for (const d of transitiveClosure(full, '개요', c)) affected.add(`${d.sheet}!${d.cell}`)
    const staleCaches: string[] = []
    for (const [s, path] of files) {
      const xml = await zip.file(path)!.async('string')
      for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (!affected.has(`${s}!${m[1]}`)) continue
        if (/<v>[\s\S]*?<\/v>|<is>/.test(m[2] ?? '')) staleCaches.push(`${s}!${m[1]}`)
      }
    }
    check(`허브 영향 ${affected.size}셀(복합 수식 포함) 캐시 전무`, staleCaches.length === 0,
      staleCaches.slice(0, 5).join(', '))
  }

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
    useApprovalISO: '2011-06-25',
    building: {
      purpose: 'X', totalArea: 1, buildingArea: 1, floorsAbove: 1, floorsBelow: 1,
      height: 1, households: 1, buildingCount: 1, permitDateISO: '2009-04-25',
    },
    report9: { ...R9_BLANK },
  })
  const missing = ANCHORS.filter(a => !values.has(a.field)).map(a => a.field)
  check(`앵커 ${ANCHORS.length}개 field 전부 값 맵에 존재`, missing.length === 0, missing.join(', '))
}

// ── ⑤ 자가치유(S3-3) — 합성 픽스처 단위 검사 ────────────────────────
// 실서식으로는 '행이 밀린' 상태를 만들 수 없어(셀 삽입 미지원) 합성 워크북으로 규약을 고정한다.
// XLSX.write는 **검증 입력 픽스처**를 만드는 데만 쓴다 — 산출물 생성 금지(D-8)와 충돌하지 않는다.
console.log('[5] 자가치유 — 라벨 재탐색·오프셋 보존·모호하면 실패')
{
  const mk = (rows: Array<Array<string | null>>) => {
    const wbF = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wbF, XLSX.utils.aoa_to_sheet(rows), 'T')
    return new Uint8Array(XLSX.write(wbF, { type: 'buffer', bookType: 'xlsx' }))
  }
  const anchor = { field: 'x', sheet: 'T', cell: 'B1', labelCell: 'A1', label: '상호' }

  // 라벨이 한 행 밀림 → 값 좌표도 함께 한 행 이동
  const h1 = validateAnchors(mk([['비고', '값0'], ['상호', '값1']]), [anchor])
  check('한 행 밀림 → B2로 치유', h1.ok && h1.anchors[0].cell === 'B2' && h1.healed.length === 1,
    h1.ok ? h1.healed.join('') : (h1 as { failures: string[] }).failures.join(''))

  // 라벨→값 오프셋이 옆 칸이 아닌 경우(위임장 K6→N6 부류) — 오프셋 그대로 이동
  const far = { field: 'y', sheet: 'T', cell: 'D1', labelCell: 'A1', label: '연락처' }
  const h2 = validateAnchors(mk([['다른것', null, null, '값0'], [null], ['연락처', null, null, '값2']]), [far])
  check('3열 오프셋 보존 → D3로 치유', h2.ok && h2.anchors[0].cell === 'D3',
    h2.ok ? h2.healed.join('') : (h2 as { failures: string[] }).failures.join(''))

  // 같은 라벨이 두 곳 → 추측 주입 금지, 실패
  const h3 = validateAnchors(mk([['비고'], ['상호'], ['상호']]), [anchor])
  check('후보 2곳이면 치유하지 않고 실패', !h3.ok)

  // 어디에도 없음 → 실패
  const h4 = validateAnchors(mk([['비고'], ['주소']]), [anchor])
  check('재탐색 0곳이면 실패', !h4.ok)

  // 정상 일치면 치유가 개입하지 않는다
  const h5 = validateAnchors(mk([['상호', '값']]), [anchor])
  check('일치 시 원좌표 유지·치유 0건', h5.ok && h5.anchors[0].cell === 'B1' && h5.healed.length === 0)
}

// ── ⑥ 배포 자산 축 — 라우트가 실제로 내보내는 파일로 같은 불변식을 다시 건다 ──────
// 종전엔 [1]~[4]가 전부 기저 템플릿(report-workbook.xlsx)만 봤는데 라우트는 full 자산을
// 읽는다(route.ts TEMPLATE_PATH). 개요 파트가 바이트 복사라 결과가 같을 뿐, **검증되지 않은
// 축**이었다(2026-08-23 독립 판정). 도너 이식이 개요·니들·닫힌 덮개를 건드리면 여기서 붉어진다.
console.log('[6] 배포 자산(report-workbook-full.xlsx)에 같은 불변식')
{
  const full = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
  const fz = await JSZip.loadAsync(full)
  const ffiles = await sheetFileMap(fz)

  const fv = validateAnchors(full)
  check('앵커 전수 라벨 일치·치유 0건', fv.ok && fv.healed.length === 0,
    fv.ok ? fv.healed.join(' · ') : (fv as { failures: string[] }).failures.join(' · '))

  const hubXml = await fz.file(ffiles.get('개요')!)!.async('string')
  const dirty = HUB_INPUT_CELLS.filter(c => {
    const m = new RegExp(`<c r="${c}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(hubXml)
    return /<v>[\s\S]*?<\/v>|<is>/.test(m?.[1] ?? '')
  })
  check(`개요 입력 칸 ${HUB_INPUT_CELLS.length}개 전부 공란`, dirty.length === 0, dirty.join(', '))

  // 닫힌 덮개 — 어느 목록에도 없는 값 칸이 있으면 '아무도 안 보는 값'이다(N15 실사고)
  const covered = new Set([...HUB_INPUT_CELLS, ...HUB_LABEL_CELLS,
    ...ANCHORS.filter(a => a.sheet === '개요').map(a => a.cell)])
  const unclassified: string[] = []
  for (const m of hubXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const body = m[3] ?? ''
    if (/<f[ >]/.test(body) || !/<v>[\s\S]*?<\/v>|<is>/.test(body)) continue
    if (!covered.has(m[1])) unclassified.push(m[1])
  }
  check('개요 값 칸이 전부 (앵커|입력|라벨)로 분류됨', unclassified.length === 0, unclassified.join(', '))

  const rawLeaks: string[] = []
  for (const name of Object.keys(fz.files)) {
    if (fz.files[name].dir) continue
    const raw = await fz.file(name)!.async('string')
    for (const n of SCRUB_NEEDLES) if (raw.includes(n)) rawLeaks.push(`${name}⊃'${n}'`)
  }
  check('원시 바이트 니들 0건', rawLeaks.length === 0, rawLeaks.slice(0, 5).join(', '))

  // 외부 통합문서 링크 — 타 고객 상호·직원 휴대전화·내부 경로가 캐시와 rel Target에 실려 있던 축.
  // 니들 목록으로는 못 잡으므로 **파트 존재 자체**를 금한다(빌드 ④d와 같은 규약)
  const ext = Object.keys(fz.files).filter(n => n.includes('xl/externalLinks/'))
  const fwb = await fz.file('xl/workbook.xml')!.async('string')
  check('외부링크 파트·참조 0건', ext.length === 0 && !/<externalReference/.test(fwb),
    ext.length ? `파트 ${ext.length}개` : '')

  // ★ **참조 축의 닫힌 덮개** — 스포크 수식이 읽는 개요 좌표가 전부 (앵커 | 입력 칸)에 덮이는가.
  // [3]의 덮개는 '개요에 값이 남았는가'를 보고, 이건 '개요에서 값을 **꺼내 가는데 아무도 안 채우는**
  // 칸이 있는가'를 본다 — 방향이 반대라 서로를 대신하지 못한다. 실제로 `정보!J20 = 개요!D21`이
  // 앵커 없이 남아 전 고객 엑셀에 '경사로 0 개소'가 인쇄됐다(2026-08-23 F세대 판정).
  // 빈 칸은 캐시가 없어 뷰어가 0을 그리므로 '안 채움'이 곧 오인쇄다.
  const referenced = new Set<string>()
  for (const [s, path] of ffiles) {
    if (s === '개요') continue
    const xml = await fz.file(path)!.async('string')
    for (const m of xml.matchAll(/<f[^>]*>([\s\S]*?)<\/f>/g))
      for (const r of m[1].matchAll(/'?개요'?!\$?([A-Z]+)\$?(\d+)/g)) referenced.add(`${r[1]}${r[2]}`)
  }
  // 이행조치 축(별지 10호 값)은 Phase 3 몫이라 지금은 미배선이 정상 — 명시 유예 목록.
  // 목록이 커지면 '유예'가 '방치'가 되므로 여기 없는 미배선은 실패로 남긴다
  const PHASE3_PENDING = new Set(['G10', 'I9', 'J9', 'G9', 'H9', 'K9', 'E9', 'E10', 'D10', 'D12'])
  const uncovered = [...referenced].filter(c => !covered.has(c) && !PHASE3_PENDING.has(c))
  check(`스포크가 읽는 개요 ${referenced.size}좌표 전부 덮임(유예 목록 제외)`,
    uncovered.length === 0, uncovered.join(', '))
}

// ── ⑦ 정보 시트 √ 통문자열 — 자구 왕복 · 오염 · 마크 닫힌 덮개 ─────────────────
// 종전에 S7-2가 정보!B5 하나만 고쳐, 같은 시트의 나머지 12칸이 **표본 고객의 답을 전 고객
// 문서에 인쇄**하고 있었다(2026-08-23 F세대 판정 §1-②). 검사 축이 세 개다:
//  (a) 왕복 — 표본과 같은 답을 넣으면 서식 원문과 **바이트 동일**(자구·공백 런까지)
//  (b) 오염 — 다른 답을 넣으면 표본의 √·숫자·날짜가 **하나도 남지 않는다**
//  (c) 닫힌 덮개 — 마크(`[√]`·`[  ]`)를 든 리터럴 칸은 전부 앵커거나 명시 정적 칸이다.
//      (a)·(b)는 아는 칸만 보고, (c)는 **모르는 칸**을 잡는다 — 이번 결함의 정체가 그것이었다
console.log('[7] 정보 시트 √ 통문자열 — 자구 왕복·오염·닫힌 덮개')
{
  const fullBytes = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
  const fwb = XLSX.read(fullBytes, { cellFormula: true })
  const cellText = (sheet: string, ref: string) =>
    String((fwb.Sheets[sheet]?.[ref] as XLSX.CellObject | undefined)?.v ?? '')

  // (a) 표본 답 — 서식에 이미 찍혀 있던 √ 위치·숫자·날짜가 곧 '표본 고객의 답'이다
  const SAMPLE: R9 = {
    ...R9_BLANK,
    repRole: '관리자',
    mgrAppointType: '소방안전관리자수첩',
    hasFirePlan: true, firePlanStored: true,
    prevOpDone: true, eduDone: true, drillDone: true,
    insuranceJoined: true, insPeriod: '2024년  1월  1일 ~  2024년  12월  31일',
    multiUseNone: true,
    stCon: true, rfEtc: true,
    stairsCount: '1',
    pkOut: true,
  }
  const ROUNDTRIP: Array<[string, string]> = [
    ['repRoleLine', 'B5'], ['mgrAppointLine', 'B8'], ['firePlanLine', 'B10'],
    ['prevInspectLine', 'B11'], ['trainingLine', 'B12'], ['insuranceLine', 'B13'],
    ['multiUseCol1', 'B14'], ['multiUseCol2', 'E14'], ['multiUseCol3', 'I14'],
    ['structureLine', 'B19'], ['roofLine', 'B20'], ['stairsLine', 'B21'],
    ['elevatorLine', 'B22'], ['parkingLine', 'B23'],
  ]
  const diff: string[] = []
  for (const [field, ref] of ROUNDTRIP) {
    const got = oneValue(SAMPLE, field)
    const want = cellText('정보', ref)
    if (got !== want) diff.push(`${ref}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
  }
  check(`정보 ${ROUNDTRIP.length}칸 자구 왕복 — 표본 답 → 서식 원문과 바이트 동일`,
    diff.length === 0, diff.slice(0, 2).join(' | '))

  // (b) 오염 — 다른 고객의 답을 넣으면 표본 흔적이 남지 않는다
  const OTHER: R9 = {
    ...R9_BLANK,
    repRole: '소유자',
    mgrAppointType: '겸직',
    hasFirePlan: false, firePlanNone: true, firePlanStored: false,
    prevOpDone: false, prevOpNone: true, prevCompDone: true,
    eduDone: false, eduNone: true, drillDone: false, drillNone: true,
    insuranceJoined: false, insCompany: '삼성화재', insPeriod: '2026년 3월 1일 ~ 2027년 2월 28일',
    insPerson: '10000', insProperty: '100000',
    multiUseNone: false, multiUseCounts: { '휴게음식점영업': '3', '인터넷컴퓨터게임시설제공업': '2' },
    stSteel: true, rfSlab: true,
    stairsCount: '7', specialStairCount: '2',
    elvR: '4', elvE: '1',
    pkIn: true, pkInUg: true, pkMech: true,
  }
  const residue: string[] = []
  const noSample = (field: string, needles: string[]) => {
    const s = oneValue(OTHER, field)
    for (const n of needles) if (s.includes(n)) residue.push(`${field}⊃'${n}'`)
  }
  noSample('mgrAppointLine', ['[√]소방안전관리자수첩'])
  noSample('firePlanLine', ['[√]작성', '[√]보관'])
  noSample('prevInspectLine', ['([√]실시 [  ]미실시),     종합정밀점검 ([  ]실시'])
  noSample('trainingLine', ['소방안전교육 ([√]실시'])
  noSample('insuranceLine', ['2024년', '[√]가입,'])
  noSample('multiUseCol1', ['[√]해당없음'])
  noSample('structureLine', ['[√]철근콘크리트구조'])
  noSample('roofLine', ['[√]기타'])
  noSample('stairsLine', [' 1 개소'])
  noSample('parkingLine', ['[√]옥외'])
  check('오염 축 — 다른 답 주입 시 표본 √·날짜·개소 잔존 0', residue.length === 0, residue.join(', '))

  // 다른 고객의 답이 실제로 반영되는가(오염 0이 '전부 공란'으로 달성되면 안 된다 — 반대 방향 단언)
  const applied: string[] = []
  const must = (field: string, needle: string) => {
    if (!oneValue(OTHER, field).includes(needle)) applied.push(`${field}⊅'${needle}'`)
  }
  must('mgrAppointLine', '[√]겸직')
  must('firePlanLine', '[√]미작성')
  must('prevInspectLine', '종합정밀점검 ([√]실시')
  must('insuranceLine', '삼성화재')
  must('insuranceLine', '2026년 3월 1일 ~ 2027년 2월 28일')
  must('multiUseCol1', '[√]휴게음식점영업( 3 개소)')
  must('multiUseCol1', '[  ]해당없음')
  must('multiUseCol3', '[√]인터넷컴퓨터게임시설\n    제공업( 2 개소)')
  must('structureLine', '[√]철골구조')
  must('stairsLine', '( 7 개소 )')
  must('stairsLine', '[√]특별피난계단 ( 2 개소)')
  must('elevatorLine', '[√]승용( 4 대 )')
  must('parkingLine', '[√]옥내([√]지하')
  check('반영 축 — 다른 답이 실제로 찍힌다(공란으로 달성 금지)', applied.length === 0, applied.join(', '))

  // 가입금액 — 단위 만원 통일(2026-08-24 사용자 확정). 값이 있으면 **폭 18칸을 지키며** 들어가
  // 대물 열이 밀리지 않는다. 값이 없으면 서식 원문(18칸 공백)과 동일해야 한다(위 왕복 축이 단언)
  {
    const line = oneValue(OTHER, 'insuranceLine').split('\n')[2]
    check('가입금액 주입 — 대인·대물 값 반영', line.includes('10000') && line.includes('100000'), line)
    // ⚠기대값을 손으로 조립하지 않는다 — 폭 불변은 **길이 속성**으로 단언한다(직접 타이핑하면
    //   가운데 맞춤의 좌우 배분을 눈대중하게 되고, 실제로 첫 시도가 그렇게 틀렸다)
    const blankLine = oneValue(SAMPLE, 'insuranceLine').split('\n')[2]
    check('가입금액 폭 불변(대물 열 밀림 없음)', line.length === blankLine.length,
      `주입 ${line.length}자 vs 서식 ${blankLine.length}자`)
    check('두 슬롯이 정확히 18칸', /대인\((.{18})만원 \) {4}대물\((.{18})만원 \)$/.test(line), JSON.stringify(line))
    // ⚠**경계값**을 반드시 밟는다 — 종전 픽스처가 5·6자뿐이라 `>= w` off-by-one(정확히 18자에서
    //   슬롯이 20칸이 되던 결함)을 한 번도 못 밟았다(2026-08-24 독립 판정). 성립하는 구역에서만
    //   검사하면 불변식을 선언만 하고 지키지 못한다
    const widthAt = (n: number) => {
      const s = oneValue({ ...OTHER, insPerson: 'X'.repeat(n), insProperty: '' }, 'insuranceLine').split('\n')[2]
      return /대인\((.*?)만원 \)/.exec(s)![1].length
    }
    const boundary = [0, 1, 17, 18].map(n => [n, widthAt(n)] as const).filter(([, w]) => w !== 18)
    check('슬롯 폭 경계(0·1·17·18자) 전부 18칸 유지', boundary.length === 0,
      boundary.map(([n, w]) => `${n}자→${w}칸`).join(', '))
    // 19자 이상은 **자르지 않고 넘친다**가 규약 — 값을 잃는 것이 정렬보다 나쁘다
    check('19자는 넘치되 값 보존', widthAt(19) === 21 && oneValue({ ...OTHER, insPerson: 'X'.repeat(19) }, 'insuranceLine').includes('X'.repeat(19)))
    check('가입금액 단위는 만원(천만원 잔재 0)', !line.includes('천만원') && (line.match(/만원/g) ?? []).length === 2, line)
  }

  // (c) 닫힌 덮개 — **전 시트**에서, 체크된 마크(√)를 든 리터럴 칸은 전부 앵커여야 한다.
  //
  // ⚠ 종전엔 시트 목록이 `['정보','보고서','다수동일때']` **손목록**이었다. 그래서 나머지 64시트에
  //   앵커 없는 √ 15칸(현황 설비 5·현3 세부현황 6·현1·다수동 2·대상물 점검구분 1)이 **영구히
  //   안 보였고**, 남의 설비 목록·점검 결과·수신기 위치가 전 고객 산출물에 인쇄됐다
  //   (2026-08-24 독립 판정 3인이 서로 다른 축에서 같은 결론). 목록을 넓힌 게 아니라 **없앴다** —
  //   축이 손목록이면 그 목록 밖은 언제나 사각이다.
  // ⚠ 마크 정규식은 `MARK_CHECKED_RE` **단일 원천**. 종전엔 이 파일과 _probe-info-mutants에
  //   복붙돼 있었고 둘 다 공백 1칸 `[ ]`를 빠뜨려 **덮개와 그 자기검사가 같은 사각을 공유**했다.
  // 빈 마크(`[  ]`)는 손으로 채우는 백지 서식이라 정상 — 체크된 것만 본다.
  const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
  // ⚠ **판정기는 하나뿐이어야 한다.** (d) 자기검사가 이 로직을 인라인 복제하면, 이 루프를 죽여도
  //   (d)가 초록이라 **덮개를 통째로 되돌려도 통과**한다(2026-08-24 독립 판정 실측 — 게이트
  //   카나리아에서 고쳤다던 결함을 내가 (d)에 그대로 재현했다). 그래서 함수로 뽑아 둘이 공유한다.
  // ⚠ **수식 캐시도 본다.** 종전엔 `if (c.f) continue`로 건너뛰었는데, 그러면 캐시에 새로 생긴
  //   표본 답은 `SAMPLE_ANSWERS` **손목록에만** 의존하게 된다 — 리터럴 축에서만 참인 불변식이었다.
  //   현 자산의 캐시 체크마크는 실측 0칸이라 포함해도 오탐이 없다(포함이 곧 강화).
  const uncoveredMarks = (w: XLSX.WorkBook): string[] => {
    const out: string[] = []
    for (const sheet of w.SheetNames) {
      const ws = w.Sheets[sheet]
      for (const k of Object.keys(ws)) {
        if (k.startsWith('!')) continue
        const c = ws[k] as XLSX.CellObject
        if (!MARK_CHECKED_RE.test(String(c.v ?? ''))) continue
        if (!anchored.has(`${sheet}!${k}`)) out.push(`${sheet}!${k}${c.f ? '(캐시)' : ''}`)
      }
    }
    return out
  }
  const uncovered = uncoveredMarks(fwb)
  check(`전 ${fwb.SheetNames.length}시트 — 앵커 없는 체크 마크(√) 0칸(리터럴+캐시)`, uncovered.length === 0,
    uncovered.slice(0, 10).join(', '))

  // 표본 점검 소견 — 마크가 아니라 자유 텍스트라 위 덮개에 안 걸린다(축이 다르다).
  // 백지 서식에 남의 판단이 있으면 안 된다: '이상없음'·'별첨참조'는 점검자가 쓰는 말이고
  // '직원실'은 표본 고객의 실내 위치다
  const opinions: string[] = []
  for (const sheet of fwb.SheetNames) {
    const ws = fwb.Sheets[sheet]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const v = String((ws[k] as XLSX.CellObject).v ?? '')
      for (const n of SAMPLE_OPINION_NEEDLES) if (v.includes(n)) opinions.push(`${sheet}!${k}⊃'${n}'`)
    }
  }
  check('표본 점검 소견·실내 위치 0건(리터럴·캐시 모두)', opinions.length === 0, opinions.slice(0, 6).join(', '))

  // 판정 캐시 — 표본이 설치한 설비에 딸린 '○'(양호)·'／'(해당없음)이 남으면 **하지 않은 점검이
  // 양호로 인쇄**된다(어제 펌프성능시험 15칸과 같은 부류, 다른 시트). 도너 시트의 세로 3연속
  // 범례(○/×/／)는 서식 정본이라 제외하고 갑지 26시트만 본다
  {
    const donorSet = new Set(allDonorSheets())
    const verdicts: string[] = []
    for (const sheet of fwb.SheetNames) {
      if (donorSet.has(sheet)) continue
      const ws = fwb.Sheets[sheet]
      for (const k of Object.keys(ws)) {
        if (k.startsWith('!')) continue
        const t = String((ws[k] as XLSX.CellObject).v ?? '').trim()
        if ((VERDICT_MARKS as readonly string[]).includes(t)) verdicts.push(`${sheet}!${k}='${t}'`)
      }
    }
    check('갑지 26시트 — 점검 판정 마크 캐시 0칸', verdicts.length === 0, verdicts.slice(0, 8).join(', '))
  }

  // (d) **자기 민감도** — 위 단언들이 결함을 실제로 잡는지 매 실행마다 스스로 증명한다.
  //
  // ⚠ 종전엔 이 역할을 별도 프로브(_probe-info-mutants)가 맡았는데 **반증 불가**였다: 그 프로브는
  //   자기가 만든 `mutate()` 함수만 검사할 뿐 [7]의 비교를 한 번도 태우지 않아, **[7]을 통째로
  //   지워도 6 PASS**였다(2026-08-24 독립 판정). 검사의 민감도는 검사 **밖**에서 증명할 수 없다.
  // 그래서 여기서는 **입력을 흔든다** — 기대 문자열을 손으로 변형하는 게 아니라 조립기에 다른
  //   답을 먹여, (a)의 실제 비교가 붉어지는지 본다. 조립기·비교기 둘 다 진짜 경로다.
  {
    const perturb: Array<[string, string, R9]> = [
      ['구조 √ 위치', 'B19', { ...SAMPLE, stCon: false, stSteel: true }],
      ['계단 개소', 'B21', { ...SAMPLE, stairsCount: '7' }],
      ['보험 가입기간', 'B13', { ...SAMPLE, insPeriod: '2030년 1월 1일' }],
      ['다중이용업 해당없음', 'B14', { ...SAMPLE, multiUseNone: false }],
      ['선임구분', 'B8', { ...SAMPLE, mgrAppointType: '기타' }],
    ]
    const blind = perturb.filter(([, ref, r9]) => {
      const field = ROUNDTRIP.find(([, c]) => c === ref)![0]
      return oneValue(r9, field) === cellText('정보', ref)   // 흔들었는데 원문과 같다 = 못 본다
    })
    check(`(a) 왕복 대조가 입력 변화 ${perturb.length}종을 전부 감지`, blind.length === 0,
      blind.map(([n]) => n).join(', '))

    // (c) 덮개가 '앵커 없는 √'를 실제로 잡는가 — **같은 함수(uncoveredMarks)에** 결함을 심어 태운다.
    //     ⚠ 분류 로직을 여기서 다시 쓰면 (c)를 죽여도 (d)가 초록이라 **아무것도 지키지 못한다**
    //       (2026-08-24 독립 판정이 실제로 (c)를 3시트 손목록으로 되돌리고 `[√]`를 심어 우회했다).
    //     자산은 건드리지 않는다 — 워크북 객체의 얕은 사본에 합성 셀만 얹는다.
    const planted = (cells: Record<string, XLSX.CellObject>): XLSX.WorkBook => ({
      SheetNames: fwb.SheetNames,
      Sheets: { ...fwb.Sheets, 현황: { ...fwb.Sheets['현황'], ...cells } },
    } as XLSX.WorkBook)
    const cases: Array<[string, XLSX.CellObject, boolean]> = [
      ['앵커 없는 반각 √', { t: 's', v: '[√]소화기구' } as XLSX.CellObject, true],
      ['앵커 없는 전각 √', { t: 's', v: '［√］' } as XLSX.CellObject, true],
      ['공백 낀 [ √ ]', { t: 's', v: '[ √ ]' } as XLSX.CellObject, true],
      ['수식 캐시 √(f 보존)', { t: 's', v: '[√]종합점검', f: '대상물!G3' } as XLSX.CellObject, true],
      ['빈 마크(백지 서식)', { t: 's', v: '[  ]' } as XLSX.CellObject, false],
    ]
    const blindCases = cases.filter(([, cell, shouldCatch]) =>
      (uncoveredMarks(planted({ ZZ999: cell })).some(x => x.startsWith('현황!ZZ999'))) !== shouldCatch)
    check(`(c) 덮개가 심은 결함 ${cases.length}종을 정확히 판정(빈 마크는 통과)`,
      blindCases.length === 0, blindCases.map(([n]) => n).join(', '))
    // 앵커 칸에 √가 있는 것은 정상 — 덮개가 앵커를 오탐하지 않는지도 같은 함수로 확인
    check('(c) 앵커 칸의 √는 오탐하지 않는다', uncoveredMarks(fwb).length === 0)
  }

  // 다수동일때 — 주입값이 **전부 빈 마크**인가(값을 지어내지 않았다는 단언). 반대로 표본 답이
  // 하나라도 살아 있으면 붉어진다. `[√]`가 0개, 표본 개소 ' 1 '이 0개
  const MB_FIELDS = ['mbStructureBlank', 'mbRoofBlank', 'mbStairsBlank', 'mbElevatorBlank', 'mbParkingBlank']
  const notBlank = MB_FIELDS.filter(f => {
    const s = oneValue(SAMPLE, f)   // 표본 답을 줘도 빈 서식이어야 한다(입력과 무관한 상수)
    return s.includes('[√]') || /\( 1 /.test(s)
  })
  check(`다수동일때 ${MB_FIELDS.length}필드가 입력과 무관한 빈 서식(값 지어내지 않음)`,
    notBlank.length === 0, notBlank.join(', '))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
