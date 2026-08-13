// 로컬 Gotenberg 대체 서버 — 이 PC에서도 PDF 생성을 가능하게 한다
//
// 배경: PDF 변환은 Gotenberg 컨테이너(스테이징 gotenberg-staging / 운영 gotenberg-prod)에만 있어
// 로컬에서는 별지 서식·엑셀 대조 PDF를 뽑을 수 없었다(R5-7이 partial로 막혀 있던 이유).
// 이 PC엔 Docker가 없지만 **Playwright Chromium**(HTML→PDF)과 **LibreOffice**(오피스→PDF)가 있다.
// 그래서 앱을 고치는 대신 **Gotenberg와 같은 HTTP API를 말하는 사이드카**를 띄운다 —
// src/lib/pdf.ts는 한 줄도 바꾸지 않고 GOTENBERG_URL만 이쪽을 가리키면 된다.
//
// 실행:  node scripts/local-gotenberg.mjs            (기본 포트 3010)
//        node scripts/local-gotenberg.mjs --port 3020
// 사용:  .env.local 에  GOTENBERG_URL=http://localhost:3010
//
// 지원 라우트(앱이 실제로 쓰는 것만)
//   GET  /health                        — gotenbergHealthy()
//   POST /forms/chromium/convert/html   — 별지 서식·소방계획서 본문 (Playwright Chromium)
//   POST /forms/libreoffice/convert     — xlsx·odt → PDF (LibreOffice headless)
//   POST /forms/pdfengines/merge        — 합본. pdf-lib가 있으면 병합, 없으면 501+안내
//
// ⚠ 렌더러가 다르므로 **운영과 픽셀 단위로 같지 않을 수 있다**. 레이아웃 최종 확인은 스테이징에서.

import http from 'node:http'
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 3010

// ⚠ Windows에서는 **soffice.com**(콘솔판)을 쓴다. soffice.exe는 런처라 변환이 끝나기 전에 반환해
// 호출부가 완료를 기다리지 못하고, 실측상 한 건에 48초가 걸렸다(.com은 워밍업 후 1초대).
const SOFFICE = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.com',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
  '/usr/bin/soffice',
].find(p => existsSync(p))

let browser = null
async function getBrowser() {
  if (browser) return browser
  const { chromium } = await import('playwright')
  browser = await chromium.launch()
  return browser
}

/** multipart 파싱 — Node 24의 undici가 Request.formData()로 처리해준다(의존성 0) */
async function parseForm(req, body) {
  const r = new Request('http://local/', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? '' },
    body,
  })
  return r.formData()
}

/** form의 파일 항목을 임시 디렉터리에 그대로 푼다 — 상대경로 자산(이미지 등)이 살아야 한다 */
async function spillFiles(form, dir) {
  const names = []
  for (const [key, value] of form.entries()) {
    if (key !== 'files' || typeof value === 'string') continue
    const name = value.name || 'file'
    await writeFile(join(dir, name), Buffer.from(await value.arrayBuffer()))
    names.push(name)
  }
  return names
}

const inch = (form, key, dflt) => {
  const v = form.get(key)
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? `${n}in` : dflt
}

async function htmlToPdf(form, dir) {
  const names = await spillFiles(form, dir)
  const entry = names.includes('index.html') ? 'index.html' : names.find(n => /\.html?$/i.test(n))
  if (!entry) throw Object.assign(new Error('index.html이 없습니다'), { status: 400 })

  const b = await getBrowser()
  const page = await b.newPage()
  try {
    // file:// 로 열어야 같은 디렉터리의 이미지·폰트가 상대경로로 잡힌다(Gotenberg와 같은 방식)
    await page.goto(`file:///${join(dir, entry).replace(/\\/g, '/')}`, { waitUntil: 'networkidle' })
    return Buffer.from(await page.pdf({
      width: inch(form, 'paperWidth', '8.27in'),
      height: inch(form, 'paperHeight', '11.69in'),
      margin: {
        top: inch(form, 'marginTop', '0.6in'), bottom: inch(form, 'marginBottom', '0.6in'),
        left: inch(form, 'marginLeft', '0.55in'), right: inch(form, 'marginRight', '0.55in'),
      },
      printBackground: form.get('printBackground') !== 'false',
      landscape: form.get('landscape') === 'true',
      preferCSSPageSize: form.get('preferCssPageSize') === 'true',
    }))
  } finally {
    await page.close()
  }
}

// 변환은 직렬로 돌린다 — 기본 프로필을 공유하므로 동시에 부르면 LibreOffice가 잠금 때문에 깨진다.
// 요청이 원래 순차적이라 실질 지연은 없다.
let loQueue = Promise.resolve()
const loLock = fn => (loQueue = loQueue.then(fn, fn))
// 격리 프로필(-env:UserInstallation)은 **한 건당 48초**가 걸린다(실측: 기본 프로필 1초 vs 커스텀 48초,
// 재사용해도 매번 그렇다). 그래서 기본 프로필을 쓰고, GUI가 떠 있어 잠기는 경우에만 격리로 물러난다.
const LO_PROFILE = join(tmpdir(), 'localgot-lo-profile')

