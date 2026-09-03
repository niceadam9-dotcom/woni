/** 별지 미리보기 다크 모드 판독성 — 픽셀 실측 (무DB, dev 서버 불필요).
 *
 *  결함: 문서 골격에 배경 명시가 없으면 iframe 문서 배경이 **투명**이라 부모의 bg-surface가
 *  비친다. 다크 모드에서 그 배경이 어두워 검은 글자가 판독 불가("미리보기가 어둡다").
 *
 *  판정은 대조 설계다 — 같은 HTML에서 background 선언만 벗긴 **대조군**을 나란히 띄워,
 *  수리(문서가 흰 배경을 스스로 선언)가 실제로 델타를 만드는지 픽셀 밝기로 잰다.
 *  대조군이 어둡게 나오지 않으면 이 검사 자체가 항진명제다(그때는 FAIL).
 *
 *  실행: npx tsx scripts/_probe-preview-dark.mts */
import { chromium } from 'playwright'
import { renderDocument } from '../src/lib/doc-templates/base.ts'
import { renderReport10 } from '../src/lib/doc-templates/report1011.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`); ok ? pass++ : fail++
}

// 실제 서식 2종 — 9호 계열 골격(renderDocument 직접) + 10호(사용자 신고 표면)
const doc9 = renderDocument({ title: '판독성 표본', pages: ['<h1 class="doc-title">소방시설등 자체점검 실시결과 보고서</h1><table class="form"><tr><th>대상물 명칭</th><td>표본</td></tr></table>'] })
const doc10 = renderReport10({
  customerName: '표본', purpose: '', address: '표본로 1', ownerName: '', ownerPhone: '',
  mgrName: '', mgrPhone: '', rows: [], reportDate: '2026년 9월 3일', submitTo: '표본소방서장',
})

// 대조군 — background 선언만 벗긴다(수리 전 상태 재현)
const strip = (html: string) => html.replace(/background:\s*#fff;?/g, '')
check('대조군 생성 — background 선언이 실제로 벗겨졌다',
  doc9.includes('background: #fff') && !strip(doc9).includes('background: #fff'))

const harness = (label: string, html: string) => `
  <div style="background:#15151f;padding:8px" id="${label}">
    <iframe srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="width:400px;height:220px;border:0"></iframe>
  </div>`
const page9 = `<!doctype html><body style="margin:0">${harness('fixed9', doc9)}${harness('ctrl9', strip(doc9))}${harness('fixed10', doc10)}${harness('ctrl10', strip(doc10))}</body>`

const browser = await chromium.launch()
try {
  const pg = await (await browser.newContext({ viewport: { width: 900, height: 1100 } })).newPage()
  await pg.setContent(page9)
  await pg.waitForTimeout(400)
  // iframe 중앙부 픽셀 평균 밝기(0~255) — 문서 여백 영역이라 글자 없이 배경만 잡힌다
  const lum = async (id: string) => {
    const el = pg.locator(`#${id} iframe`)
    const buf = await el.screenshot()
    const png = await import('sharp').then(s => s.default(buf).raw().toBuffer({ resolveWithObject: true }))
    const { data, info } = png
    let sum = 0, n = 0
    // 중앙 1/3 영역만 — 테두리·글자 회피
    for (let y = Math.floor(info.height / 3); y < Math.floor(info.height * 2 / 3); y++) {
      for (let x = Math.floor(info.width / 3); x < Math.floor(info.width * 2 / 3); x++) {
        const o = (y * info.width + x) * info.channels
        sum += (data[o] + data[o + 1] + data[o + 2]) / 3; n++
      }
    }
    return Math.round(sum / n)
  }
  const [f9, c9, f10, c10] = [await lum('fixed9'), await lum('ctrl9'), await lum('fixed10'), await lum('ctrl10')]
  console.log(`  밝기 — 9호 수리=${f9} 대조군=${c9} · 10호 수리=${f10} 대조군=${c10}`)
  check('대조군(배경 없음)은 어둡다 — 검사가 항진명제가 아님', c9 < 80 && c10 < 80, `${c9}·${c10}`)
  check('수리본(9호 골격)은 밝다(흰 종이)', f9 > 200, String(f9))
  check('수리본(10호)은 밝다(흰 종이)', f10 > 200, String(f10))
} finally {
  await browser.close()
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
