/** 라이브러리 목록 미리보기가 **대표 칸**을 띄우는가 — 실측 프로브 (2026-09-21).
 *
 *  의심: `planTextPreview`가 행/레코드 섹션에서 `Object.values(...).find(비어있지않음)`으로
 *  첫 값을 집는다. 그런데 **Postgres jsonb는 키를 「길이 → 바이트순」으로 재정렬해 돌려준다**.
 *  그래서 화면에 뜨는 것은 「선언 순서의 첫 칸」이 아니라 「jsonb가 앞으로 민 칸」이다.
 *
 *  🚨 산식을 여기에 베껴 쓰지 않는다 — **제품 함수를 그대로 불러** 화면이 실제로 받는 값을 찍는다.
 *     (산식 사본으로 확인하면 같은 결함을 두 번 승인하게 된다.)
 *
 *  판정: DB가 돌려준 실제 키 순서 ≠ 편집기 스펙의 선언 순서이고, 그 탓에 제품 preview가
 *        선언상 대표 칸이 아닌 다른 칸을 띄우면 **결함**.
 *
 *  실행:
 *    스테이징  npx tsx scripts/_probe-plan-text-preview.mts
 *    운영      SUPABASE_URL=... SERVICE_ROLE_KEY=... npx tsx scripts/_probe-plan-text-preview.mts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { PLAN_TEXT_SECTIONS, planTextPreview } from '../src/lib/plan-text-sections.ts'

function creds(): { url: string; key: string; origin: string } {
  const pu = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const pk = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (pu && pk) return { url: pu, key: pk, origin: 'process.env' }
  const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const get = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
  const u = get('NEXT_PUBLIC_SUPABASE_URL'), s = get('SUPABASE_SERVICE_ROLE_KEY')
  if (!u || !s) throw new Error('자격증명을 찾지 못했습니다 (.env.local / process.env)')
  return { url: u, key: s, origin: '.env.local' }
}

/** 편집기 스펙이 선언한 칸 순서 — 이것이 「대표 칸」의 단일 원천이다 */
function declaredKeys(sectionKey: string): string[] {
  const ed = PLAN_TEXT_SECTIONS[sectionKey]?.editor ?? []
  const rec = ed.find(f => f.kind === 'record')
  if (rec && rec.kind === 'record') return rec.entries.map(e => e.key)
  const row = ed.find(f => f.kind === 'rows' && !f.key)
  if (row && row.kind === 'rows') return row.cols.map(c => c.key)
  return []
}

const { url, key, origin } = creds()
const db = createClient(url, key, { auth: { persistSession: false } })
console.log(`■ 대상 ${url.replace(/^https:\/\//, '').split('.')[0]} (자격증명 ${origin})\n`)

const { data, error } = await db
  .from('plan_text_library')
  .select('id, section_key, title, body, is_default')
  .order('section_key')
if (error) throw new Error(`조회 실패: ${error.message}`)

let bad = 0, checked = 0
for (const r of data ?? []) {
  const sk = r.section_key as string
  const declared = declaredKeys(sk)
  if (declared.length === 0) continue  // 대표 칸 축이 없는 섹션(단일 text)은 이 결함의 대상이 아니다

  // 행 섹션은 첫 행이 미리보기의 원천이다. 레코드 섹션은 body 자체.
  const src: Record<string, unknown> | undefined =
    Array.isArray(r.body) ? (r.body[0] as Record<string, unknown> | undefined)
      : (r.body && typeof r.body === 'object' ? r.body as Record<string, unknown> : undefined)
  if (!src) continue

  checked++
  const dbOrder = Object.keys(src)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  // 선언 순서로 골랐다면 나왔을 대표 칸
  const wantKey = declared.find(k => str(src[k]).trim())
  const want = wantKey ? str(src[wantKey]).trim().replace(/\s+/g, ' ') : ''
  // 화면이 실제로 받는 값 — **제품 함수**
  const got = planTextPreview(sk, r.body)

  const cut = (t: string) => (t.length > 40 ? `${t.slice(0, 40)}…` : t)
  const ok = got === cut(want)
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${sk} / 「${r.title}」${r.is_default ? ' ⭐기본' : ''}`)
  console.log(`    DB 키 순서 : ${dbOrder.join(', ')}`)
  console.log(`    선언 순서  : ${declared.join(', ')}`)
  console.log(`    대표(선언) : ${wantKey ?? '(없음)'} → ${want || '(빈 값)'}`)
  console.log(`    제품 preview: ${got || '(빈 값)'}`)
  if (!ok) console.log(`    ⚠ 대표 칸이 아닌 값이 뜬다`)
  console.log()
}

console.log(`── 대표 칸 축이 있는 ${checked}건 중 어긋남 ${bad}건`)
process.exit(bad > 0 ? 1 : 0)
