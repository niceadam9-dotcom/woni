// KST 날짜 변환 회귀 검사 (소방계획서_36 F-14)
//
// ⚠ 이 검사가 **고정 입력**만 쓰는 이유: 원래 결함은 하루 중 00:00~09:00 KST의
//    9시간 창에서만 드러난다. '지금'으로 판정하면 낮에 돌린 검사는 영원히 초록이고,
//    실제로 그렇게 몇 달을 통과했다. 시간 의존 결함은 **언제 돌렸는가**가 숨은 축이다.
//
// 서버·DB 없이 순수 함수만 본다 — pre-push(무서버 게이트)에 얹을 수 있다.
// 실행: npx tsx scripts/test-kst-date.mts
const { kstDate, todayKst } = await import('../src/lib/kst-date.ts')

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} — ${detail}`) }
}
const eq = (name: string, got: string, want: string) => check(`${name} → ${want}`, got === want, `실제 ${JSON.stringify(got)}`)

console.log('— kstDate: UTC 타임스탬프 → KST 달력 날짜')

// ★ 실제로 터졌던 값 (2026-08-30 07:39 KST에 화면이 '완료 2026-08-29'를 찍었다)
eq('버그 재현값 2026-08-29T22:39Z', kstDate('2026-08-29T22:39:00.000+00:00'), '2026-08-30')

// 경계 — UTC 15:00이 KST 자정이다
eq('경계 직전 14:59:59Z', kstDate('2026-08-29T14:59:59Z'), '2026-08-29')
eq('경계 15:00:00Z', kstDate('2026-08-29T15:00:00Z'), '2026-08-30')

// 낮 시간대(UTC 오전)는 종전 동작과 같아야 한다 — 고치면서 멀쩡하던 값을 밀면 안 된다
eq('실DB 표본 02:17Z', kstDate('2026-07-23T02:17:48.846+00:00'), '2026-07-23')
eq('실DB 표본 12:36Z', kstDate('2026-08-04T12:36:40.197+00:00'), '2026-08-04')

// 해·달 넘김
eq('연말 넘김', kstDate('2026-12-31T15:00:00Z'), '2027-01-01')
eq('월말 넘김', kstDate('2026-08-31T16:20:00Z'), '2026-09-01')

// 타임존 표기가 없으면 UTC로 본다(기록하는 쪽이 UTC) — 로컬 해석되면 서버마다 값이 갈린다
eq('타임존 표기 없음', kstDate('2026-08-29T22:39:00'), '2026-08-30')

// 빈 값·쓰레기는 빈 문자열 (화면이 'Invalid Date'를 찍으면 안 된다)
eq('null', kstDate(null), '')
eq('undefined', kstDate(undefined), '')
eq('빈 문자열', kstDate(''), '')
eq('파싱 불가', kstDate('없는날짜'), '')

console.log('\n— 회귀 서명: 종전 split(\'T\')[0]이 왜 틀렸는지를 고정한다')
{
  const buggy = '2026-08-29T22:39:00.000+00:00'
  const naive = buggy.split('T')[0]
  check("종전 방식은 이 값에서 실제로 하루 이르다", naive === '2026-08-29' && kstDate(buggy) === '2026-08-30',
    `naive=${naive} kst=${kstDate(buggy)}`)
  // 낮 값에서는 둘이 같다 — 그래서 이 결함이 오래 안 보였다
  const day = '2026-07-23T02:17:48.846+00:00'
  check('낮 시간대에서는 두 방식이 같다(결함이 숨던 이유)', day.split('T')[0] === kstDate(day))
}

console.log('\n— todayKst: 고정 시각 주입으로 판정')
eq('주입 22:39Z', todayKst(Date.parse('2026-08-29T22:39:00Z')), '2026-08-30')
eq('주입 02:00Z', todayKst(Date.parse('2026-08-29T02:00:00Z')), '2026-08-29')

// ── 정적 가드: 타임스탬프를 문자열로 잘라 날짜로 쓰는 자리가 되살아나지 못하게 한다.
//    F-10 교훈 — 잡아주는 검사가 없는 규약은 조용히 썩는다.
console.log('\n— 정적 가드: UTC 타임스탬프를 split으로 자르는 자리 0곳')
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : (/\.(tsx?|ts)$/.test(n) ? [p] : [])
  })
  // timestamptz 컬럼을 화면 날짜로 쓰는 패턴만 노린다(오늘 계산용 new Date()...는 별개 축)
  const BAD = /\b(completed_at|submitted_at|created_at|updated_at|sent_at)(\?)?\.split\('T'\)/
  const hits: string[] = []
  // 규약을 정의한 파일 자신은 제외한다 — 거기서는 안티패턴을 **이름으로 불러** 설명해야 한다
  const SELF = join('src', 'lib', 'kst-date.ts')
  for (const f of walk(join(process.cwd(), 'src'))) {
    if (f.endsWith(SELF)) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (BAD.test(line)) hits.push(`${f.replace(process.cwd(), '.')}:${i + 1}`)
    })
  }
  check('타임스탬프 .split(\'T\') 직접 사용 0곳 — kstDate()를 쓸 것', hits.length === 0, hits.join(' · '))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
