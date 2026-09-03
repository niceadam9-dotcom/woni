// 156 무조건 hard delete 실측 (스테이징) — 이력 있는 합성 고객이 RPC 한 번에 전멸하는가
// 심는 축: RESTRICT 직계(inspections·bills·buildings) + RESTRICT 손자(inspection_reports)
//          + CASCADE(customer_contacts·fire_plans·inspection_steps 자동 7행) + SET NULL축(mobile_documents)
// 실행: node scripts/_probe-156-staging.mjs   (토큰: %TEMP%/sbtok.txt 관례)
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const STAGING = 'nwflnzugwylhpdyodyog'
const CUST = 'eeeeeeee-dead-4bee-8000-000000000156'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json() }
}

const COUNTS = `SELECT
  (SELECT count(*) FROM customers          WHERE id = '${CUST}')          AS customers,
  (SELECT count(*) FROM customer_contacts  WHERE customer_id = '${CUST}') AS contacts,
  (SELECT count(*) FROM buildings          WHERE customer_id = '${CUST}') AS buildings,
  (SELECT count(*) FROM inspections        WHERE customer_id = '${CUST}') AS inspections,
  (SELECT count(*) FROM inspection_steps s JOIN inspections i ON i.id = s.inspection_id
     WHERE i.customer_id = '${CUST}')                                     AS steps,
  (SELECT count(*) FROM inspection_reports r JOIN inspections i ON i.id = r.inspection_id
     WHERE i.customer_id = '${CUST}')                                     AS reports,
  (SELECT count(*) FROM bills              WHERE customer_id = '${CUST}') AS bills,
  (SELECT count(*) FROM fire_plans         WHERE customer_id = '${CUST}') AS fire_plans,
  (SELECT count(*) FROM mobile_documents   WHERE customer_id = '${CUST}'
     OR title = 'PROBE156-MDOC')                                          AS mobile_docs`

// 1) 시드 — 한 DO 블록(원자적). enum은 이름을 박지 않고 enum_range로 뽑는다(ASCII 유지).
const seed = await q(`DO $seed$
DECLARE
  v_prof uuid;
  v_cust uuid := '${CUST}';
  v_bldg uuid := 'eeeeeeee-dead-4bee-8000-000000000157';
  v_insp uuid := 'eeeeeeee-dead-4bee-8000-000000000158';
BEGIN
  SELECT id INTO v_prof FROM profiles LIMIT 1;
  INSERT INTO customers (id, customer_code, customer_name, contract_date, inspection_type, created_by)
  VALUES (v_cust, 'ZZPROBE156', 'PROBE156-HARDDEL', CURRENT_DATE, (enum_range(NULL::inspection_type))[1], v_prof);
  INSERT INTO customer_contacts (customer_id, role, name)
  VALUES (v_cust, (enum_range(NULL::contact_role))[1], 'PROBE156-CONTACT');
  INSERT INTO buildings (id, customer_id, building_name, created_by)
  VALUES (v_bldg, v_cust, 'PROBE156-BLDG', v_prof);
  INSERT INTO inspections (id, customer_id, assigned_employee_id, inspection_type, inspection_start_date, created_by)
  VALUES (v_insp, v_cust, v_prof, (enum_range(NULL::inspection_type))[1], CURRENT_DATE, v_prof);
  INSERT INTO inspection_reports (inspection_id, report_type, customer_code, customer_name)
  VALUES (v_insp, (enum_range(NULL::report_type))[1], 'ZZPROBE156', 'PROBE156-HARDDEL');
  INSERT INTO bills (customer_id, billing_month, bill_date, created_by)
  VALUES (v_cust, '2026.09', CURRENT_DATE, v_prof);
  INSERT INTO fire_plans (customer_id, year, pdf_name, pdf_path)
  VALUES (v_cust, 2026, 'probe.pdf', v_cust::text || '/probe.pdf');
  INSERT INTO mobile_documents (employee_id, customer_id, doc_type, doc_date, title)
  VALUES (v_prof, v_cust, 'work_record', CURRENT_DATE, 'PROBE156-MDOC');
END $seed$;`)
console.log('seed:', seed.status, JSON.stringify(seed.body).slice(0, 300))

const before = await q(COUNTS)
console.log('before:', JSON.stringify(before.body))

// 2) 삭제 — 운영 코드와 같은 진입점(RPC 함수)
const del = await q(`SELECT hard_delete_customer('${CUST}')::text AS result`)
console.log('delete:', del.status, JSON.stringify(del.body))

// 3) 전멸 실측
const after = await q(COUNTS)
console.log('after:', JSON.stringify(after.body))

const a = Array.isArray(after.body) ? after.body[0] : null
const allZero = a && Object.values(a).every(v => Number(v) === 0)
console.log(allZero ? 'PASS: all rows gone (incl. RESTRICT chain + SET-NULL axis)' : 'FAIL: leftovers remain')
if (!allZero) process.exitCode = 1
