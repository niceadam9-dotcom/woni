// D-8 후속 — 새로 넣은 !inner 임베드 4곳이 PGRST201로 죽지 않는지 실측한다.
//
// 왜 별도 축인가: FK가 여럿인 두 표 사이에 !inner + 중첩 필터를 걸면 PostgREST가 임베드를
// 모호하다고 거절한다(PGRST201). 이건 tsc·next build·마이그레이션 diff 어디에도 안 나오고
// **DB에 붙는 런타임에서만** 터진다 — 화면을 열어야 알 수 있는 종류의 실패라, 쿼리만 떼어
// 직접 쏴 본다. [[risk_postgrest_embed_ambiguity]]
//
// 또 하나: 필터가 걸렸는지도 함께 본다. .eq가 조용히 무시되면 0건이 아니라 '전건'이 되므로
// 에러 없음만으로는 통과가 아니다(비활성 고객이 섞여 나오면 실패로 센다).
//
// 실행: cmd /c "npx tsx scripts/_probe-d8-embeds.mts > _d8-embeds.txt 2>&1"
import { raw } from './_e2e-helpers.mjs'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  OK   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

/** 임베드 안의 is_active가 전부 true인지 — 필터가 실제로 걸렸는지 확인 */
function allActive(rows: any[], pick: (r: any) => any): boolean {
  return rows.every(r => pick(r)?.is_active === true)
}

async function main() {
  console.log('=== D-8 !inner 임베드 런타임 실측 (PGRST201 + 필터 실효) ===\n')

  // ① 대시보드 — 점검보고서 제출대기 (2단 중첩 임베드)
  {
    const { data, error } = await raw
      .from('inspection_report_status')
      .select(`id, notification_due_date,
        inspection_plan_items:plan_item_id!inner (
          scheduled_date, customers:customer_id!inner ( customer_name, is_active ) )`)
      .eq('inspection_plan_items.customers.is_active', true)
      .eq('fire_station_submitted', false)
      .not('inspection_completed_at', 'is', null)
      .limit(5)
    check('① inspection_report_status 2단 !inner — 에러 없음', !error, `${error?.code} ${error?.message}`)
    if (!error) check('① 필터 실효 (임베드 전건 활성)',
      allActive(data ?? [], (r: any) => r.inspection_plan_items?.customers), `${data?.length}행`)
  }

  // ② 대시보드 — 이행계획 제출대기 (2단 중첩 임베드)
  {
    const { data, error } = await raw
      .from('action_plans')
      .select(`id, completion_target_date,
        inspections:inspection_id!inner (
          inspection_start_date, customers:customer_id!inner ( customer_name, is_active ) )`)
      .eq('inspections.customers.is_active', true)
      .is('submitted_at', null)
      .limit(5)
    check('② action_plans 2단 !inner — 에러 없음', !error, `${error?.code} ${error?.message}`)
    if (!error) check('② 필터 실효 (임베드 전건 활성)',
      allActive(data ?? [], (r: any) => r.inspections?.customers), `${data?.length}행`)
  }

  // ③ 점검확정 — 계획 항목 (customers·profiles 두 임베드 동시)
  {
    const { data, error } = await raw
      .from('inspection_plan_items')
      .select(`*, customers:customer_id!inner (customer_name, customer_code, is_active), profiles:assigned_employee_id (name)`)
      .eq('customers.is_active', true)
      .limit(5)
    check('③ inspection_plan_items !inner — 에러 없음', !error, `${error?.code} ${error?.message}`)
    if (!error) check('③ 필터 실효 (임베드 전건 활성)',
      allActive(data ?? [], (r: any) => r.customers), `${data?.length}행`)
  }

  // ④ 문자 발송 — 발송 이력 축 B
  {
    const { data, error } = await raw
      .from('sms_send_log')
      .select('id, kind, customer_id, visit_date, customers:customer_id!inner ( customer_name, address, region_si, region_myeon, region_ri, is_active )')
      .eq('customers.is_active', true)
      .limit(5)
    check('④ sms_send_log !inner — 에러 없음', !error, `${error?.code} ${error?.message}`)
    if (!error) check('④ 필터 실효 (임베드 전건 활성)',
      allActive(data ?? [], (r: any) => r.customers), `${data?.length}행`)
  }

  // ⑤ 대조군 — 필터를 빼면 비활성이 실제로 섞여 나오는가.
  //    이게 0이면 위 검사들은 '비활성 데이터가 없어서' 통과한 항진명제다.
  {
    const { count: inactive } = await raw.from('customers')
      .select('id', { count: 'exact', head: true }).eq('is_active', false)
    console.log(`\n  [대조군] 스테이징 비활성 고객 = ${inactive ?? 0}명`)
    if (!inactive) {
      console.log('  ⚠ 비활성 고객이 0명이라 위 "필터 실효" 검사는 항진명제다 — 판정 근거로 쓰지 말 것')
    }
    const { data: leak } = await raw.from('inspection_plan_items')
      .select('id, customers:customer_id!inner (is_active)')
      .eq('customers.is_active', false).limit(3)
    console.log(`  [대조군] 필터 반전 시 비활성 계획 항목 = ${(leak ?? []).length}건 (>0이면 검사가 유효)`)
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('중단:', e); process.exit(1) })
