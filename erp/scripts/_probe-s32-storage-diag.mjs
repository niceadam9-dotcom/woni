/* S10-6 후속 진단 — '지웠다는데 남아 있다'의 정체를 축을 갈라 확인한다.
 *
 * 브라우저·서버액션을 빼고 _purgeCustomerStorage 와 **같은 로직**만 재현한다.
 * 판정 축을 둘로 나눈다:
 *   (a) list()  — 버킷 목록에 실제로 남아 있는가
 *   (b) download() — 내려받아지는가 (CDN/캐시 착시 가능성 배제용)
 * 둘이 어긋나면 캐시 문제, 둘 다 '있다'면 remove()가 정말 안 지운 것이다.
 *
 * 실행: cd F:\AI\ERP\erp; node scripts/_probe-s32-storage-diag.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// .env.local 직독 (dev 서버와 같은 값)
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

const BUCKET = 'fire-plans'
const CID = `s32diag-${Date.now()}`
const paths = [`${CID}/assets/cover.txt`, `${CID}/assets/evac-map.txt`, `${CID}/gen-assets/sub/nested.txt`]

for (const p of paths) {
  const { error } = await raw.storage.from(BUCKET).upload(p, Buffer.from('diag'), { contentType: 'text/plain' })
  if (error) { console.log(`업로드 실패 ${p}: ${error.message}`); process.exit(1) }
}
console.log(`업로드 3건 완료 — 접두사 ${CID}`)

// ⚠ 이 한 줄이 E2E 프로브와 이 진단의 유일한 차이였다.
// S10-6 프로브는 ①대조군에서 삭제 **전에** download()를 했고, 그때 CDN이 객체를 캐시했을 수 있다.
// 그렇다면 '삭제 후 download 성공'은 고아가 아니라 캐시 잔상이다 — list()가 진짜 축이다.
const PREWARM = process.env.PREWARM !== '0'
if (PREWARM) {
  for (const p of paths) await raw.storage.from(BUCKET).download(p)
  console.log('사전 download 3건 수행(캐시 예열) — E2E 대조군과 같은 조건')
}

// ── _purgeCustomerStorage 와 동일한 BFS ──
const files = []
const queue = [CID]
while (queue.length) {
  const prefix = queue.shift()
  const { data, error } = await raw.storage.from(BUCKET).list(prefix, { limit: 1000 })
  if (error) { console.log(`목록 실패 ${prefix}: ${error.message}`); break }
  console.log(`  list(${prefix}) → ${(data ?? []).map(o => `${o.name}${o.id === null ? '/(folder)' : ''}`).join(', ') || '(비어있음)'}`)
  for (const o of data ?? []) {
    if (o.id === null) queue.push(`${prefix}/${o.name}`)
    else files.push(`${prefix}/${o.name}`)
  }
}
console.log(`수집한 파일 ${files.length}건:`)
files.forEach(f => console.log(`   ${f}`))

const { data: rmData, error: rmErr } = await raw.storage.from(BUCKET).remove(files)
console.log(`remove() error=${rmErr ? rmErr.message : 'none'} / 응답에 담긴 건수=${Array.isArray(rmData) ? rmData.length : 'n/a'}`)
if (Array.isArray(rmData)) rmData.forEach(o => console.log(`   지워졌다고 보고된 것: ${o.name}`))

// ── 사후 판정 — 두 축 ──
console.log('\n사후 확인:')
for (const p of paths) {
  const dir = p.slice(0, p.lastIndexOf('/'))
  const base = p.slice(p.lastIndexOf('/') + 1)
  const { data: ls } = await raw.storage.from(BUCKET).list(dir, { limit: 1000 })
  const inList = (ls ?? []).some(o => o.name === base)
  const { data: d } = await raw.storage.from(BUCKET).download(p)
  console.log(`  ${p}\n     list에 존재=${inList}  download가능=${!!d}`)
}

// 정리
await raw.storage.from(BUCKET).remove(paths)
