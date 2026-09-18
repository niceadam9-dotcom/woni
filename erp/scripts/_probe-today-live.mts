/** 2026-09-18 배선분 통합 실서버 실측 — 1.11.2 · 1.11.4뒷쪽 · 1.15 · 2.5를 한 번에
 *
 *  오프라인 증명(test-fire-plan-preview)은 조립·주입·되읽기를 덮지만 라우트엔 권한·템플릿
 *  캐시·체크박스·사진이 더 얹혀 있다. **받은 파일이 곧 사용자가 받는 것**이다.
 *  데이터를 심고 → 엑셀을 받고 → 네 시트를 되읽고 → **원상복구**한다(실고객 오염 금지).
 *
 *  실행: npx tsx scripts/_probe-today-live.mts   (localhost:3000 — 워크트리 프로덕션 서버)
 */
import JSZip from 'jszip'
import { launch, login, raw, mkUser, delUser } from './_e2e-helpers.mjs'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { TRAIN2_SHEET, REC1114_SHEET, FIRE115_SHEET, CMD25_SHEET, CMD25_PLACE_CELL } from '../src/lib/fire-plan-anchors.ts'
import { labelAt } from '../src/lib/fire-plan-xlsx-manifest.ts'

const BASE = 'http://localhost:3000'
const EMAIL = 'e2e-today-live@test.local'
let ctx: Awaited<ReturnType<typeof launch>> | null = null
let userId: string | null = null
let customerId = ''
let backup: Record<string, unknown> | null = null
let ok = true

const sectionsOf = async () => {
  const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  return (data?.sections ?? {}) as Record<string, unknown>
}
const check = (name: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : '🚨 FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!pass) ok = false
}