async function officeToPdf(form, dir) {
  return loLock(() => officeToPdfInner(form, dir))
}

async function officeToPdfInner(form, dir) {
  if (!SOFFICE) throw Object.assign(new Error('LibreOffice(soffice)를 찾지 못했습니다'), { status: 501 })
  const names = await spillFiles(form, dir)
  const src = names.find(n => !/\.pdf$/i.test(n))
  if (!src) throw Object.assign(new Error('변환할 파일이 없습니다'), { status: 400 })
  // ⚠ landscape는 문서 자체의 페이지 설정을 따른다 — Gotenberg의 filter 옵션까지 흉내내지 않는다
  const base = ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, join(dir, src)]
  const pdfPath = join(dir, src.replace(extname(src), '.pdf'))
  try {
    await run(SOFFICE, base, { timeout: 120_000, windowsHide: true })
    if (!existsSync(pdfPath)) throw new Error('기본 프로필로 변환되지 않음')
  } catch {
    // GUI가 떠 있으면 기본 프로필이 잠긴다 — 느리지만 확실한 격리 프로필로 재시도
    console.log('  ↻ 기본 프로필 실패 → 격리 프로필로 재시도(느립니다: LibreOffice GUI를 닫으면 빨라집니다)')
    await run(SOFFICE, [
      '--headless', '--norestore', `-env:UserInstallation=file:///${LO_PROFILE.replace(/\\/g, '/')}`,
      '--convert-to', 'pdf', '--outdir', dir, join(dir, src),
    ], { timeout: 180_000, windowsHide: true })
  }
  const out = (await readdir(dir)).find(f => f.toLowerCase() === src.replace(extname(src), '.pdf').toLowerCase())
  if (!out) throw new Error('LibreOffice가 PDF를 만들지 못했습니다')
  return readFile(join(dir, out))
}

async function mergePdfs(form, dir) {
  const names = (await spillFiles(form, dir)).filter(n => /\.pdf$/i.test(n)).sort()
  if (names.length === 0) throw Object.assign(new Error('병합할 PDF가 없습니다'), { status: 400 })
  if (names.length === 1) return readFile(join(dir, names[0]))
  let PDFDocument
  try { ({ PDFDocument } = await import('pdf-lib')) } catch {
    throw Object.assign(
      new Error('합본은 pdf-lib가 필요합니다 — npm i -D pdf-lib 후 다시 시도하세요(단일 PDF는 이미 동작).'),
      { status: 501 })
  }
  const merged = await PDFDocument.create()
  for (const n of names) {
    const doc = await PDFDocument.load(await readFile(join(dir, n)))
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    pages.forEach(p => merged.addPage(p))
  }
  return Buffer.from(await merged.save())
}

const ROUTES = {
  '/forms/chromium/convert/html': htmlToPdf,
  '/forms/libreoffice/convert': officeToPdf,
  '/forms/pdfengines/merge': mergePdfs,
}

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? '').split('?')[0]
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'up', impl: 'local', chromium: true, libreoffice: !!SOFFICE }))
    return
  }
  const handler = ROUTES[url]
  if (req.method !== 'POST' || !handler) { res.writeHead(404).end('not found'); return }

  const chunks = []
  for await (const c of req) chunks.push(c)
  const dir = await mkdtemp(join(tmpdir(), 'localgot-'))
  const t0 = Date.now()
  try {
    const form = await parseForm(req, Buffer.concat(chunks))
    const pdf = await handler(form, dir)
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length })
    res.end(pdf)
    console.log(`  ✅ ${url} → ${(pdf.length / 1024).toFixed(0)}KB (${Date.now() - t0}ms)`)
  } catch (e) {
    const status = e?.status ?? 500
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(e?.message ?? e))
    console.log(`  ❌ ${url} (${status}): ${e?.message ?? e}`)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

server.listen(PORT, () => {
  console.log(`로컬 Gotenberg 대체 서버 :${PORT}`)
  console.log(`  Chromium(HTML→PDF): playwright   LibreOffice: ${SOFFICE ?? '없음'}`)
  console.log(`  .env.local 에  GOTENBERG_URL=http://localhost:${PORT}`)
  console.log('  ⚠ 렌더러가 달라 운영과 픽셀 단위로 같지 않을 수 있습니다 — 최종 레이아웃 확인은 스테이징에서')
})

const bye = async () => { await browser?.close().catch(() => {}); server.close(() => process.exit(0)) }
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
