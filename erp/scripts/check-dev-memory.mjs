/** dev 서버 메모리 진단 — E2E를 돌리기 전에 환경부터 본다
 *  실행: node scripts/check-dev-memory.mjs        — 진단만(종료코드 0)
 *        node scripts/check-dev-memory.mjs --gate — 위험하면 종료코드 1
 *
 *  왜 있나 (2026-08-19 실측):
 *  `next dev` 프로세스가 회귀 한 번에 수 GB를 먹는다. 재기동 30분 만에 26MB → 4.2GB,
 *  회귀를 한 번 더 돌리면 6.2GB. 여유 메모리가 마르면 Playwright의 page.goto가 타임아웃하는데,
 *  그 증상이 하필 **"실행마다 다른 테스트가 실패하고, 그 테스트를 단독으로 돌리면 통과"**로
 *  나타난다. 그래서 테스트 코드나 앱 코드를 의심하며 시간을 버리게 된다.
 *
 *  같은 코드로 실측한 상관관계:
 *    여유 6.5GB → 22/22 그린
 *    여유 2.6GB 시작 → 1건 실패
 *    여유 564MB → **단독 실행마저 page.goto 타임아웃**
 *    재기동(5.9GB) → 같은 테스트가 그대로 통과
 *
 *  마지막 줄이 핵심이다. 코드를 한 줄도 바꾸지 않고 dev만 재기동해서 통과했다면 원인은 환경이다.
 *
 *  양상이 둘이라 지표도 둘이다:
 *    ① 고아 워커 누적 — node **개수**가 수십~수백 (2026-08-14: 356개/10GB, VSCode 다운)
 *    ② 단일 프로세스 비대 — 개수는 정상인데 **한 개가 수 GB** (2026-08-19)
 *  개수만 세면 ②를 놓친다.
 */
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** PowerShell 실행 → JSON.
 *  `-Command "여러 줄"`은 인용이 깨지기 쉬워(실측: 따옴표 이스케이프가 어긋나 null 반환)
 *  임시 .ps1 파일로 넘긴다. */
function ps(script) {
  const f = join(tmpdir(), `devmem-${process.pid}.ps1`)
  writeFileSync(f, script, 'utf8')
  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${f}"`,
      { encoding: 'utf8', windowsHide: true })
    return out.trim() ? JSON.parse(out) : null
  } finally {
    try { unlinkSync(f) } catch { /* 무시 */ }
  }
}

const s = ps(`
$p = @(Get-Process node -ErrorAction SilentlyContinue |
  Select-Object @{n='id';e={$_.Id}}, @{n='mb';e={[math]::Round($_.WorkingSet64/1MB)}})
$os = Get-CimInstance Win32_OperatingSystem
$dev = $null
try { $dev = (Get-NetTCPConnection -LocalPort 3000 -State Listen -EA Stop | Select-Object -First 1).OwningProcess } catch {}
[pscustomobject]@{
  procs = $p
  free  = [math]::Round($os.FreePhysicalMemory/1KB)
  total = [math]::Round($os.TotalVisibleMemorySize/1KB)
  dev   = $dev
} | ConvertTo-Json -Depth 4 -Compress
`)

if (!s) {
  console.log('△ 메모리 정보를 읽지 못했습니다(PowerShell 응답 없음) — 진단을 건너뜁니다.')
  process.exit(0)
}

const procs = Array.isArray(s.procs) ? s.procs : (s.procs ? [s.procs] : [])
const totalNodeMb = procs.reduce((n, p) => n + (p.mb ?? 0), 0)
const devMb = s.dev ? (procs.find(p => p.id === s.dev)?.mb ?? null) : null

