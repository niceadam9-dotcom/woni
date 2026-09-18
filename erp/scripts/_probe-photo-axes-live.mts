/** 새 사진 축 2개 실서버 실측 — 1.11.4 훈련·교육 4칸 · 1.14.2 증빙 2칸 (2026-09-18)
 *
 *  사진은 스토리지 바이트·EMU 좌표·drawing 파트가 얽혀 **오프라인 단언만으로 부족하다**
 *  (이 저장소 전례: 구조 83건 초록인데 LibreOffice 육안이 결함을 잡았다).
 *  실제 이미지를 올려 → 엑셀을 받아 → `xl/media`·`xl/drawings`에 박혔는지 되읽는다.
 *
 *  🚨 `process.exit` 금지(finally를 건너뛴다) · 스토리지 파일과 sections를 **원상복구**한다.
 *  실행: npx tsx scripts/_probe-photo-axes-live.mts   (localhost:3000)
 */
import JSZip from 'jszip'
import { launch, login, raw, mkUser, delUser } from './_e2e-helpers.mjs'

const BASE = 'http://localhost:3000'
const BUCKET = 'fire-plans'
const EMAIL = 'e2e-photo-axes@test.local'
let ctx: Awaited<ReturnType<typeof launch>> | null = null
let userId: string | null = null
let customerId = ''
let backup: Record<string, unknown> | null = null
const uploaded: string[] = []
let ok = true
const check = (name: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : '🚨 FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!pass) ok = false
}

/** 8×8 빨강 PNG — 유효한 바이트여야 수집기가 버리지 않는다(깨진 파일은 조용히 탈락한다) */
const PNG_8x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAG0lEQVR42mP8z8BQz0AEYBxVSF+F/'
  + 'xtQFQAAvxAB8kGZ2ZkAAAAASUVORK5CYII=', 'base64')

const sectionsOf = async () => {
  const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  return (data?.sections ?? {}) as Record<string, unknown>
}

