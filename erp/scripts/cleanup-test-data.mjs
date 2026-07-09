// 운영 개시 직전 테스트·Mock 데이터 정리 (배포순서.md '5단계 정리 체크리스트')
//
// 기본은 dry-run: 삭제 대상 건수만 출력하고 아무것도 변경하지 않는다.
//   node scripts/cleanup-test-data.mjs                          ← dry-run (안전)
//   node scripts/cleanup-test-data.mjs --execute                ← 백업 후 실제 삭제
//   node scripts/cleanup-test-data.mjs --execute --skip=vehicles,partners
//
// 하는 일 (--execute):
//  1) 삭제 대상 전 테이블을 scripts/backup/cleanup-backup-<시각>.json 으로 백업
//  2) FK 순서대로 거래·테스트 데이터 전량 삭제 (고객·점검·계획·전표·게시글·휴가 등)
//  3) @erp-test.com 계정 비활성화(is_active=false) + auth 로그인 차단(ban)
//
// 유지되는 것: profiles(실계정), departments, holidays, account_codes,
//   company_profile, board_categories, inspection_sheets(양식), activity_logs(감사·append-only)
//
// 주의:
//  - 실운영 데이터 입력 "전"에 1회만 실행할 것 (거래 테이블 전량 삭제 방식)
//  - Storage 버킷의 첨부파일 실물은 남는다 (경로는 백업 JSON에 보존됨)
//  - 삭제 후 검증: node F:/AI/ERP/victory_test/invariant_check_entire.mjs
import { mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXECUTE = process.argv.includes('--execute')
const SKIP = new Set(
  (process.argv.find(a => a.startsWith('--skip='))?.slice(7) ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
)

const SH = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}

// ── 삭제 순서: FK 역순 (RESTRICT 부모보다 자식 먼저) ──────────────
const WIPE = [
  // 소방점검 계열
  ['inspection_reports',    '점검 보고서'],
  ['inspections',           '점검 (steps·defects·action_plans는 CASCADE)'],
  ['inspection_plan_items', '점검 계획 항목 (status_log·report_status는 CASCADE)'],
  ['inspection_plans',      '점검 계획'],
  // 영업·매출 계열
  ['bills',                 '청구 (tax_invoices는 CASCADE)'],
  ['orders',                '수주'],
  ['quotes',                '견적'],
  ['inquiries',             '고객 문의'],
  // 고객·건물
  ['buildings',             '건물'],
  ['customers',             '고객 (customer_contacts는 CASCADE)'],
  // 결재·근태·급여
  ['documents',             '기안서 (approvers·attachments는 CASCADE)'],
  ['leaves',                '휴가 신청'],
  ['leave_balances',        '휴가 잔여일수'],
  ['payrolls',              '급여'],
  // 회계
  ['voucher_lines',         '회계 전표 라인'],
  ['vouchers',              '회계 전표'],
  // 커뮤니케이션·개인
  ['mobile_documents',      '모바일 문서'],
  ['messages',              '쪽지'],
  ['notifications',         '알림'],
  ['board_posts',           '게시글'],
  ['meeting_notes',         '회의록'],
  ['schedules',             '일정'],
  ['todos',                 '할 일'],
  ['my_notes',              '개인 메모'],
  ['address_contacts',      '주소록'],
  ['push_subscriptions',    '푸시 구독 (재로그인 시 재등록됨)'],
  // 자재·구매·차량·업무 (테스트 입력분)
  ['stock_movements',       '재고 이동'],
  ['purchase_order_lines',  '발주 라인'],
  ['purchase_orders',       '발주'],
  ['inventory_items',       '재고 품목'],
  ['item_categories',       '품목 분류'],
  ['partners',              '거래처'],
  ['vehicle_logs',          '차량 운행일지'],
  ['vehicles',              '차량'],
  ['work_tasks',            '업무 태스크'],
  ['work_journals',         '업무 일지'],
]

// CASCADE로 함께 삭제되는 자식 — 백업에만 포함
const CASCADE_BACKUP = [
  'inspection_steps', 'inspection_defects', 'action_plans',
  'action_complete_reports', 'action_plan_status',
  'inspection_status_log', 'inspection_report_status',
  'tax_invoices', 'customer_contacts',
  'document_approvers', 'document_attachments',
]

async function count(table) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
    headers: { ...SH, Prefer: 'count=exact' },
  })
  if (r.status === 404) return null // 테이블 없음 (마이그레이션 미적용)
  if (!r.ok) throw new Error(`${table} count ${r.status}: ${await r.text()}`)
  return parseInt(r.headers.get('content-range')?.split('/')[1] ?? '0', 10)
}

