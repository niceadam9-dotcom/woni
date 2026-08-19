/** 카카오 지도를 iframe으로 띄울 수 있는가 — 지도 모달 이식 전 확인 (소방계획서_24 S5-7)
 *  실행: npx tsx scripts/_probe-kakao-iframe.mts
 *
 *  폐지된 모니터링 화면의 KakaoMapModal은 `map.kakao.com/link/search/{주소}`를 iframe으로 띄웠다.
 *  그대로 되살리기 전에 **실제로 그려지는지** 본다 — 프레임이 막히면 빈 상자만 남고,
 *  그건 지도가 없는 것보다 나쁘다(있는 줄 알고 눌렀는데 아무것도 안 나온다).
 */
import { chromium } from 'playwright'

const ADDR = '경기도 양평군 양평읍 양근리 1'
const URLS = [
  `https://map.kakao.com/link/search/${encodeURIComponent(ADDR)}`,
  `https://map.kakao.com/?q=${encodeURIComponent(ADDR)}`,
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })

for (const url of URLS) {
  const blocked: string[] = []
  page.on('console', m => { if (/frame|X-Frame|refused/i.test(m.text())) blocked.push(m.text()) })

  await page.setContent(`<iframe id="f" src="${url}" style="width:900px;height:600px;border:0"></iframe>`)
  await page.waitForTimeout(6000)

  const info = await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement | null
    if (!f) return { ok: false, why: 'iframe 없음' }
    try {
      const d = f.contentDocument
      if (!d) return { ok: false, why: 'contentDocument 접근 불가(교차 출처 — 정상일 수도, 차단일 수도)' }
      const text = (d.body?.innerText ?? '').trim()
      return { ok: text.length > 0, why: text.slice(0, 120) || '본문 비어 있음' }
    } catch (e) {
      return { ok: false, why: `접근 예외: ${String(e).slice(0, 80)}` }
    }
  })

  // 교차 출처라 내부를 못 읽는 게 정상이므로, **화면에 실제로 뭔가 그려졌는지**를 픽셀로 본다.
  // 전부 흰색이면 차단된 것이다(빈 상자).
  const shot = await page.locator('#f').screenshot()
  const uniq = new Set<string>()
  for (let i = 0; i < shot.length - 3; i += 997) uniq.add(`${shot[i]},${shot[i + 1]},${shot[i + 2]}`)

  console.log(`\n— ${url}`)
  console.log(`  내부 접근: ${info.why}`)
  console.log(`  픽셀 다양성: ${uniq.size}종 (1~2종이면 빈 화면 = 차단)`)
  console.log(`  콘솔 차단 메시지: ${blocked.length ? blocked.slice(0, 2).join(' / ') : '없음'}`)
  console.log(`  판정: ${uniq.size > 5 ? '✅ 그려진다' : '❌ 빈 화면 — iframe 이식은 무의미'}`)
}

await browser.close()
