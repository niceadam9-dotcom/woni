// markdown → PDF (Playwright Chromium). Mermaid 다이어그램·표 렌더 포함.
// 실행: node scripts/_md-to-pdf.mjs <input.md> <output.pdf>
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) { console.error('usage: node _md-to-pdf.mjs <in.md> <out.pdf>'); process.exit(1) }

const md = readFileSync(inPath, 'utf8')
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Malgun Gothic','맑은 고딕',sans-serif; font-size: 12px; line-height: 1.55; color: #1a1a2e; padding: 8px 4px; }
  h1 { font-size: 22px; border-bottom: 3px solid #7b68ee; padding-bottom: 8px; color: #4b3fb8; }
  h2 { font-size: 16px; margin-top: 22px; border-bottom: 1px solid #d0ccf5; padding-bottom: 4px; color: #5a4fc0; }
  h3 { font-size: 13px; margin-top: 16px; color: #3a2f8f; background: #f5f4ff; padding: 5px 8px; border-radius: 5px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10.5px; }
  th { background: #7b68ee; color: #fff; padding: 5px 7px; text-align: left; }
  td { border: 1px solid #d8d4ee; padding: 4px 7px; vertical-align: top; }
  tr:nth-child(even) td { background: #faf9ff; }
  code { background: #f0eefa; padding: 1px 4px; border-radius: 3px; font-size: 10.5px; color: #b8256a; }
  pre { background: #f7f6fc; border: 1px solid #e0ddf5; border-radius: 6px; padding: 10px; overflow-x: auto; page-break-inside: avoid; }
  pre code { background: none; color: #1a1a2e; }
  .mermaid { text-align: center; margin: 12px 0; page-break-inside: avoid; }
  h3, table { page-break-inside: avoid; }
</style></head><body><div id="content"></div>
<script>
  const raw = ${JSON.stringify(md)};
  // mermaid 코드블록 분리
  marked.setOptions({ breaks: false });
  const tokens = marked.lexer(raw);
  let out = '';
  for (const t of tokens) {
    if (t.type === 'code' && t.lang === 'mermaid') out += '<div class="mermaid">' + t.text + '</div>';
    else out += marked.parser([t]);
  }
  document.getElementById('content').innerHTML = out;
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { htmlLabels: true } });
  window.__ready = mermaid.run().then(() => true).catch(e => { console.error('mermaid', e); return true; });
</script></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__ready, { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(1500)
await page.pdf({
  path: outPath, format: 'A4', printBackground: true,
  margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
})
await browser.close()
console.log('PDF 생성:', outPath)
