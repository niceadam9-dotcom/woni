// 한글 렌더 가능성 단언 — "설치됐는가"가 아니라 "찍히는가"를 검사한다.
//
// 배경(소방계획서_서버.md §15.3, 2026-08-24 인시던트):
//   `node:20-alpine`이 떠다니는 태그라 베이스가 Alpine 3.23으로 올라가면서 `font-nanum`이
//   사라졌고, 코드가 그대로인데 운영 빌드가 깨졌다. 그때 남긴 교훈 둘:
//   ① apk add 성공은 두부(□) 렌더를 배제하지 못한다 — 사람이 PNG를 눈으로 봐야 했다.
//   ② ⚠ 잉크 픽셀 수로는 판정할 수 없다. 한글 체인과 '한글 없는 폰트' 대조군의 어두운
//      픽셀이 2376으로 완전히 같았다 (fontconfig가 글자 단위로 폴백하기 때문).
//   이 스크립트는 그 육안 판정을 결정적 검사로 옮긴 것이다.
//
// ⚠ 폐기한 설계 — '가가가' vs '가나다' 래스터 동일성 (2026-08-24 변이 검사로 기각).
//   두부가 코드포인트와 무관한 같은 사각형이라는 전제가 **틀렸다**. pango는 글리프가 없으면
//   코드포인트 16진수가 박힌 hexbox를 그리므로 가(AC00)·나(B098)·다(B2E4)가 서로 달라져
//   두부인데도 통과한다. 항진명제가 될 뻔했다.
//
// 채택한 판별자 — 구조. hexbox는 **닫힌 사각 테두리**라 잉크 bbox의 맨 윗줄이 꽉 찬다.
//   실측(2026-08-24): 실제 한글 가·나·소·힣 = 0.079~0.086 / hexbox(U+100000) = 0.993.
//   12배 분리라 임계 0.5는 두 군집 어느 쪽에서도 멀다.
//   게다가 이 검사엔 **양성 대조군**이 들어 있다 — 미할당 코드포인트가 '정상 글리프처럼'
//   보이면 판별자 자체가 죽은 것이므로 그 사실을 소리 내어 알린다.
//
// 실행:
//   node scripts/assert-korean-glyphs.mjs                     # 전체 (파일+fontconfig+렌더)
//   node scripts/assert-korean-glyphs.mjs --files-only        # 파일 축만 (환경 무관·밀폐)
//   node scripts/assert-korean-glyphs.mjs --font-dir=/usr/share/fonts/nanum
//
// 위반 시 exit 1. Dockerfile runner 스테이지가 RUN으로 걸어, 폰트가 깨지면 이미지가
// 아예 만들어지지 않는다.
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const filesOnly = argv.includes('--files-only')
const fontDirArg = argv.find(a => a.startsWith('--font-dir='))
const fontDir = fontDirArg ? fontDirArg.slice('--font-dir='.length) : join(root, 'assets', 'fonts')

// 저장소에 박아 넣은 폰트의 신원 — 파일이 바뀌면 즉시 드러난다.
// (google/fonts ofl/nanumgothic, OFL 1.1. 2026-08-24 고정)
const EXPECTED = [
  { file: 'NanumGothic-Regular.ttf', family: 'NanumGothic',
    sha256: '76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31' },
  { file: 'NanumGothic-Bold.ttf', family: 'NanumGothic',
    sha256: 'f96298f9fb18e364d2370f4c3ce948ac67a2b61af992d7234bc15c42b033c674' },
]

// 커버리지 표본 — 한글 음절 경계(가·힣)와 실제로 찍히는 어휘의 글자를 함께 본다.
// static-map-compose.ts는 소방서명·고객명·'2.4km · 6분' 캡션을 그린다.
const SAMPLE = '가힣소방서고객명계획서점검·0123'
// 렌더 축 표본 — 위 실측에서 윗줄비율이 낮게 확인된 글자들.
const RENDER_SAMPLE = ['가', '나', '소', '힣']
// 어떤 폰트에도 없는 코드포인트(평면16 PUA) — 판별자 살아있음을 확인하는 양성 대조군.
const UNMAPPED = String.fromCodePoint(0x100000)
// hexbox 판정 임계. 실측 군집은 0.09 이하 vs 0.99라 이 값은 양쪽에서 멀다.
const TOP_ROW_FULL = 0.5

