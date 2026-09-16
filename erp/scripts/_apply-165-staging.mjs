// 마이그레이션 165 스테이징 적용 — `_apply-138-staging` 관례 (2026-09-16)
// 165: buildings 계단 4종 개소 컬럼 + 백필. `stairs_count`는 직통+피난 **파생 저장**으로 격하.
//
// 🚨 적용 전/후를 **같은 스크립트가 재어** 「성공한 척」을 막는다. 2026-09-16 실측 기준
//    대상은 5명(서림사·지평리56·송학떡집·별그리다·강순기 건물_2)이고 전원 활성 건물 1동이다.
//    그 수가 다르게 나오면 전제가 바뀐 것이니 사람이 봐야 한다.
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath}`)
  console.error('Supabase 관리 API 토큰(sbp_…)을 그 경로에 한 줄로 저장한 뒤 다시 실행하세요.')
  process.exit(1)
}

const STAGING = 'nwflnzugwylhpdyodyog'
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const ok = (r) => r.status >= 200 && r.status < 300

// ── 적용 전 실측 ────────────────────────────────────────────────────────────
const before = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='buildings' AND column_name LIKE 'stair\\_%\\_count') AS new_cols,
    (SELECT count(*) FROM buildings WHERE COALESCE(is_active,true) AND stairs_count IS NOT NULL) AS had_sum`)
if (!ok(before)) { console.error('적용 전 조회 실패:', JSON.stringify(before.body)); process.exit(1) }
console.log('적용 전:', JSON.stringify(before.body))

// ── 적용 ────────────────────────────────────────────────────────────────────
/* ⚠ **스크립트 자기 위치 기준**으로 읽는다. 상대경로(`supabase/…`)로 두면 `erp/`가 아닌 곳에서
 *   실행했을 때 ENOENT로 죽거나, 더 나쁘게는 다른 트리의 같은 이름 파일을 읽는다.
 *   이 저장소는 CWD 함정으로 깨진 커밋을 만든 전례가 있다(`update-index`가 10파일을 통째로 빠뜨렸다). */
const sql = readFileSync(new URL('../supabase/migrations/165_buildings_stairs_by_kind.sql', import.meta.url), 'utf8')
const r = await q(sql)
console.log(`${ok(r) ? 'OK  ' : 'FAIL'} 165_buildings_stairs_by_kind.sql — status ${r.status}${ok(r) ? '' : ' ' + JSON.stringify(r.body)}`)
if (!ok(r)) process.exit(1)

// ── 적용 후 검증 ────────────────────────────────────────────────────────────
//  ⚠ 「컬럼이 생겼다」로 끝내지 않는다. 백필이 실제로 값을 옮겼는지, 그리고 합계가
//    직통+피난과 **어긋나지 않는지**(파생의 불변식)까지 본다.
const after = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='buildings' AND column_name LIKE 'stair\\_%\\_count') AS new_cols,
    (SELECT count(*) FROM buildings WHERE COALESCE(is_active,true)
       AND (stair_direct_count IS NOT NULL OR stair_escape_count IS NOT NULL
            OR stair_special_count IS NOT NULL OR stair_outdoor_count IS NOT NULL)) AS filled,
    (SELECT count(*) FROM buildings WHERE COALESCE(is_active,true)
       AND stairs_count IS DISTINCT FROM
           NULLIF(COALESCE(stair_direct_count,0) + COALESCE(stair_escape_count,0), 0)) AS sum_mismatch,
    (SELECT count(*) FROM buildings WHERE COALESCE(is_active,true) AND stair_special_count > 0) AS special_filled`)
console.log('적용 후:', JSON.stringify(after.body))

const row = Array.isArray(after.body) ? after.body[0] : null
if (!row) { console.error('🚨 검증 조회가 행을 안 줬다 — 「성공한 척」을 막기 위해 실패로 친다'); process.exit(1) }
const fails = []
if (Number(row.new_cols) !== 4) fails.push(`신규 컬럼 ${row.new_cols}개(4여야 한다)`)
if (Number(row.sum_mismatch) !== 0) fails.push(`합계 불일치 ${row.sum_mismatch}건 — stairs_count가 직통+피난과 어긋난다`)
if (Number(row.filled) === 0) fails.push('백필이 한 건도 안 옮겼다(대상 5명이었다)')
if (Number(row.special_filled) === 0) fails.push('특별피난계단이 0건 — 송학떡집·별그리다가 안 옮겨졌다')

// 어느 고객이 어떻게 됐는지 이름으로 남긴다 — 숫자만 보면 엉뚱한 행이 옮겨져도 초록이다
const rows = await q(`
  SELECT c.customer_name AS name, b.stair_direct_count AS d, b.stair_escape_count AS e,
         b.stair_special_count AS sp, b.stair_outdoor_count AS o, b.stairs_count AS sum
  FROM buildings b JOIN customers c ON c.id = b.customer_id
  WHERE COALESCE(b.is_active,true)
    AND (b.stair_direct_count IS NOT NULL OR b.stair_escape_count IS NOT NULL
         OR b.stair_special_count IS NOT NULL OR b.stair_outdoor_count IS NOT NULL)
  ORDER BY c.customer_name`)
console.log('\n백필된 건물:')
for (const x of (Array.isArray(rows.body) ? rows.body : [])) {
  console.log(`  · ${x.name}  직통=${x.d ?? '-'} 피난=${x.e ?? '-'} 특별=${x.sp ?? '-'} 옥외=${x.o ?? '-'}  합계=${x.sum ?? '-'}`)
}

if (fails.length) { console.error('\n🚨 검증 실패:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('\n✅ 165 적용·검증 완료')
