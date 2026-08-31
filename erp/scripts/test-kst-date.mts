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

console.log("\n— F-14 잔여 축: 오프셋 형태(todayKst(Date.now() + N))가 기준일과 갈라지지 않는다")
{
  // layout.tsx(뱃지 D+3)·inspections/page.tsx(D+7)는 '오늘'과 오프셋 날짜를 **함께** 쓴다.
  // 한쪽만 KST로 옮기면 두 기준이 갈라져 뱃지가 하루치 어긋난다 — 그 짝을 여기서 고정한다.
  const base = Date.parse('2026-08-29T22:39:00Z') // = KST 08-30 07:39, 결함이 드러나는 창
  eq('기준일', todayKst(base), '2026-08-30')
  eq('D+3', todayKst(base + 3 * 86400000), '2026-09-02')
  eq('D+7', todayKst(base + 7 * 86400000), '2026-09-06')
  // 종전 UTC 방식이었다면 셋 다 하루 이르다 — 그 차이를 서명으로 박는다
  const utc = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  check('종전 UTC 방식은 짝 전체가 하루 이르다(회귀 서명)',
    utc(base) === '2026-08-29' && utc(base + 3 * 86400000) === '2026-09-01',
    `utc=${utc(base)} / ${utc(base + 3 * 86400000)}`)
  // 월 경계 — 달력 배너가 쓰는 slice(0,7) 축
  eq('월 축(KST)', todayKst(Date.parse('2026-08-31T22:00:00Z')).slice(0, 7), '2026-09')
}

console.log('\n— 이미 KST인 관용구를 건드리면 안 된다(9시간 이중 가산 방지)')
{
  // 크론 5종·별지 조립 등 12곳은 `new Date(Date.now() + 9*3600_000)`으로 **이미 옳다**.
  // 최초 코드모드가 이걸 todayKst(Date.now() + 9*3600_000)으로 바꿀 뻔했다 → 18시간이 된다.
  const t = Date.parse('2026-08-29T22:39:00Z')
  const already = new Date(t + 9 * 3600_000).toISOString().slice(0, 10)
  eq('기존 관용구와 todayKst()는 같은 답', already, todayKst(t))
  // ⚠ 이중 가산이 **실제로 하루를 밀어내는** 시각을 골라야 한다. 처음엔 위 t를 그대로 썼는데
  //   그 시각에는 9시간을 두 번 더해도 날짜가 안 바뀌어, '위험하다'고 적어놓고 **위험을 보여주지
  //   못하는** 단언이 됐다(통과하지만 무의미). 밀리는 창은 t+9h가 UTC 15:00~24:00일 때다.
  const t2 = Date.parse('2026-08-30T08:00:00Z') // = KST 08-30 17:00
  eq('올바른 답(9시간 한 번)', todayKst(t2), '2026-08-30')
  eq('이중 가산은 하루 늦다(코드모드가 낼 뻔한 값)',
    new Date(t2 + 18 * 3600_000).toISOString().slice(0, 10), '2026-08-31')
}

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

  // ── F-14 **잔여 축**: '오늘'을 UTC로 구하는 자리(2026-08-30 신설).
  //    위 가드는 '저장된 타임스탬프를 자르는 것'만 봤고 이 축은 "별개"라며 비워 뒀는데,
  //    실측해 보니 그 비워 둔 축에 **26곳**이 있었다(폼 기본값·마감 판정·뱃지·달력).
  //    ⚠ `new Date(Date.now() + 9*3600_000)...`은 **잡지 않는다** — 그건 이미 KST를
  //      올바르게 구하는 관용구이고(크론 5종·별지 조립 등 12곳), 여기에 걸어 todayKst()로
  //      바꾸면 9시간이 **두 번** 더해진다. 실제로 최초 코드모드가 그럴 뻔했다.
  const BARE = /new Date\(\)\.toISOString\(\)\.(?:split\('T'\)\[0\]|slice\(0,\s*(?:10|7)\))/
  const bare: string[] = []
  for (const f of walk(join(process.cwd(), 'src'))) {
    if (f.endsWith(SELF)) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (BARE.test(line)) bare.push(`${f.replace(process.cwd(), '.')}:${i + 1}`)
    })
  }
  check("'오늘'을 UTC로 구하는 자리 0곳 — todayKst()를 쓸 것", bare.length === 0, bare.join(' · '))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