let failures = 0
function ok(msg) { console.log(`✅ ${msg}`) }
function bad(msg) { failures++; console.log(`❌ ${msg}`) }
function note(msg) { console.log(`   ${msg}`) }

// ── TTF 파싱 (의존성 없이 name·cmap만 직접 읽는다) ──────────────────────────
function tableDirectory(buf) {
  const numTables = buf.readUInt16BE(4)
  const tables = {}
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16
    tables[buf.toString('latin1', p, p + 4)] = { offset: buf.readUInt32BE(p + 8), length: buf.readUInt32BE(p + 12) }
  }
  return tables
}

/** UTF-16BE로 저장된 name 문자열을 읽는다. */
function readUtf16BE(buf, off, len) {
  const b = Buffer.from(buf.subarray(off, off + len))
  b.swap16()
  return b.toString('utf16le')
}

/** name 테이블의 nameID를 읽는다 (기본 1 = 폰트 패밀리). */
function readName(buf, table, nameID = 1) {
  const base = table.offset
  const count = buf.readUInt16BE(base + 2)
  const stringOffset = buf.readUInt16BE(base + 4)
  let macFallback = null
  for (let i = 0; i < count; i++) {
    const p = base + 6 + i * 12
    const platformID = buf.readUInt16BE(p)
    const encodingID = buf.readUInt16BE(p + 2)
    if (buf.readUInt16BE(p + 6) !== nameID) continue
    const len = buf.readUInt16BE(p + 8)
    const off = base + stringOffset + buf.readUInt16BE(p + 10)
    // Windows 플랫폼(3,1) = UTF-16BE. 영문 패밀리명이 여기 있다.
    if (platformID === 3 && encodingID === 1) return readUtf16BE(buf, off, len)
    if (platformID === 1 && macFallback === null) macFallback = buf.toString('latin1', off, off + len)
  }
  return macFallback
}

/** cmap에서 코드포인트 → 글리프ID. 없으면 0(.notdef). format 4와 12를 지원한다. */
function makeCmapLookup(buf, table) {
  const base = table.offset
  const numTables = buf.readUInt16BE(base + 2)
  let best = null, bestScore = -1
  for (let i = 0; i < numTables; i++) {
    const p = base + 4 + i * 8
    const platformID = buf.readUInt16BE(p)
    const encodingID = buf.readUInt16BE(p + 2)
    const subOffset = base + buf.readUInt32BE(p + 4)
    // (3,10) UCS-4 > (3,1) BMP > 그 외
    const score = platformID === 3 && encodingID === 10 ? 3 : platformID === 3 && encodingID === 1 ? 2 : 1
    if (score > bestScore) { bestScore = score; best = subOffset }
  }
  if (best === null) return null
  const format = buf.readUInt16BE(best)
  if (format === 12) {
    const nGroups = buf.readUInt32BE(best + 12)
    return cp => {
      for (let g = 0; g < nGroups; g++) {
        const q = best + 16 + g * 12
        const start = buf.readUInt32BE(q), end = buf.readUInt32BE(q + 4)
        if (cp >= start && cp <= end) return buf.readUInt32BE(q + 8) + (cp - start)
      }
      return 0
    }
  }
  if (format === 4) {
    const segCountX2 = buf.readUInt16BE(best + 6)
    const segCount = segCountX2 / 2
    const endBase = best + 14
    const startBase = endBase + segCountX2 + 2
    const deltaBase = startBase + segCountX2
    const rangeBase = deltaBase + segCountX2
    return cp => {
      if (cp > 0xffff) return 0
      for (let s = 0; s < segCount; s++) {
        const end = buf.readUInt16BE(endBase + s * 2)
        if (cp > end) continue
        const start = buf.readUInt16BE(startBase + s * 2)
        if (cp < start) return 0
        const idDelta = buf.readInt16BE(deltaBase + s * 2)
        const idRangeOffset = buf.readUInt16BE(rangeBase + s * 2)
        if (idRangeOffset === 0) return (cp + idDelta) & 0xffff
        const gp = rangeBase + s * 2 + idRangeOffset + (cp - start) * 2
        if (gp + 1 >= buf.length) return 0
        const g = buf.readUInt16BE(gp)
        return g === 0 ? 0 : (g + idDelta) & 0xffff
      }
      return 0
    }
  }
  return null
}

