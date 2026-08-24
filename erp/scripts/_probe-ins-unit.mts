/** 화재보험 가입금액 **단위**를 법정 서식 원문(hwpx)에서 직접 확인.
 *  파생 요약본(_doc01/*.MD)이나 남의 주석을 믿지 않는다([[feedback_legal_form_source]]) —
 *  `fire-plan-info-panel.tsx:377`은 "별지 9호 원문이 '천만원'"이라 적었고 갑지 서식은 '만원'이다.
 *  둘 중 하나는 틀렸으므로 원문 본문 텍스트를 뽑아 앞뒤 문맥과 함께 본다. */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'

const out: string[] = []
const TARGETS = [
  ['별지9호 placeholder(hwpx)', '../erp_goal/_form/별지9호-placeholder.hwpx'],
]
for (const [label, path] of TARGETS) {
  out.push(`\n### ${label} — ${path}`)
  let zip: JSZip
  try { zip = await JSZip.loadAsync(readFileSync(path)) } catch (e) { out.push(`  열기 실패: ${(e as Error).message}`); continue }
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir)
  out.push(`  파트 ${names.length}개`)
  for (const n of names) {
    if (!/\.(xml|hpf|rels)$/i.test(n) && !n.includes('section')) continue
    const raw = await zip.file(n)!.async('string')
    // 본문 텍스트만: <hp:t>...</hp:t> 연결
    const text = [...raw.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)].map(m => m[1]).join('')
      || raw.replace(/<[^>]+>/g, '')
    for (const key of ['가입금액', '천만원', '만원', '보험사']) {
      let i = -1
      while ((i = text.indexOf(key, i + 1)) !== -1) {
        const ctx = text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ')
        out.push(`  [${n}] '${key}' @${i} … ${ctx} …`)
      }
    }
  }
}
writeFileSync('scripts/_probe-ins-unit.txt', out.join('\n'), 'utf8')
console.log('ok')
