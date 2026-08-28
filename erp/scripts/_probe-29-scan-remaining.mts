// 소방계획서_29 R-1 — 잔여 화면 다크 스캔 + 스크린샷 (S4-1·S4-2 보조)
//
// 6화면(설정·대시보드·고객목록·점검업무·점검달력·휴가달력)은 기촬영 — 여기는 나머지.
// 각 화면에서 ①computed backgroundColor 휘도 스캔(밝은 면 목록) ②스크린샷(_shots/dark2-*.png).
// 별지 미리보기는 iframe 내부가 **라이트로 남는지**가 검사 항목이다(D-4 — 문서는 흰 종이가 정본).
// 실행: npx tsx scripts/_probe-29-scan-remaining.mts
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'theme-scan-rest@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const SCAN = `(function(){
  var out = [], seen = {};
  var els = document.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var cs = getComputedStyle(el);
    var bg = cs.backgroundColor;
    var m = /^rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)$/.exec(bg);
    if (!m) continue;
    var a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a < 0.5) continue;
    var lum = (0.2126*+m[1] + 0.7152*+m[2] + 0.0722*+m[3]) / 255;
    if (lum < 0.55) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) continue;
    // 의도적 라이트 축 제외: 문서 미리보기 iframe·서명/피난도 캔버스·사진(D-4·S3-6)
    if (el.tagName === 'IFRAME' || el.tagName === 'CANVAS' || el.tagName === 'IMG' || el.tagName === 'svg') continue;
    if (el.closest('iframe, canvas, svg')) continue;
    var cls = (typeof el.className === 'string' ? el.className : '').slice(0, 90);
    var key = el.tagName + '|' + cls + '|' + bg;
    if (seen[key]) continue;
    seen[key] = 1;
    out.push({ bg: bg, area: Math.round(r.width * r.height), tag: el.tagName, cls: cls, inline: (el.getAttribute('style') || '').slice(0, 60) });
  }
  out.sort(function(a,b){ return b.area - a.area; });
  return JSON.stringify(out.slice(0, 12));
})()`

type P = Awaited<ReturnType<typeof launch>>['page']
const brightTotals: Array<{ label: string; n: number }> = []

async function scanShot(page: P, path: string, label: string, slug: string) {
  await page.goto(`${BASE}${path}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1500)
  const raw2 = (await page.evaluate(SCAN)) as string
  const list = JSON.parse(raw2) as Array<{ bg: string; area: number; tag: string; cls: string; inline: string }>
  console.log(`\n── ${label} (${path}) — 밝은 면 ${list.length}종`)
  for (const it of list) {
    console.log(`   ${it.bg}  area=${it.area}  <${it.tag}> ${it.cls}${it.inline ? `  style="${it.inline}"` : ''}`)
  }
  await page.screenshot({ path: `scripts/_shots/dark2-${slug}.png` }).catch(() => {})
  brightTotals.push({ label, n: list.length })
  return list
}

try {
  userId = await mkUser({ email: EMAIL, name: '잔여스캔', employeeId: 'E2E-SCR' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, EMAIL)
  await page.goto(`${BASE}/settings`)
  await page.waitForSelector('[data-testid="theme-option-dark"]')
  await page.click('[data-testid="theme-option-dark"]')
  await page.waitForSelector('[data-testid="theme-saved"]', { timeout: 15000 })

  // ── 정적 라우트 ──
  const staticScreens: Array<[string, string, string]> = [
    ['/fire-plans/generate',       '작성 센터(문서 작업대)', 'fire-plans-generate'],
    ['/fire-plans/library',        '공통문구 라이브러리',    'fire-plans-library'],
    ['/documents',                 '문서',                  'documents'],
    ['/approvals',                 '전자결재',              'approvals'],
    ['/tax-invoices',              '세금계산서',            'tax-invoices'],
    ['/stock/status',              '재고 현황',             'stock-status'],
    ['/board',                     '게시판',                'board'],
    ['/mail',                      '메일',                  'mail'],
    ['/leaves',                    '휴가 신청',             'leaves'],
    ['/inquiries',                 '문의',                  'inquiries'],
    ['/inspection-ledger',         '점검대장',              'ledger'],
    ['/inspection-reports/status', '작성현황(보고서)',      'insp-reports'],
    ['/reports',                   '보고서 센터',           'reports'],
    ['/inspections/sms',           '문자 발송',             'sms'],
    ['/billing/status',            '청구 현황',             'billing'],
    ['/my/signature',              '서명(라이트 고정 캔버스)', 'my-signature'],
  ]
  for (const [path, label, slug] of staticScreens) await scanShot(page, path, label, slug)

  // ── 동적: 실데이터가 있는 고객·점검 건 ──
  const { data: fpf } = await raw.from('fire_plan_forms').select('customer_id').limit(1)
  const custId: string | null = fpf?.[0]?.customer_id
    ?? (await raw.from('customers').select('id').eq('is_active', true).limit(1)).data?.[0]?.id ?? null

  if (custId) {
    await scanShot(page, `/customers/${custId}`, '고객 상세(기본)', 'cust-detail')
    await scanShot(page, `/customers/${custId}?tab=plan&form=1.1`, '고객 상세 — 소방계획서 1.1', 'cust-plan-11')
    await scanShot(page, `/customers/${custId}?tab=plan&form=1.4`, '고객 상세 — 소방계획서 1.4', 'cust-plan-14')
    const annex = await scanShot(page, `/customers/${custId}?tab=plan&form=annex`, '고객 상세 — 별지 허브', 'cust-annex')
    void annex
    // D-4: 별지 미리보기 iframe 내부는 라이트가 정본 — 다크로 물들지 않았는지
    const iframeBg = await page.evaluate(`(function(){
      var f = document.querySelector('iframe');
      if (!f) return 'NO-IFRAME';
      try {
        var d = f.contentDocument;
        if (!d || !d.body) return 'NO-DOC';
        return getComputedStyle(d.body).backgroundColor;
      } catch (e) { return 'CROSS-ORIGIN'; }
    })()`) as string
    console.log(`\n   별지 iframe 내부 bg: ${iframeBg}`)
    if (iframeBg !== 'NO-IFRAME' && iframeBg !== 'NO-DOC' && iframeBg !== 'CROSS-ORIGIN') {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(iframeBg)
      const lum = m ? (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255 : 1
      // 투명(rgba(0,0,0,0))이면 UA 기본 흰 배경 위에 문서가 그려진다 — 라이트 유지로 판정
      const transparent = /rgba\(0, 0, 0, 0\)/.test(iframeBg)
      check('D-4 — 별지 미리보기 iframe 내부는 라이트 유지', transparent || lum > 0.55, iframeBg)
    }
  } else {
    console.log('\n⚠ 스테이징에 고객이 없어 고객 상세 축 생략')
  }

  const { data: insp } = await raw.from('inspections').select('id').order('created_at', { ascending: false }).limit(1)
  if (insp?.[0]?.id) {
    await scanShot(page, `/inspections/${insp[0].id}`, '점검 상세(회차 카드)', 'insp-detail')
    await scanShot(page, `/inspections/${insp[0].id}/sheet`, '점검표 입력 전용 페이지', 'insp-sheet')
  } else {
    console.log('\n⚠ 스테이징에 점검 건이 없어 점검표 입력 축 생략')
  }

  console.log('\n== 화면별 밝은 면 요약 ==')
  for (const t of brightTotals) console.log(`   ${String(t.n).padStart(2)}종  ${t.label}`)
  check('스캔 완주', true, `${brightTotals.length}화면`)
} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
