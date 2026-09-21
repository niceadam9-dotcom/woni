/** 표지 「사진 표지」 개편 프로브 (2026-09-21 사용자 확정).
 *
 *  붙드는 것:
 *   ① 제목이 **이름 길이에 맞춰** 커진다 — 짧은 이름은 크게, 긴 이름은 넘치지 않게.
 *      고정 크기로는 불가능하다는 것이 이 개편의 근거다(종전 32pt에서 309명 중 32명이 넘쳤다).
 *   ② **어느 줄도 띠 폭을 넘지 않는다** — 넘으면 엑셀이 글자를 잘라 인쇄한다(조용한 손실).
 *   ③ 띠 높이가 줄 수를 감당한다 — 모자라면 둘째 줄이 테두리 밖으로 잘린다.
 *   ④ 🚨 **Excel 복구창 가드** — `fonts`·`cellXfs`의 `count`가 실제 개수와 같은가.
 *      어긋나면 LibreOffice는 조용히 통과하고 **Excel만** 복구 대화상자를 띄운다.
 *   ⑤ 표지에 **사진이 실제로 앉는다**(drawing 파트 + 미디어).
 *   ⑥ 정보 블록(소재지·작성)이 값으로 채워진다.
 *   ⑦ 표지 전체 높이가 **한 쪽**을 넘지 않는다.
 *
 *  실행: npx tsx scripts/_probe-cover-title.mts   (로컬 dev + 스테이징 DB)
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import JSZip from 'jszip'
import { coverTitleEm, coverTitleLayout, COVER_WIDTH_PT } from '../src/lib/fire-plan-cover-title'

const EMAIL = 'cover-title-e2e@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** 표지 폭 여유 — 제품의 SAFETY와 같은 값이면 자기채점이 된다. 일부러 **더 느슨하게** 잡아
 *  '넘쳤는가'만 독립으로 묻는다(제품이 0.94를 0.99로 바꿔도 진짜 넘칠 때만 빨강). */
const HARD_LIMIT = COVER_WIDTH_PT

