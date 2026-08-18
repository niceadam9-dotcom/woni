// 읽기 전용 — DB에 저장된 공휴일 현황(연도별 건수 + 대체공휴일 목록)
import { readFileSync } from 'fs'
import { join } from 'path'
const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) throw new Error(`${ref} ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}
for (const [label, ref] of [['스테이징', 'nwflnzugwylhpdyodyog'], ['운영', 'ryuozdhnilfjlahorizh']]) {
  const cnt = await q(ref, `SELECT year, COUNT(*) AS n,
      COUNT(*) FILTER (WHERE name LIKE '대체공휴일%') AS subs
      FROM holidays GROUP BY year ORDER BY year`)
  console.log(`\n[${label}] 연도별 공휴일`)
  for (const r of (Array.isArray(cnt) ? cnt : [])) console.log(`  ${r.year}: ${r.n}일 (대체 ${r.subs})`)
  const may = await q(ref, `SELECT to_char(date,'YYYY-MM-DD') AS d, name FROM holidays
      WHERE date BETWEEN '2025-05-01' AND '2025-05-10' ORDER BY 1`)
  console.log(`  2025-05-01~10: ${JSON.stringify(Array.isArray(may) ? may : [])}`)
}
