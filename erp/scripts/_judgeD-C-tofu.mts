/** 판정자 C — _probe-d11-render.mts [6] '두부 흔적 0'이 **무엇이든 잡을 수 있는가**.
 *  그 검사는 LO가 낸 **HTML 텍스트**에서 U+FFFD(치환문자)를 찾는다. 그런데 두부는 래스터 단계의
 *  현상이고 HTML은 글자를 그대로 옮겨 적을 뿐이라, 글리프가 없어도 U+FFFD는 생기지 않는다.
 *  → 폰트가 확실히 없는 코드포인트를 담은 최소 xlsx를 만들어 같은 술어를 돌려본다.
 *  ⚠ 자산과 무관한 **새 임시 파일**만 만든다(자산 SheetJS 왕복 금지 규칙과 무관).
 *  실행: npx tsx scripts/_judgeD-C-tofu.mts */
import { writeFileSync, readFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import XLSX from 'xlsx'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const dir = mkdtempSync(join(tmpdir(), 'jdC-tofu-'))

// 글리프가 없을 가능성이 매우 높은 비BMP 문자들 (PUA는 Windows가 덮으므로 쓰지 않는다)
const odd = String.fromCodePoint(0x10a00) + String.fromCodePoint(0x1e900) + String.fromCodePoint(0x11000)
const ws = XLSX.utils.aoa_to_sheet([['정상 한글'], [odd], ['ASCII ok']])
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'T')
const src = join(dir, 'tofu.xlsx')
writeFileSync(src, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'html', '--outdir', dir, src],
  { timeout: 600_000, windowsHide: true, stdio: 'pipe' })
const f = readdirSync(dir).filter(x => x.endsWith('.html'))
if (!f.length) throw new Error('렌더 실패: ' + readdirSync(dir).join(','))
const html = readFileSync(join(dir, f[0]), 'utf8')
const text = html.replace(/<[^>]*>/g, '')

console.log(`입력한 비지원 후보 코드포인트: U+10A00 U+1E900 U+11000`)
console.log(`HTML에 그 문자들이 원문 그대로 남아 있는가: ${[...odd].every(c => text.includes(c) || html.includes(`&#${c.codePointAt(0)};`))}`)
console.log(`\n▶ _probe-d11-render.mts [6] 술어 !/\\uFFFD/.test(text) 결과: ${!/�/.test(text)}`)
console.log(`   (true = '두부 0' 초록. 글리프가 없어도 초록이면 이 검사는 두부를 볼 수 없다)`)

// PDF 쪽도 — 텍스트 추출 없이 쪽수만 보는 [2]가 무엇을 보증하는지
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, src],
  { timeout: 600_000, windowsHide: true, stdio: 'pipe' })
const pdf = join(dir, 'tofu.pdf')
const pages = existsSync(pdf) ? (readFileSync(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length : 0
console.log(`\n비지원 글자만 든 파일도 PDF ${pages}쪽으로 '열린다' → [2]는 '열리는가'만 본다`)
