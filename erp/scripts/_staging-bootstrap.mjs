// 스테이징 초기화: 관리자 계정 생성 + 운영 DB에서 공휴일/회사정보 복사
// 실행: node scripts/_staging-bootstrap.mjs  (키: %TEMP%/sb-staging-svc.txt, 운영키: .env.local)
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const prod = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const stagingKey = readFileSync(join(process.env.TEMP, 'sb-staging-svc.txt'), 'utf8').trim()
const staging = createClient('https://nwflnzugwylhpdyodyog.supabase.co', stagingKey)

// 1) 스테이징 관리자 계정 (auth 트리거가 profiles 자동 생성)
const ADMIN_EMAIL = 'staging-admin@sjfire.co.kr'
const ADMIN_PW = process.argv[2]
if (!ADMIN_PW) { console.error('사용법: node _staging-bootstrap.mjs <관리자비밀번호>'); process.exit(1) }

const { data: created, error: userErr } = await staging.auth.admin.createUser({
  email: ADMIN_EMAIL,
  password: ADMIN_PW,
  email_confirm: true,
  user_metadata: { name: '스테이징관리자' },
})
if (userErr) console.log('관리자 생성:', userErr.message)
else console.log('관리자 생성 OK:', created.user.id)

// 프로필 role을 admin으로 승격
if (created?.user?.id) {
  const { error } = await staging.from('profiles')
    .update({ role: 'admin', name: '스테이징관리자', is_active: true })
    .eq('id', created.user.id)
  console.log('프로필 admin 승격:', error ? error.message : 'OK')
}

// 2) 공휴일 복사 (계획 영업일 계산 필수)
const { data: holidays } = await prod.from('holidays').select('date, name, is_national, year')
if (holidays?.length) {
  const { error } = await staging.from('holidays').insert(holidays)
  console.log(`공휴일 복사 ${holidays.length}건:`, error ? error.message : 'OK')
}

// 3) 회사 프로필 복사
const { data: company } = await prod.from('company_profile').select('*').limit(1)
if (company?.length) {
  const row = { ...company[0] }
  delete row.updated_by // 스테이징에 없는 프로필 FK 방지
  const { error } = await staging.from('company_profile')
    .upsert(row)
  console.log('회사 프로필 복사:', error ? error.message : 'OK')
}

// 확인
const { count: hc } = await staging.from('holidays').select('*', { count: 'exact', head: true })
const { data: profs } = await staging.from('profiles').select('email:name, role')
console.log('스테이징 공휴일:', hc, '건 / 프로필:', JSON.stringify(profs))
