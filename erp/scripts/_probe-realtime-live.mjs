// S5-7 라이브 스모크 — publication 등록만으로는 부족: Realtime 서비스가 프로젝트 레벨로
// 실제 이벤트를 전달하는지 확인한다 (소방계획서_16 S5-7 · S5-8 파이프라인).
// 검증 3건: ① inspection_sheet_responses INSERT 이벤트 수신
//           ② 같은 테이블 DELETE 이벤트 수신 (REPLICA IDENTITY FULL이어야 필터 매칭 — 122)
//           ③ notifications INSERT 이벤트 수신 (알림 벨 경로 — K-3 해소 확인)
// 실행: node scripts/_probe-realtime-live.mjs   (스테이징 DB — .env.local)
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const raw = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}
const waitFor = (fn, ms = 10000) => new Promise(resolve => {
  const t0 = Date.now()
  const iv = setInterval(() => {
    if (fn()) { clearInterval(iv); resolve(true) }
    else if (Date.now() - t0 > ms) { clearInterval(iv); resolve(false) }
  }, 100)
})

const ITEM = 'ZZ-RT-SMOKE'
let inspId = ''
let profileId = ''
let notifId = ''
let smokeRowId = ''

try {
  // 기존 점검 건·프로필 하나를 빌린다 (행 생성은 스모크 행뿐 — finally에서 정리)
  const { data: insp } = await raw.from('inspections').select('id').limit(1).maybeSingle()
  const { data: prof } = await raw.from('profiles').select('id').limit(1).maybeSingle()
  if (!insp || !prof) throw new Error('스테이징에 inspections/profiles 데이터가 없어 스모크 불가')
  inspId = insp.id
  profileId = prof.id

  const events = { respIns: false, respDel: false, notifIns: false }
  let subscribed = false
  const ch = raw.channel('rt-smoke')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'inspection_sheet_responses', filter: `inspection_id=eq.${inspId}` },
      p => { if (p.new?.item_code === ITEM) events.respIns = true })
    // DELETE 제약(실측): filter 미지원 + old에 PK만 — 스모크 행의 id로 매칭 (훅은 전체 갱신으로 처리)
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'inspection_sheet_responses' },
      p => { if (p.old?.id && p.old.id === smokeRowId) events.respDel = true })
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profileId}` },
      p => { if (p.new?.title === 'RT-SMOKE') events.notifIns = true })
    .subscribe(status => { if (status === 'SUBSCRIBED') subscribed = true })

  check('채널 구독(SUBSCRIBED)', await waitFor(() => subscribed, 15000), '— Realtime 서비스가 프로젝트 레벨 OFF일 수 있음')

  // SUBSCRIBED 직후 첫 이벤트는 서버 WAL 리스너 활성화 지연으로 유실될 수 있다(2026-08-18
  // 실측: 1차 ① 미수신 → 재실행 연속 4/4). 미수신이면 행을 지우고 1회 재삽입해 레이스만 걸러낸다.
  for (let attempt = 0; attempt < 2 && !events.respIns; attempt++) {
    const { data: smokeRow, error: insErr } = await raw.from('inspection_sheet_responses')
      .insert({ inspection_id: inspId, item_code: ITEM, result: 'O' }).select('id').single()
    if (insErr) throw new Error(`스모크 행 삽입 실패: ${insErr.message}`)
    smokeRowId = smokeRow.id
    if (!(await waitFor(() => events.respIns)) && attempt === 0)
      await raw.from('inspection_sheet_responses').delete().eq('id', smokeRowId)
  }
  check('① 점검표 응답 INSERT 이벤트 수신', events.respIns)

  await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId).eq('item_code', ITEM)
  check('② DELETE 이벤트 수신 (무필터 구독·PK 매칭 — filter·old 전컬럼은 미지원 실측)', await waitFor(() => events.respDel))

  const { data: notif, error: nErr } = await raw.from('notifications')
    .insert({ recipient_id: profileId, title: 'RT-SMOKE', message: 'Realtime 스모크 — 자동 삭제됨', type: 'approved' })
    .select('id').single()
  if (nErr) throw new Error(`알림 삽입 실패: ${nErr.message}`)
  notifId = notif.id
  check('③ notifications INSERT 이벤트 수신 (알림 벨 경로)', await waitFor(() => events.notifIns))

  await raw.removeChannel(ch)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (inspId) await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId).eq('item_code', ITEM)
  if (notifId) await raw.from('notifications').delete().eq('id', notifId)
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
