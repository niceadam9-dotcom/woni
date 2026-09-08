/** 다중이용업소 **입력 단일화** 실데이터 확인 — 소방계획서_22 S14-5 ①.
 *
 *  합격선 문면: "입력 화면 다중이용업소 시트 **1개**(STD-32)". 2026-08-20 재판정이
 *  "실데이터 검증이 한 번도 안 됐다"로 남겨 둔 자리다 — 당시 스테이징에 STD-32 응답이 0건이고
 *  multiUse 고객 1명은 레거시 MU 응답을 갖고 있어 시트가 2개였다(그 건은 보존 분기라 **정상**).
 *
 *  왜 순수 검증이 안 되나: `buildSheetOverviews`가 admin 클라이언트를 받아 DB에서 직접 읽는다.
 *  그래서 **자기 픽스처를 만들고 지운다**(test-hard-delete-race와 같은 형태). 기존 데이터는
 *  건드리지 않는다 — 이름에 MARK가 들어가고 finally에서 cleanupCustomer로 정리한다.
 *
 *  판정 지점 3곳(sheet-overview.ts):
 *    :203  multiUse = isMultiUseApplicable(mu) **AND** categories에 빈칸 아닌 값 ≥1
 *    :225  STD-32는 설비 맵 미등재라 multiUse일 때만 installed 취급(노출 예외)
 *    :267  multiUse면 MU-01은 **응답이 하나도 없을 때만** 숨긴다(레거시 보존)
 *
 *  네 경우를 나란히 돌린다. B가 없으면 A의 '1개'가 공허하다 — 어떤 이유로든 MU-01이 늘
 *  사라지는 상태여도 A는 초록이기 때문이다. B는 "숨김이 조건부"임을 증명하는 대조군이다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-mu-single-sheet.mts */
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer } from './_e2e-helpers.mjs'
import { buildSheetOverviews } from '../src/lib/sheet-overview.ts'
import { deriveMuFromStd32, MU_STD32_MAP } from '../src/lib/mu-std32-map.ts'

const MARK = 'mu1sheet'
const created: string[] = []
let userId = ''