// ── 살아 있는가 (프로세스 존재 ≠ 응답 가능) ────────────────────────────────
// 실측(2026-08-19): 프로세스는 2.5GB로 멀쩡히 떠 있고 여유 메모리도 3.2GB인데
// **응답만 안 하는** 상태가 있다(wedge). 그때 메모리만 보면 "✅ 돌려도 된다"고 오판하고,
// 회귀는 서버가 필요한 E2E부터 줄줄이 실패한다 — 실제로 11건이 그렇게 깨졌다.
// 그래서 크기·개수와 함께 **응답 여부**를 반드시 본다.
// 한 번 실패했다고 wedge로 단정하지 않는다 — **갓 기동한 dev는 첫 요청에서 라우트를 컴파일하느라
// 수 초~십수 초가 걸린다**(실측: 첫 GET /login 4.3s, 두 번째 398ms). 단발 타임아웃으로 재면
// 멀쩡한 서버를 무응답으로 몰아, 없는 문제를 쫓게 만든다(오탐 경고는 없느니만 못하다).
// 3회까지 시도하고 전부 실패할 때만 wedge로 본다.
let alive = null, aliveMs = null, tries = 0
if (s.dev) {
  const t0 = Date.now()
  for (tries = 1; tries <= 3; tries++) {
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 15_000)
      const r = await fetch('http://localhost:3000/login', { method: 'HEAD', signal: ctl.signal })
      clearTimeout(timer)
      if (r.ok) { alive = true; break }
    } catch { /* 다음 시도 */ }
    alive = false
    if (tries < 3) await new Promise(res => setTimeout(res, 3000))
  }
  aliveMs = Date.now() - t0
}

console.log('── dev 진단 ──')
console.log(`  node 프로세스 : ${procs.length}개 · 합계 ${totalNodeMb}MB`)
console.log(`  dev(:3000)    : ${s.dev ? `PID ${s.dev} · ${devMb ?? '?'}MB` : '기동 안 됨'}`)
console.log(`  응답          : ${s.dev
  ? (alive ? `정상 (${aliveMs}ms${tries > 1 ? `, ${tries}회째 성공 — 컴파일 중이었던 듯` : ''})`
           : `**무응답** (3회 시도 ${aliveMs}ms)`)
  : '—'}`)
console.log(`  시스템 메모리 : 여유 ${s.free}MB / 전체 ${s.total}MB`)

// 임계값 — 실측 기반. 2.6GB에서 이미 실패가 나왔고 6.5GB에서는 전건 그린이었다.
const FREE_DANGER = 1500   // 이 아래면 E2E가 무작위로 깨진다(564MB에서는 단독 실행도 실패)
const FREE_WARN = 3000
const DEV_WARN = 3000      // dev 한 프로세스가 3GB를 넘으면 회귀 한 번을 못 버틴다
const COUNT_WARN = 30      // ① 고아 워커 누적

const problems = []
// 무응답이 가장 심각하다 — 메모리가 아무리 넉넉해도 E2E는 전부 깨진다
if (s.dev && alive === false) problems.push(`dev가 떠 있는데 **응답하지 않는다**(wedge) — 메모리와 무관하다`)
if (s.free < FREE_DANGER) problems.push(`여유 메모리 ${s.free}MB — E2E가 무작위로 실패한다`)
if (devMb != null && devMb > DEV_WARN) problems.push(`dev 프로세스 ${devMb}MB — 회귀 도중 메모리가 마른다`)
if (procs.length > COUNT_WARN) problems.push(`node ${procs.length}개 — 고아 워커 누적(양상 ①)`)

if (problems.length === 0) {
  const tight = s.free < FREE_WARN
  console.log(tight
    ? `\n△ 여유 ${s.free}MB — 돌릴 수는 있으나 회귀 후반에 빠듯해질 수 있다.`
    : '\n✅ 전체 회귀를 돌려도 되는 상태.')
  process.exit(0)
}

console.log('\n❌ 이 상태로 E2E를 돌리면 결과를 믿을 수 없다:')
for (const p of problems) console.log(`   · ${p}`)
console.log(`
   실패가 **실행마다 다른 테스트로 옮겨 다니고 단독 실행은 통과**한다면
   코드가 아니라 이것이 원인이다. 먼저 dev를 내렸다 올릴 것:

     $p = (Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -First 1).OwningProcess
     Stop-Process -Id $p -Force
     npm run dev
`)
if (procs.length > COUNT_WARN) {
  console.log(`   고아 워커(①)는 명령줄로 정확히 걸러 정리한다 — Claude Code 자신의 node를 건드리지 않게:

     Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
       Where-Object { $_.CommandLine -like '*\\ERP\\erp\\.next\\dev\\build\\*' } |
       ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
`)
}

process.exit(process.argv.includes('--gate') ? 1 : 0)
