// 소방계획서_29 S3-5 — 모달 백드롭 다크 알파 상향 코드모드
//
// 라이트의 bg-black/20~40 백드롭은 어두운 페이지 위에서 대비가 약하다(깨짐 아님).
// 라이트 픽셀 불변 원칙(D-3)에 따라 클래스를 바꾸지 않고 dark:bg-black/60 을 **추가**한다.
//
// 대상 판정: 같은 줄에 `inset-0`(fixed/absolute 오버레이)과 `bg-black/(20|25|30|40)`이 함께 있는 줄만.
//   - 콘텐츠 위 장식 오버레이(이미지 캡션 등)는 inset-0 없이 쓰여 걸리지 않는다.
//   - 이미지 뷰어(사진 위 어두운 배경이 정본)는 제외 목록.
// 실행: node scripts/_codemod-29-backdrop.mjs [--write]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(process.cwd(), 'src')
const WRITE = process.argv.includes('--write')

// 이미지 뷰어 — 사진 위 오버레이는 밝기 축이 다르다(이미 /50~/85 고알파)
const EXCLUDE = [
  'components\\inspections\\photo-gallery-modal.tsx',
  'components\\customers\\customer-assets-client.tsx',
  'components\\inspections\\inspection-workbench.tsx',
]
// 타 세션 편집 중 — 코드모드 본체와 같은 이유로 스킵(§10-4)
const SKIP_CONCURRENT = [
  'components\\sms\\sms-status-client.tsx',
  'app\\(dashboard)\\inspections\\sms-actions.ts',
]

const RE = /bg-black\/(20|25|30|40)(?!\d)/g

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (/\.(tsx|ts)$/.test(name)) yield p
  }
}

let filesTouched = 0, linesTouched = 0
const report = []
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file)
  if (EXCLUDE.some(e => rel.endsWith(e)) || SKIP_CONCURRENT.some(e => rel.endsWith(e))) {
    if (readFileSync(file, 'utf8').match(RE)) report.push(`SKIP  ${rel}`)
    continue
  }
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  let changed = 0
  const out = lines.map(line => {
    if (!line.includes('inset-0')) return line
    if (line.includes('dark:bg-black/')) return line // 이미 처리됨(재실행 안전)
    if (!RE.test(line)) { RE.lastIndex = 0; return line }
    RE.lastIndex = 0
    changed++
    return line.replace(RE, m => `${m} dark:bg-black/60`)
  })
  if (changed > 0) {
    filesTouched++; linesTouched += changed
    report.push(`${String(changed).padStart(4)}  ${rel}`)
    if (WRITE) writeFileSync(file, out.join('\n'))
  }
}

console.log(`mode=${WRITE ? 'WRITE' : 'DRY'}  files=${filesTouched}  lines=${linesTouched}`)
for (const r of report) console.log(r)
