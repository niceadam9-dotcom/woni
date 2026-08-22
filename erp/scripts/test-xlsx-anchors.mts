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
import { ANCHORS, HUB_INPUT_CELLS, SCRUB_NEEDLES, validateAnchors } from '../src/lib/xlsx-anchors.ts'
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
    report9: {
      ckOp: true, ckInitial: false, ckCompEtc: false, consent: null, repRole: '',
      managerGrade: '', mgrEduDate: '', main: null, assistants: [],
    },
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

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
