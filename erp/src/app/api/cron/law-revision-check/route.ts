import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// 법제처 서식 개정 감지 (소방계획서_4.md §9-5c) — VPS 주간 크론 (IP 등록된 OC 계정 필요, env LAW_OC)
// 별지 9·10·11호(licbyl)·외관점검표 고시(admbyl)의 공포/발령일자를 기준표(106)와 비교,
// 개정 감지 시 관리자 알림(law_revision — 재심기 안내) + 기준 갱신(알림 1회).
// 재심기: 새 HWP 수신 후 seed-report9/-report1011/-exterior-placeholders.py 재실행 (개발 PC).

type FormWatch = {
  key: string; target: 'licbyl' | 'admbyl'; query: string; match: string
  dateTag: '공포일자' | '발령일자'; reseed: string
}
const WATCHES: FormWatch[] = [
  { key: 'report9', target: 'licbyl', query: '자체점검 실시결과', match: '자체점검 실시결과 보고서', dateTag: '공포일자', reseed: 'seed-report9-placeholders.py' },
  { key: 'report10', target: 'licbyl', query: '이행계획서', match: '소방시설등의 자체점검 결과 이행계획서', dateTag: '공포일자', reseed: 'seed-report1011-placeholders.py' },
  { key: 'report11', target: 'licbyl', query: '이행완료 보고서', match: '소방시설등의 자체점검 결과 이행완료 보고서', dateTag: '공포일자', reseed: 'seed-report1011-placeholders.py' },
  { key: 'exterior', target: 'admbyl', query: '소방시설외관점검표', match: '소방시설등 외관점검표', dateTag: '발령일자', reseed: 'seed-exterior-placeholders.py + seed-exterior-sheet.mjs' },
]

/** 검색 XML에서 match 별표명이 속한 항목의 일자·다운로드 링크 추출 (항목 블록 단위) */
function parseEntry(xml: string, match: string, dateTag: string): { date: string; link: string } | null {
  const blocks = xml.split(/<(?:licbyl|admrulbyl) id=/)
  for (const b of blocks) {
    if (!b.includes(match)) continue
    const date = b.match(new RegExp(`<${dateTag}>(\\d{8})</${dateTag}>`))?.[1]
    const link = b.match(/<별표서식파일링크>([^<]+)<\/별표서식파일링크>/)?.[1] ?? ''
    if (date) return { date, link }
  }
  return null
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const oc = process.env.LAW_OC
  if (!oc) return NextResponse.json({ ok: false, error: 'LAW_OC 미설정 — 법제처 회원 ID(IP 등록 계정)를 env에 추가해주세요.' }, { status: 200 })

  const admin = createAdminClient()
  const { data: baseRaw } = await admin.from('law_form_baselines').select('key, form_name, announce_date')
  const baselines = new Map(((baseRaw ?? []) as Array<{ key: string; form_name: string; announce_date: string }>)
    .map(b => [b.key, b]))

  const results: Record<string, string> = {}
  const revised: string[] = []
  for (const w of WATCHES) {
    try {
      const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=${w.target}&type=XML&query=${encodeURIComponent(w.query)}`
      const res = await fetch(url, { cache: 'no-store' })
      const xml = await res.text()
      if (xml.includes('사용자 정보 검증에 실패')) {
        return NextResponse.json({ ok: false, error: `OC 검증 실패(${oc}) — 법제처 OPEN API에 호출 서버 IP(VPS)가 등록된 계정인지 확인해주세요.` }, { status: 200 })
      }
      const entry = parseEntry(xml, w.match, w.dateTag)
      if (!entry) { results[w.key] = '검색 결과 없음(서식명 변경 가능성 — 확인 필요)'; continue }
      const base = baselines.get(w.key)
      if (!base) { results[w.key] = '기준 없음(106 미적용?)'; continue }
      if (entry.date > base.announce_date) {
        // 개정 감지 — 관리자 알림 + 기준 갱신(중복 알림 방지)
        const { data: managers } = await admin.from('profiles')
          .select('id').in('role', ['manager', 'admin']).eq('is_active', true).eq('is_system', false)
        const rows = ((managers ?? []) as Array<{ id: string }>).map(m => ({
          recipient_id: m.id,
          title: `[서식 개정] ${base.form_name}`,
          message: `법제처 서식이 개정됐습니다 (${base.announce_date} → ${entry.date}). 새 서식 수신 후 개발 PC에서 ${w.reseed} 재실행(재심기)이 필요합니다.${entry.link ? ` 다운로드: https://www.law.go.kr${entry.link}` : ''}`,
          type: 'law_revision',
          reference_type: 'document',
        }))
        if (rows.length > 0) await admin.from('notifications').insert(rows as Record<string, unknown>[])
        await admin.from('law_form_baselines')
          .update({ announce_date: entry.date, updated_at: new Date().toISOString() }).eq('key', w.key)
        revised.push(w.key)
        results[w.key] = `개정 감지 ${base.announce_date} → ${entry.date} (알림 발송)`
      } else {
        results[w.key] = `최신 (${base.announce_date})`
      }
    } catch (e) {
      results[w.key] = `조회 실패: ${(e as Error).message.slice(0, 100)}`
    }
  }
  return NextResponse.json({ ok: true, oc, revised, results })
}
