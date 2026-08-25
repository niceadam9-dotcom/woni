/** 단계 [입력] 진입 링크 + `?sheet=auto` 자동 오픈 — 프로브
 *
 *  배경: 6단계는 증거가 등록되면 자동 완료되는데(inspection-step-status.ts evidenceDone),
 *  화면에는 강제 완료(사유) 버튼만 있고 증거를 남기러 갈 링크가 없었다. 그 경로를 이었다.
 *
 *  1부: 순수 함수 단언(stepInputLink·pickAutoOpenSheet) — DB 불필요
 *  2부: 소스 배선 확인 — 순수 함수가 맞아도 화면에 연결이 안 돼 있으면 사용자에겐 없는 기능이다
 *       (_probe-c1-blocks.mjs 관례: 주석 아닌 코드에 배선이 실제로 있는지 정규식으로 단언)
 *
 *  실행: npx tsx scripts/test-step-input-link.mts
 *  (src named import가 깨지므로 default import + 캐스트 — test-inspection-steps-sync.mts 관례) */
import { readFileSync } from 'node:fs'
import linkMod from '../src/lib/inspection-step-links.ts'

const { stepInputLink, pickAutoOpenSheet } =
  linkMod as unknown as typeof import('../src/lib/inspection-step-links.ts')

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
/** 주석을 걷어낸 코드 — 주석에 적힌 문구가 배선으로 오판되지 않게 (_probe-c1-blocks 관례) */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ID = '11111111-2222-3333-4444-555555555555'

console.log('— 1부 stepInputLink (단계별 정상 경로)')
{
  const s1 = stepInputLink(ID, 1)
  ok('① 점검표 입력 링크가 있다', s1 !== null)
  // 입력의 정본은 /inspections/{id}/sheet (소방계획서_28 S1) — 종전 상세 드로어(?step=1&sheet=auto)에서 이관
  ok('① 입력 전용 페이지 + sheet=auto로 보낸다',
    s1?.href === `/inspections/${ID}/sheet?sheet=auto`, s1?.href)
  ok('① 옛 목적지(점검 상세 드로어)로는 더 이상 보내지 않는다',
    !/\?step=1&sheet=auto$/.test(s1?.href ?? ''), s1?.href)
  ok('① 라벨은 "점검표 입력"', s1?.label === '점검표 입력', s1?.label)

  const s5 = stepInputLink(ID, 5)
  ok('⑤ 불량 조치 링크가 있다', s5 !== null)
  ok('⑤ step=5 + #defects 앵커 — step 없이 앵커만 주면 그 칸이 렌더되지 않는다',
    s5?.href === `/inspections/${ID}?step=5#defects`, s5?.href)

  // 목적지를 확정하지 못한 단계는 **침묵**한다 — 추측 링크는 링크 없음보다 나쁘다
  for (const n of [2, 3, 4, 6]) {
    ok(`${n}단계는 1차 범위 밖이라 null(버튼 미표시)`, stepInputLink(ID, n) === null)
  }
  ok('범위 밖 단계 번호(0·7)도 null', stepInputLink(ID, 0) === null && stepInputLink(ID, 7) === null)
}

