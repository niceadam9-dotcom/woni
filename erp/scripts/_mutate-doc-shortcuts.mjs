// 변이 검증 — test-doc-shortcuts.mts가 실제로 무는가.
// 각 변이는 «제품을 한 군데만» 망가뜨리고, 검사가 **빨개져야** 통과다(기대 반전).
// ⚠ 대상 파일엔 다른 세션의 미커밋 변경이 얹혀 있다 — 바이트 단위로 백업·복구한다
//   (텍스트 왕복은 CRLF를 LF로 뭉갠다. 이 세션에서 실제로 한 번 밟았다).
import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const CUST = 'src/app/(dashboard)/customers/page.tsx'
const INSP = 'src/app/(dashboard)/inspections/page.tsx'

const MUTANTS = [
  {
    id: 'M1', file: CUST, expect: 'A-3/A-5 (글씨가 아니라 기본 버튼이 된다)',
    from: '<FirePlanXlsxButton customerId={c.id} variant="compact" />',
    to: '<FirePlanXlsxButton customerId={c.id} variant="primary" />',
  },
  {
    id: 'M2', file: CUST, expect: 'A-8 (전 행이 첫 고객 PDF를 가리킨다 — 배선 뒤집기)',
    from: 'href={`/customers/${c.id}/fire-plan/pdf`}',
    to: 'href={`/customers/${customers[0].id}/fire-plan/pdf`}',
  },
  {
    id: 'M3', file: INSP, expect: 'B-4 (문서 열 머리글이 사라진다)',
    from: "{['고객명', '유형/차수', '시작일', '담당자', '진행 단계', '상태', '보고서'].map((h, i) => (",
    to: "{['고객명', '유형/차수', '시작일', '담당자', '진행 단계', '상태'].map((h, i) => (",
  },
  {
    id: 'M4', file: CUST, expect: "C-3 (관문이 라우트와 다른 술어를 쓴다)",
    from: "const canCreate = can(profile.role as UserRole, 'customer_manage')",
    to: "const canCreate = can(profile.role as UserRole, 'customer_delete')",
  },
]

const backup = new Map()
for (const f of [CUST, INSP]) backup.set(f, readFileSync(f))

function restoreAll() {
  for (const [f, buf] of backup) writeFileSync(f, buf)
}

let pass = 0, fail = 0
try {
  for (const m of MUTANTS) {
    const raw = backup.get(m.file).toString('utf8')
    if (!raw.includes(m.from)) {
      console.log(`\n❌ ${m.id} — 치환 대상을 못 찾음(0건 치환이면 변이가 안 돈 것이다)\n    ${m.from}`)
      fail++; continue
    }
    const hits = raw.split(m.from).length - 1
    writeFileSync(m.file, Buffer.from(raw.replace(m.from, m.to), 'utf8'))
    console.log(`\n▶ ${m.id} (${hits}건 중 1건 치환) — 기대: ${m.expect}`)

    let red = false, out = ''
    try {
      out = execSync('npx tsx scripts/test-doc-shortcuts.mts', { encoding: 'utf8', timeout: 600000 })
    } catch (e) {
      red = true; out = (e.stdout ?? '') + (e.stderr ?? '')
    }
    restoreAll()

    const failed = /결과: \d+ 통과 \/ (\d+) 실패/.exec(out)?.[1] ?? '?'
    const redLines = out.split('\n').filter(l => l.includes('❌')).map(l => l.trim().slice(0, 70))
    if (red) {
      pass++
      console.log(`  ✅ 검사가 빨개졌다 (실패 ${failed}건)`)
      redLines.slice(0, 4).forEach(l => console.log(`     ${l}`))
    } else {
      fail++
      console.log(`  ❌ 변이가 살아남았다 — 이 축을 무는 단언이 없다`)
    }
  }
} finally {
  restoreAll()
  // 복구 증명 — 바이트가 원본과 같아야 한다
  for (const [f, buf] of backup) {
    const same = Buffer.compare(readFileSync(f), buf) === 0
    console.log(`  복구 ${same ? '✅' : '🚨 불일치!'} ${f}`)
  }
  // 그래도 미덥지 않으니 git에게 한 번 더 묻는다
  try {
    console.log('\n--- 복구 후 git diff --numstat ---')
    console.log(execSync(`git diff HEAD --numstat -- "${CUST}" "${INSP}"`, { encoding: 'utf8' }))
  } catch { /* noop */ }
}

console.log(`\n변이 결과: ${pass}/${MUTANTS.length} 잡음${fail ? ` · ${fail} 놓침` : ''}`)
process.exit(fail > 0 ? 1 : 0)
