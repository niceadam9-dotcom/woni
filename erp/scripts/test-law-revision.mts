// 9-5c E2E — 법제처 서식 개정 감지 크론 (LAW_OC=test, 실 API)
// 실행: npx tsx scripts/test-law-revision.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary } from './_e2e-helpers.mjs'
import { readFileSync } from 'fs'

const secret = (readFileSync('F:/AI/ERP/erp/.env.local', 'utf8').match(/^CRON_SECRET=(.+)$/m)?.[1] ?? '').trim()
const fire = () => fetch(`${BASE}/api/cron/law-revision-check`, { headers: { Authorization: `Bearer ${secret}` } }).then(r => r.json())

try {
  // 1) 기준 최신 상태 — 개정 없음
  const res1 = await fire()
  check('크론 응답 ok', res1.ok === true, JSON.stringify(res1))
  check('전 서식 최신 판정', (res1.revised ?? []).length === 0 && String(res1.results?.report9 ?? '').includes('최신'), JSON.stringify(res1.results))

  // 2) 개정 시뮬레이션 — report9 기준을 과거로 내림
  await raw.from('law_form_baselines').update({ announce_date: '20250101' }).eq('key', 'report9')
  const res2 = await fire()
  check('개정 감지(report9)', (res2.revised ?? []).includes('report9'), JSON.stringify(res2.results))
  const { data: base } = await raw.from('law_form_baselines').select('announce_date').eq('key', 'report9').single()
  check('기준 갱신(20260701)', base?.announce_date === '20260701', base?.announce_date)
  const { data: notis } = await raw.from('notifications')
    .select('id, title, message').eq('type', 'law_revision')
  const mine = (notis ?? []).filter((n: { title: string }) => n.title.includes('별지 9호'))
  check('관리자 알림(law_revision) 발송', mine.length > 0, String((notis ?? []).length))
  check('재심기 안내 포함', mine.some((n: { message: string }) => n.message.includes('seed-report9-placeholders.py')))

  // 3) 재발화 — 기준 갱신됐으므로 추가 알림 없음(1회 원칙)
  const res3 = await fire()
  check('재발화 시 재알림 없음', !(res3.revised ?? []).includes('report9'), JSON.stringify(res3.revised))

  // 정리 — 테스트 알림 제거
  for (const n of mine) await raw.from('notifications').delete().eq('id', (n as { id: string }).id)
} catch (e) {
  check('예외 없음', false, String(e))
}
summary()
