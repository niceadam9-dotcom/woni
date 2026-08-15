/** 위임장 조립 실데이터 프로브 (소방계획서_22 S8) — 스테이징 DB의 실제 자체점검 건으로
 *  assembleDelegation → renderDelegation 실행 경로를 검증한다. 서버 액션 밖에서 돌리므로
 *  'server-only' 게이트는 react-server 조건으로 우회해야 한다:
 *    $env:NODE_OPTIONS='--conditions=react-server'; npx tsx scripts/_probe-delegation-assemble.mts
 *  쓰기: annex_inputs 테스트 행 1건 INSERT 후 즉시 DELETE(138 CHECK 실증) — 그 외 읽기 전용. */
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY

const { createAdminClient } = await import('../src/lib/supabase/admin')
const { assembleDelegation } = await import('../src/lib/annex-cover-official')
const { renderDelegation } = await import('../src/lib/doc-templates/delegation')

let pass = 0, fail = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}

const admin = createAdminClient()

// 실제 자체점검 건 — 일자 있는 최근 건부터 (plan_type null 또는 special*)
const { data: insps } = await admin.from('inspections')
  .select('id, plan_type, inspection_start_date, inspection_end_date')
  .not('inspection_start_date', 'is', null)
  .order('inspection_start_date', { ascending: false }).limit(30)
const target = ((insps ?? []) as Array<{ id: string; plan_type: string | null; inspection_start_date: string }>)
  .find(i => !i.plan_type || i.plan_type.startsWith('special'))
if (!target) { console.error('자체점검 건 없음 — 스테이징 데이터 확인'); process.exit(1) }
console.log(`대상 점검: ${target.id} (${target.inspection_start_date})`)

// ① 조립 — 실 서버 경로와 동일 함수
const { data, missing } = await assembleDelegation(admin, '', target.id)
check('조립 무예외 + typeLabel', ['작동점검', '최초점검', '종합점검'].includes(data.typeLabel), data.typeLabel)
check('점검일자 자동 산출', /^\d{4}\.\d{2}\.\d{2} 부터 ~ \d{4}\.\d{2}\.\d{2} 까지$/.test(data.periodLabel), data.periodLabel)
check('일수 산출', /^\d+일$/.test(data.daysLabel), data.daysLabel)
check('위임 일자 표기', /^\d{4}년 \d{1,2}월 \d{1,2}일$/.test(data.submitDate), data.submitDate)
console.log(`     관계인=${JSON.stringify(data.owner)} 대리인=${JSON.stringify(data.agent)} 관할=${JSON.stringify(data.station)}`)
console.log(`     missing(${missing.length}): ${missing.join(' | ') || '없음'}`)
check('공란은 missing으로 표면화(생년월일 등)', !data.owner.birth ? missing.some(m => m.includes('생년월일')) : true)

// ② 렌더 — 조립 결과 그대로
const html = renderDelegation(data)
check('렌더 성립(위임내용·유의사항·귀하)', html.includes('위 임 내 용') && html.includes('유 의 사 항') && html.includes('소방서(본부) 귀하'))
check('체크박스 √ 1개', (html.match(/\[√\]/g) ?? []).length === 1)

// ③ 138 CHECK 실증 — annex_inputs에 delegation 실INSERT(성공해야) 후 삭제, 엉터리 값은 거부돼야
const ins = await admin.from('annex_inputs').insert({
  inspection_id: target.id, annex_no: 'delegation',
  fields: { ownerBirth: '_probe_', agentBirth: '_probe_' },
} as Record<string, unknown>).select('id').single()
check('annex_inputs delegation INSERT 허용(138)', !ins.error, ins.error?.message ?? '')
if (ins.data) await admin.from('annex_inputs').delete().eq('id', (ins.data as { id: string }).id)
const bad = await admin.from('annex_inputs').insert({
  inspection_id: target.id, annex_no: '_bogus_', fields: {},
} as Record<string, unknown>)
check('엉터리 annex_no는 CHECK 거부(음성 대조)', !!bad.error)

console.log(`\n${pass}/${pass + fail} 통과`)
if (fail) process.exit(1)
