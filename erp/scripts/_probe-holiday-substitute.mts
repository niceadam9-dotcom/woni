// 대체공휴일 생성 실측 — lib/holidays.ts가 연도별로 무엇을 만드는지 그대로 출력 (읽기 전용)
// 실행: npx tsx scripts/_probe-holiday-substitute.mts
import { getKoreanHolidays } from '../src/lib/holidays'

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const dow = (iso: string) => DOW[new Date(iso + 'T00:00:00').getDay()]

for (const year of [2024, 2025, 2026, 2027]) {
  const list = await getKoreanHolidays(year)
  const subs = list.filter(h => h.name.startsWith('대체공휴일'))
  console.log(`\n===== ${year}년 — 공휴일 ${list.length}일 · 대체공휴일 ${subs.length}일 =====`)
  for (const h of list) {
    const mark = h.name.startsWith('대체공휴일') ? '  ↳' : '   '
    console.log(`${mark} ${h.date}(${dow(h.date)}) ${h.name}`)
  }
}

// 같은 날짜에 공휴일이 둘 이상 겹치는 경우 원본에 무엇이 있었는지 — 코드가 조용히 버리는 지점
console.log('\n===== 원본(date-holidays)에서 같은 날 겹치는 공휴일 =====')
const Holidays = (await import('date-holidays')).default as unknown as new (c: string) => {
  setLanguages: (l: string) => void
  getHolidays: (y: number) => Array<{ date: string; name: string; type: string }>
}
for (const year of [2024, 2025, 2026, 2027]) {
  const hd = new Holidays('KR'); hd.setLanguages('ko')
  const raw = (hd.getHolidays(year) as Array<{ date: string; name: string; type: string }>)
    .filter(r => r.type === 'public')
  const byDate = new Map<string, string[]>()
  for (const r of raw) {
    const d = r.date.slice(0, 10)
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(r.name)
  }
  const dup = [...byDate.entries()].filter(([, v]) => v.length > 1)
  console.log(`  ${year}: ${dup.length === 0 ? '겹침 없음' : dup.map(([d, v]) => `${d}(${dow(d)}) = ${v.join(' + ')}`).join(' / ')}`)
}
