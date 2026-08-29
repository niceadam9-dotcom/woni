/** 판정자 D — S7-0 대체 실측(읽기 전용). test-doc-generation이 환경으로 막혀 있을 때,
 *  '추출본이 실제 스키마·실데이터에서 도는가'를 PDF 변환 **직전까지** 태워 본다.
 *   ① 149의 sheet_protocol 컬럼이 실재하는가(옛 차단 사유의 소멸 여부)
 *   ② 추출본 assembleReport9가 실 점검 건에서 조립되는가
 *   ③ 렌더러가 HTML을 내는가(= 남은 실패 지점은 Gotenberg뿐임을 좁힌다)
 *  DB는 SELECT만 한다. 실행: npx tsx --conditions=react-server scripts/_judge27g-d-r9run.mts */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { assembleReport9 } from '../src/lib/report9-assemble.ts'
import { renderReport9 } from '../src/lib/doc-templates/report9.ts'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
// 내부 헬퍼(sheet-catalog 등)가 자기 createAdminClient()를 부르므로 프로세스 env도 채워 준다
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } })

const OUT: string[] = [`[DB] ${env.NEXT_PUBLIC_SUPABASE_URL}`, `[GOTENBERG_URL in .env.local] ${env.GOTENBERG_URL ?? '(없음)'}`]

// ① 149 컬럼 실재 — ASCII 술어만 쓴다(한글 술어는 조용한 0건이 된다)
{
  const { error } = await db.from('inspections').select('id, sheet_protocol').limit(1)
  OUT.push(`[149] inspections.sheet_protocol 조회: ${error ? `❌ ${error.code} ${error.message}` : '✅ OK'}`)
  const { error: e2 } = await db.from('inspections').select('id, zzz_not_a_column').limit(1)
  OUT.push(`[대조군] 없는 컬럼 조회: ${e2 ? `✅ 거절됨(${e2.code})` : '❌ 통과 — 이 검사는 무의미'}`)
}

// ② 실 점검 건으로 조립
const { data: rows } = await db.from('inspections')
  .select('id, customer_id, year').not('customer_id', 'is', null)
  .order('created_at', { ascending: false }).limit(3)
OUT.push(`[표본] 점검 ${rows?.length ?? 0}건`)
for (const r of (rows ?? []) as Array<{ id: string; customer_id: string; year: number }>) {
  try {
    const r9 = await assembleReport9(db as never, r.customer_id, r.id)
    const html = renderReport9(r9.data, { assets: { logo: '', stamp: '', sign: '' } } as never)
    OUT.push(`  ✅ ${r.id.slice(0, 8)} — 조립 OK(missing ${r9.missing.length}) · 렌더 ${html.length}자 · 인력 ${r9.data.assistants.length}명`)
  } catch (e) {
    OUT.push(`  ❌ ${r.id.slice(0, 8)} — ${(e as Error).message.slice(0, 200)}`)
  }
}
writeFileSync('F:/AI/ERP/_j27d-r9run.txt', OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