async function fetchAll(table) {
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id`, {
      headers: { ...SH, Range: `${from}-${from + PAGE - 1}` },
    })
    if (r.status === 404) return null
    if (!r.ok && r.status !== 416) throw new Error(`${table} fetch ${r.status}: ${await r.text()}`)
    const page = r.status === 416 ? [] : await r.json()
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

async function wipeTable(table) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=not.is.null`, {
    method: 'DELETE',
    headers: { ...SH, Prefer: 'count=exact' },
  })
  if (!r.ok) throw new Error(`${table} delete ${r.status}: ${await r.text()}`)
  return parseInt(r.headers.get('content-range')?.split('/')[1] ?? '-1', 10)
}

async function main() {
  console.log(EXECUTE
    ? '⚠️  EXECUTE 모드 — 백업 후 실제 삭제를 진행합니다.\n'
    : '🔍 DRY-RUN — 건수 확인만 하고 아무것도 변경하지 않습니다. 실제 삭제는 --execute\n')

  // ── 0) 현황 요약 ──────────────────────────────────────────────
  const targets = WIPE.filter(([t]) => !SKIP.has(t))
  let total = 0
  console.log('── 삭제 대상 ──')
  for (const [table, note] of targets) {
    const n = await count(table)
    if (n === null) { console.log(`  ${table.padEnd(24)} (테이블 없음 — 스킵)`); continue }
    total += n
    console.log(`  ${table.padEnd(24)} ${String(n).padStart(6)}건  ${note}`)
  }
  if (SKIP.size) console.log(`  (--skip: ${[...SKIP].join(', ')})`)
  console.log(`  합계 ${total}건 (+ CASCADE 자식 테이블)\n`)

  // 테스트 계정
  const pr = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?email=like.*%40erp-test.com&select=id,email,name,role,is_active`,
    { headers: SH }
  )
  const testAccounts = await pr.json()
  console.log('── 비활성화 대상 계정 (@erp-test.com) ──')
  for (const p of testAccounts) {
    console.log(`  ${p.email.padEnd(28)} ${p.name} (${p.role}) ${p.is_active ? '' : '— 이미 비활성'}`)
  }
  console.log()

  if (!EXECUTE) {
    console.log('dry-run 종료. 문제 없으면: node scripts/cleanup-test-data.mjs --execute')
    return
  }

  // ── 1) 백업 ──────────────────────────────────────────────────
  const backupDir = join(__dirname, 'backup')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupDir, `cleanup-backup-${stamp}.json`)

  const backup = { at: new Date().toISOString(), tables: {} }
  for (const table of [...targets.map(([t]) => t), ...CASCADE_BACKUP]) {
    const rows = await fetchAll(table)
    if (rows === null) continue
    backup.tables[table] = rows
    console.log(`  백업: ${table} ${rows.length}건`)
  }
  writeFileSync(backupPath, JSON.stringify(backup, null, 1))
  console.log(`✓ 백업 저장: ${backupPath}\n`)

  // ── 2) 삭제 (FK 순서) ────────────────────────────────────────
  for (const [table] of targets) {
    if (!(table in backup.tables)) continue // 테이블 없음
    try {
      const n = await wipeTable(table)
      console.log(`  삭제: ${table} ${n >= 0 ? n + '건' : '완료'}`)
    } catch (e) {
      console.error(`  ✗ ${table} 삭제 실패 — 중단합니다 (백업은 저장됨): ${e.message}`)
      process.exit(1)
    }
  }
  console.log()

  // ── 3) 테스트 계정 비활성화 + 로그인 차단 ────────────────────
  for (const p of testAccounts) {
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${p.id}`, {
      method: 'PATCH', headers: SH, body: JSON.stringify({ is_active: false }),
    })
    // auth 레벨에서도 차단 (비밀번호가 알려진 테스트 계정이므로)
    const r2 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, {
      method: 'PUT', headers: SH, body: JSON.stringify({ ban_duration: '876000h' }),
    })
    console.log(`  계정 차단: ${p.email} (profile ${r1.ok ? 'OK' : 'FAIL'}, auth ban ${r2.ok ? 'OK' : 'FAIL'})`)
  }

  console.log(`
✅ 정리 완료. 다음을 확인하세요:
  1. 불변식 검사: node F:/AI/ERP/victory_test/invariant_check_entire.mjs
  2. Storage 버킷 첨부파일 실물은 남아 있음 (필요 시 Supabase 대시보드에서 정리)
  3. 실제 직원 계정 생성 후 운영 데이터 입력 시작`)
}

main().catch(e => { console.error(e); process.exit(1) })