try {
  userId = await mkUser({ email: EMAIL, name: '표지프로브', employeeId: 'E2E-CVTT' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // 이름 길이 스펙트럼 — 짧은·중간·가장 긴 실고객을 고른다(합성 이름으로는 실제 분포를 못 잰다)
  const { data: custs } = await raw.from('customers')
    .select('id, customer_name').eq('is_active', true).limit(2000)
  const sorted = (custs ?? []).slice().sort(
    (a: { customer_name: string }, b: { customer_name: string }) =>
      coverTitleEm(a.customer_name ?? '') - coverTitleEm(b.customer_name ?? ''))
  const picks = [
    sorted[0],                                   // 가장 짧은
    sorted[Math.floor(sorted.length / 2)],       // 중앙
    sorted[sorted.length - 1],                   // 가장 긴 = 최악
    (custs ?? []).find((c: { customer_name: string }) => c.customer_name === '용문3'),
  ].filter(Boolean)
  check('(전제) 검사 표본을 골랐다 — 짧은·중앙·가장 긴·용문3', picks.length >= 3, `${picks.length}건`)
  /** 고객별 제목 크기 — 루프 뒤에 「이름에 따라 갈리는가」를 묻는 원천 */
  const sizes: Array<{ name: string; sz: number; em: number }> = []

  for (const c of picks) {
    const label = `${c.customer_name}`
    const res = await page.request.get(`${BASE}/customers/${c.id}/fire-plan/xlsx`)
    if (!res.ok()) { check(`[${label}] 생성 200`, false, `${res.status()}`); continue }
    const buf = Buffer.from(await res.body())
    const z = await JSZip.loadAsync(buf)
    const sheet = await z.file('xl/worksheets/sheet1.xml')!.async('string')
    const styles = await z.file('xl/styles.xml')!.async('string')

    // ── 제목 칸 ──
    const cm = /<c[^>]*\br="A3"[^>]*>[\s\S]*?<\/c>/.exec(sheet)
    const title = cm ? (/<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[0])?.[1] ?? '') : ''
    const lines = title.split('\n')
    const sIdx = Number(/\bs="(\d+)"/.exec(cm?.[0] ?? '')?.[1] ?? NaN)
    const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '')
      .matchAll(/<xf[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0])
    const fonts = [...(/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)?.[1] ?? '')
      .matchAll(/<font>[\s\S]*?<\/font>|<font\/>/g)].map(m => m[0])
    const fontId = Number(/fontId="(\d+)"/.exec(xfs[sIdx] ?? '')?.[1] ?? NaN)
    const sz = Number(/<sz val="([\d.]+)"\/>/.exec(fonts[fontId] ?? '')?.[1] ?? NaN)

    /* ① 🚨 **「24pt 이상」으로 묻지 않는다.** 그렇게 물었더니 「고정 32pt로 되돌리기」 변이가
          그대로 통과했다(M1 생존, 2026-09-21) — 이 개편의 알맹이는 크기가 아니라 **이름에 따라
          달라진다**는 것이다. 그래서 ⓐ제품이 순수 계산을 실제로 썼는가 ⓑ표본 사이에서 실제로
          갈리는가(루프 뒤) ⓒ짧은 이름은 종전보다 큰가 — 셋으로 묻는다. */
    const want = coverTitleLayout(lines.join(' ').replace(/\s+/g, ' '))
    sizes.push({ name: label, sz, em: coverTitleEm(lines.join('')) })
    check(`[${label}] ① 제목 크기가 순수 계산과 같다 (${sz}pt · ${lines.length}줄)`,
      sz === want.fontPt, `산출물 ${sz}pt / 계산 ${want.fontPt}pt · ${JSON.stringify(lines)}`)

    // ② 어느 줄도 띠 폭을 넘지 않는다 — 이게 빨강이면 인쇄물에서 글자가 잘린다
    const widest = Math.max(...lines.map(t => coverTitleEm(t) * sz))
    check(`[${label}] ② 가장 넓은 줄이 띠 폭 안 (${widest.toFixed(0)} ≤ ${HARD_LIMIT.toFixed(0)}pt)`,
      widest <= HARD_LIMIT, `${widest.toFixed(0)}pt · ${JSON.stringify(lines)}`)

    // ③ 띠 높이가 줄 수를 감당하는가
    const rowTag = /<row[^>]*\br="3"[^>]*>/.exec(sheet)?.[0] ?? ''
    const ht = Number(/\bht="([\d.]+)"/.exec(rowTag)?.[1] ?? NaN)
    check(`[${label}] ③ 띠 높이 ${ht}pt ≥ 줄 수×글자 (${(lines.length * sz).toFixed(0)}pt)`,
      Number.isFinite(ht) && ht >= lines.length * sz, `ht=${ht} 줄=${lines.length} sz=${sz}`)
    // 줄바꿈이 켜져 있어야 `\n`이 두 줄로 보인다(꺼져 있으면 한 줄로 뭉개져 잘린다)
    check(`[${label}] ③ 제목 칸에 wrapText`, /wrapText="1"/.test(xfs[sIdx] ?? ''), xfs[sIdx]?.slice(0, 120) ?? '')

    // ④ 🚨 Excel 복구창 가드 — count가 실제 개수와 같은가
    const fontsCount = Number(/<fonts[^>]*count="(\d+)"/.exec(styles)?.[1] ?? NaN)
    const xfsCount = Number(/<cellXfs[^>]*count="(\d+)"/.exec(styles)?.[1] ?? NaN)
    check(`[${label}] ④ fonts count=${fontsCount} == 실제 ${fonts.length}`, fontsCount === fonts.length)
    check(`[${label}] ④ cellXfs count=${xfsCount} == 실제 ${xfs.length}`, xfsCount === xfs.length)

    // ⑤ 표지 사진 — **사진이 있으면 앉고, 없으면 안내가 남는다**가 계약이다.
    //    「그림이 있다」만 물으면 사진 없는 고객에서 빨강이 되고(오보), 「안내가 있다」만 물으면
    //    그림이 안 앉아도 초록이 된다. 둘의 **배타**를 묻는 것이 이 계약의 뜻이다.
    // 🚨 **자기닫힘을 먼저** 본다. `<c r="A5" s="3"/>`에 `<c[^>]*r="A5"[^>]*>`를 먼저 대면
    //    `[^>]*`가 `/`까지 먹어 매칭되고, 뒤의 `[\s\S]*?</c>`가 **다음 칸까지** 삼킨다
    //    (실제로 빈 A5가 A7의 '소재지'를 물어와 멀쩡한 제품이 빨갛게 나왔다 — 2026-09-21).
    const cellTextOf = (ref: string) => {
      const m = new RegExp(`<c[^>]*\\br="${ref}"[^>]*/>|<c[^>]*\\br="${ref}"[^>]*>[\\s\\S]*?</c>`).exec(sheet)
      return m ? (/<t[^>]*>([\s\S]*?)<\/t>/.exec(m[0])?.[1] ?? '') : ''
    }
    const hasDrawing = /<drawing r:id=/.test(sheet)
    const placeholder = cellTextOf('A5')
    check(`[${label}] ⑤ 사진이 앉으면 안내를 지우고, 없으면 안내를 남긴다`,
      hasDrawing ? placeholder === '' : placeholder.includes('위성사진'),
      `그림=${hasDrawing} 안내=${JSON.stringify(placeholder)}`)

    // ⑥ 정보 블록 — 위와 **같은 자**(cellTextOf)를 쓴다. 자를 두 벌 두면 한쪽만 낡는다.
    const cellText = cellTextOf
    // 주소는 **95%가 비어 있다**(실측 307명 중 292명) — 그래서 「있으면 라벨+값, 없으면 둘 다 없음」이
    // 계약이다. 「라벨이 늘 있다」로 물으면 빈 줄 위의 유령 라벨을 초록으로 통과시킨다.
    const addrL = cellText('A7'), addrV = cellText('M7')
    check(`[${label}] ⑥ 소재지 — 있으면 라벨+값, 없으면 둘 다 비움`,
      addrV.trim() ? addrL === '소재지' : addrL.trim() === '',
      `라벨=${JSON.stringify(addrL)} 값=${JSON.stringify(addrV)}`)
    check(`[${label}] ⑥ 작성 라벨·값(연도 포함)`, cellText('A8') === '작성' && /\d{4}년/.test(cellText('M8')),
      `${cellText('A8')} / ${cellText('M8')}`)

    // ⑦ 표지 전체가 한 쪽 안인가 (A4 세로 본문 한도 838pt — xlsx-wrap-height PAGE_BODY_PT)
    const total = [...sheet.matchAll(/<row[^>]*\bht="([\d.]+)"/g)].reduce((a, m) => a + Number(m[1]), 0)
    check(`[${label}] ⑦ 표지 높이 ${total.toFixed(0)}pt ≤ 838pt (한 쪽)`, total <= 838, `${total.toFixed(0)}pt`)

  }

  // ①ⓑ **이름에 따라 갈리는가** — 고정 크기로 되돌리면 여기서 걸린다(M1이 뚫은 구멍을 막는 단언)
  const distinct = new Set(sizes.map(s => s.sz))
  check(`① 제목 크기가 이름마다 다르다 (${sizes.map(s => `${s.name}=${s.sz}pt`).join(' · ')})`,
    distinct.size > 1, `서로 다른 크기 ${distinct.size}종`)
  // ①ⓒ **긴 이름일수록 작다** — 단조성이 곧 '폭에 맞춘다'는 뜻이다(우연한 다양성과 구별된다)
  const byEm = sizes.slice().sort((a, b) => a.em - b.em)
  check('① 이름이 길수록 제목이 작아진다(폭에 맞춘 결과)',
    byEm[0].sz >= byEm[byEm.length - 1].sz,
    byEm.map(s => `${s.name}(em ${s.em})=${s.sz}pt`).join(' · '))
  // ①ⓓ 가장 짧은 이름은 **종전 고정 32pt보다 확실히 크다**(사용자 요구 「몇 배」의 최소선)
  check('① 가장 짧은 이름은 종전 32pt의 두 배 이상', byEm[0].sz >= 64, `${byEm[0].name}=${byEm[0].sz}pt`)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
  summary()
}