// ── 축 1: 폰트 파일 자체 (환경 무관 — 어디서 돌려도 같은 답) ────────────────
console.log(`폰트 디렉터리: ${fontDir}\n`)
console.log('[축 1] 폰트 파일')
for (const want of EXPECTED) {
  const path = join(fontDir, want.file)
  if (!existsSync(path)) { bad(`${want.file} — 파일 없음 (${path})`); continue }
  const buf = readFileSync(path)

  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== want.sha256) bad(`${want.file} — sha256 불일치\n     기대 ${want.sha256}\n     실측 ${sha}`)
  else ok(`${want.file} — sha256 일치`)

  const tables = tableDirectory(buf)
  if (!tables.name || !tables.cmap) { bad(`${want.file} — name/cmap 테이블 없음 (온전한 TTF가 아니다)`); continue }

  const family = readName(buf, tables.name, 1)
  // 체인이 **이름으로** 지목하는 패밀리와 정확히 같아야 한다.
  // static-map-compose.ts:101의 `Malgun Gothic, NanumGothic, Noto Sans CJK KR, sans-serif`에서
  // 2순위로 걸리는 게 이 이름이다. 다르면 sans-serif로 흘러 '우연히' 렌더된다.
  if (family !== want.family) bad(`${want.file} — 패밀리명 '${family}' (기대 '${want.family}')`)
  else ok(`${want.file} — 패밀리명 '${family}'`)

  const lookup = makeCmapLookup(buf, tables.cmap)
  if (!lookup) { bad(`${want.file} — cmap 서브테이블을 읽지 못했다`); continue }
  const missing = [...SAMPLE].filter(ch => lookup(ch.codePointAt(0)) === 0)
  if (missing.length) bad(`${want.file} — 글리프 없음: ${missing.join(' ')}`)
  else ok(`${want.file} — 표본 ${[...SAMPLE].length}자 전부 글리프 보유`)
}

