/**
 * date-holidays 패키지로 한국 공휴일을 가져옵니다.
 *
 * 처리 내용:
 * 1. 설날·추석 등 연휴(P3D)는 start~end 범위를 확장해 각 날짜를 모두 포함
 * 2. 설날 라이브러리 버그 보정: date-holidays가 설날을 당일(1/1)부터 3일로
 *    계산하지만 한국법은 전날(12/30)부터 3일이므로 하루 앞당김
 * 3. 공휴일이 토·일요일에 해당하면 대체공휴일(다음 평일)을 자동 생성
 * 4. date-holidays가 'public'으로 잘못 분류하는 비공휴일 국경일(제헌절, 2008년부터
 *    공휴일 아님)은 제외 — 포함 시 영업일 계산이 밀려 법정 제출기한을 초과할 수 있음
 */
const NON_PUBLIC_NATIONAL_DAYS = ['제헌절']

export async function getKoreanHolidays(year: number): Promise<{ date: string; name: string }[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Holidays = require('date-holidays')
  const hd = new Holidays('KR')
  hd.setLanguages('ko')

  const raw = hd.getHolidays(year) as Array<{
    date: string; name: string; type: string; start: string; end: string; rule?: string
  }>

  const KST = 9 * 60 * 60 * 1000
  const DAY = 24 * 60 * 60 * 1000
  const dateMap = new Map<string, string>()

  for (const h of raw.filter(r => r.type === 'public' && !NON_PUBLIC_NATIONAL_DAYS.includes(r.name))) {
    let startMs = new Date(h.start).getTime() + KST
    let endMs   = new Date(h.end).getTime()   + KST

    // 설날 라이브러리 버그 보정:
    // rule "korean 01-0-01 P3D" → 당일(1/1)부터 3일 → 하루 앞당겨 전날(12/30)부터 3일
    if (h.rule?.includes('01-0-01') && h.rule?.includes('P3D')) {
      startMs -= DAY
      endMs   -= DAY
    }

    // [startMs, endMs) 범위의 KST 날짜를 하나씩 등록
    let cur = startMs
    while (cur < endMs) {
      const d = new Date(cur)
      const y = d.getUTCFullYear()
      const m = String(d.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(d.getUTCDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${dd}`
      if (!dateMap.has(dateStr)) dateMap.set(dateStr, h.name)
      cur += DAY
    }
  }

  // 대체공휴일: 공휴일이 토·일이면 다음 비공휴일 평일로 이동
  const subSet = new Set<string>()
  const substitutes: Array<{ date: string; name: string }> = []

  for (const [dateStr, name] of [...dateMap.entries()].sort()) {
    const d = new Date(dateStr + 'T00:00:00')
    const dow = d.getDay()

    if (dow === 0 || dow === 6) {
      const sub = new Date(d)
      sub.setDate(sub.getDate() + (dow === 6 ? 2 : 1))

      for (let i = 0; i < 10; i++) {
        const sy   = sub.getFullYear()
        const sm   = String(sub.getMonth() + 1).padStart(2, '0')
        const sd   = String(sub.getDate()).padStart(2, '0')
        const subStr = `${sy}-${sm}-${sd}`
        const subDow = sub.getDay()

        if (subDow !== 0 && subDow !== 6 && !dateMap.has(subStr) && !subSet.has(subStr)) {
          substitutes.push({ date: subStr, name: `대체공휴일 (${name})` })
          subSet.add(subStr)
          break
        }
        sub.setDate(sub.getDate() + 1)
      }
    }
  }

  for (const s of substitutes) {
    dateMap.set(s.date, s.name)
  }

  return [...dateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, name]) => ({ date, name }))
}
