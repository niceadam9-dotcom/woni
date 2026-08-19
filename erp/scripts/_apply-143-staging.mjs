// 마이그레이션 143 스테이징 적용 — notifications.type에 'law_revision' 추가
// 실행: node scripts/_apply-143-staging.mjs        (미리보기)
//       node scripts/_apply-143-staging.mjs --run  (적용, 토큰: %TEMP%/sbtok.txt)
//
// 왜 필요한가: 법제처 서식 개정 크론이 type='law_revision'으로 관리자 알림을 넣는데
//   그 값이 CHECK에 없어 **insert가 항상 실패**했다. 라우트는 오류를 안 보고 기준일만
//   올렸으므로 다음 실행에서는 개정이 감지되지 않는다 — 신호가 통째로 사라진다.
//   실측(2026-08-19 스테이징): 관리자 14명인데 law_revision 알림 0건.
//
// 멱등: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT라 재실행이 안전하다.
// ⚠ 제약을 갈아 끼우므로 기존 행이 새 목록을 위반하면 ADD에서 실패한다 —
//   적용 전에 '목록 밖 type이 실제로 있는지'를 먼저 센다(있으면 중단).
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath} — scripts/_restore-sbtok.ps1로 복원하세요.`)
  process.exit(1)
}
const APPLY = process.argv.includes('--run')
const STAGING = 'nwflnzugwylhpdyodyog'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  // Management API는 200이 아니라 201을 돌려준다 — 200만 성공으로 보면 정상 응답을 실패로 읽는다
  return { ok: r.status >= 200 && r.status < 300, status: r.status, body: await r.json().catch(() => null) }
}

const ALLOWED = [
  'approval_request', 'approved', 'rejected', 'recalled',
  'leave_request', 'leave_approved', 'leave_rejected',
  'inspection_assigned', 'inspection_step_due', 'inspection_step_overdue', 'inspection_completed',
  'insurance_expiry_due', 'insurance_expiry_overdue',
  'defect_action_due', 'defect_action_overdue',
  'report_submit_due', 'report_submit_overdue',
  'weekly_doc_briefing', 'law_revision',
]

const STATE = `SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%law_revision%' FROM pg_constraint WHERE conname='notifications_type_check') AS has_law_revision,
  (SELECT count(*)::int FROM notifications WHERE type='law_revision') AS law_noti_rows,
  (SELECT count(*)::int FROM notifications WHERE type <> ALL (ARRAY[${ALLOWED.map(t => `'${t}'`).join(',')}])) AS outside_new_list`

const MIGRATION = `
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[${ALLOWED.map(t => `'${t}'::text`).join(', ')}]));
`

const show = (label, b) => console.log(`  ${label.padEnd(10)} ${JSON.stringify(Array.isArray(b) ? b[0] : b)}`)

const before = await q(STATE)
if (before.ok === false) { console.error('상태 조회 실패:', before.status, JSON.stringify(before.body)); process.exit(1) }
console.log('마이그레이션 143 — notifications.type에 law_revision 추가 (스테이징)')
show('적용 전', before.body)

const b0 = Array.isArray(before.body) ? before.body[0] : before.body
if (b0.outside_new_list > 0) {
  console.error(`⛔ 새 목록 밖 type이 ${b0.outside_new_list}건 있습니다 — 제약을 갈아 끼우면 ADD에서 실패합니다. 먼저 그 행들을 확인하세요.`)
  process.exit(1)
}
if (b0.has_law_revision) { console.log('\n이미 적용돼 있습니다 (재실행 안전, 변경 없음).'); process.exit(0) }

if (!APPLY) {
  console.log('\n미리보기입니다. 적용하려면 --run 을 붙이세요.')
  process.exit(0)
}

const res = await q(MIGRATION)
if (res.ok === false) { console.error('적용 실패:', res.status, JSON.stringify(res.body)); process.exit(1) }

const after = await q(STATE)
show('적용 후', after.body)
const a0 = Array.isArray(after.body) ? after.body[0] : after.body
if (!a0.has_law_revision) { console.error('⛔ 적용됐다는데 제약에 law_revision이 없습니다.'); process.exit(1) }

// 실제로 넣어지는지 왕복 확인 — 제약 문자열만 보면 '되는 줄 알았는데 안 되는' 상태를 못 잡는다
const probe = await q(`INSERT INTO notifications (recipient_id, title, message, type, reference_type)
  SELECT id, '[143 프로브] 삭제 예정', '제약 확인용', 'law_revision', 'document' FROM profiles WHERE is_active LIMIT 1
  RETURNING id`)
if (probe.ok === false) { console.error('⛔ 프로브 insert 실패 — 제약이 여전히 막습니다:', JSON.stringify(probe.body)); process.exit(1) }
const probeId = (Array.isArray(probe.body) ? probe.body[0] : probe.body)?.id
console.log(`  프로브     insert 성공 (id=${probeId})`)
await q(`DELETE FROM notifications WHERE id = '${probeId}'`)
const left = await q(`SELECT count(*)::int AS n FROM notifications WHERE type='law_revision'`)
console.log(`  프로브 정리 남은 law_revision 알림: ${JSON.stringify(Array.isArray(left.body) ? left.body[0] : left.body)}`)
console.log('\n✅ 143 적용 완료')