// ── 축 1b: Dockerfile 규약 — 배포판 패키지로 되돌아가는 회귀를 막는다 ────────
// 다음에 폰트가 깨졌을 때 `apk add font-무엇`으로 때우면 이 자립이 조용히 풀린다.
// 그 유혹이 정확히 2026-08-24에 우리가 한 일이었다(font-nanum → font-noto-cjk).
//
// ⚠ **저장소 축이라 --files-only에서만 돈다.** 같은 스크립트가 이미지 안에서도 돌지만
//   runner는 이 스크립트만 COPY하므로 Dockerfile·compose가 거기 없다. 조건 없이 검사했다가
//   폰트가 멀쩡한 운영 빌드를 3건 실패로 세웠다(2026-08-24 VPS 실측).
//   '파일이 없으면 통과'로 무마하면 저장소에서도 가드가 사라지므로, 축 자체를 나눈다.
if (filesOnly) {
  console.log('\n[축 1b] Dockerfile 규약')
  const dockerfile = join(root, 'Dockerfile')
  if (!existsSync(dockerfile)) {
    bad('Dockerfile을 찾지 못했다')
  } else {
    const text = readFileSync(dockerfile, 'utf8')
    // 주석(#로 시작하는 줄)은 규약을 설명하느라 이 단어들을 담고 있으므로 제외하고 본다.
    const code = text.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n')
    // `fontconfig`(라이브러리)는 정당한 의존이라 제외 — 잡으려는 건 `font-nanum`·`fonts-noto-cjk`
    // 같은 **폰트 패키지**다. 둘의 차이는 하이픈이다.
    // apk는 `add`, apt/dnf/yum은 `install`이다 — 한쪽만 막으면 다른 쪽으로 새로 들어온다.
    // 덮는 축은 '패키지명이 fonts?- 로 시작하는 경우'다. RHEL식 접미 명명(google-noto-…-fonts)은
    // 이 축 밖이다 — 우리 베이스가 Alpine인 한 닿지 않지만, 베이스를 바꾸면 여기도 넓혀야 한다.
    const aptFont = new RegExp('(apk|apt|apt-get|dnf|yum|microdnf)\\s+(add|install)[^\\n]*\\sfonts?-')
    if (aptFont.test(code)) bad('Dockerfile이 폰트를 배포판 패키지로 설치하고 있다 — 저장소 자립이 풀렸다')
    else ok('폰트를 배포판 패키지로 설치하지 않는다')
    if (!code.includes('assets/fonts/')) bad('Dockerfile이 assets/fonts/를 COPY하지 않는다')
    else ok('assets/fonts/를 이미지로 COPY한다')
    if (!code.includes('assert-korean-glyphs.mjs')) bad('Dockerfile이 렌더 단언을 실행하지 않는다 — 두부가 빌드를 통과한다')
    else ok('빌드가 렌더 단언을 실행한다')
  }

  // .dockerignore의 실수는 전부 '조용한 실패'다 — 빌드는 성공하고 런타임에만 죽는다.
  //   assets/fonts를 빼면 COPY가 실패하거나 폰트 없는 이미지가 나오고,
  //   .env를 빼면 next build가 NEXT_PUBLIC_*를 인라인하지 못해 클라이언트 Supabase만 죽는다.
  const dockerignore = join(root, '.dockerignore')
  if (existsSync(dockerignore)) {
    const rules = readFileSync(dockerignore, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    // 접두 일치로 본다 — `.env`도 `.env*`도 `.env.production`도 전부 걸린다.
    const mustKeep = ['.env', 'assets', 'templates', 'scripts', 'src', 'public', 'package.json']
    const offenders = rules.filter(r => mustKeep.some(k => r.replace(/^\/+/, '').startsWith(k)))
    if (offenders.length) bad(`.dockerignore가 빌드에 필요한 것을 배제한다: ${offenders.join(', ')}`)
    else ok(`.dockerignore — 필수 경로 배제 없음 (규칙 ${rules.length}건)`)
  }
}

// ── 축 1c: Gotenberg 태그 고정 — 한글 PDF를 찍는 건 앱이 아니라 그 컨테이너다 ──
// 별지 서식 6종의 한글은 전부 Gotenberg 안의 폰트로 렌더된다. 그래서 `:8` 같은 떠다니는
// 태그는 앱 이미지보다 노출이 크다 — 우리 코드가 그대로여도 다음 pull이 서식을 두부로 만든다.
// 운영·스테이징이 서로 다른 버전을 보면 '여기선 됐는데'가 성립해 검증이 무의미해지므로 함께 본다.
// (축 1b와 같은 이유로 저장소 축 — 이미지 안엔 compose 파일이 없다)
if (filesOnly) {
  console.log('\n[축 1c] Gotenberg 태그 고정')
  const pinned = new RegExp('gotenberg/gotenberg:(\\d+\\.\\d+\\.\\d+)')
  const anyTag = new RegExp('gotenberg/gotenberg:(\\S+)')
  const found = {}
  for (const f of ['docker-compose.prod.yml', 'docker-compose.staging.yml']) {
    const p = join(root, f)
    if (!existsSync(p)) { bad(`${f} — 파일 없음`); continue }
    const text = readFileSync(p, 'utf8')
    const m = text.match(pinned)
    if (m) { found[f] = m[1]; ok(`${f} — ${m[1]} (패치까지 고정)`) }
    else {
      const loose = text.match(anyTag)
      bad(`${f} — 태그가 패치까지 고정돼 있지 않다: '${loose ? loose[1] : '(gotenberg 이미지 없음)'}'`)
    }
  }
  // 한쪽이 파싱에 실패했는데 '동일 버전 ✅'를 찍으면 결함 위에 초록을 덮는 셈이다
  // — 두 쪽 다 읽힌 경우에만 동일성을 판정한다.
  const versions = [...new Set(Object.values(found))]
  if (Object.keys(found).length !== 2) {
    note('두 compose를 모두 읽지 못해 동일성은 판정하지 않는다')
  } else if (versions.length !== 1) {
    bad(`운영·스테이징 Gotenberg 버전이 다르다 — ${JSON.stringify(found)}`)
  } else {
    ok(`운영·스테이징 동일 버전 (${versions[0]})`)
  }
}

if (filesOnly) {
  console.log()
  if (failures) { console.error(`한글 렌더 단언 실패 — ${failures}건`); process.exit(1) }
  console.log('한글 렌더 단언 통과 (저장소 축 1·1b·1c — fontconfig·래스터는 이미지 안에서 검사된다)')
  process.exit(0)
}

// ── 축 2: fontconfig가 실제로 무엇을 고르는가 ────────────────────────────────
// 파일이 있어도 fc-cache가 안 돌았으면 여기서 걸린다. 패밀리명이 아니라 **파일 경로**를
// 물어 우리가 넣은 그 파일이 선택됐는지 확인한다.
console.log('\n[축 2] fontconfig 해석')
try {
  const koList = execFileSync('fc-list', [':lang=ko', 'family'], { encoding: 'utf8' }).trim()
  if (!koList) bad('fc-list :lang=ko — 한글 폰트가 하나도 없다')
  else ok(`fc-list :lang=ko — ${koList.split('\n').length}종`)

  // `fc-match ... file`은 ':file=/경로' 꼴로 뱉으므로 --format으로 경로만 받는다.
  const file = execFileSync('fc-match', ['--format=%{file}', 'NanumGothic:lang=ko'], { encoding: 'utf8' }).trim()
  if (!file.includes('NanumGothic')) bad(`fc-match NanumGothic → '${file}' (우리 폰트가 아닌 파일로 폴백됐다)`)
  else ok(`fc-match NanumGothic → '${file}'`)
} catch (e) {
  bad(`fontconfig 실행 실패 — ${e.message}`)
}

// ── 축 3: 실제 래스터 구조 (두부 판정) ───────────────────────────────────────
console.log('\n[축 3] 래스터 구조 — 두부(hexbox) 판정')
try {
  const sharp = (await import('sharp')).default
  const FAMILY = 'Malgun Gothic, NanumGothic, Noto Sans CJK KR, sans-serif' // static-map-compose.ts:101과 동일

  /** 글자 하나를 크게 그려 잉크 bbox와 '맨 윗줄이 얼마나 찼는가'를 잰다. */
  async function shape(ch) {
    const S = 160
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S * 3}" height="${S * 2}">` +
      `<rect width="${S * 3}" height="${S * 2}" fill="#fff"/>` +
      `<text x="20" y="${S + 40}" font-family="${FAMILY}" font-size="${S}" fill="#000">${ch}</text></svg>`
    const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true })
    const { width: w, height: h, channels: c } = info
    const dark = (x, y) => data[(y * w + x) * c] < 128
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark(x, y)) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    if (x1 < 0) return { ink: 0, topRatio: 0, bw: 0, bh: 0 }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1
    let top = 0, ink = 0
    for (let x = x0; x <= x1; x++) if (dark(x, y0)) top++
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (dark(x, y)) ink++
    return { ink, topRatio: top / bw, bw, bh }
  }

  // 양성 대조군 — 판별자가 살아 있는지 먼저 본다.
  const ctrl = await shape(UNMAPPED)
  if (ctrl.ink === 0) {
    note(`대조군 U+100000 — 아무것도 안 그려짐(이 환경은 미지원 문자를 공백으로 처리).`)
    note(`  → 두부는 '잉크 0'으로 나타난다. 아래 잉크 검사가 그걸 잡는다.`)
  } else if (ctrl.topRatio >= TOP_ROW_FULL) {
    ok(`대조군 U+100000 — hexbox 확인 (윗줄비율 ${ctrl.topRatio.toFixed(3)}) → 판별자 살아 있음`)
  } else {
    bad(`대조군 U+100000이 정상 글리프처럼 보인다 (윗줄비율 ${ctrl.topRatio.toFixed(3)}, 잉크 ${ctrl.ink})`)
    note(`  → 이 환경에선 두부를 구조로 구분할 수 없다. 축 3의 판정을 신뢰하지 말 것.`)
  }

  for (const ch of RENDER_SAMPLE) {
    const m = await shape(ch)
    if (m.ink === 0) {
      bad(`'${ch}' — 아무것도 그려지지 않았다 (한글 폰트가 없다)`)
    } else if (m.topRatio >= TOP_ROW_FULL) {
      bad(`'${ch}' — 두부(hexbox)로 그려졌다 (윗줄비율 ${m.topRatio.toFixed(3)}, bbox ${m.bw}x${m.bh})`)
    } else {
      ok(`'${ch}' — 실제 글리프 (윗줄비율 ${m.topRatio.toFixed(3)}, bbox ${m.bw}x${m.bh}, 잉크 ${m.ink})`)
    }
  }
} catch (e) {
  bad(`sharp 래스터화 실패 — ${e.message}`)
}

console.log()
if (failures) { console.error(`한글 렌더 단언 실패 — ${failures}건`); process.exit(1) }
console.log('한글 렌더 단언 통과')
