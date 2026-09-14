// 1.10 「전년도 업무 실시사항」 라벨 줄바꿈 프로브 — image-14의 '작/성', '보/관' 쪼개짐.
// 판정축: 라벨 span이 몇 줄로 그려졌는가(getClientRects) + 칸을 넘쳤는가(scrollWidth).
// 배율 4단계(xxl+boost)까지 재고, 마지막에 옛 CSS(w-24 고정px)로 되돌리는 변이로 프로브가 빨강이 되는지 확인한다.
import { raw, launch, login, mkUser, delUser, check, summary, BASE } from './_e2e-helpers.mjs'

const LABELS = ['소방계획서 작성', '소방계획서 보관', '자체점검 작동', '자체점검 종합', '소방안전교육', '소방훈련']
const EMAIL = 'probe-form110-label@test.local'

/** 라벨 span들의 렌더 실측 */
async function measure(page) {
  return page.evaluate(labels => labels.map(label => {
    const g = document.querySelector(`div[role="group"][aria-label="${label}"]`)
    if (!g) return { label, missing: true }
    const el = g.querySelector('span')
    const cs = getComputedStyle(el)
    // ⚠ el.getClientRects()는 못 쓴다 — 이 span은 flex 아이템이라 **블록화**돼, 글자가 두 줄로
    //   접혀도 rect는 늘 1개다(그걸로 재면 결함이 있어도 초록). 줄 수는 텍스트에 Range를 씌워
    //   센다 — Range의 client rect는 줄상자(line box)마다 하나씩 나온다.
    const rng = document.createRange()
    rng.selectNodeContents(el)
    return {
      label,
      lines: rng.getClientRects().length,         // 2 이상 = 줄바꿈됨
      overflow: el.scrollWidth - el.clientWidth,  // 0 초과 = 칸 밖으로 삐져나감
      text: el.textContent,
      width: Math.round(el.getBoundingClientRect().width),
      height: Math.round(el.getBoundingClientRect().height),
      fontSize: cs.fontSize,
      whiteSpace: cs.whiteSpace,
    }
  }), LABELS)
}

function report(tag, rows) {
  for (const r of rows) {
    if (r.missing) { check(`${tag} ${r.label} 존재`, false, '(role=group 못 찾음)'); continue }
    check(`${tag} 「${r.label}」 한 줄`, r.lines === 1, `lines=${r.lines} w=${r.width}px h=${r.height}px fs=${r.fontSize}`)
    check(`${tag} 「${r.label}」 칸 안`, r.overflow <= 0, `overflow=${r.overflow}px`)
  }
}

const { data: cust, error: cErr } = await raw.from('customers').select('id,customer_name')
  .eq('is_active', true).order('created_at', { ascending: true }).limit(1)
if (cErr) { console.error(`고객 조회 실패: ${cErr.message}`); process.exit(2) }
if (!cust?.length) { console.error('활성 고객이 없다 — 프로브 중단'); process.exit(2) }
const { id: cid, customer_name: cname } = cust[0]
console.log(`대상 고객: ${cname} (${cid})`)