try {
  const { data: cust } = await raw.from('customers').select('id, customer_name').eq('is_active', true).limit(1).single()
  if (!cust) { console.error('🚨 스테이징에 고객이 없다'); process.exit(1) }
  customerId = cust.id as string
  console.log(`대상 고객: ${cust.customer_name} (${customerId})`)

  backup = await sectionsOf()
  const kitchen = labelAt(CMD25_SHEET, CMD25_PLACE_CELL).trim()
  /* 🚨 **저장 형식 ≠ 조립 결과 형식.** hazards는 화면이 `{place, loc, risks}`로 저장하고
   *   조립기가 `{place, location, factors}`로 갈아 끼운다(risks 어휘도 짧은 말이다 —
   *   `전기`·`부주의`). 조립 결과 모양을 심었다가 `normHazardFactors(undefined)`가 터져
   *   500을 만났다(`_probe-500-repro`가 축을 갈라 규명 — 제품 결함이 아니라 픽스처 오류). */
  const seeded = {
    ...backup,
    hazards: [{ place: '전기실', loc: '1층', risks: ['화학'] },
      { place: kitchen, loc: '지하 1층', risks: ['전기', '부주의'] }],
    fireHistory: [{ kind: '비화재보', at: '2026-07-01', place: 'X', cause: 'Y', action: 'Z' },
      { kind: '화재', at: '2026-02-11', place: '__LIVE_PLACE__', cause: '__LIVE_CAUSE__', action: 'A' }],
    training: {
      eduMonths: [3], drillMonths: [9], scenario: '__LIVE_SCENARIO__',
      details: [{ name: '__LIVE_NAME__', at: '2026-05-20', place: '__LIVE_WHERE__', target: '자위소방대 및 근무자',
        kindPractice: '부분', kindTheory: '강의', formType: '합동', formPartner: '소방서',
        materials: '__LIVE_MAT__', plan: '__LIVE_PLAN__' }],
      records: [{ at: '2026-04-02', kind: '교육', attendees: '25', content: '__LIVE_EDU__', evaluation: '__LIVE_EVAL__' }],
    },
  }
  await raw.from('fire_plan_forms').update({ sections: seeded }).eq('customer_id', customerId)

  userId = await mkUser({ email: EMAIL, name: '통합실측E2E', employeeId: 'E2E-TODAY' })
  ctx = await launch()
  await login(ctx.page, EMAIL)

  const res = await ctx.page.request.get(`${BASE}/customers/${customerId}/fire-plan/xlsx`)
  console.log(`\nxlsx HTTP ${res.status()}`)
  /* 🚨 `process.exit`를 쓰지 않는다 — finally(원상복구)를 건너뛰어 **실고객을 오염시킨다**.
   *   2026-09-18 이 프로브의 첫 실행이 정확히 그래서 감상골의 세 축을 남겼다. */
  if (!res.ok()) { throw new Error(`라우트 ${res.status()}: ${(await res.text()).slice(0, 200)}`) }
  const notice = res.headers()['x-fireplan-missing']
  if (notice) console.log(`고지: ${decodeURIComponent(notice).slice(0, 240)}`)
  const zip = await JSZip.loadAsync(new Uint8Array(await res.body()))
  const grid = async (s: string) => {
    const g = await readSheetGrid(zip, s)
    return (r: string) => g.cells.find(x => x.ref === r)?.text ?? ''
  }

  console.log('\n[1.11.2 세부계획]')
  const t2 = await grid(TRAIN2_SHEET)
  check('일시·장소·시나리오', t2('I5') === '2026-05-20' && t2('I6') === '__LIVE_WHERE__'
    && t2('I13') === '__LIVE_SCENARIO__', `${t2('I5')}/${t2('I6')}/${t2('I13')}`)
  check('예시문칸 3 덮임', t2('I4') === '__LIVE_NAME__' && t2('I14') === '__LIVE_MAT__' && t2('I15') === '__LIVE_PLAN__')
  check('상자: 대상 2·부분·강의·합동', t2('I7').includes('■') && t2('V7').includes('■')
    && !t2('AI7').includes('■') && t2('AE8').includes('■') && t2('R9').includes('■') && t2('V12').includes('■'))

  console.log('\n[1.11.4 뒷쪽 교육결과]')
  const r4 = await grid(REC1114_SHEET)
  check('일시·참석·내용·성과', r4('I3') === '2026-04-02' && r4('AI5').startsWith('25')
    && r4('I6') === '__LIVE_EDU__' && r4('I7') === '__LIVE_EVAL__', `${r4('I3')}/${r4('AI5')}`)

  console.log('\n[1.15 화재발생개요]')
  const f5 = await grid(FIRE115_SHEET)
  check('최신 화재 건(비화재보 제외)', f5('R11') === '2026-02-11' && f5('R12') === '__LIVE_PLACE__'
    && f5('Z15') === '__LIVE_CAUSE__', `${f5('R11')}/${f5('R12')}`)
  check('가스안전공사 번호', f5('Z6') === '1544-4500', f5('Z6'))

  console.log(`\n[2.5 지휘통제팀 — ${kitchen} 블록]`)
  const c5 = await grid(CMD25_SHEET)
  check('전기적·부주의만 켜짐(전기실 요인 아님)', c5('L5').includes('■') && c5('L13').includes('■')
    && !c5('L8').includes('■'), `${c5('L5').slice(0, 2)}/${c5('L13').slice(0, 2)}/${c5('L8').slice(0, 2)}`)
  check('보일러 실외기 블록은 미체크', !c5('L16').includes('■') && !c5('L18').includes('■'))

  console.log(`\n${ok ? '✅ 오늘 배선 네 시트가 받은 파일에서 전부 확인됐다' : '🚨 실서버에서 갈라진 칸이 있다'}`)
  process.exitCode = ok ? 0 : 1
} finally {
  if (customerId && backup) {
    await raw.from('fire_plan_forms').update({ sections: backup }).eq('customer_id', customerId)
    const after = await sectionsOf()
    console.log(`원상복구: training=${JSON.stringify(after.training ?? null)?.slice(0, 40)} hazards=${(after.hazards as unknown[] | undefined)?.length ?? 0}건`)
  }
  if (userId) await delUser(userId)
  await ctx?.browser.close()
}
