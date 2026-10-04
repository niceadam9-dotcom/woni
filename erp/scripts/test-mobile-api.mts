// C1 모바일 API 실호출 검사 — /api/mobile/sheet-save · /api/mobile/defect-add (2026-10-04)
//
// 앱이 하는 그대로 부른다: 실제 계정으로 로그인해 받은 Supabase access token을 Bearer로.
// 401 관문만 보는 배포 확증과 달리, **저장이 실제로 되고·재전송이 무해하고·충돌이 막히는지**를 본다.
// 수용 기준 「오프라인 입력 뒤 복귀 동기화 손실 0」의 서버 축(멱등·충돌)이 여기서 실측된다.
//
// 실행: npx tsx scripts/test-mobile-api.mts   (localhost:3000 기동 필요 · 스테이징 DB · 마이그 180 필요)
import { createClient } from '@supabase/supabase-js'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, PW } from './_e2e-helpers.mjs'
import { SUPABASE_URL, ANON_KEY } from './_env.mjs'

const stamp = Date.now().toString(36)
const EMAIL_A = `e2e-mobile-a-${stamp}@example.com`
const EMAIL_B = `e2e-mobile-b-${stamp}@example.com`
let userA = '', userB = '', customerId = '', inspectionId = ''

async function tokenOf(email: string): Promise<string> {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error || !data.session) throw new Error(`로그인 실패(${email}): ${error?.message}`)
  return data.session.access_token
}

