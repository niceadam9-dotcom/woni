// P1A-3: 과거 작동보고서 '현황' 시트 → fire_facilities(건물단위) 이관
// 현황 시트의 [√] 체크박스를 역파싱해 설치 설비를 추출, 개요!B14(상호)로 고객 매칭.
// 사용: node scripts/migrate-facilities-from-reports.mjs           (dry-run)
//       node scripts/migrate-facilities-from-reports.mjs --execute (DB 반영)
import * as XLSX from 'xlsx'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const EXECUTE = process.argv.includes('--execute')
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// facility_code → 분류(category)
const CATEGORY = {
  '소화기구': '소화설비', '옥내소화전': '소화설비', '스프링클러': '소화설비', '간이스프링클러': '소화설비', '물분무등소화설비': '소화설비', '옥외소화전': '소화설비',
  '자동화재탐지설비': '경보설비', '비상경보설비': '경보설비', '비상방송설비': '경보설비', '자동화재속보설비': '경보설비', '가스누설경보기': '경보설비',
  '피난기구': '피난구조설비', '인명구조기구': '피난구조설비', '유도등·유도표지': '피난구조설비', '비상조명등': '피난구조설비',
  '상수도소화용수설비': '소화용수설비', '소화수조·저수조': '소화용수설비',
  '제연설비': '소화활동설비', '연결송수관설비': '소화활동설비', '연결살수설비': '소화활동설비', '비상콘센트설비': '소화활동설비', '무선통신보조설비': '소화활동설비',
}

// facility_code → 현황 시트 체크박스 셀 (injectFacilityStatus 역맵)
const FACILITY_CHECKBOX = {
  '소화기구': 'D7', '옥내소화전': 'C12', '스프링클러': 'C13', '간이스프링클러': 'C14',
  '물분무등소화설비': 'C16', '옥외소화전': 'C25', '자동화재탐지설비': 'C28', '비상경보설비': 'C27',
  '비상방송설비': 'C29', '자동화재속보설비': 'C31', '가스누설경보기': 'C33', '피난기구': 'Z7',
  '인명구조기구': 'Y12', '유도등·유도표지': 'Y13', '비상조명등': 'Y16', '상수도소화용수설비': 'Y18',
  '소화수조·저수조': 'Y19', '제연설비': 'Y20', '연결송수관설비': 'Y22', '연결살수설비': 'Y23',
  '비상콘센트설비': 'Y24', '무선통신보조설비': 'Y25',
}

function parseReport(path, file) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' })
  const gae = wb.Sheets['개요']
  const hyeon = wb.Sheets['현황']
  if (!gae || !hyeon) return null
  // 상호 후보: 개요 B14/B12 (템플릿 버전차) + 파일명 접두 (작동보고서/작동점검 앞)
  const fromFile = file.replace(/\s*(작동보고서|작동점검).*$/, '').trim()
  const cand = [gae['B14'], gae['B12']].map(c => c ? String(c.v).trim() : '').filter(Boolean)
  cand.push(fromFile)
  const names = [...new Set(cand.filter(n => n && !/^경기|^서울|^\d/.test(n)))]  // 주소로 보이는 값 제외
  const installed = []
  for (const [code, addr] of Object.entries(FACILITY_CHECKBOX)) {
    const c = hyeon[addr]
    if (c && typeof c.v === 'string' && c.v.includes('√')) installed.push(code)
  }
  return { names, installed }
}

const dir = process.cwd()
const files = readdirSync(dir).filter(f => /\.xls$/i.test(f) && /(작동보고서|작동점검)/.test(f))
console.log(`대상 보고서 파일 ${files.length}건${EXECUTE ? ' (실행 모드)' : ' (DRY-RUN)'}\n`)

let migrated = 0, skipped = 0
for (const f of files) {
  const r = parseReport(join(dir, f), f)
  if (!r) { console.log(`  ⚠️ ${f}: 개요/현황 시트 없음 — skip`); skipped++; continue }
  // 고객 매칭 — 후보 상호들로 정확일치 → 부분일치
  let c = null
  for (const nm of r.names) {
    const { data: exact } = await admin.from('customers').select('id, customer_name').eq('customer_name', nm).limit(1)
    if (exact?.length) { c = exact[0]; break }
    const key = nm.replace(/\s+/g, '').slice(0, 4)
    const { data: like } = await admin.from('customers').select('id, customer_name').ilike('customer_name', `%${key}%`).limit(2)
    if (like?.length === 1) { c = like[0]; break }
  }
  if (!c) { console.log(`  ❌ [${r.names.join('/')}] (${f}): 고객 미매칭 — 수동보완 필요 [설비 ${r.installed.length}]`); skipped++; continue }
  const { data: blds } = await admin.from('buildings').select('id, building_name').eq('customer_id', c.id).eq('is_active', true).order('building_name')
  if (!blds?.length) { console.log(`  ❌ "${r.name}"→${c.customer_name}: 건물 없음 — 수동보완`); skipped++; continue }
  const bld = blds[0]

  console.log(`  ✅ [${r.names.join('/')}] → 고객 ${c.customer_name} / 건물 ${bld.building_name} — 설비 ${r.installed.length}: ${r.installed.join(', ')}`)
  if (EXECUTE) {
    // 기존 설비 있으면 건너뜀(덮어쓰기 방지), 없으면 삽입
    const { count } = await admin.from('fire_facilities').select('id', { count: 'exact', head: true }).eq('building_id', bld.id)
    if (count && count > 0) { console.log(`     · 이미 설비현황 존재(${count}) — skip`); skipped++; continue }
    const rows = r.installed.map(code => ({ building_id: bld.id, category: CATEGORY[code] ?? '기타', facility_code: code, installed: true, detail: { note: '과거 보고서 이관' } }))
    if (rows.length) {
      const { error } = await admin.from('fire_facilities').insert(rows)
      if (error) { console.log(`     · 삽입 실패: ${error.message}`); skipped++; continue }
    }
    migrated++
  }
}
console.log(`\n결과: ${EXECUTE ? `이관 ${migrated}건` : 'DRY-RUN (반영 안 함)'}, 건너뜀/보완필요 ${skipped}건`)
