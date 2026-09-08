/** 「불량사진」 시트 — **HTTP 라우트 실호출** 왕복 (소방계획서_46 S4-7 잔여 축)
 *  실행: npx tsx --conditions=react-server scripts/_probe-46-http.mts
 *
 *  ⭐ 이 프로브가 존재하는 이유는 하나다. test-photo-sheet.mts·_probe-46-realdb.mts는
 *  **라이브러리를 직접 부른다**(buildDefectPhotoSheet + insertSheetAfter). 그래서 둘 다 초록이어도
 *  criteria 문구의 「**200**」 — 즉 인증·권한·조립·주입·삽입·스트리밍이 한 줄로 이어진
 *  진짜 응답 — 은 한 번도 실행된 적이 없었다. S4-7이 partial로 남아 있던 유일한 이유.
 *
 *  ⚠ 읽기 전용이다 — DB에 쓰는 것은 임시 계정(mkUser/delUser)뿐이고 점검·불량·사진은 손대지 않는다.
 *  산출 xlsx는 **실고객 사진**을 담으므로 임시 폴더에만 쓴다(저장소로 옮기지 말 것).
 *
 *  ⭐ 음성 대조군을 함께 싣는다. 「시트가 있다」만 재면 삽입이 무조건 일어나는 코드에서도
 *  초록이 된다 — 사진 없는 점검 건에서 **시트가 없어야** 그 초록이 무언가를 지킨 것이 된다.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-probe46-http@test.local'
const SHEET = '불량사진'
const AFTER = '현5'
/** 라우트가 읽는 것과 **같은** 자산 — 미디어 기준선을 여기서 뺀다 */
const TEMPLATE = join(process.cwd(), 'templates', 'report-workbook-full.xlsx')
/** 한 건 = 캡션·조치 전·조치 후 3행 (defect-photo-embed ROWS_PER_DEFECT) */
const ROWS_PER_DEFECT = 3

/** <sheets> 등장 순서 = localSheetId 축과 같은 인덱스 */
async function sheetOrder(bytes: Buffer): Promise<string[]> {
  const wb = await (await JSZip.loadAsync(bytes)).file('xl/workbook.xml')!.async('string')
  return [...wb.matchAll(/<sheet\s[^>]*\/>/g)].map(m => /\sname="([^"]*)"/.exec(m[0])?.[1] ?? '')
}

// ── 표본 고르기 — 사진 있는 점검(양성) · 사진 없는 점검(음성 대조군) ─────────────────
const { data: withPhoto, error: e1 } = await raw.from('inspection_defects')
  .select('inspection_id, defect_code, photo_url, after_photo_url')
  .or('photo_url.not.is.null,after_photo_url.not.is.null')
  .order('created_at', { ascending: true })
if (e1) { console.error('불량 조회 실패:', e1.message); process.exit(1) }

const byInsp = new Map<string, number>()
for (const r of withPhoto ?? []) byInsp.set(r.inspection_id as string, (byInsp.get(r.inspection_id as string) ?? 0) + 1)
if (byInsp.size === 0) {
  console.log('⚠ 실 DB에 사진 달린 불량이 0건 — 이 축은 표본이 생긴 뒤 다시 돌릴 것')
  process.exit(2)
}
const [posId, posCount] = [...byInsp.entries()].sort((a, b) => b[1] - a[1])[0]

// 음성 대조군 — 사진 달린 불량이 하나도 없는 점검 건
const { data: allInsp, error: e2 } = await raw.from('inspections').select('id').limit(1000)
if (e2) { console.error('점검 조회 실패:', e2.message); process.exit(1) }
const negId = (allInsp ?? []).map(r => r.id as string).find(id => !byInsp.has(id))
if (!negId) { console.log('⚠ 사진 없는 점검 건이 0건 — 음성 대조군을 만들 수 없다'); process.exit(2) }

console.log(`대상 ${BASE}`)
console.log(`양성 표본 ${posId} — 사진 달린 불량 ${posCount}건`)
console.log(`음성 대조군 ${negId} — 사진 달린 불량 0건\n`)

