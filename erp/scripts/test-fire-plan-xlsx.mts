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
import { FIRE_PLAN_ANCHORS, FIRE_PLAN_FIELDS, isPlaceholderLabelAnchor, isWrappedUnitAnchor, isBracketBoxAnchor, isDashPlaceholderAnchor, isSampleTextAnchor, FIRE_PLAN_SAMPLE_CELLS, FP_SHEET, ZONE_ROWS, ZONE_SHEET, ZONE_FIRST_ROW, BRIG_ROWS, BRIG_FIRST_ROW, isBoxLabelAnchor, isUnitLabelAnchor, isPrefixLabelAnchor, isYearMonthLabelAnchor, FORM14_ROWS, FORM14_SHEET, FORM14_NAME_CELL, FORM14_NAME_FIELD } from '../src/lib/fire-plan-anchors.ts'
import { ALL_STANDARD_CODES } from '../src/lib/facility-codes.ts'
import { brigadeRowOverflow, buildFirePlanValues, missingValueFields, planDate, zoneRowOverflow } from '../src/lib/fire-plan-xlsx-values.ts'
import { FIRE_PLAN_MANIFEST, labelAt, boxGlyphAt, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { measureLines } from '../src/lib/xlsx-wrap-height.ts'
import { FIRE_PLAN_SCRUB_NEEDLES, FIRE_PLAN_MARK_CHECKED_RE } from '../src/lib/fire-plan-scrub.ts'
import { classifyAlign, isCheckText } from '../src/lib/fire-plan-align.ts'
import { COMPARTMENT_KINDS } from '../src/lib/evac-compartment.ts'
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

  // 내용 지문 — 파일 sha는 재빌드마다 바뀌지만(zip 타임스탬프) 이건 내용이 같으면 같다.
  // '자산이 실제로 달라졌는가'를 묻는 유일한 축이라 별도로 센다.
  const z = await JSZip.loadAsync(bytes)
  const names = Object.keys(z.files).filter(n => !z.files[n].dir).sort()
  const h = createHash('sha256')
  for (const n of names) { h.update(n); h.update(await z.file(n)!.async('nodebuffer')) }
  const content = h.digest('hex')
  check('내용 지문 일치', content === FIRE_PLAN_MANIFEST.asset.contentSha256,
    `${content.slice(0, 12)} vs ${(FIRE_PLAN_MANIFEST.asset.contentSha256 ?? '(없음)').slice(0, 12)}`)
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
  //
  // 두 번째 갈래는 **상자칸**(앵커 §상자칸): `□ 면적별` 처럼 법정 자구를 이고 있고 값 축이
  // 상자 글자만 갈아 끼운다. 지우면 서식이 사라지므로 공란을 요구할 수 없다. 예외를 좌표
  // 목록으로 적으면 진짜 오염이 그 뒤에 숨으니 `isBoxLabelAnchor`로 **자기정의**하고,
  // 자산의 그 칸이 manifest 라벨과 **글자 그대로 같은지**를 함께 요구한다(표본 답 방지).
  const cellText = (a: { sheet: string; cell: string }) =>
    String((wb.Sheets[a.sheet]?.[a.cell] as XLSX.CellObject | undefined)?.v ?? '').trim()
  const boxLabelOk = (a: { sheet: string; cell: string }) =>
    isBoxLabelAnchor(a) && cellText(a) === labelAt(a.sheet, a.cell).trim()
  //
  // 세 번째 갈래는 **단위칸**(2026-09-08): `급`·`㎡`·`명` 처럼 자구가 값 **뒤에** 붙는 칸이다.
  // ⚠ 이 예외를 `셀 글자 == manifest 라벨`로 판정하면 **항진명제**가 된다 — manifest 라벨
  //   자체가 자산에서 파생되므로 표본 답이 남아 있어도 등식은 성립한다(위 boxLabelOk의
  //   등식도 같은 한계를 갖고, 실질 판별은 `isBoxLabelAnchor` 쪽이 한다). 그래서
  //   `isUnitLabelAnchor`는 등식이 아니라 **'남은 글자가 단위처럼 생겼는가'**를 묻는다.
  //
  // 다섯째 갈래는 **연월칸**(2026-09-14, 1.10.1 점검시기): `'          년        월'` 처럼 자구가
  // 값 **사이사이에** 끼어 있다. 단위칸과 같은 이유로 등식이 아니라 '남은 글자가 자구뿐인가'를
  // 묻는다 — 숫자가 한 자라도 있으면 그건 표본의 답이라 예외를 통과하지 못한다(아래 단언).
  // 여섯째 갈래는 **자리표시칸**(2026-09-17, 1.10.3 영업시간): `00시~00시`처럼 템플릿이
  // **보기 값**을 이고 있다. 앞의 것들과 달리 자구가 값과 함께 남는 게 아니라 값에 **통째로
  // 갈린다** — 그래도 값이 없을 땐 남아야 그 칸이 무엇을 적는 자리인지 알 수 있다.
  // 판별은 여기서도 등식이 아니라 **'0으로만 이뤄진 시각 꼴인가'**다: `09:00~18:00` 같은
  // 실제 답은 통과하지 못하므로 표본 시간이 이 예외 뒤에 숨지 못한다.
  const dirty = FIRE_PLAN_ANCHORS.filter(a => {
    const t = cellText(a)
    return t && !/^[□☐]$/.test(t) && !boxLabelOk(a) && !isUnitLabelAnchor(a) && !isPrefixLabelAnchor(a)
      && !isYearMonthLabelAnchor(a) && !isPlaceholderLabelAnchor(a) && !isWrappedUnitAnchor(a)
      && !isBracketBoxAnchor(a)
      && !isSampleTextAnchor(a) && !isDashPlaceholderAnchor(a)
  })
  // 여덟째 갈래는 **각괄호 상자칸**(2026-09-17, 2.14 결과기록부): 별지 제13호 계열은 상자를
  // `□`가 아니라 `[  ]`로 그리고 표시도 `√`다. `isBoxLabelAnchor`가 `□`만 보므로 이 시트는
  // manifest 집계에서 **상자 0**으로 잡혔다. 판별은 **각괄호 안이 공백뿐인가** — `[√]`·`[1]`은
  // 통과하지 못하므로 표본의 답이 이 예외 뒤에 숨지 못한다.
  // 아홉째 갈래는 **법정 예시문칸**(2026-09-17, 3.4): 템플릿이 자유 문장인 보기 값을 이고 있다.
  // 자리표시칸의 형제인데 자구가 시각 꼴이 아니라 문장이라 **모양으로 가를 수 없다** — 이 벽 때문에
  // ①류(PDF는 인쇄, 엑셀만 공란)가 세 시트에서 닫히지 않고 있었다.
  // 🚨 좌표만 적으면 봐주기지만 **자구까지 적으면 봐주기가 아니다**. 아래 두 단언이 짝이다:
  //    ①선언한 자구가 템플릿과 글자까지 같은가  ②값이 있을 때 **실제로 덮이는가**.
  //    ②가 없으면 「선언만 해 두고 영영 공란」이 조용히 통과한다.
  // 열째 갈래는 **대시 자리표시칸**(2026-09-17, 1.9.3 관리구역): 양식이 「없음」을 `-`로
  // 표기해 둔 자리다. 외자 대시엔 답이 숨을 수 없어 판별이 좁다(라벨.trim() === '-').
  check('앵커 셀 공란(… 각괄호상자·법정예시문·대시자리표시만 예외)', dirty.length === 0,
    dirty.slice(0, 5).map(a => `${a.sheet}!${a.cell}='${cellText(a)}'`).join(' · '))
  // 🚨 예외가 늘면 **그 수를 못 박는다** — 봐주기가 조용히 번지지 않게.
  const wrappedCells = FIRE_PLAN_ANCHORS.filter(isWrappedUnitAnchor)
  check('감싼단위칸 예외 수가 그대로(1.11.1 거주자 1칸)', wrappedCells.length === 1,
    wrappedCells.map(a => `${a.sheet}!${a.cell}='${cellText(a)}'`).join(' · '))
  const dashCells = FIRE_PLAN_ANCHORS.filter(isDashPlaceholderAnchor)
  check('대시자리표시칸 예외 수가 그대로(1.9.3 관리구역 10칸 — 양식이 3~12행에만 `-`)', dashCells.length === 10,
    `${dashCells.length}칸`)
  const sampleCells = FIRE_PLAN_ANCHORS.filter(isSampleTextAnchor)
  // 2026-09-18: 2.9 초기소화·가스 조치 3칸 추가로 13→16 — PDF 초기대응 개요 폴백과 같은 자구
  // 2026-09-18(2): 1.11.4 뒷쪽 교육내용·성과 2칸으로 16→18 — training.records가 덮는다
  check('법정예시문칸 예외 수가 그대로(3.4 4 + 3.6 4 + 1.6.1 5 + 2.9 3 + 1.11.4 2)', sampleCells.length === 18,
    sampleCells.map(a => `${a.sheet}!${a.cell}`).join(' · '))
  // ① 선언한 자구가 템플릿과 **글자까지** 같은가 — 다르면 표본의 답이 바뀐 것이다.
  //   ⚠ `cellText`가 아니라 `labelAt`으로 묻는다 — 저쪽은 공백을 깎아 `'1층 주차장 '`의
  //     꼬리 공백을 못 본다. 핀은 **바이트 그대로**여야 제 구실을 한다.
  const sampleBad = FIRE_PLAN_SAMPLE_CELLS.filter(([sh, ce, want]) => labelAt(sh, ce) !== want)
  check('선언한 예시 자구가 템플릿과 글자까지 같다(꼬리 공백까지)', sampleBad.length === 0,
    sampleBad.map(([sh, ce, want]) => `${sh}!${ce}: ${JSON.stringify(labelAt(sh, ce))} ≠ ${JSON.stringify(want)}`).join(' / '))

  const bracketCells = FIRE_PLAN_ANCHORS.filter(isBracketBoxAnchor)
  check('각괄호상자칸 예외 수가 그대로(2.14 등급 4 + 자격구분 2)', bracketCells.length === 6,
    bracketCells.map(a => `${a.cell}='${cellText(a)}'`).join(' · '))
  // 🎯 이 예외 뒤에 답이 숨지 못한다 — 각괄호 안에 글자가 있으면 그건 상자가 아니라 **답**이다
  check('각괄호 안은 전부 공백뿐(표본 √·숫자가 없다)',
    bracketCells.every(a => /\[\s+\]/.test(cellText(a))),
    bracketCells.filter(a => !/\[\s+\]/.test(cellText(a))).map(a => a.cell).join(','))
  const placeholderCells = FIRE_PLAN_ANCHORS.filter(isPlaceholderLabelAnchor)
  check('자리표시칸 예외 수가 그대로(1.10.3 영업시간 4칸)', placeholderCells.length === 4,
    placeholderCells.map(a => `${a.cell}`).join(','))
  // 2026-09-14: 1.10.1 「건축물 사용승인일 :」 배선으로 1 → 2. 이 시트는 종전 앵커 0이라
  //   사용승인일이 통째로 공란이었다(PDF는 같은 값을 인쇄 중이었다 — D-7 갈라짐).
  const prefixCells = FIRE_PLAN_ANCHORS.filter(isPrefixLabelAnchor)
  // 2026-09-17(11): 2.13 대상명(A2)을 배선해 2→3
  // 2026-09-18: 2.6·2.9·2.10·2.11 대상명 4칸으로 4→8
  check('접두라벨칸 예외 수가 그대로(대상명 7 + 1.10.1 사용승인일 = 8칸)', prefixCells.length === 8,
    prefixCells.map(a => `${a.sheet}!${a.cell}='${cellText(a)}'`).join(' · '))
  const ymCells = FIRE_PLAN_ANCHORS.filter(isYearMonthLabelAnchor)
  check('연월칸 예외 수가 그대로(1.10.1 점검시기 4칸)', ymCells.length === 4,
    ymCells.map(a => `${a.sheet}!${a.cell}='${cellText(a)}'`).join(' · '))
  // 🎯 표본 답이 이 예외 뒤에 숨지 못한다 — 연월칸에 숫자가 남았으면 그건 자구가 아니라 답이다
  check('연월칸에 숫자가 없다', ymCells.every(a => !/\d/.test(cellText(a))),
    ymCells.filter(a => /\d/.test(cellText(a))).map(a => `${a.sheet}!${a.cell}`).join(','))
  // 🎯 표본 답이 이 예외 뒤에 숨지 못한다 — 콜론 뒤에 글자가 남았으면 그건 자구가 아니라 답이다
  check('접두라벨칸에 답이 없다', prefixCells.every(a => /[:：]$/.test(cellText(a))),
    prefixCells.filter(a => !/[:：]$/.test(cellText(a))).map(a => `${a.sheet}!${a.cell}`).join(','))
  const boxOnly = FIRE_PLAN_ANCHORS.filter(a => /^[□☐]$/.test(cellText(a)))
  // 2026-09-17: 1.11.1 연간계획이 **12개월 격자**라 빈 상자가 구조적으로 생긴다(라벨은 행 머리와
  //   월 머리에 있고 칸 자신은 `□`뿐). 종전 `<= 3`은 그 모양을 예상하지 않은 느슨한 상한이었다 —
  //   **정확한 수**로 바꾼다(상한보다 강한 단언이다: 한 칸만 늘어도 붉어진다).
  //   내역: 표지 용도 1 + 1.11.1 교육 36 + 훈련 36 = 73.
  // 2026-09-18: 1.14.1 월 격자 120(방법 10 × 12월 — 같은 모양)으로 73→193.
  check('빈 상자만 남은 앵커 수가 그대로(표지 1 + 1.11.1 72 + 1.14.1 120)', boxOnly.length === 193,
    `${boxOnly.length}칸`)
  const boxLabel = FIRE_PLAN_ANCHORS.filter(isBoxLabelAnchor)
  // 🚨 정체 판정 — 상한만 두면 예외가 **0개로 사라져도** 초록이다(1.5.1 3칸 + 1.1 21칸)
  // 2026-09-09: 주차장 2칸(L13 옥내·AB13 옥외) 배선으로 1.1이 19→21이 됐다. 이 숫자는
  // **늘어난 이유가 분명할 때만** 고친다 — 줄어들면 배선이 조용히 빠진 것이다.
  // 2026-09-09(2): 주차장 14행 자주식·기계식 4칸(L14·T14·AB14·AJ14)을 더 배선해 1.1이 21→25.
  //   법정 양식 hwpx 원문·manifest 양쪽에서 그 네 칸을 확인하고 늘렸다(추측 아님).
  // 2026-09-14: 서식 1.4 설비 체크칸 40을 배선해 28→68. 이 시트는 종전 앵커 0이라 40종 전부가
  //   `□`로 인쇄되고 있었다(PDF는 같은 값을 체크 중이었다 — D-7 갈라짐).
  // 2026-09-14(2): 서식 1.10.1 자체점검 상자 9를 배선해 68→77 — 작동/종합 머리 2, 안쪽 줄 3
  //   (최초·종합·2차), 점검자 4(작동 자체/외주 · 종합 자체/외주). 이 시트도 종전 앵커 0이었다.
  // 2026-09-16: 서식 1.1 전기차충전소(AR13) 1칸을 배선해 1.1이 25→26, 합이 77→78. 주차장 13행의
  //   셋째 칸이고 원천은 같은 `parking_summary`다(판정 `parseParkingEv` — 별지 9호엔 이 칸이 없다).
  // 2026-09-17: 서식 1.2.2 화재취약장소 위험요소 상자 18을 배선해 78→96 —
  //   고정 3개소(보일러실·주방·전기실) × 6요소(전기/기계/화학/가스누출/자연재해/부주의).
  //   ⚠ `☐ 기타( )` 3칸은 **일부러 안 세웠다** — ERP에 축이 없다(없는 근거로 체크하지 않는다).
  //   이 시트도 종전 앵커 0이었고 PDF는 같은 값을 이미 인쇄 중이었다(D-7 갈라짐).
  // 2026-09-17(2): 1.10.3 다중이용업소 상자 10을 배선해 96→106 — 영업시간 6(평일/휴일 ×
//   주간/야간 + 평일·휴일 머리) + 이용자 4(노유자·주취자·청소년·신체부자유자).
//   ⚠ 안전점검 분기 4 · 안전시설 17은 **일부러 안 세웠다**(ERP에 축이 없다).
  // 2026-09-17(2): 1.11.1 배선으로 106→181 — 월 격자 72(교육 36 + 훈련 36) + 대상자 3.
  // 2026-09-17(3): 3.1 배선으로 181→189 — 계단 4 + 기타 피난시설 3 + 승강기 1(한 칸에 상자 셋).
  //   ⚠ 3.1의 나머지 상자 23칸은 **일부러 안 세웠다**(화재경보 방식·피난기구·인명구조기구·
  //     유도등 선식·방화시설 — ERP와 입도가 다르거나 축이 없다. 사유는 앵커 선언부).
  // 2026-09-17(4): 2.1 배선으로 189→209 — 등급 4 + 상시근무인원 4 + Type 2 + 팀 10.
  //   ⚠ 운영시간(`시 ~ 시`)·근무형태·초기대응체계 조 편성은 **일부러 안 세웠다**
  //     (ERP 형식이 양식의 두 자리로 안 쪼개지거나 축이 없다 — 사유는 앵커 선언부).
  // 2026-09-17(6): 1.9 배선으로 209→216 — 운영 1 + 팀 6.
  //   ⚠ 「해당없음」·근무형태 2상자는 **일부러 안 켠다**(면제 여부·근무형태 축이 ERP에 없다).
  // 2026-09-17(8): 3.5 배선으로 216→228 — 근무·거주자 6 + 시설이용자 6.
  // 2026-09-17(9): 1.9 피난약자 블록으로 228→233 — 상자 5종(3.5의 `기타`가 여긴 없다).
  // 2026-09-17(13): 1.6.1 차단기구 유무(AR9)·위험물 해당없음(J18)으로 233→235
  // 2026-09-18: 2.10 피난유도팀으로 235→239 — 경로 3(R7~R9) + 비상방송설비 1(AU6).
  //   ⚠ 경보방식 3·주지구경종·시각경보기·피난안전구역·옥상·기타는 **일부러 안 켠다**
  //     (수신기 설정·구성품 입도·1.4 묶음 입도 — 사유는 앵커 선언부).
  // 2026-09-18(2): 2.6 상자 2(Q10·Q13) + 2.8 상자 2(K6·K8)로 239→243 — 설비 자동 전파라
  //   설비 존재 = 가용(비상방송설비·자동화재속보설비, 1.4와 같은 집합).
  // 2026-09-18(3): 2.9 층별·시설별 6(O5~O10)으로 243→249 — 층수는 구조화 원시값(파싱 아님)·
  //   시설별은 1.6.1과 같은 축. 기타(O11)는 축이 없어 안 센다.
  // 2026-09-18(4): 1.14.1 월 격자 120(방법 10 × 12월, ④ promoPlan)으로 249→369.
  //   보관방법 상자 4(16~17행)·※ 안내(AE3)는 축이 없어 안 센다.
  check('상자칸 예외 수가 그대로(… + 2.9 6 + 1.14.1 120)',
    boxLabel.length === 369, `${boxLabel.length}칸`)
  check('상자칸은 템플릿에서 전부 미체크', boxLabel.every(a => !/■/.test(cellText(a))),
    boxLabel.filter(a => /■/.test(cellText(a))).map(a => a.cell).join(','))
  const unitCells = FIRE_PLAN_ANCHORS.filter(a => isUnitLabelAnchor(a) && !isSampleTextAnchor(a))
  // 2026-09-17: 1.10.3 수용인원(AS8 '명')을 배선해 5→6
  // 2026-09-17(2): 1.11.1 근무자·자위소방대 인원(AA4·AA5)을 배선해 6→8.
  //   ⚠ 거주자(BB4)는 `약     명`이라 **감싼단위칸**이다 — 아래에서 따로 센다.
  // 2026-09-17(4): 2.1 자위소방대 총원(V13 '명')을 배선해 8→9
  // 2026-09-17(6): 1.9 편성인원(U3 '명')을 배선해 9→10 — 2.1 V13과 **같은 수**다
  // 2026-09-17(8): 3.5 근무·거주자 인원 6칸(' 명')을 배선해 10→16
  // 2026-09-17(9): 1.9 피난약자 활동구역 3칸('    층')을 배선해 16→19
  // 2026-09-17(13): 1.6.1 kW·kVA·대 5칸으로 19→24 — ⚠ R9 '각층'은 단위 꼴이지만
  //   **예시문칸이 우선**이라 아래에서 뺀다(한 칸이 두 예외에 걸리면 더 구체적인 쪽이 정체다).
  // 2026-09-18: 1.11.4 뒷쪽 참석(AI5 '명')으로 24→25
  check('단위칸 예외 수가 그대로(급·㎡·명·층·kW 25칸)', unitCells.length === 25,
    unitCells.map(a => `${a.cell}='${cellText(a)}'`).join(' · '))
  // 🎯 표본 답이 단위칸 예외 **뒤에 숨지 못한다** — 숫자가 남았으면 그건 단위가 아니라 답이다
  //   (이 칸들에 실제로 `100명`·`1 개소`가 있었다)
  check('단위칸에 숫자가 없다', unitCells.every(a => !/\d/.test(cellText(a))),
    unitCells.filter(a => /\d/.test(cellText(a))).map(a => `${a.sheet}!${a.cell}`).join(','))
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
    contractStart: '2025-01-01', companyName: '어느소방이엔지',
    /* 서식 1.10.1 — 점검계획일 **파생 자동값**(고객이 1.10.1을 안 적은 다수 경로다).
     * 입력이 자동값을 이기는 갈래는 아래 §1.10.1에서 값 함수를 직접 불러 따로 본다. */
    operationMonth: '2026년 7월', comprehensiveMonth: '2026년 1월',
    /* 서식 1.4 — **설치·미설치를 둘 다** 담는다(전부 담으면 '늘 켜는 구현'이 통과한다).
     * 고른 다섯은 축이 각각 다르다: 좌열 부모(소화기구)·좌열(유도등·자탐)·우열 AJ(옥외소화전)·
     * 우열 **AI**(비상콘센트 — 23~25행만 열이 다르다). 바로 옆·아래 칸(유도표지 J20·
     * 비상조명등 AJ19·옥내소화전 J4)은 **일부러 비워** 한 칸 밀림을 음성으로 잡는다. */
    facilities: ['소화기구 및 자동소화장치', '유도등', '자동화재탐지설비 및 시각경보기',
      '옥외소화전설비', '비상콘센트설비'],
    // ⚠ 1.1 §시설현황·운영현황(2026-09-08 배선)은 **켜짐과 꺼짐을 둘 다** 담아야 한다.
    //   전부 채우면 '늘 켜는 구현'이, 전부 비우면 '늘 끄는 구현'이 초록으로 통과한다.
    //   그래서 승강기는 승용·비상용만(피난용 없음), 계단은 직통만(특별피난 없음)으로 둔다.
    grade: '2급', buildingArea: '567.8',
    elevators: { passenger: '2', emergency: '1', evac: '' },
    ops: {
      insuranceJoined: true, insuranceCompany: '어느화재', insurancePeriod: '2025.1.1~2026.1.1',
      insuranceAmountPerson: '1000', insuranceAmountProperty: '2000',
      opHoursWeekday: '09:00~18:00', opHoursHoliday: '',
      headcountWorker: '10', headcountResident: '', headcountMax: '150',
    },
    /* 계단 4종 — 서식 1.1 15~16행의 **새 원천**(마이그 165, 건물 컬럼).
     *  ⚠ `outdoor: '0'`을 일부러 둔다. 종전 판정 `!!txt(v)`는 문자열 `'0'`을 **켰고**,
     *    그래서 스테이징의 송학떡집이 「0개소인데 ■」로 인쇄되고 있었다. 이 칸이 그 회귀를 문다. */
    stairCounts: { direct: '2', special: '', escape: '', outdoor: '0' },
    // 방화구획은 **네 갈래 중 가장 어려운 것**을 픽스처로 잡는다 — '면적별·층별'은 상자 둘을
    // 함께 체크해야 하므로, 한 상자만 찍는 구현도 초록으로 통과하는 'area'로는 판별이 안 된다.
    forms: {
      /* 🚨 `stairs`를 **일부러 반대로** 채운다. 계단 원천은 2026-09-16(마이그 165)부터 건물
       *   `stairCounts`이고 이 JSON은 조립기 폴백 전용이다. 여기에 「특별피난계단 9」를 심어 두면,
       *   1.1 값 축이 옛 경로로 되돌아가는 순간 아래 음성 단언이 빨개진다 —
       *   빈 값으로 두면 되돌아가도 조용히 초록이다(공허 통과). */
      evacFire: { compartment: 'area_floor', stairs: { 직통계단: '', 특별피난계단: '9', 피난계단: '', 옥외계단: '' } },
      multiUse: { applicable: true },
      /* ⚠ 점검자를 **작동은 외주·종합은 자체**로 엇갈리게 둔다. 둘 다 같은 값이면
       *   '한쪽만 읽고 양쪽에 찍는' 구현이 초록으로 통과한다(네 상자가 한 번에 판별된다).
       * ⚠ `comp2Month`·`isInitial`은 **비워 둔다** — 이 둘이 음성 축이다(늘 켜는 구현을 잡는다). */
      inspection: {
        opMonth: '', opInspector: '외주',
        isInitial: false, initialMonth: '',
        compMonth: '', comp2Month: '', compInspector: '자체',
      },
    },
    // 자위소방대 — 대장·부대장·현장대응팀 셋을 **한 픽스처에** 담는다. 현장대응팀은 칸보다
    // 하나 많게 채워 **넘침**까지 같은 실행에서 본다(잘려도 인쇄물은 멀쩡해 보이는 축).
    brigade: [
      { team: '자위소방대장', name: '김대장', duty: '관리구역 상황통제', phone: '010-2222-3333' },
      { team: '부대장', name: '박부대장', duty: '대장 부재시 수행', phone: '010-4444-5555' },
      ...Array.from({ length: BRIG_ROWS + 1 }, (_, i) => ({
        team: i === 0 ? '비상연락' : '초기소화', name: `대원${i + 1}`, duty: `임무${i + 1}`, phone: `010-6666-${String(1000 + i)}`,
      })),
    ],
    zones: Array.from({ length: ZONE_ROWS + 2 }, (_, i) => ({
      zone: `${i + 1}층`, name: `구역${i + 1}`, area: `${100 + i}`,
      weekday: '', holiday: '', managerCo: `입주사${i + 1}`, contact: `010-1111-00${i}`,
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
  {
    /* 원본이 두 어휘를 섞어 쓰므로(F-6) `boxGlyphAt`은 **셀마다** 원본 글자를 돌려줘야 한다.
     * ⚠ 좌표를 적지 않는다 — 종전엔 `('1.1','F12')`를 박아 두었다가 미세 격자 전환 때 그 칸이
     *   상자칸이 아니게 되어 붉어졌다. manifest에서 **각 글자를 쓰는 칸을 찾아** 되묻는다. */
    const sample = (glyph: string) => {
      for (const s of FIRE_PLAN_MANIFEST.sheets) {
        for (const [ref, g] of Object.entries(s.boxes)) if (g === glyph) return { sheet: s.name, ref }
      }
      return null
    }
    for (const glyph of ['□', '☐']) {
      const hit = sample(glyph)
      check(`boxGlyphAt이 '${glyph}' 칸의 원본 글자를 준다`,
        !!hit && boxGlyphAt(hit.sheet, hit.ref) === glyph,
        hit ? `${hit.sheet}!${hit.ref}` : '그 글자를 쓰는 칸이 없다')
    }
  }

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
  /* 🚨 **검사에 좌표를 베껴 적지 않는다.**
   *
   *  종전에는 `at(F11,'C4')`처럼 절대 좌표를 적었다. 미세 격자 전환(47 Q-9)으로 앵커가 통째로
   *  옮겨가자 이 검사들이 **한꺼번에 11건 붉어졌다** — 제품은 멀쩡한데 검사만 낡은 것이었다.
   *  이제 **필드 이름으로 앵커에게 물어** 그 칸을 본다. 격자가 또 바뀌어도 따라간다.
   *
   *  ⚠ 그 대신 이 검사는 **좌표가 옳은지는 못 본다** — 앵커가 정답을 들고 있으니 항진명제다.
   *    좌표 축은 **S7-3 강순기 대조**가 hwpx 원문과 `gridTops`로 독립 판정한다(자구 불일치 0).
   *    여기서 보는 것은 '값이 앵커 칸에 **실제로 들어갔는가**'다 — 두 축을 나눠 둔다. */
  const anchorOf = (field: string, sheet?: string) => {
    const a = FIRE_PLAN_ANCHORS.find(x => x.field === field && (!sheet || x.sheet === sheet))
    if (!a) throw new Error(`앵커에 field='${field}'${sheet ? ` (${sheet})` : ''} 가 없다 — 검사가 낡았다`)
    return a
  }
  const atF = (field: string, sheet?: string) => { const a = anchorOf(field, sheet); return at(a.sheet, a.cell) }
  const labelF = (field: string) => { const a = anchorOf(field); return labelAt(a.sheet, a.cell) }

  const F11 = FP_SHEET.F1_1
  check('1.1 명칭 착지', atF('customer_name', F11) === '가상건물', atF('customer_name', F11))
  check('1.1 사용승인일이 사람이 읽는 날짜', atF('use_approval_date') === '2019. 3. 7.', atF('use_approval_date'))
  // 🚨 R-1 — 씨앗대로였다면 여기에 **대표자 전화**가 들어갔다
  check('1.1 소방안전관리자 연락처 = 관리자 전화(대표자 아님)',
    atF('manager_phone') === '010-0000-0002' && atF('owner_phone') === '010-0000-0001',
    `관리자칸='${atF('manager_phone')}' 대표칸='${atF('owner_phone')}'`)
  check('1.2.1 구역 첫 행 착지', atF('zone_0_floor') === '1층', atF('zone_0_floor'))
  check('1.2.1 구역 마지막 행 착지', atF(`zone_${ZONE_ROWS - 1}_floor`) === `${ZONE_ROWS}층`)
  check('1.3 관할소방서 착지', atF('fire_station') === '어딘가소방서', atF('fire_station'))
  check('1.2.1 관리주체(입주사) 착지', atF('zone_0_company') === '입주사1', atF('zone_0_company'))

  /* ── 1.1 §시설현황·운영현황(2026-09-08 배선) ────────────────────────────────
   *  🚨 **켜짐만 보면 안 된다.** '전부 체크하는 구현'도 켜짐 검사는 통과한다. 그래서 칸마다
   *    데이터가 있는 짝(켜짐)과 없는 짝(꺼짐)을 나란히 요구한다. 자구 보존도 함께 본다 —
   *    상자만 갈아 끼워야지 법정 문구를 덮어쓰면 안 된다. */
  check('1.1 대상물 급수 = 값+자구', atF('grade') === '2급', atF('grade'))
  check('1.1 건축면적 = 값+단위', atF('building_area') === '567.8㎡', atF('building_area'))
  check('1.1 승강기 승용·비상용 체크',
    atF('elevator_passenger').includes('■') && atF('elevator_emergency').includes('■'),
    `${atF('elevator_passenger')} / ${atF('elevator_emergency')}`)
  check('1.1 승강기 피난용은 미체크(데이터 없음)', !atF('elevator_evac').includes('■'), atF('elevator_evac'))
  check('1.1 승강기 법정 자구 보존',
    atF('elevator_passenger').replace('■', '☐') === labelF('elevator_passenger'), atF('elevator_passenger'))
  check('1.1 계단 직통만 체크',
    atF('stair_direct').includes('■') && !atF('stair_escape').includes('■'),
    `직통='${atF('stair_direct')}' 피난='${atF('stair_escape')}'`)
  /* 🚨 음성 둘 — 둘 다 「켜지면 안 되는데 켜지는」 실제 결함을 재현한다.
   *   ① 특별피난: 옛 원천(1.5 탭 JSON)엔 `'9'`가 있다. 여기가 ■면 배선이 되돌아간 것이다.
   *   ② 옥외: 값이 `'0'`이다. 여기가 ■면 판정이 `!!txt`로 되돌아간 것이다(송학떡집 결함). */
  check('1.1 특별피난계단 미체크 — 1.5 탭 JSON으로 되돌아가지 않았다',
    !atF('stair_special').includes('■'), atF('stair_special'))
  check("1.1 옥외계단 미체크 — 개소 '0'은 설치가 아니다",
    !atF('stair_outdoor').includes('■'), atF('stair_outdoor'))
  check('1.1 운영시간 평일 체크 + 시각 착지',
    atF('ophours_weekday').includes('■') && atF('ophours_weekday_time') === '09:00~18:00',
    `${atF('ophours_weekday')} / ${atF('ophours_weekday_time')}`)
  check('1.1 운영시간 휴일은 미체크(데이터 없음)', !atF('ophours_holiday').includes('■'), atF('ophours_holiday'))
  check('1.1 근무인원 체크 + 값',
    atF('headcount_worker_on').includes('■') && atF('headcount_worker') === '10 명',
    `${atF('headcount_worker_on')} / ${atF('headcount_worker')}`)
  check('1.1 거주인원은 미체크·빈 단위(데이터 없음)',
    !atF('headcount_resident_on').includes('■') && atF('headcount_resident').trim() === '명',
    `${atF('headcount_resident_on')} / '${atF('headcount_resident')}'`)
  // 🎯 이 칸에 표본 고객의 답 `100명`이 박혀 있었다 — 값이 덮어쓰는지, 잔재가 없는지 둘 다 본다
  check('1.1 최대수용인원 = 우리 값(표본 100명이 아니다)',
    atF('headcount_max') === '150명' && !atF('headcount_max').includes('100'), atF('headcount_max'))
  check('1.1 업무대행 해당(대행업체 있음)',
    atF('agency_yes').includes('■') && !atF('agency_no').includes('■'), `${atF('agency_yes')} / ${atF('agency_no')}`)
  check('1.1 다중이용업 해당',
    atF('multiuse_yes').includes('■') && !atF('multiuse_no').includes('■'), `${atF('multiuse_yes')} / ${atF('multiuse_no')}`)
  check('1.1 화재보험 가입',
    atF('insurance_yes').includes('■') && !atF('insurance_no').includes('■'), `${atF('insurance_yes')} / ${atF('insurance_no')}`)
  {
    /* ⚠ 데이터가 없어 **일부러 안 세운 칸**(주차장·공공기관·권원분리·주간/야간)은 앵커가 없어
     *   필드로 물을 수 없다. 좌표를 적는 대신 **시트 전체의 ■ 개수**로 묻는다 — 배선하지 않은
     *   상자가 하나라도 켜지면 수가 늘어난다. 좌표에 매이지 않으면서 범위는 더 넓다.
     *   기대값 9 = 승용·비상용·직통계단·평일·근무인원·최대수용인원·업무대행해당·다중이용업해당·가입 */
    const ws = wb2.Sheets[F11] ?? {}
    const marks = Object.keys(ws).filter(k => !k.startsWith('!'))
      .filter(k => String((ws[k] as XLSX.CellObject).v ?? '').includes('■')).length
    check('1.1 체크된 상자는 우리가 켠 9개뿐(미배선 칸은 손대지 않는다)', marks === 9, `${marks}개`)
  }

  /* ── 서식 1.4 소방시설 현황 (2026-09-14 배선) ──────────────────────────────────
   *  🚨 이 시트는 앵커가 **0칸**이라 40종 전부가 `□`로 인쇄되고 있었다(사용자 신고: 소화기구·
   *    유도등). 같은 값을 PDF는 체크하고 있었으므로 두 산출물이 갈라져 있었다(D-7).
   *  🚨 켜짐만 묻지 않는다 — '전부 체크하는 구현'도 켜짐 검사는 통과한다. 칸마다 **짝**을 건다. */
  {
    const rowOf = (code: string) => {
      const r = FORM14_ROWS.find(x => x.code === code)
      if (!r) throw new Error(`검사가 낡았다 — 1.4에 코드 '${code}'가 없다`)
      return r
    }
    const f14 = (code: string) => at(FORM14_SHEET, rowOf(code).cell)

    // ① 전사(全射) — 표준 코드가 하나라도 칸을 못 얻으면 그 설비는 영원히 미체크다
    check('1.4 표준 코드 전건이 칸을 얻었다', FORM14_ROWS.length === ALL_STANDARD_CODES.length,
      `${FORM14_ROWS.length}/${ALL_STANDARD_CODES.length}종`)
    check('1.4 칸·필드에 중복이 없다',
      new Set(FORM14_ROWS.map(r => r.cell)).size === FORM14_ROWS.length
      && new Set(FORM14_ROWS.map(r => r.field)).size === FORM14_ROWS.length)

    // ② 양성 — 사용자가 신고한 바로 그 두 칸
    check('1.4 소화기구 및 자동소화장치 체크', f14('소화기구 및 자동소화장치').includes('■'),
      f14('소화기구 및 자동소화장치'))
    check('1.4 유도등 체크', f14('유도등').includes('■'), f14('유도등'))
    check('1.4 우열 AJ(옥외소화전) 체크', f14('옥외소화전설비').includes('■'), f14('옥외소화전설비'))
    // 🎯 23~25행만 우열이 AI다 — AJ로 적었으면 여기만 조용히 빗나간다
    check('1.4 우열 AI(비상콘센트) 체크', f14('비상콘센트설비').includes('■'), f14('비상콘센트설비'))

    // ③ 음성 — 유도등 바로 아래(유도표지)·바로 옆(비상조명등)이 함께 켜지면 좌표가 밀린 것이다
    check('1.4 유도표지는 미체크(미설치)', !f14('유도표지').includes('■'), f14('유도표지'))
    check('1.4 비상조명등은 미체크(미설치)', !f14('비상조명등').includes('■'), f14('비상조명등'))
    check('1.4 옥내소화전은 미체크(미설치)', !f14('옥내소화전설비').includes('■'), f14('옥내소화전설비'))
    check('1.4 무선통신보조는 미체크(미설치)', !f14('무선통신보조설비').includes('■'), f14('무선통신보조설비'))

    // ④ 법정 자구 보존 — 상자만 갈아 끼워야지 문구를 덮어쓰면 안 된다
    const restored = (r: { cell: string }) =>
      at(FORM14_SHEET, r.cell).replace('■', boxGlyphAt(FORM14_SHEET, r.cell)).trim()
    const broken = FORM14_ROWS.filter(r => restored(r) !== labelAt(FORM14_SHEET, r.cell).trim())
    check('1.4 법정 자구 보존(상자 글자만 바뀐다)', broken.length === 0,
      broken.slice(0, 4).map(r => `${r.cell}='${at(FORM14_SHEET, r.cell)}'`).join(' · '))

    // ⑤ 시트 전체 ■ 수 — 배선하지 않은 칸(R16·R17 피난기구 하위, AJ2 안내문)이 켜지면 늘어난다.
    //   ⚠ A2 대상명은 `■`로 시작하는 **불릿**이라 체크가 아니다 — 세지 않는다(좌표로 빼지 않고
    //     그 앵커의 칸으로 빼서, 서식이 밀려도 검사가 따라간다).
    {
      const ws = wb2.Sheets[FORM14_SHEET] ?? {}
      const marks = Object.keys(ws).filter(k => !k.startsWith('!') && k !== FORM14_NAME_CELL)
        .filter(k => String((ws[k] as XLSX.CellObject).v ?? '').includes('■')).length
      check('1.4 체크된 상자는 우리가 켠 5개뿐(미배선 칸은 손대지 않는다)', marks === 5, `${marks}개`)
    }

    // ⑥ 대상명 — 서식 자구는 남고 값이 뒤에 붙는다
    check('1.4 대상명 착지(자구 + 값)',
      atF(FORM14_NAME_FIELD).includes('대상명') && atF(FORM14_NAME_FIELD).endsWith('가상건물'),
      atF(FORM14_NAME_FIELD))
  }

  /* ── 서식 1.10.1 연간 점검 계획 (2026-09-14 배선) ──────────────────────────────
   *  🚨 이 시트도 앵커가 **0칸**이라 사용승인일·자체점검 체크·점검시기가 통째로 공란이었다
   *    (사용자 신고). 같은 값을 PDF는 인쇄하고 있었다 — 1.4와 똑같은 D-7 갈라짐이다.
   *  🚨 여기서도 켜짐만 묻지 않는다. 픽스처가 **엇갈린 점검자**(작동=외주 / 종합=자체)와
   *    **빈 2차·최초점검**을 함께 담고 있어 네 상자와 두 음성 축이 한 실행에서 판별된다. */
  {
    const F1101 = FP_SHEET.F1_10_1
    const on = (f: string) => atF(f).includes('■')

    // ① 사용승인일 — 사용자가 신고한 바로 그 칸. 자구는 남고 값이 뒤에 붙는다(접두라벨칸)
    check('1.10.1 사용승인일 착지(자구 + 값)',
      atF('f1101_use_approval_date').includes('건축물 사용승인일')
      && atF('f1101_use_approval_date').endsWith('2019. 3. 7.'),
      atF('f1101_use_approval_date'))
    // 🎯 1.1과 **같은 원천·같은 표기**여야 한다 — 두 칸이 갈라지면 한 문서 안에서 모순이다
    check('1.10.1 사용승인일이 1.1과 같은 값', atF('f1101_use_approval_date').endsWith(atF('use_approval_date')),
      `1.10.1='${atF('f1101_use_approval_date')}' vs 1.1='${atF('use_approval_date')}'`)

    // ② 자체점검 머리 상자 둘
    check('1.10.1 작동점검 체크', on('f1101_op_check'), atF('f1101_op_check'))
    check('1.10.1 종합점검 체크(종합 시기 있음)', on('f1101_comp_check'), atF('f1101_comp_check'))

    // ③ 점검시기 — 연월칸. 자구(`년`·`월`)는 남고 값이 그 앞에 끼어야 한다
    check('1.10.1 작동점검 시기 = 자동값',
      atF('f1101_op_month').includes('2026년') && atF('f1101_op_month').includes('7월'),
      `'${atF('f1101_op_month')}'`)
    check('1.10.1 종합점검 시기 = 자동값',
      atF('f1101_comp_month').includes('2026년') && atF('f1101_comp_month').includes('1월'),
      `'${atF('f1101_comp_month')}'`)
    // 🎯 작동·종합이 **서로 다른 달**을 받는다 — 한쪽을 양쪽에 찍는 구현이 여기서 붉어진다
    check('1.10.1 작동·종합 시기가 서로 다르다', atF('f1101_op_month') !== atF('f1101_comp_month'),
      `작동='${atF('f1101_op_month')}' 종합='${atF('f1101_comp_month')}'`)
    check('1.10.1 연월칸 법정 자구 보존(년·월이 남는다)',
      /년/.test(atF('f1101_op_month')) && /월/.test(atF('f1101_op_month')), atF('f1101_op_month'))

    // ④ 점검자 — 엇갈린 픽스처라 네 상자가 한 번에 판별된다
    check('1.10.1 작동 점검자 = 외주(자체 아님)', on('f1101_op_outsource') && !on('f1101_op_self'),
      `자체='${atF('f1101_op_self')}' 외주='${atF('f1101_op_outsource')}'`)
    check('1.10.1 종합 점검자 = 자체(외주 아님)', on('f1101_comp_self') && !on('f1101_comp_outsource'),
      `자체='${atF('f1101_comp_self')}' 외주='${atF('f1101_comp_outsource')}'`)

    // ⑤ 음성 — 안 적은 것은 안 켠다('늘 켜는 구현'을 잡는 축)
    check('1.10.1 최초점검은 미체크(입력 없음)', !on('f1101_initial_check'), atF('f1101_initial_check'))
    check('1.10.1 종합 2차는 미체크(입력 없음)', !on('f1101_comp2_box'), atF('f1101_comp2_box'))
    /* ⚠ 「숫자가 없다」만 물으면 **칸을 통째로 지우는 구현도 통과**한다(빈 문자열엔 숫자가 없다).
     *   변이가 실제로 그걸 뚫었다 — 빈 서식의 계약은 '값이 없다'가 아니라 **'자구가 남는다'**다. */
    const blankForm = (f: string) => !/\d/.test(atF(f)) && /년/.test(atF(f)) && /월/.test(atF(f))
    check('1.10.1 최초·2차 연월칸은 빈 서식(년·월 자구는 남고 숫자는 없다)',
      blankForm('f1101_initial_month') && blankForm('f1101_comp2_month'),
      `최초='${atF('f1101_initial_month')}' 2차='${atF('f1101_comp2_month')}'`)

    // ⑥ 법정 자구 보존 — 상자칸 아홉 전부, 상자 글자만 바뀌어야 한다
    {
      const boxFields = ['f1101_op_check', 'f1101_comp_check', 'f1101_initial_check', 'f1101_comp_box',
        'f1101_comp2_box', 'f1101_op_self', 'f1101_op_outsource', 'f1101_comp_self', 'f1101_comp_outsource']
      const broken = boxFields.filter(f => {
        const a = anchorOf(f)
        return at(a.sheet, a.cell).replace('■', boxGlyphAt(a.sheet, a.cell)).trim() !== labelAt(a.sheet, a.cell).trim()
      })
      check('1.10.1 법정 자구 보존(상자 글자만 바뀐다)', broken.length === 0, broken.join(','))
    }

    /* ⑦ 시트 전체 ■ 수 — 배선하지 않은 칸(외관점검 한 벌·일상점검·관련서류)이 켜지면 늘어난다.
     *   기대값 5 = D5 작동점검 · AF7 작동 외주 · D8 종합점검 머리 · V9 종합점검 줄 · V12 종합 자체.
     *   ⚠ 「종합점검」 상자는 **둘**이다 — 머리(D8)와 안쪽 줄(V9). 처음에 4로 적었다가 이 단언이
     *     잡았다(제품이 아니라 기대값이 틀렸다). 머리만 세면 안쪽 줄이 빠져도 초록이 된다. */
    {
      const ws = wb2.Sheets[F1101] ?? {}
      const marks = Object.keys(ws).filter(k => !k.startsWith('!'))
        .filter(k => String((ws[k] as XLSX.CellObject).v ?? '').includes('■')).length
      check('1.10.1 체크된 상자는 우리가 켠 5개뿐(외관점검·일상점검은 손대지 않는다)', marks === 5, `${marks}개`)
    }

    /* ⑧ 갈래 표 — 주입까지 가지 않고 **값 함수를 직접** 불러 나머지 경로를 판별한다.
     *   여기서만 보이는 것이 둘이다: **입력이 자동값을 이기는가**, 그리고 **최초점검만 잡힌 건**
     *   (종합월이 비어도 머리 상자가 켜져야 한다 — PDF가 독립 행을 내는 것과 같은 판단). */
    const vals = (insp: Record<string, unknown> | undefined, auto: Record<string, string>) =>
      buildFirePlanValues({ ...fixture, ...auto, forms: { ...fixture.forms, inspection: insp } } as unknown as FirePlanGenData)
    {
      const over = vals({ opMonth: '2027년 11월', compMonth: '2027년 2월', opInspector: '외주', compInspector: '외주', isInitial: false, initialMonth: '', comp2Month: '' },
        { operationMonth: '2026년 7월', comprehensiveMonth: '2026년 1월' })
      check('1.10.1 고객 입력이 자동값을 이긴다',
        String(over.get('f1101_op_month')).includes('2027년') && String(over.get('f1101_op_month')).includes('11월'),
        String(over.get('f1101_op_month')))
      check('1.10.1 자동값이 새어 들지 않는다', !String(over.get('f1101_op_month')).includes('2026'),
        String(over.get('f1101_op_month')))
    }
    {
      // 🎯 최초점검만 — 종합월이 비어도 머리 상자가 켜진다(`hasComprehensiveBlock`)
      const init = vals({ opMonth: '', compMonth: '', opInspector: '외주', compInspector: '외주', isInitial: true, initialMonth: '2026년 5월', comp2Month: '' },
        { operationMonth: '2026년 7월', comprehensiveMonth: '' })
      check('1.10.1 최초점검만 잡혀도 종합 머리가 켜진다', String(init.get('f1101_comp_check')).includes('■'),
        String(init.get('f1101_comp_check')))
      check('1.10.1 최초점검 시기 착지', /2026년\s*5월/.test(String(init.get('f1101_initial_month'))),
        String(init.get('f1101_initial_month')))
      check('1.10.1 최초점검만일 때 종합 상자는 꺼진다', !String(init.get('f1101_comp_box')).includes('■'),
        String(init.get('f1101_comp_box')))
    }
    {
      // 🎯 2차는 적었을 때만 — '공란 유지'는 값을 버리라는 뜻이 아니다(PDF도 이 값을 인쇄한다)
      const c2 = vals({ opMonth: '', compMonth: '2026년 1월', opInspector: '외주', compInspector: '외주', isInitial: false, initialMonth: '', comp2Month: '2026년 8월' },
        { operationMonth: '2026년 7월', comprehensiveMonth: '2026년 1월' })
      check('1.10.1 2차는 고객이 적었을 때만 켜진다', String(c2.get('f1101_comp2_box')).includes('■'),
        String(c2.get('f1101_comp2_box')))
      check('1.10.1 2차 시기 착지', /2026년\s*8월/.test(String(c2.get('f1101_comp2_month'))),
        String(c2.get('f1101_comp2_month')))
    }
    {
      /* 🎯 자체점검이 하나도 안 잡힌 고객 — 작동점검은 **그래도 켜지고**(법정 필수) 종합 블록은
       *   통째로 꺼진다. 점검자도 둘 다 꺼져야 한다(종합을 안 하는데 점검자만 찍히면 자기모순). */
      const none = vals(undefined, { operationMonth: '', comprehensiveMonth: '' })
      check('1.10.1 시기 미정이어도 작동점검은 켜진다', String(none.get('f1101_op_check')).includes('■'),
        String(none.get('f1101_op_check')))
      // ⚠ 여기도 '지운다'가 아니라 '자구가 남는다'를 요구한다(위 §빈 서식 주석)
      check('1.10.1 작동 연월칸은 빈 서식으로 남는다(년·월 자구 보존)',
        !/\d/.test(String(none.get('f1101_op_month'))) && /년/.test(String(none.get('f1101_op_month')))
        && /월/.test(String(none.get('f1101_op_month'))),
        `'${String(none.get('f1101_op_month'))}'`)
      check('1.10.1 종합 블록이 통째로 꺼진다',
        !String(none.get('f1101_comp_check')).includes('■') && !String(none.get('f1101_comp_box')).includes('■'),
        `머리='${none.get('f1101_comp_check')}' 종합='${none.get('f1101_comp_box')}'`)
      check('1.10.1 종합 점검자도 둘 다 꺼진다',
        !String(none.get('f1101_comp_self')).includes('■') && !String(none.get('f1101_comp_outsource')).includes('■'),
        `자체='${none.get('f1101_comp_self')}' 외주='${none.get('f1101_comp_outsource')}'`)
      // 입력이 아예 없어도 점검자 기본값은 외주다(PDF와 공유하는 규칙)
      check('1.10.1 입력 없으면 작동 점검자 기본 외주', String(none.get('f1101_op_outsource')).includes('■'),
        String(none.get('f1101_op_outsource')))
    }
    {
      /* 🚨 **변이가 찾아낸 구멍**(2026-09-14). 위 `none` 건은 점검자가 기본값 `외주`라, 종합
       *   블록이 꺼진 것 때문에 `자체` 상자가 꺼진 건지 **애초에 자체가 아니어서** 꺼진 건지
       *   구별하지 못했다 — `compBlock &&` 가드를 떼는 변이가 그대로 살아남았다.
       *   그래서 **블록은 꺼졌는데 점검자는 자체**인 건을 따로 세운다. 이 짝에서만 가드가 드러난다. */
      const offSelf = vals({ opMonth: '', compMonth: '', opInspector: '외주', compInspector: '자체', isInitial: false, initialMonth: '', comp2Month: '' },
        { operationMonth: '2026년 7월', comprehensiveMonth: '' })
      check('1.10.1 종합을 안 하면 「자체」를 골랐어도 점검자를 안 찍는다',
        !String(offSelf.get('f1101_comp_self')).includes('■'), String(offSelf.get('f1101_comp_self')))
      // 짝 — 같은 입력에서 블록이 켜지면 그 「자체」는 찍혀야 한다(늘 끄는 구현을 잡는다)
      const onSelf = vals({ opMonth: '', compMonth: '2026년 1월', opInspector: '외주', compInspector: '자체', isInitial: false, initialMonth: '', comp2Month: '' },
        { operationMonth: '2026년 7월', comprehensiveMonth: '2026년 1월' })
      check('1.10.1 종합을 하면 그 「자체」가 찍힌다',
        String(onSelf.get('f1101_comp_self')).includes('■'), String(onSelf.get('f1101_comp_self')))
    }
    {
      /* 🎯 레거시 자유 텍스트 — 형식을 못 맞추면 **원문을 통째로** 인쇄한다(값을 잃지 않는다).
       *   `planMonthParts`의 왕복 대조가 없으면 `경`이 조용히 사라진다. */
      const legacy = vals({ opMonth: '2026년 7월경', compMonth: '', opInspector: '외주', compInspector: '외주', isInitial: false, initialMonth: '', comp2Month: '' },
        { operationMonth: '', comprehensiveMonth: '' })
      check('1.10.1 형식 밖 연월은 원문 그대로(글자 유실 0)',
        String(legacy.get('f1101_op_month')).includes('2026년 7월경'), String(legacy.get('f1101_op_month')))
    }
  }

  /* ── 제2장 서식 2.2 자위소방대 편성표 (2단계 · Q-1) ────────────────────────────
   *  🚨 이 검사가 없으면 **배선이 통째로 죽어 있어도 초록**이다 — 값 맵 완결성은 `''`도
   *    '있다'로 세기 때문이다(실제로 브리게이드를 배선한 첫 실행이 그랬다). */
  const digits = (s: string) => s.replace(/\D/g, '')
  check('2.2 대장 착지(성명·임무·전화)',
    atF('brig_lead_name') === '김대장' && atF('brig_lead_duty') === '관리구역 상황통제'
    && digits(atF('brig_lead_phone')) === '01022223333',
    `${atF('brig_lead_name')} / ${atF('brig_lead_duty')} / ${atF('brig_lead_phone')}`)
  check('2.2 부대장 착지',
    atF('brig_dep_name') === '박부대장' && digits(atF('brig_dep_phone')) === '01044445555',
    `${atF('brig_dep_name')} / ${atF('brig_dep_phone')}`)
  // 🎯 대장·부대장이 현장대응팀으로도 새어 들어가면 같은 사람이 두 줄에 인쇄된다
  check('2.2 대장·부대장은 현장대응팀에 중복되지 않는다',
    atF('brig_f0_name') === '대원1' && atF('brig_f0_name') !== '김대장', atF('brig_f0_name'))
  check('2.2 현장대응팀 마지막 행까지 채운다',
    atF(`brig_f${BRIG_ROWS - 1}_name`) === `대원${BRIG_ROWS}`, atF(`brig_f${BRIG_ROWS - 1}_name`))
  check('2.2 소속이 대원 있는 줄에만 찍힌다', atF('brig_f0_org') === '가상건물', atF('brig_f0_org'))
  check('2.2 넘친 대원을 센다(잘렸다는 사실을 드러낸다)', brigadeRowOverflow(fixture) === 1,
    `${brigadeRowOverflow(fixture)}명`)
  check('2.2 넘친 대원이 표에 새어 들어가지 않는다', !values.has(`brig_f${BRIG_ROWS}_name`))
  check('2.2 행 예산이 manifest 라벨 블록에서 파생됐다', BRIG_ROWS === 14, `${BRIG_ROWS}행`)
  check('2.14 결과기록부 대상명 착지',
    atF('customer_name', FP_SHEET.F2_14) === '가상건물', atF('customer_name', FP_SHEET.F2_14))

  {
    // 대원이 칸보다 **적을** 때 — 빈 줄에 소속(건물명)만 찍히면 '이름 없는 소속'이 인쇄된다
    const few = buildFirePlanValues({
      ...fixture,
      brigade: [{ team: '자위소방대장', name: '김대장', duty: '', phone: '' }],
    } as unknown as FirePlanGenData)
    check('2.2 대원 없는 줄은 소속도 비운다',
      few.get('brig_f0_org') === '' && few.get('brig_f0_name') === '' && few.get('brig_dep_org') === '',
      `f0_org='${few.get('brig_f0_org')}' dep_org='${few.get('brig_dep_org')}'`)
  }

  /* ── 1.5.1 방화구획(상자칸) ── 값칸과 달리 **라벨은 남고 상자만 바뀐다**. 라벨까지 덮어쓰면
   *  법정 자구가 사라지는데, 상자 하나만 보는 검사는 그걸 못 본다 — 자구 보존을 따로 요구한다. */
  const F151 = FP_SHEET.F1_5_1
  check('1.5.1 면적별 체크 착지', atF('compartment_area').includes('■'), atF('compartment_area'))
  // 🎯 '면적별·층별'은 새 상자가 아니라 **둘 다** 체크다 — 한 상자만 찍는 구현을 여기가 잡는다
  check('1.5.1 층별도 함께 체크(면적별·층별)', atF('compartment_floor').includes('■'), atF('compartment_floor'))
  check('1.5.1 법정 자구 보존 — 상자만 갈아 끼웠다',
    atF('compartment_area').replace('■', '□').trim() === labelF('compartment_area').trim(), atF('compartment_area'))
  check('1.5.1 해당유무 = 유',
    atF('compartment_applies').startsWith('■유') && atF('compartment_applies').includes('□무'),
    atF('compartment_applies'))
  /* ⚠ ERP 입력에 없는 갈래(`용도별`)는 배선하지 않았다 — 늘 미체크로 남아야 한다.
   *   앵커가 없으니 필드로 못 묻는다. 좌표를 적는 대신 **라벨로 그 칸을 찾는다**(유일성 단언 포함) —
   *   격자가 바뀌어도 라벨은 따라다니고, 여러 곳에서 찾히면 그 자체가 붉어진다. */
  {
    const s151 = FIRE_PLAN_MANIFEST.sheets.find(x => x.name === F151)!
    const hits = Object.entries(s151.labels).filter(([, v]) => v.replace(/\s/g, '') === '□용도별')
    check('1.5.1 「용도별」 칸이 유일하다(라벨 축)', hits.length === 1, `${hits.length}곳`)
    if (hits.length === 1) {
      check('1.5.1 용도별은 손대지 않는다', !at(F151, hits[0][0]).includes('■'), at(F151, hits[0][0]))
    }
  }

  {
    // 네 갈래 전수 + 미입력. 두 상태가 같은 상자 조합을 내면 **화면의 선택이 인쇄물에서 사라진다**.
    const boxesOf = (c: string) => {
      const m = buildFirePlanValues({ ...fixture, forms: { evacFire: { compartment: c } } } as unknown as FirePlanGenData)
      const on = (f: string) => String(m.get(f) ?? '').includes('■')
      return `${on('compartment_area') ? 'A' : '-'}${on('compartment_floor') ? 'F' : '-'}|${String(m.get('compartment_applies'))}`
    }
    const sig = ['area', 'floor', 'area_floor', 'none', ''].map(boxesOf)
    check('방화구획 4갈래 + 미입력이 전부 다른 인쇄를 낸다', new Set(sig).size === 5, sig.join('  '))
    // 미입력과 '해당없음'은 다르다 — 안 물어본 칸에 '무'를 찍으면 없는 답이 인쇄된다
    check('미입력은 유·무를 둘 다 비운다', !boxesOf('').includes('■'), boxesOf(''))
    check('해당없음은 무를 찍는다', boxesOf('none').includes('■무'), boxesOf('none'))
    check('화면 갈래도 넷(단일 원천)', COMPARTMENT_KINDS.length === 4, COMPARTMENT_KINDS.map(k => k.label).join('·'))
  }

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

/* ══════════════════════ [8] 정렬 축 (소방계획서_47 B-12) ══════════════════════
 *  정렬 지시(체크 좌 · 단위만 우 · 문장 좌 · 토큰 좌 · 배너 좌 · 나머지 가운데)가 **자산의
 *  styles.xml에 실제로 실렸는가**. 종전엔 이 지시들이 독립 생성기(_gs-book50)에만 배선돼
 *  고객이 받는 ERP 워크북은 가운데 하나뿐이었다 — 여기가 붉으면 그 회귀다.
 *
 *  ⚠ 스타일 **번호를 하나도 적지 않는다** — styles.xml을 스스로 파싱해 번호→정렬을 그때그때
 *    푼다(이 저장소에서 좌표·번호 하드코딩 검사가 두 번 오보를 냈다). 분류 규칙은 빌더와
 *    **한 벌**(fire-plan-align)에서 읽는다 — 이 검사의 축은 '분류가 옳은가'가 아니라
 *    '분류가 자산에 착지했는가'다(분류 자체의 옳음은 생성기 육안·사용자 지시가 원천). */
console.log('\n[8] 정렬 축 — 분류가 styles.xml에 실렸는가 (B-12)')
{
  const zip = await JSZip.loadAsync(bytes)
  const stylesXml = await zip.file('xl/styles.xml')!.async('string')
  // ⚠ <xf/> 자기닫힘과 <xf>…</xf>가 섞일 수 있다 — 자기닫힘을 놓치면 번호가 통째로 밀린다
  const cellXfsXml = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? ''
  const xfAligns: string[] = []
  for (const m of cellXfsXml.matchAll(/<xf\b[^>]*?(?:\/>|>([\s\S]*?)<\/xf>)/g)) {
    xfAligns.push(/<alignment\b[^>]*?horizontal="([^"]+)"/.exec(m[1] ?? '')?.[1] ?? 'general')
  }
  check('cellXfs 정렬 파싱이 비지 않았다(눈멂 가드)', xfAligns.length >= 4, `${xfAligns.length}개`)
  check('left·center·right 세 정렬이 모두 실재', ['left', 'center', 'right'].every(a => xfAligns.includes(a)),
    [...new Set(xfAligns)].join(','))

  // 시트명 → 시트 XML 경로 — [6]과 같은 자기정의 방식(rels 경유)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relTarget = new Map<string, string>()
  for (const m of relXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget.set(m[1], m[2])
  const sheetPath = new Map<string, string>()
  for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const t = relTarget.get(m[2])
    if (t) sheetPath.set(m[1].replace(/&amp;/g, '&'), `xl/${t}`)
  }

  const cnt = { banner: 0, check: 0, unit: 0, prose: 0, token: 0, center: 0, proseCol: 0 }
  const bad: Record<keyof typeof cnt, string[]> = { banner: [], check: [], unit: [], prose: [], token: [], center: [], proseCol: [] }
  for (const s of FIRE_PLAN_MANIFEST.sheets) {
    const p = sheetPath.get(s.name)
    if (!p) { check(`${s.name} 시트 XML 접근`, false); continue }
    const xml = await zip.file(p)!.async('string')
    const sAt = new Map<string, number>()
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"(?:\s+s="(\d+)")?/g)) sAt.set(m[1], Number(m[2] ?? -1))
    const alignAt = (ref: string) => xfAligns[sAt.get(ref) ?? -1] ?? '(칸없음)'
    const bannerRows = new Set(s.bannerRows)
    const rowOf = (ref: string) => Number(/\d+/.exec(ref)![0]) - 1
    const judge = (ref: string, kind: keyof typeof cnt, want: string) => {
      cnt[kind]++
      const got = alignAt(ref)
      if (got !== want) bad[kind].push(`${s.name}!${ref} ${want}≠${got}`)
    }
    /* ⑥ — 「형제가 문장인 열」이라 가운데에서 좌로 올린 칸. **manifest가 실어 준 사실**이다:
     * 판정에 필요한 hwpx 열·병합폭·borderFill이 여기엔 없어 라벨만으로는 재현할 수 없다.
     * ⚠ 이 집합을 빼면 «⑥이 고친 24칸»을 「가운데여야 하는데 좌」로 읽어 제품이 옳은데 붉어진다. */
    const proseCol = new Set(s.proseColumnCells)
    // 토큰 칸 — 템플릿에서 공란이지만 스타일은 남아 런타임 주입 값이 좌정렬을 받는다(배너 토큰도 좌)
    for (const ref of Object.keys(s.tokenCells)) judge(ref, 'token', 'left')
    for (const [ref, label] of Object.entries(s.labels)) {
      if (bannerRows.has(rowOf(ref))) { judge(ref, 'banner', 'left'); continue }
      const want = classifyAlign(label, { proseColumn: proseCol.has(ref) })
      const kind = proseCol.has(ref) ? 'proseCol'
        : want === 'right' ? 'unit' : want === 'center' ? 'center' : isCheckText(label) ? 'check' : 'prose'
      judge(ref, kind, want)
    }
  }
  const totalTokens = FIRE_PLAN_MANIFEST.sheets.reduce((t, s) => t + Object.keys(s.tokenCells).length, 0)
  // 🚨 분모를 함께 단언한다 — 라벨이 0으로 새면 '불일치 0'은 항진명제다
  check(`체크 선두 칸 전건 좌`, cnt.check >= 100 && bad.check.length === 0,
    bad.check.slice(0, 4).join(' · ') || `${cnt.check}칸`)
  check(`단위만 칸 전건 우`, cnt.unit >= 3 && bad.unit.length === 0,
    bad.unit.slice(0, 4).join(' · ') || `${cnt.unit}칸`)
  check(`문장 칸 전건 좌`, cnt.prose >= 30 && bad.prose.length === 0,
    bad.prose.slice(0, 4).join(' · ') || `${cnt.prose}칸`)
  check(`토큰 칸 전건 좌(분모 = manifest 전수)`, cnt.token === totalTokens && totalTokens >= 50 && bad.token.length === 0,
    bad.token.slice(0, 4).join(' · ') || `${cnt.token}/${totalTokens}칸`)
  check(`배너 줄 전건 좌`, cnt.banner >= 30 && bad.banner.length === 0,
    bad.banner.slice(0, 4).join(' · ') || `${cnt.banner}줄`)
  check(`나머지 라벨은 가운데(다수)`, cnt.center >= 500 && bad.center.length === 0,
    bad.center.slice(0, 4).join(' · ') || `${cnt.center}칸`)

  /* ⑥ 「형제가 문장인 열」 — 사용자 지적 image-30(서식 2.1 임무는 7칸 중 4칸만 가운데였다).
   * 🚨 **개수를 정확히 가둔다**(표본답 비우기·fill-in 규칙과 같은 규약). ⑥ 목록은 빌드가 만들고
   *   이 검사가 읽으므로 규칙이 넓어지면 목록도 함께 넓어져 「전건 좌」는 계속 초록이다 —
   *   **자기 채점**이라 개수만이 유일한 자다. 느슨한 구간(20~30)으로는 부족했다: 구(句) 길이를
   *   6→2로 무른 변이가 27칸으로 **살아남았다**(실측). 정확한 수라야 규칙을 건드릴 때 사람이 본다.
   *   실측 24칸 = 1.9 개별임무 4 · 1.11.2 1 · 1.14.1 홍보방법 4 · 2.1 임무 4 · 2.4 임무카드 6 ·
   *              2.9 1 · 2.14 1 · 3.7 3. 양식이 개정되면 이 수를 **보고 나서** 고칠 것. */
  const PROSE_COL_EXPECT = 24
  check(`⑥ 형제 문장 열 전건 좌`, cnt.proseCol === PROSE_COL_EXPECT && bad.proseCol.length === 0,
    bad.proseCol.slice(0, 4).join(' · ') || `${cnt.proseCol}/${PROSE_COL_EXPECT}칸`)
  {
    /* 🚨 「좌인가」만 물으면 **항진명제**다: ⑥이 통째로 죽어도 ①~⑤가 이미 좌로 보낸 칸을
     *   목록에 실어 두면 초록이다. **⑥이 없었다면 가운데였을 것**임을 함께 단언한다. */
    const noop: string[] = []
    for (const s of FIRE_PLAN_MANIFEST.sheets) {
      for (const ref of s.proseColumnCells) {
        if (classifyAlign(s.labels[ref] ?? '') !== 'center') noop.push(`${s.name}!${ref}`)
      }
    }
    check(`⑥ 목록은 전부 「⑥이 없었으면 가운데」`, noop.length === 0, noop.slice(0, 4).join(' · ') || '항진명제 아님')
  }
  {
    // 사용자가 직접 짚은 네 칸(서식 2.1 임무). 규칙이 바뀌어도 이 결론은 남아야 한다
    const s = sheetManifest('2.1 자위소방대 일반현황')
    const want = ['총괄지휘 및 감독', '초기화재 진압활동', '피난유도 및 피난보조활동', '인명구조 및 응급조치']
    const refs = want.map(t => Object.entries(s.labels).find(([, v]) => v.trim() === t)?.[0])
    check(`2.1 임무 네 칸을 라벨로 찾았다(좌표 밀림 가드)`, refs.every(Boolean), refs.join(','))
    const p = new Set(s.proseColumnCells)
    check(`2.1 임무 네 칸 전건 좌정렬`, refs.every(r => !!r && p.has(r)),
      refs.map((r, i) => `${want[i]}=${r}${r && p.has(r) ? '✓' : '✗'}`).join(' · '))
    // 형제 세 칸은 ⑤(긴 문장)가 이미 좌로 보낸다 — 한 열이 통째로 왼쪽에서 시작하는지를 본다
    const col = refs[0]!.replace(/\d+$/, '')
    const sibs = Object.keys(s.labels).filter(r => r.startsWith(col) && /^\D+2[1-7]$/.test(r))
    check(`2.1 임무 열 7칸이 한 정렬로 모였다`, sibs.length === 7
      && sibs.every(r => p.has(r) || classifyAlign(s.labels[r]) === 'left'), `${sibs.length}칸 ${sibs.join(',')}`)
  }
}

/* ══════════ [9] 기하 축 — 「한 줄인가」·「좌우가 같은가」(사용자 지적 image-28·29) ══════════
 *
 *  🚨 정렬 검사(=[8])는 이 결함을 **전혀 못 본다**. 글자도 정렬도 옳은데 칸이 한 칸 좁아
 *    접히는 부류라, 묻는 축이 「폭 대 글자」여야 한다. 자는 빌드가 행 높이를 늘릴 때 쓰는 것과
 *    같은 추정기(`measureLines`)다 — 두 벌을 두면 한쪽만 낡는다.
 *  ⚠ 빌드 게이트에도 같은 단언이 있지만 여기에도 둔다: 게이트는 «자산을 만들 때»만 돌고,
 *    이 검사는 «저장소에 있는 자산»을 본다(남이 옛 자산을 되돌려 놓아도 여기서 붉어진다).
 */
{
  console.log('\n[9] 기하 축 — 서식 2.1 한 줄 · 평일/휴일 대칭')
  const s = sheetManifest('2.1 자위소방대 일반현황')
  const zip = await JSZip.loadAsync(bytes)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relTarget = new Map<string, string>()
  for (const m of relXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget.set(m[1], m[2])
  let path = ''
  for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    if (m[1].replace(/&amp;/g, '&') === s.name) path = `xl/${relTarget.get(m[2])}`
  }
  const xml = await zip.file(path)!.async('string')
  const colNum = (r: string) => [...(/^[A-Z]+/.exec(r)![0])].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1
  const span = new Map<string, number>()
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) span.set(m[1], colNum(m[2]) - colNum(m[1]) + 1)
  const colW = Number(/<col [^>]*width="([\d.]+)"/.exec(xml)?.[1] ?? 0)
  check('열 폭을 읽었다(눈멂 가드)', colW > 0, `${colW}`)

  const at = (text: string) => Object.entries(s.labels).find(([, v]) => v.trim() === text)?.[0]
  /** 그 글자가 든 칸이 **한 줄인가** — 좌표가 아니라 법정 자구로 찾는다(좌표는 밀린다) */
  const oneLine = (text: string) => {
    const ref = at(text)
    if (!ref) return { ok: false, d: `'${text}' 라벨을 못 찾았다` }
    const cols = span.get(ref) ?? 1
    const lines = measureLines(s.labels[ref], cols, colW)
    return { ok: lines === 1, d: `${ref} ${cols}칸 ${lines}줄` }
  }
  for (const t of ['□ 비상연락팀', '□ 초기소화팀', '□ 피난유도팀', '□ 응급구조팀', '□ 방호안전팀',
    '□ 평일', '□ 휴일', '□ 상근직']) {
    const r = oneLine(t)
    check(`2.1 「${t}」 한 줄`, r.ok, r.d)
  }
  /* 「주간」·「야간」은 평일·휴일 **양쪽에 같은 글자**가 있다 — 라벨 검색이 첫 칸만 주므로
   * 여기서는 그 둘을 짝으로 집어 **폭이 같은지**까지 본다(사용자 지시가 「오른쪽과 동일하게」였다). */
  for (const word of ['주간', '야간']) {
    const refs = Object.entries(s.labels).filter(([, v]) => v.trim() === `□ ${word}`).map(([r]) => r)
    check(`2.1 「□ ${word}」이 평일·휴일 두 칸`, refs.length === 2, refs.join(','))
    const widths = refs.map(r => span.get(r) ?? 1)
    check(`2.1 「□ ${word}」 평일 == 휴일 폭`, widths.length === 2 && widths[0] === widths[1],
      refs.map((r, i) => `${r}=${widths[i]}칸`).join(' · '))
    check(`2.1 「□ ${word}」 두 칸 다 한 줄`,
      refs.every(r => measureLines(s.labels[r], span.get(r) ?? 1, colW) === 1),
      refs.map(r => `${r}:${measureLines(s.labels[r], span.get(r) ?? 1, colW)}줄`).join(' · '))
  }
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
