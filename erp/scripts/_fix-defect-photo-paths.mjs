// 불량 전/후 사진 저장값 보정 (2026-08-18) — 죽은 public URL → 버킷 경로.
//
// 배경: 업로드가 getPublicUrl()을 저장했는데 inspection-defects 버킷은 비공개다.
//       그 주소는 400 {"error":"Bucket not found"}라 사진이 화면 전체에서 뜨지 않았다.
//       파일 자체는 멀쩡하므로 저장값만 경로로 바꾸면 전부 되살아난다.
//
// 안전장치: ①미리보기 기본 ②경로 추출 실패 행은 건드리지 않고 보고 ③변환 후 실제로
//           Storage에 존재하는지 확인하고, 없는 경로는 되돌리지 않고 '확인 필요'로 보고한다.
//
// 실행: node scripts/_fix-defect-photo-paths.mjs          (미리보기)
//       node scripts/_fix-defect-photo-paths.mjs --apply  (반영)
//       node scripts/_fix-defect-photo-paths.mjs --apply --prod   (운영 대상)
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const APPLY = process.argv.includes('--apply')
const PROD = process.argv.includes('--prod')
const url = PROD ? process.env.PROD_SUPABASE_URL : SUPABASE_URL
const key = PROD ? process.env.PROD_SERVICE_ROLE_KEY : SERVICE_ROLE_KEY
if (PROD && (!url || !key)) {
  console.error('운영 대상에는 PROD_SUPABASE_URL·PROD_SERVICE_ROLE_KEY 환경변수가 필요합니다.')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { persistSession: false } })
const BUCKET = 'inspection-defects'

/** src/lib/defect-photos.ts extractStoragePath와 같은 규칙 (스크립트는 ts를 못 불러 사본) */
const extractPath = (stored) => {
  if (!stored) return null
  const v = String(stored).trim()
  if (!v) return null
  if (!v.startsWith('http')) return v.replace(/^\/+/, '')
  const m = v.match(new RegExp(`/${BUCKET}/(.+)$`))
  return m ? m[1].split('?')[0] : null
}

console.log(`대상 DB: ${url}${PROD ? '  ← 운영' : ''}\n`)

const { data, error } = await admin
  .from('inspection_defects')
  .select('id, defect_name, photo_url, after_photo_url')
  .or('photo_url.not.is.null,after_photo_url.not.is.null')
if (error) { console.error('조회 실패:', error.message); process.exit(1) }

const plan = []      // 바꿀 것
const already = []   // 이미 경로
const broken = []    // 경로를 못 뽑은 값
for (const r of data ?? []) {
  const patch = {}
  for (const field of ['photo_url', 'after_photo_url']) {
    const v = r[field]
    if (!v) continue
    if (!String(v).startsWith('http')) { already.push(`${r.defect_name}.${field}`); continue }
    const p = extractPath(v)
    if (!p) { broken.push(`${r.defect_name}.${field} = ${v}`); continue }
    patch[field] = p
  }
  if (Object.keys(patch).length > 0) plan.push({ id: r.id, name: r.defect_name, patch })
}

console.log(`행 ${(data ?? []).length}건 · 변환 대상 ${plan.length}건 · 이미 경로 ${already.length}건 · 추출 실패 ${broken.length}건`)
for (const b of broken) console.log(`  ⚠ 추출 실패(미변경): ${b}`)
for (const p of plan) {
  for (const [f, v] of Object.entries(p.patch)) console.log(`  ${APPLY ? 'SET ' : 'PLAN'}  ${p.name}.${f} → ${v}`)
}

// 변환 결과가 실제로 존재하는 파일인지 확인 — 되살아나는지가 이 작업의 목적이다
const allPaths = [...new Set(plan.flatMap(p => Object.values(p.patch)))]
let missing = []
if (allPaths.length > 0) {
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(allPaths, 60)
  const ok = new Set((signed ?? []).filter(s => s.signedUrl).map(s => s.path))
  missing = allPaths.filter(p => !ok.has(p))
  console.log(`\nStorage 확인: ${allPaths.length - missing.length}/${allPaths.length}개 존재`)
  for (const m of missing) console.log(`  ⚠ 파일 없음(그래도 경로로는 바꾼다 — 원본이 지워진 건): ${m}`)
}

if (!APPLY) {
  console.log('\n미리보기입니다 — 반영하려면 --apply')
} else {
  let ok = 0
  for (const p of plan) {
    const { error: e } = await admin.from('inspection_defects').update(p.patch).eq('id', p.id)
    if (e) console.error(`  실패 ${p.name}: ${e.message}`)
    else ok++
  }
  // 반영 결과를 다시 읽어 확인한다 — update 응답만 믿지 않는다
  const { data: after } = await admin.from('inspection_defects')
    .select('photo_url, after_photo_url')
    .or('photo_url.not.is.null,after_photo_url.not.is.null')
  const leftover = (after ?? []).flatMap(r => [r.photo_url, r.after_photo_url])
    .filter(v => v && String(v).startsWith('http')).length
  console.log(`\n반영 ${ok}/${plan.length}건 · 검증: 남은 http 저장값 ${leftover}건 (0이어야 정상)`)
  process.exitCode = ok === plan.length && leftover === 0 ? 0 : 1
}