try {
  const { data: cust } = await raw.from('customers').select('id, customer_name').eq('is_active', true).limit(1).single()
  if (!cust) throw new Error('스테이징에 고객이 없다')
  customerId = (cust as { id: string }).id
  console.log(`대상: ${(cust as { customer_name: string }).customer_name}`)
  backup = await sectionsOf()

  // ── 사진 6장 업로드(훈련 2·교육 2·홍보 2) ──
  const paths: string[] = []
  for (const tag of ['t1', 't2', 'e1', 'e2', 'p1', 'p2']) {
    const path = `${customerId}/_e2e-photo-${tag}.png`
    const { error } = await raw.storage.from(BUCKET).upload(path, PNG_8x8, { contentType: 'image/png', upsert: true })
    if (error) throw new Error(`업로드 실패 ${path}: ${error.message}`)
    uploaded.push(path); paths.push(path)
  }
  console.log(`사진 ${uploaded.length}장 업로드`)

  await raw.from('fire_plan_forms').update({
    sections: {
      ...backup,
      training: {
        ...((backup.training ?? {}) as object),
        photos: [
          { path: paths[0], kind: 'train', caption: '' }, { path: paths[1], kind: 'train', caption: '' },
          { path: paths[2], kind: 'edu', caption: '' }, { path: paths[3], kind: 'edu', caption: '' },
        ],
      },
      promoPhotos: [{ path: paths[4], caption: '' }, { path: paths[5], caption: '' }],
    },
  }).eq('customer_id', customerId)

  userId = await mkUser({ email: EMAIL, name: '사진축E2E', employeeId: 'E2E-PHOTO' })
  ctx = await launch()
  await login(ctx.page, EMAIL)

  const res = await ctx.page.request.get(`${BASE}/customers/${customerId}/fire-plan/xlsx`)
  console.log(`xlsx HTTP ${res.status()}`)
  if (!res.ok()) throw new Error(`라우트 ${res.status()}: ${(await res.text()).slice(0, 200)}`)
  const zip = await JSZip.loadAsync(new Uint8Array(await res.body()))

  const media = Object.keys(zip.files).filter(n => n.startsWith('xl/media/'))
  check('받은 파일에 그림 파트가 있다', media.length >= 6, `${media.length}장`)

  /* 🎯 시트별 drawing에 실제로 앵커가 박혔는가 — 「media에 있다」만으로는 부족하다
   *   (어느 시트에도 안 앉고 파일만 들어간 상태가 가능하다). */
  /* 🚨 시트명 → 파일명은 **`sheetFileMap`에게 묻는다.** 첫 판본은 workbook.xml 등장 순서로
   *   `sheet{N}.xml`을 지어냈다가 두 시트 모두 「0장」이라는 **거짓 빨강**을 냈다 —
   *   순서와 파일 번호는 1:1이 아니다(이 저장소의 「쪽≠시트 번호」와 같은 함정). */
  const { sheetFileMap } = await import('../src/lib/xlsx-inject.ts')
  const fileMap = await sheetFileMap(zip)
  const sheetDrawing = async (sheetName: string) => {
    const full = fileMap.get(sheetName)
    if (!full) return `(시트 없음: ${sheetName})`
    const base = full.replace(/^xl\/worksheets\//, '')
    const rels = await zip.file(`xl/worksheets/_rels/${base}.rels`)?.async('string')
    const m = rels?.match(/drawings\/(drawing\d+\.xml)/)
    return m ? await zip.file(`xl/drawings/${m[1]}`)?.async('string') ?? '' : ''
  }

  for (const [sheet, want] of [['1.11.4 결과기록부 뒷쪽', 4], ['1.14.2 화재예방 및 홍보 결과', 2]] as const) {
    const xml = await sheetDrawing(sheet)
    /* 🚨 이 라이터는 `oneCellAnchor`를 쓴다(크기를 `ext`로 준다) — `twoCellAnchor`로 세면
     *   **전부 0장**이 나와 거짓 빨강이 된다(내 계측기가 세 번째로 틀린 자리). */
    const anchors = (xml.match(/<xdr:(one|two)CellAnchor/g) ?? []).length
    check(`${sheet}에 그림 ${want}장이 앉았다`, anchors === want, `${anchors}장`)
  }

  /* 진단 — 0장이면 어디에 앉았는지, 라우트가 뭐라 고지했는지 본다 */
  if (!ok) {
    console.log('\n[진단]')
    console.log(`  고지: ${decodeURIComponent(res.headers()['x-fireplan-missing'] ?? '(없음)').slice(0, 400)}`)
    for (const name of Object.keys(zip.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n))) {
      const xml = await zip.file(name)!.async('string')
      console.log(`  ${name}: 앵커 ${(xml.match(/<xdr:(one|two)CellAnchor/g) ?? []).length}개`)
    }
    for (const s of ['1.11.4 결과기록부 뒷쪽', '1.14.2 화재예방 및 홍보 결과']) {
      console.log(`  fileMap["${s}"] = ${fileMap.get(s) ?? '(없음)'}`)
    }
  }

  console.log(`\n${ok ? '✅ 새 사진 축 2개가 받은 파일에서 확인됐다' : '🚨 사진이 시트에 안 앉았다'}`)
  process.exitCode = ok ? 0 : 1
} finally {
  if (customerId && backup) {
    await raw.from('fire_plan_forms').update({ sections: backup }).eq('customer_id', customerId)
    const after = await sectionsOf()
    console.log(`sections 복구: ${JSON.stringify(after) === JSON.stringify(backup) ? '✅ 동일' : '🚨 다르다'}`)
  }
  if (uploaded.length) {
    const { error } = await raw.storage.from(BUCKET).remove(uploaded)
    console.log(`업로드 파일 삭제: ${error ? `🚨 ${error.message}` : `✅ ${uploaded.length}장`}`)
  }
  if (userId) await delUser(userId)
  await ctx?.browser.close()
}