console.log('— 2부 pickAutoOpenSheet (첫 미완성 시트 고르기)')
{
  const S = (id: string, responded: number, total: number, installed = true) =>
    ({ sheetId: id, responded, total, installed })

  ok('전부 미입력이면 첫 시트',
    pickAutoOpenSheet([S('a', 0, 10), S('b', 0, 5)])?.sheetId === 'a')
  ok('앞 시트가 다 찼으면 다음 미완성 시트',
    pickAutoOpenSheet([S('a', 10, 10), S('b', 3, 5)])?.sheetId === 'b')
  ok('부분 입력도 미완성으로 본다',
    pickAutoOpenSheet([S('a', 9, 10)])?.sheetId === 'a')

  // 사용자 결정 2 — 다 채운 사람에게 드로어를 던지지 않는다
  ok('전부 완료면 null (드로어를 열지 않는다)',
    pickAutoOpenSheet([S('a', 10, 10), S('b', 5, 5)]) === null)
  ok('시트가 하나도 없으면 null', pickAutoOpenSheet([]) === null)
  ok('분모 0 시트는 건너뛴다(항목 없는 시트에서 빈 드로어가 뜨면 안 된다)',
    pickAutoOpenSheet([S('a', 0, 0), S('b', 0, 4)])?.sheetId === 'b')

  // 보드(SheetGroupBoard) 기본 필터와 같아야 — 화면에 안 보이는 시트가 열리면 '첫 미완성'이 어긋난다
  ok('미설치·무응답 시트는 건너뛴다(보드에 안 보이는 시트)',
    pickAutoOpenSheet([S('a', 0, 10, false), S('b', 0, 5, true)])?.sheetId === 'b')
  ok('미설치라도 입력이 이미 있으면 후보 — 보드도 responded>0이면 보여준다',
    pickAutoOpenSheet([S('a', 2, 10, false), S('b', 0, 5, true)])?.sheetId === 'a')
  ok('설치 정보가 아예 없는 고객(Q-12)은 필터를 풀고 첫 미완성',
    pickAutoOpenSheet([S('a', 0, 10, false), S('b', 0, 5, false)])?.sheetId === 'a')
}