const uid = await mkUser({ email: EMAIL, name: '라벨프로브', employeeId: 'PRB-L110' })
const { browser, page } = await launch()
try {
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${cid}?tab=plan&form=1.10`)
  // dutyAuto 로딩이 끝나야 markPair가 그려진다 — networkidle은 이 화면에 안 온다(서버 액션 폴링)
  await page.waitForSelector('div[role="group"][aria-label="소방계획서 작성"]', { timeout: 30000 })

  console.log('\n[1] 기본 배율')
  const base = await measure(page)
  report('기본', base)
  console.log(`  · 라벨 칸 폭 ${base[0].width}px / white-space=${base[0].whiteSpace}`)
  await page.screenshot({ path: 'scripts/_out-form110-label-base.png', clip: await clipOf(page) })

  console.log('\n[2] 최대 배율 (data-fs=xxl + data-fs-boost)')
  await page.evaluate(() => {
    document.documentElement.dataset.fs = 'xxl'
    document.getElementById('c-1.10-prev').setAttribute('data-fs-boost', '')
  })
  await page.waitForTimeout(300)
  const big = await measure(page)
  report('최대배율', big)
  console.log(`  · 라벨 칸 폭 ${big[0].width}px (기본 ${base[0].width}px) / fs=${big[0].fontSize}`)
  check('최대배율에서 라벨 칸도 함께 넓어짐(em 파생)', big[0].width > base[0].width,
    `${base[0].width} → ${big[0].width}`)
  await page.screenshot({ path: 'scripts/_out-form110-label-xxl.png', clip: await clipOf(page) })

  // 옛 CSS = w-24(96px 고정 px) + 줄바꿈 허용. 이걸 되살려 프로브가 실제로 이 결함을 잡는지 본다.
  const applyOldCss = () => page.evaluate(() => {
    for (const g of document.querySelectorAll('div[role="group"]')) {
      const el = g.querySelector('span')
      if (el) { el.style.width = '6rem'; el.style.whiteSpace = 'normal'; el.style.flexShrink = '1' }
    }
  })
  const setScale = big => page.evaluate(on => {
    if (on) { document.documentElement.dataset.fs = 'xxl'; document.getElementById('c-1.10-prev').setAttribute('data-fs-boost', '') }
    else { document.documentElement.removeAttribute('data-fs'); document.getElementById('c-1.10-prev').removeAttribute('data-fs-boost') }
  }, big)

  console.log('\n[3a] 변이 — 옛 CSS + 기본 배율')
  await setScale(false); await applyOldCss(); await page.waitForTimeout(200)
  const old1 = await measure(page)
  const wrap1 = old1.filter(r => !r.missing && r.lines > 1).map(r => r.label)
  console.log(`  라벨칸 폭 ${old1[0].width}px · 높이 ${old1[0].height}px · 쪼개진 라벨: ${wrap1.length ? wrap1.join(', ') : '(없음)'} — 글자 ${old1[0].fontSize}`)
  // 기본 배율에선 7글자 ≈ 94.5px < 96px라 아슬아슬하게 안 쪼개진다. 그래서 여태 안 들켰다.
  check('[3a] 기본 배율에서는 옛 CSS도 멀쩡 = 이 결함은 배율을 올려야 나온다',
    wrap1.length === 0, `쪼개진 것=${JSON.stringify(wrap1)}`)

  console.log('\n[3b] 변이 — 옛 CSS + 최대 배율 (image-14 재현)')
  await setScale(true); await applyOldCss(); await page.waitForTimeout(300)
  const old2 = await measure(page)
  const wrap2 = old2.filter(r => !r.missing && r.lines > 1).map(r => r.label)
  console.log(`  라벨칸 폭 ${old2[0].width}px · 높이 ${old2[0].height}px · 쪼개진 라벨: ${wrap2.length ? wrap2.join(', ') : '(없음)'} — 글자 ${old2[0].fontSize}`)
  check('[3b] 변이: 옛 w-24에서 「소방계획서 작성」이 쪼개진다(프로브가 이 결함을 잡는다는 증거)',
    wrap2.includes('소방계획서 작성'), `쪼개진 것=${JSON.stringify(wrap2)}`)
  check('[3b] 변이: 옛 w-24에서 「소방계획서 보관」도 쪼개진다', wrap2.includes('소방계획서 보관'))
  check('[3b] 변이가 무차별이 아님 — 같은 배율에서 짧은 라벨(소방훈련)은 멀쩡',
    !wrap2.includes('소방훈련'), `쪼개진 것=${JSON.stringify(wrap2)}`)
  await page.screenshot({ path: 'scripts/_out-form110-label-old.png', clip: await clipOf(page) })
} finally {
  await browser.close()
  await delUser(uid)
}
summary()

async function clipOf(page) {
  const box = await page.locator('[id="c-1.10-prev"]').boundingBox()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}