const dir = mkdtempSync(join(tmpdir(), 'http46-'))
let userId: string | null = null
/** launch()는 { browser, page }를 준다 — browser를 직접 주지 않는다 */
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '프로브46', employeeId: 'P46HTTP', role: 'admin' })
  const launched = await launch()
  browser = launched.browser
  const page = launched.page
  page.setDefaultTimeout(180_000)
  await login(page, EMAIL)

  // ── [1] 양성 — 200 · 「현5」 바로 뒤 · 행 수 ────────────────────────────────────
  console.log('[1] 사진 있는 점검 — HTTP 200 왕복')
  const res = await page.request.get(`${BASE}/inspections/${posId}/workbook`, { timeout: 180_000 })
  check('HTTP 200', res.status() === 200, `실제 ${res.status()}`)
  const ct = res.headers()['content-type'] ?? ''
  check('Content-Type이 xlsx', ct.includes('spreadsheetml'), ct)
  const missing = res.headers()['x-workbook-missing'] ?? ''
  console.log(`     X-Workbook-Missing: ${missing || '(없음)'}`)

  const body = Buffer.from(await res.body())
  const xlsx = join(dir, 'pos.xlsx')
  writeFileSync(xlsx, body)
  check('본문이 zip(PK)', body[0] === 0x50 && body[1] === 0x4b, `${body[0]},${body[1]}`)
  console.log(`     산출 ${(body.byteLength / 1024 / 1024).toFixed(2)}MB → ${xlsx}`)

  const order = await sheetOrder(body)
  const iAfter = order.indexOf(AFTER)
  const iSheet = order.indexOf(SHEET)
  check(`「${AFTER}」가 있다`, iAfter >= 0, order.slice(0, 5).join(','))
  check(`「${SHEET}」 시트가 실렸다`, iSheet >= 0)
  check(`「${SHEET}」가 「${AFTER}」 바로 뒤`, iSheet === iAfter + 1, `현5=${iAfter} 사진=${iSheet}`)

  const zip = await JSZip.loadAsync(body)
  const photoPart = Object.keys(zip.files).find(p => /^xl\/worksheets\/sheetPhoto\.xml$/.test(p))
  check('sheetPhoto.xml 파트 실재', !!photoPart)
  const sheetXml = await zip.file('xl/worksheets/sheetPhoto.xml')!.async('string')
  const rows = [...sheetXml.matchAll(/<row\s/g)].length
  check(`행 수가 3의 배수(1건=${ROWS_PER_DEFECT}행)`, rows > 0 && rows % ROWS_PER_DEFECT === 0, `${rows}행`)
  const blocks = rows / ROWS_PER_DEFECT
  console.log(`     블록 ${blocks}건 · ${rows}행 → 예상 ${Math.ceil(blocks / 3)}쪽 (3건/장)`)

  // ⚠ 자산에는 이미 `xl/media/image1.png`가 있다(로고). 「전부 .jpeg」를 zip 전체에 걸면
  // 그 기존 파트가 걸려 **제품이 옳은데도 붉어진다** — 실제로 한 번 그렇게 오보했다.
  // 축은 「**이번에 늘어난** 미디어」다: 자산 기준선을 빼고 센다(그러면 검사가 더 세진다).
  // ⚠ `Object.keys(zip)`이 아니라 `zip.files`다 — 전자는 JSZip 인스턴스의 속성명을 주고
  //   기준선이 **빈 집합**이 된다. 그러면 아래 「기존 미디어 그대로」가 every()의 공허 통과로
  //   초록이 되면서 아무것도 안 지킨다(실제로 한 번 그렇게 통과했다).
  const baseZip = await JSZip.loadAsync(readFileSync(TEMPLATE))
  const baseMedia = new Set(Object.keys(baseZip.files)
    .filter(p => p.startsWith('xl/media/') && !baseZip.files[p].dir))
  if (baseMedia.size === 0) { console.log('  ❌ 기준선 미디어가 0 — 자산 판독 실패'); process.exit(1) }
  const media = Object.keys(zip.files).filter(p => p.startsWith('xl/media/') && !zip.files[p].dir)
  const added = media.filter(p => !baseMedia.has(p))
  check('media에 사진이 실렸다', added.length > 0, `늘어난 ${added.length}장 / 전체 ${media.length}`)
  check('늘어난 미디어 확장자가 전부 .jpeg', added.length > 0 && added.every(p => p.endsWith('.jpeg')),
    added.slice(0, 3).join(','))
  check('자산 기존 미디어는 그대로 남아 있다', [...baseMedia].every(p => media.includes(p)))

  // ── [2] 음성 대조군 — 사진 0장이면 시트가 없어야 한다 ──────────────────────────
  console.log('\n[2] 사진 없는 점검 — 시트가 붙지 않는다(음성 대조군)')
  const res2 = await page.request.get(`${BASE}/inspections/${negId}/workbook`, { timeout: 180_000 })
  check('HTTP 200', res2.status() === 200, `실제 ${res2.status()}`)
  const body2 = Buffer.from(await res2.body())
  const order2 = await sheetOrder(body2)
  check(`「${SHEET}」 시트가 없다`, order2.indexOf(SHEET) === -1,
    `index ${order2.indexOf(SHEET)} — 삽입이 무조건 일어나고 있다`)
  check(`「${AFTER}」는 그대로 있다`, order2.indexOf(AFTER) >= 0)
  const zip2 = await JSZip.loadAsync(body2)
  check('sheetPhoto.xml 파트도 없다', !zip2.file('xl/worksheets/sheetPhoto.xml'))

  // ── [3] 인증 축 — 세션 없이는 산출물이 나가지 않는다 ────────────────────────────
  // ⚠ 라우트 본문은 401을 돌려주지만 **거기까지 가지 못한다** — 미들웨어가 먼저 /login으로
  //   307을 낸다. 그래서 「401이어야 한다」로 재면 제품이 옳은데도 붉어진다(실제로 오보했다).
  //   지켜야 할 것은 상태코드의 숫자가 아니라 **실고객 사진이 든 xlsx가 새어나가지 않는 것**이다.
  //   redirect를 따라가면 /login 200이 되어 통과처럼 보이므로 maxRedirects:0이 필수.
  console.log('\n[3] 인증 축 — 세션 없이 부르면 산출물이 안 나간다')
  const anon = await browser.newContext()
  const res3 = await anon.request.get(`${BASE}/inspections/${posId}/workbook`,
    { timeout: 60_000, maxRedirects: 0 })
  check('200이 아니다', res3.status() !== 200, `실제 ${res3.status()}`)
  check('로그인으로 돌려보내거나 거절한다(307/302/401/403)',
    [307, 302, 401, 403].includes(res3.status()), `실제 ${res3.status()}`)
  if (res3.status() === 307 || res3.status() === 302) {
    check('Location이 /login', (res3.headers()['location'] ?? '').startsWith('/login'),
      res3.headers()['location'] ?? '')
  }
  const leak = Buffer.from(await res3.body())
  check('본문이 xlsx가 아니다(zip 매직 없음)', !(leak[0] === 0x50 && leak[1] === 0x4b),
    `${leak.length}바이트`)
  await anon.close()
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}

summary()