console.log('— 3부 배선 (순수 함수가 맞아도 연결이 없으면 없는 기능이다)')
{
  // ① 링크의 새 목적지 — 신설 입력 페이지가 `?sheet=auto`를 같은 함수로 푸는지(의미 보존)
  const sheetPage = code('app/(dashboard)/inspections/[id]/sheet/page.tsx')
  ok('입력 전용 페이지가 sheet=auto를 pickAutoOpenSheet로 푼다',
    /sheetParam === 'auto'/.test(sheetPage) && /pickAutoOpenSheet\(shown\)/.test(sheetPage))
  ok('입력 전용 페이지가 initialSheetId를 클라이언트에 넘긴다', /initialSheetId=\{initialSheetId\}/.test(sheetPage))

  // 점검 상세의 ?sheet=auto는 그대로 남는다 — 옛 링크·북마크가 썩지 않아야 한다(회귀 방지)
  const page = code('app/(dashboard)/inspections/[id]/page.tsx')
  ok('page.tsx가 searchParams를 받는다', /searchParams\??:\s*Promise</.test(page))
  ok('page.tsx가 step을 1~6으로 검증한다', /stepParam\s*>=\s*1\s*&&\s*stepParam\s*<=\s*6/.test(page))
  ok('page.tsx가 initialStepNum을 작업대에 넘긴다', /initialStepNum=\{initialStepNum\}/.test(page))
  ok('page.tsx가 autoOpenSheet를 점검표에 넘긴다', /autoOpenSheet=\{autoOpenSheet\}/.test(page))

  const wb = code('components/inspections/inspection-workbench.tsx')
  ok('작업대가 딥링크 단계를 초기 선택에 반영', /useState<StepKey>\(\(\)\s*=>\s*linkedStep\s*\?\?/.test(wb))
  ok('딥링크 단계는 activeSteps 안에서만 인정(해당없음 칸 빈 화면 방지)',
    /activeSteps\.find\(k\s*=>\s*STEP_NUM\[k\]\s*===\s*initialStepNum\)/.test(wb))

  const sc = code('components/inspections/inspection-sheet-client.tsx')
  ok('점검표가 pickAutoOpenSheet로 대상을 고른다', /pickAutoOpenSheet\(list\)/.test(sc))
  ok('자동 오픈이 requestOpen(=dirty 게이트 경유)을 쓴다 — doOpen 직접 호출 금지',
    /if\s*\(target\)\s*requestOpen\(target\.sheetId/.test(sc))
  ok('자동 오픈은 1회만(ref 가드)', /autoOpenedRef\.current\s*=\s*true/.test(sc))

  const cal = code('components/inspections/inspection-calendar-client.tsx')
  ok('달력 패널이 stepInputLink를 쓴다', /stepInputLink\(selectedInspection\.id,\s*step\.step_num\)/.test(cal))
  ok('달력 패널 강제완료 라벨이 "사유 완료"', /사유 완료/.test(cal))
  ok('달력 패널에 옛 단독 라벨 "완료"만 남은 버튼이 없다', !/>\s*\n\s*완료\s*\n\s*<\/button>/.test(cal))
  // R4-4: 서버는 순서 강제를 폐지했다 — [입력]까지 현재 단계에 묶으면 뒤 단계 정상 경로가 막힌다
  ok('[입력]은 isCurrentStep이 아니라 미완료 여부로만 노출',
    /const inputLink = step\.status !== 'completed'\s*\?\s*stepInputLink\(/.test(cal))

  const panel = code('components/inspection-plans/plan-item-slide-panel.tsx')
  ok('계획 슬라이드 패널도 stepInputLink를 쓴다', /stepInputLink\(item\.inspection_id,\s*step\.step_num\)/.test(panel))
  ok('계획 패널 강제완료 라벨도 "사유 완료"', /사유 완료/.test(panel))
  ok('계획 패널 [입력]도 순서 강제와 분리(!done 기준)',
    /const inputLink = !done && item\.inspection_id/.test(panel))
}

console.log('— 4부 별지 "미입력" 경고의 [고치기] 링크 (점검표 계열은 입력 전용 페이지로)')
{
  const aml = code('components/inspections/annex-missing-list.tsx')
  ok('annexFixHref가 inspectionId를 3번째 인자로 받는다',
    /export function annexFixHref\(item: string, customerId\?: string, inspectionId\?: string\)/.test(aml))
  ok('점검표 계열 목적지가 /inspections/{id}/sheet', /`\/inspections\/\$\{id\}\/sheet`/.test(aml))
  // 근거: report9-assemble.ts:522 / :513 / report9-actions.ts:380 의 missing.push 문구
  for (const m of ['설치 설비 중 점검표 무응답', '외관점검 시트 응답 없음']) {
    ok(`매칭 접두어 "${m}"가 점검 건 축으로 등재`,
      new RegExp(`match: '${m}', axis: 'inspection'`).test(aml))
  }
  ok("'점검표 응답'은 완전일치 — 대장 축 문구(:527·:537)를 삼키지 않는다",
    /match: '점검표 응답', exact: true, axis: 'inspection'/.test(aml))
  // 규칙 행만 센다 — 타입 선언의 `axis: 'customer' | 'inspection'`이 부분일치로 끼어든다
  ok('고객 축 규칙 3건은 종전 그대로',
    (aml.match(/axis: 'customer', url:/g) ?? []).length === 3,
    String((aml.match(/axis: 'customer', url:/g) ?? []).length))
  ok('축에 맞는 id가 없으면 링크를 걸지 않는다(회귀 금지)',
    /const id = hit\.axis === 'inspection' \? inspectionId : customerId/.test(aml)
    && /return id \? hit\.url\(id\) : undefined/.test(aml))

  const wb2 = code('components/inspections/inspection-workbench.tsx')
  ok('작업대 미리보기 칩 2곳에 inspectionId 전달',
    (wb2.match(/<AnnexMissingChip missing=\{missing\} customerId=\{customerId\} inspectionId=\{inspectionId\}/g) ?? []).length === 2)
  const cp = code('components/inspections/annex-compose-panel.tsx')
  ok('작성 패널 목록에도 inspectionId 전달',
    /<AnnexMissingList missing=\{missing\} customerId=\{customerId\} inspectionId=\{inspectionId\}/.test(cp))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
