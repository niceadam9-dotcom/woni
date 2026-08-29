// 배포 전 점검 — 배포될 코드가 요구하는 DB 객체가 운영에 실재하는가. 읽기 전용.
// 코드가 DB보다 앞서면 런타임에서만 터진다(147 사례). 배포 전에 축을 맞춘다.
import { readFileSync } from 'fs'
import { join } from 'path'
const tok = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()

async function q(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`)
  return JSON.parse(t)
}

for (const [name, ref] of Object.entries({ 운영: 'ryuozdhnilfjlahorizh', 스테이징: 'nwflnzugwylhpdyodyog' })) {
  console.log(`\n===== ${name}`)
  const r = await q(ref, `
    SELECT
      -- 151 다크 모드: profiles.theme
      (SELECT count(*) FROM information_schema.columns
        WHERE table_name='profiles' AND column_name='theme')                     AS m151_theme,
      -- 152 조건부 hard delete: 함수 존재 (미커밋 기능이라 코드엔 없지만 DB엔 있을 수 있다)
      (SELECT count(*) FROM pg_proc WHERE proname='hard_delete_customer')         AS m152_fn,
      -- 153 2차=작동: 트리거 축이 고객 축인가
      (SELECT count(*) FROM pg_proc
        WHERE proname='check_inspection_sequence'
          AND pg_get_functiondef(oid) LIKE '%inspection_sub_type%')               AS m153_axis,
      -- 149 점검표 규약: inspections.sheet_protocol
      (SELECT count(*) FROM information_schema.columns
        WHERE table_name='inspections' AND column_name='sheet_protocol')          AS m149_protocol,
      -- 148/150 점검표 시딩
      (SELECT count(*) FROM inspection_sheet_items)                               AS sheet_items
  `)
  console.log(JSON.stringify(r[0], null, 1))
  const v = r[0]
  const ok = v.m151_theme > 0 && v.m153_axis > 0 && v.m149_protocol > 0
  console.log(ok ? '  ✅ 배포될 코드가 요구하는 객체 전부 존재' : '  ❌ 누락 있음 — 배포 전 마이그레이션 필요')
}