async function sheetSave(token: string | null, body: unknown) {
  const r = await fetch(`${BASE}/api/mobile/sheet-save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> }
}

// 1×1 PNG — 업로드 가드(머리 바이트 검사)를 실제로 통과하는 진짜 이미지
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function defectAdd(token: string | null, fields: Record<string, string>, photo?: Buffer, photoName = 'p.png') {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  if (photo) fd.append('photo', new File([photo], photoName, { type: 'image/png' }))
  const r = await fetch(`${BASE}/api/mobile/defect-add`, {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd,
  })
  return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> }
}

async function responses() {
  const { data } = await raw.from('inspection_sheet_responses')
    .select('item_code, result, memo, updated_at, updated_by').eq('inspection_id', inspectionId)
  return (data ?? []) as Array<{ item_code: string; result: string; memo: string | null; updated_at: string; updated_by: string }>
}

async function main() {
  const up = await fetch(`${BASE}/login`).then(r => r.status).catch(() => 0)
  if (up !== 200) { console.log(`⏭ ${BASE} 미기동 — 건너뜀`); process.exit(0) }

  userA = await mkUser({ email: EMAIL_A, name: '모바일A', employeeId: `MA${stamp}`, role: 'employee' })
  userB = await mkUser({ email: EMAIL_B, name: '모바일B', employeeId: `MB${stamp}`, role: 'employee' })
  customerId = await mkCustomer({ customer_name: `E2E 모바일 ${stamp}`, created_by: userA })
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', plan_type: 'special_종합',
    inspection_start_date: '2026-10-04', status: 'in_progress', sequence_num: 1,
    assigned_employee_id: userA, created_by: userA,
  } as never).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspectionId = (insp as { id: string }).id

  // 범위 안 항목 2개 — 종합 회차라 종합전용도 범위 안이지만, 작동 축 가드와 무관하게 일반 항목을 고른다
  const { data: items } = await raw.from('inspection_sheet_items')
    .select('item_code').eq('comprehensive_only', false).not('item_code', 'like', 'X%').order('item_code').limit(2)
  const [c1, c2] = ((items ?? []) as Array<{ item_code: string }>).map(i => i.item_code)
  check('항목 코드 2개 확보', !!c1 && !!c2, `${c1}/${c2}`)

  const tA = await tokenOf(EMAIL_A)
  const tB = await tokenOf(EMAIL_B)

  console.log('\n── sheet-save: 인증·소유 관문')
  check('무인증 401', (await sheetSave(null, { inspectionId, rows: [] })).status === 401)
  check('위조 토큰 401', (await sheetSave('forged.token.x', { inspectionId, rows: [] })).status === 401)
  const bTry = await sheetSave(tB, { inspectionId, rows: [{ item_code: c1, result: 'O' }] })
  check('🎯 담당 아닌 직원 403 — 유효한 토큰이라도 남의 점검은 못 쓴다', bTry.status === 403, `${bTry.status}`)
  check('  · 403 뒤 DB 무기록', (await responses()).length === 0)
  check('잘못된 결과값 400', (await sheetSave(tA, { inspectionId, rows: [{ item_code: c1, result: 'Q' }] })).status === 400)

  console.log('\n── sheet-save: 저장·멱등')
  const s1 = await sheetSave(tA, { inspectionId, rows: [{ item_code: c1, result: 'O' }, { item_code: c2, result: 'X', memo: '헤드 파손' }] })
  check('저장 200 · saved 2', s1.status === 200 && s1.json.saved === 2, JSON.stringify(s1.json))
  let rs = await responses()
  check('DB에 2행', rs.length === 2)
  check('updated_by = 저장한 사람(앱 사용자)', rs.every(r => r.updated_by === userA))
  check('메모 저장', rs.find(r => r.item_code === c2)?.memo === '헤드 파손')
  const s1b = await sheetSave(tA, { inspectionId, rows: [{ item_code: c1, result: 'O' }, { item_code: c2, result: 'X', memo: '헤드 파손' }] })
  rs = await responses()
  check('🎯 같은 내용 재전송(오프라인 큐 at-least-once) — 여전히 2행, 중복 0', s1b.status === 200 && rs.length === 2, `${rs.length}행`)

  console.log('\n── sheet-save: 충돌(서버 최신 우선 + 사용자 확인)')
  const base = rs.find(r => r.item_code === c1)!.updated_at
  await new Promise(res => setTimeout(res, 1100))
  // 다른 사람(B)이 그 사이 같은 항목을 불량으로 바꿨다 — 웹에서 고친 상황
  await raw.from('inspection_sheet_responses').update({ result: 'X', updated_by: userB, updated_at: new Date().toISOString() })
    .eq('inspection_id', inspectionId).eq('item_code', c1)
  const s2 = await sheetSave(tA, { inspectionId, rows: [{ item_code: c1, result: 'O', base_updated_at: base }] })
  const conflicts = (s2.json.conflicts ?? []) as Array<{ item_code: string; server: { result: string } }>
  check('🎯 충돌 반환 1건 — 낡은 기준점으로는 남의 값을 덮지 않는다', s2.status === 200 && conflicts.length === 1 && conflicts[0].item_code === c1, JSON.stringify(s2.json))
  check('  · 충돌 항목은 저장 안 됨(saved 0)', s2.json.saved === 0)
  check('  · 서버 값(X) 그대로', (await responses()).find(r => r.item_code === c1)?.result === 'X')
  check('  · 충돌 응답에 서버 값이 실린다(앱이 보여 줄 재료)', conflicts[0]?.server?.result === 'X')
  const s3 = await sheetSave(tA, { inspectionId, rows: [{ item_code: c1, result: 'O', base_updated_at: base }], force: true })
  check('🎯 force(사용자가 「내 값으로 덮기」) — 덮어쓴다', s3.status === 200 && (await responses()).find(r => r.item_code === c1)?.result === 'O')
  // 대조군 — 같은 값이면 충돌이 아니다(헛경고 금지)
  await raw.from('inspection_sheet_responses').update({ updated_by: userB, updated_at: new Date(Date.now() + 5000).toISOString() })
    .eq('inspection_id', inspectionId).eq('item_code', c1)
  const s4 = await sheetSave(tA, { inspectionId, rows: [{ item_code: c1, result: 'O', base_updated_at: base }] })
  check('대조군: 서버가 새로워도 값이 같으면 충돌 아님', ((s4.json.conflicts ?? []) as unknown[]).length === 0, JSON.stringify(s4.json))

  console.log('\n── sheet-save: 해제(／)')
  const s5 = await sheetSave(tA, { inspectionId, rows: [], clearCodes: [c2] })
  rs = await responses()
  check('clearCodes — DB 행이 실제로 지워진다', s5.status === 200 && !rs.some(r => r.item_code === c2), `${rs.map(r => r.item_code)}`)

  console.log('\n── defect-add: 관문')
  const key = `k${stamp}abcdefgh`
  check('무인증 401', (await defectAdd(null, { inspectionId, clientKey: key, defectName: 'x' })).status === 401)
  check('🎯 담당 아닌 직원 403', (await defectAdd(tB, { inspectionId, clientKey: key, defectName: 'x' })).status === 403)
  check('키 없음 400(멱등 키 필수)', (await defectAdd(tA, { inspectionId, clientKey: '', defectName: 'x' })).status === 400)
  check('잘못된 등급 400', (await defectAdd(tA, { inspectionId, clientKey: key, defectName: 'x', severity: '심각' })).status === 400)
  const { count: c0 } = await raw.from('inspection_defects').select('id', { count: 'exact', head: true }).eq('inspection_id', inspectionId)
  check('  · 거절된 요청은 DB 무기록', c0 === 0, `${c0}건`)

  console.log('\n── defect-add: 등록·사진·멱등')
  const d1 = await defectAdd(tA, { inspectionId, clientKey: key, defectName: '소화기 압력 미달', defectDetail: '3층 복도', severity: '중대' }, PNG)
  check('등록 200 · 신규 · 사진 첨부', d1.status === 200 && d1.json.existed === false && d1.json.photoAttached === true, JSON.stringify(d1.json))
  const defectId = d1.json.defectId as string
  const { data: row } = await raw.from('inspection_defects').select('defect_name, severity, photo_url, client_key').eq('id', defectId).single()
  const r1 = row as { defect_name: string; severity: string; photo_url: string | null; client_key: string }
  check('필드 저장(이름·등급·키)', r1.defect_name === '소화기 압력 미달' && r1.severity === '중대' && r1.client_key === key)
  check('🎯 사진은 **경로**로 저장(공개 URL 금지 — 비공개 버킷)', !!r1.photo_url && !r1.photo_url.startsWith('http') && r1.photo_url.startsWith(`${inspectionId}/${defectId}/`), r1.photo_url ?? 'null')
  const { data: signed } = await raw.storage.from('inspection-defects').createSignedUrl(r1.photo_url!, 60)
  const got = signed?.signedUrl ? await fetch(signed.signedUrl).then(r => r.status) : 0
  check('  · 그 경로의 파일이 실제로 받아진다(서명 URL 200)', got === 200, `${got}`)

  const d2 = await defectAdd(tA, { inspectionId, clientKey: key, defectName: '소화기 압력 미달', defectDetail: '3층 복도', severity: '중대' }, PNG)
  const { count: c2n } = await raw.from('inspection_defects').select('id', { count: 'exact', head: true }).eq('inspection_id', inspectionId)
  check('🎯 같은 키 재전송 — 기존 행 반환, 불량 1건 그대로(중복 0)', d2.status === 200 && d2.json.existed === true && d2.json.defectId === defectId && c2n === 1, `${JSON.stringify(d2.json)} · ${c2n}건`)
  const { data: row2 } = await raw.from('inspection_defects').select('photo_url').eq('id', defectId).single()
  check('  · 재전송이 사진을 다시 올리지 않는다(경로 불변)', (row2 as { photo_url: string }).photo_url === r1.photo_url)
  const { data: objs } = await raw.storage.from('inspection-defects').list(`${inspectionId}/${defectId}`)
  check('  · 스토리지에도 파일 1개뿐', (objs ?? []).length === 1, `${(objs ?? []).length}개`)

  // 사진 없이 먼저 들어간 불량에 재전송이 사진만 마저 붙인다(업로드 중 끊김 복구)
  const key2 = `k${stamp}ijklmnop`
  const d3 = await defectAdd(tA, { inspectionId, clientKey: key2, defectName: '유도등 점등 불량' })
  const d4 = await defectAdd(tA, { inspectionId, clientKey: key2, defectName: '유도등 점등 불량' }, PNG)
  const { data: row3 } = await raw.from('inspection_defects').select('photo_url').eq('id', d3.json.defectId as string).single()
  check('🎯 사진 없이 들어간 불량 — 재전송이 사진만 마저 붙인다', d4.json.existed === true && !!(row3 as { photo_url: string | null }).photo_url, JSON.stringify(d4.json))

  // 형식 거절은 영구 실패 — 불량은 성공으로 돌려주고 사진 거절만 알린다(큐 무한 재시도 방지)
  const key3 = `k${stamp}qrstuvwx`
  const d5 = await defectAdd(tA, { inspectionId, clientKey: key3, defectName: '방화문 닫힘 불량' }, Buffer.from('not an image at all'), 'p.png')
  check('🎯 이미지 아닌 파일 — 불량은 200 저장·photoRejected로 알림(재시도 유발 안 함)', d5.status === 200 && !!d5.json.photoRejected && d5.json.photoAttached === false, `${d5.status} ${JSON.stringify(d5.json)}`)

  // 웹이 같은 불량을 보는가 — 단계 동기화가 돌았다면 ⑤ 행이 미완료다
  const { data: step5 } = await raw.from('inspection_steps').select('status').eq('inspection_id', inspectionId).eq('step_num', 5).maybeSingle()
  check('단계 동기화 — 불량이 있으니 ⑤ 조치가 완료가 아니다', !!step5 && (step5 as { status: string }).status !== 'completed', JSON.stringify(step5))
}

main()
  .catch(e => { check('실행 중 예외 없음', false, String(e)) })
  .finally(async () => {
    if (inspectionId) {
      const { data: objs } = await raw.storage.from('inspection-defects').list(inspectionId)
      for (const d of (objs ?? [])) {
        const { data: files } = await raw.storage.from('inspection-defects').list(`${inspectionId}/${d.name}`)
        const paths = (files ?? []).map(f => `${inspectionId}/${d.name}/${f.name}`)
        if (paths.length) await raw.storage.from('inspection-defects').remove(paths)
      }
    }
    await cleanupCustomer(customerId)
    await delUser(userA)
    await delUser(userB)
    summary()
  })
