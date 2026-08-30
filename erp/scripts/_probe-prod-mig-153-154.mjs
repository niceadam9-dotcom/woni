// 배포 선행 확인 — 운영 DB에 153·154가 적용돼 있는가 (읽기 전용, ASCII 술어만)
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-prod-mig-153-154.mjs
import { readFileSync } from 'fs'
import { join } from 'path'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const P = { prod: 'ryuozdhnilfjlahorizh', staging: 'nwflnzugwylhpdyodyog' }
const q = async (proj, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${proj}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const b = await r.json()
  if (r.status >= 300) throw new Error(`${r.status} ${JSON.stringify(b).slice(0, 200)}`)
  return b
}

// 154 = profiles.font_scale · 153 = 2차=작동 가드(inspections/plan_items 제약) · 152 = hard_delete_customer
// ⚠ 컬럼명은 `form_font_scale`이다(내 첫 판이 `font_scale`로 물어 양쪽 0을 받고 '미적용'이라 오판했다).
//   부재 판정은 실제 스키마 이름으로만 — 이름을 틀리면 '없다'가 공짜로 나온다.
const SQL = `SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='form_font_scale') AS m154_form_font_scale,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='theme')           AS m151_theme,
  (SELECT count(*) FROM pg_proc WHERE proname='hard_delete_customer')                          AS m152_fn,
  (SELECT count(*) FROM pg_constraint
     WHERE conname = 'profiles_form_font_scale_check')                                         AS m154_check`

for (const [name, proj] of Object.entries(P)) {
  const r = (await q(proj, SQL))[0]
  console.log(`${name.padEnd(8)} ${JSON.stringify(r)}`)
}
