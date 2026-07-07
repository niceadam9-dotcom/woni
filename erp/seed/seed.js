/**
 * ERP 테스트 데이터 시드 스크립트
 *
 * 사용법:
 *   node seed/seed.js          -- 계정 생성 (이미 있으면 건너뜀)
 *   node seed/seed.js --reset  -- 기존 테스트 계정 전부 삭제 후 재생성
 *
 * 필요: .env.local 에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const fs   = require('fs')
const path = require('path')

// .env.local 직접 파싱 (dotenv 없이)
const envPath = path.join(__dirname, '..', '.env.local')
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/)
  if (m) env[m[1].trim()] = m[2].trim()
}

const SUPABASE_URL      = env['NEXT_PUBLIC_SUPABASE_URL']
const SERVICE_ROLE_KEY  = env['SUPABASE_SERVICE_ROLE_KEY']

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  .env.local 에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.')
  process.exit(1)
}

const data    = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-accounts.json'), 'utf8'))
const RESET   = process.argv.includes('--reset')
const YEAR    = new Date().getFullYear()

// ── Supabase REST helper ──────────────────────────────────────────────────────
async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':         SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Prefer':        method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// Auth Admin REST
async function authAdmin(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':         SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// ── 기존 테스트 계정 삭제 ────────────────────────────────────────────────────
async function resetExisting() {
  console.log('🗑  기존 테스트 계정 삭제 중...')
  const emails = data.users.map(u => `'${u.email}'`).join(',')

  // profiles 조회 → auth 삭제 (cascade로 profiles도 삭제됨)
  const profiles = await supabase('GET',
    `/rest/v1/profiles?email=in.(${emails})&select=id`)
  if (profiles && profiles.length > 0) {
    for (const p of profiles) {
      await authAdmin('DELETE', `/users/${p.id}`)
      process.stdout.write('.')
    }
    console.log()
  }

  // departments 삭제 (이름 기준)
  const deptNames = data.departments.map(d => `'${d.name}'`).join(',')
  await supabase('DELETE', `/rest/v1/departments?name=in.(${deptNames})`)
  console.log('✓  기존 데이터 삭제 완료')
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  if (RESET) await resetExisting()

  console.log('\n🌱  테스트 데이터 시드 시작\n')

  // 1. 부서 생성
  console.log('📁  부서 생성...')
  const deptMap = {}  // key → { id, name }
  for (const dept of data.departments) {
    // 이미 존재하면 조회, 없으면 생성
    const existing = await supabase('GET',
      `/rest/v1/departments?name=eq.${encodeURIComponent(dept.name)}&select=id,name`)
    if (existing && existing.length > 0) {
      deptMap[dept.key] = existing[0]
      console.log(`  ↩  ${dept.name} (기존)`)
    } else {
      const created = await supabase('POST', '/rest/v1/departments', { name: dept.name })
      if (created && created[0]) {
        deptMap[dept.key] = created[0]
        console.log(`  ✓  ${dept.name}`)
      } else {
        console.error(`  ❌  ${dept.name} 생성 실패`, created)
      }
    }
  }

  // 2. 유저 생성
  console.log('\n👤  유저 생성...')
  const createdUsers = []   // { user, authId }

  for (const user of data.users) {
    // 이미 있는지 확인
    const existing = await supabase('GET',
      `/rest/v1/profiles?email=eq.${encodeURIComponent(user.email)}&select=id`)
    if (existing && existing.length > 0) {
      console.log(`  ↩  ${user.name} <${user.email}> (기존)`)
      createdUsers.push({ user, authId: existing[0].id })
      continue
    }

    // Auth 유저 생성
    const authUser = await authAdmin('POST', '/users', {
      email:          user.email,
      password:       user.password,
      email_confirm:  true,
      user_metadata:  { name: user.name },
    })
    if (authUser?.error || !authUser?.id) {
      console.error(`  ❌  ${user.name} Auth 생성 실패:`, authUser?.error?.message ?? authUser)
      continue
    }

    const authId = authUser.id

    // profiles 레코드 생성
    const profile = await supabase('POST', '/rest/v1/profiles', {
      id:            authId,
      employee_id:   user.employee_id,
      name:          user.name,
      email:         user.email,
      role:          user.role,
      department_id: deptMap[user.department]?.id ?? null,
      position:      user.position,
      hire_date:     user.hire_date,
      is_active:     true,
    })
    if (!profile) {
      console.error(`  ❌  ${user.name} profile 생성 실패`)
      continue
    }

    // leave_balances 생성
    await supabase('POST', '/rest/v1/leave_balances', {
      employee_id: authId,
      year:        YEAR,
      total_days:  user.leave_total ?? 15,
      used_days:   0,
    })

    console.log(`  ✓  ${user.name} (${user.role}) <${user.email}>`)
    createdUsers.push({ user, authId })
  }

  // 3. 부서장 지정
  console.log('\n🏢  부서장 지정...')
  for (const { user, authId } of createdUsers) {
    if (!user.is_dept_manager) continue
    const dept = deptMap[user.department]
    if (!dept) continue
    await supabase('PATCH',
      `/rest/v1/departments?id=eq.${dept.id}`,
      { manager_id: authId })
    console.log(`  ✓  ${dept.name} → ${user.name}`)
  }

  // 4. 요약 출력
  console.log('\n' + '─'.repeat(60))
  console.log('✅  시드 완료! 테스트 계정 목록:\n')
  console.log('역할'.padEnd(10), '이름'.padEnd(8), '이메일'.padEnd(30), '비밀번호')
  console.log('─'.repeat(60))
  for (const user of data.users) {
    console.log(
      user.role.padEnd(10),
      user.name.padEnd(8),
      user.email.padEnd(30),
      user.password
    )
  }
  console.log()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