const kst = (days: number) => {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** 고객 + (선택)1.10.3 다중이용업 + 점검 1건. 반환: 점검 id */
async function fixture(tag: string, opts: {
  applicable?: boolean
  categories?: Record<string, string>
  std32?: Record<string, 'O' | 'X' | 'N'>
  legacyMu?: Record<string, 'O' | 'X' | 'N'>
}): Promise<string> {
  const cust = await mkCustomer({ customer_name: `${MARK}-${tag}`, address: `ZZ ${MARK} ${tag}`, created_by: userId })
  created.push(cust)

  if (opts.applicable !== undefined) {
    const { error } = await raw.from('fire_plan_forms').insert({
      customer_id: cust,
      sections: { multiUse: { applicable: opts.applicable, categories: opts.categories ?? {} } },
    })
    if (error) throw new Error(`서식 생성 실패(${tag}): ${error.message}`)
  }

  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: cust, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kst(-1), inspection_end_date: kst(-1),
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패(${tag}): ${iErr.message}`)
  const id = (insp as { id: string }).id

  const rows = [
    ...Object.entries(opts.std32 ?? {}), ...Object.entries(opts.legacyMu ?? {}),
  ].map(([item_code, result]) => ({ inspection_id: id, item_code, result }))
  if (rows.length) {
    const { error } = await raw.from('inspection_sheet_responses').insert(rows)
    if (error) throw new Error(`응답 삽입 실패(${tag}): ${error.message}`)
  }
  return id
}

/** 그 점검의 **다중이용 관련 시트**만 뽑는다(STD-32 · MU-01) */
async function muSheetsOf(inspectionId: string) {
  const { overviews, error } = await buildSheetOverviews(
    raw as never, [inspectionId], { id: userId, role: 'admin' }, { withGroups: false })
  if (error) throw new Error(`overview 실패: ${error}`)
  const ov = overviews[inspectionId]
  if (!ov) throw new Error('overview 없음')
  const all = ov.sheets as Array<{ sheetCode: string; installed?: boolean; total: number }>
  return {
    ov,
    codes: all.map(s => s.sheetCode),
    mu: all.filter(s => s.sheetCode === 'STD-32' || s.sheetCode === 'MU-01'),
  }
}

/** STD-32 표본 — 서로 다른 MU 칸으로 굴러가는 3개(매핑이 실제로 갈라지는지까지 본다) */
const STD32_SAMPLE: Record<string, 'O' | 'X' | 'N'> = {
  '32-A-001': 'O',   // → MU-001
  '32-B-011': 'N',   // → MU-004
  '32-G-001': 'X',   // → MU-016
}

try {
  userId = await mkUser({ email: `${MARK}@erp-test.com`, name: '다중이용단일화', employeeId: 'MU-1S' })

  // ── A. 합격선 — multiUse이고 레거시 MU 응답이 없다 → 다중이용 시트 정확히 1개 ──────
  {
    const id = await fixture('a', { applicable: true, categories: { c1: '일반음식점' }, std32: STD32_SAMPLE })
    const { mu, codes } = await muSheetsOf(id)
    console.log(`   A 시트: ${codes.join(', ') || '(없음)'}`)
    check('A [합격선] 다중이용 시트가 정확히 1개다', mu.length === 1,
      `${mu.length}개 — ${mu.map(s => s.sheetCode).join(', ')}`)
    check('A2 그 1개가 STD-32다', mu[0]?.sheetCode === 'STD-32', mu[0]?.sheetCode ?? '(없음)')
    check('A3 MU-01은 목록에 아예 없다(행 자체 제거)', !codes.includes('MU-01'))
    check('A4 STD-32가 설치 축으로 잡힌다(노출 예외 :225)',
      (mu[0] as { installed?: boolean })?.installed === true,
      `installed=${(mu[0] as { installed?: boolean })?.installed}`)
  }

  // ── B. 대조군 — 레거시 MU 응답이 있으면 MU-01이 **살아남는다** ────────────────────
  //   A의 '1개'가 "MU-01이 늘 사라져서" 나온 값이 아님을 증명한다.
  {
    const id = await fixture('b', {
      applicable: true, categories: { c1: '일반음식점' },
      std32: STD32_SAMPLE, legacyMu: { 'MU-001': 'O', 'MU-003': 'X' },
    })
    const { mu, codes } = await muSheetsOf(id)
    console.log(`   B 시트: ${codes.join(', ') || '(없음)'}`)
    check('B [대조군] 레거시 MU 응답이 있으면 MU-01이 보존된다 → 시트 2개', mu.length === 2,
      `${mu.length}개 — ${mu.map(s => s.sheetCode).join(', ')}. 1개면 숨김이 무조건이라는 뜻이고, 그러면 A는 공허하다`)
  }

  // ── C. 반대 방향 — 다중이용업이 아니면 STD-32가 설치 축에서 빠진다 ─────────────────
  {
    const id = await fixture('c', { applicable: false, categories: {}, std32: STD32_SAMPLE })
    const { mu } = await muSheetsOf(id)
    const std = mu.find(s => s.sheetCode === 'STD-32') as { installed?: boolean } | undefined
    check('C [반대] 비대상이면 STD-32가 installed로 잡히지 않는다', std?.installed !== true,
      `installed=${std?.installed} — 참이면 모든 고객에게 다중이용 시트가 열린다`)
  }

  // ── D. 경계 — applicable만 켜고 업종이 비면 multiUse가 아니다(:203의 AND 조건) ─────
  {
    const id = await fixture('d', { applicable: true, categories: { c1: '   ' }, std32: STD32_SAMPLE })
    const { mu } = await muSheetsOf(id)
    const std = mu.find(s => s.sheetCode === 'STD-32') as { installed?: boolean } | undefined
    check('D [경계] applicable=true라도 업종이 전부 공백이면 대상이 아니다', std?.installed !== true,
      `installed=${std?.installed} — 참이면 :203의 '업종 ≥1' 조건이 사라진 것`)
  }

  // ── E. ② 파생 — 내가 실제로 넣은 STD-32 응답이 MU 칸으로 굴러가는가(순수) ──────────
  {
    const derived = deriveMuFromStd32(code => STD32_SAMPLE[code] ?? null)
    check('E MU-001←O · MU-004←N · MU-016←X 로 파생된다',
      derived['MU-001'] === 'O' && derived['MU-004'] === 'N' && derived['MU-016'] === 'X',
      JSON.stringify(derived))
    check('E2 응답이 없는 칸은 키를 만들지 않는다(공란 유지)',
      Object.keys(derived).length === 3, `${Object.keys(derived).length}칸 — ${Object.keys(derived).join(',')}`)
    check('E3 표본이 서로 다른 칸을 건드렸다(검사가 한 칸만 보고 있지 않다)',
      new Set(Object.keys(MU_STD32_MAP).filter(k => derived[k])).size === 3)
  }
} catch (e) {
  check('예외 없이 완주', false, String((e as Error)?.stack ?? e))
} finally {
  for (const id of created) await cleanupCustomer(id)
  const { count } = await raw.from('customers').select('*', { count: 'exact', head: true }).like('customer_name', `${MARK}%`)
  check('정리 완료(검사 잔재 0건)', (count ?? 0) === 0, `${count}건 남음`)
  if (userId) await delUser(userId)
  summary()
}
