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
  // OC = 법제처 회원 ID (활용신청에 호출 서버 IP 등록 필요). 주 계정 검증 실패 시 공용 샘플(test) 폴백 —
  // 등록 반영이 지연돼도 크론이 멈추지 않고, 반영되는 즉시 자동으로 주 계정 사용.
  const ocPrimary = process.env.LAW_OC
  if (!ocPrimary) return NextResponse.json({ ok: false, error: 'LAW_OC 미설정 — 법제처 회원 ID(IP 등록 계정)를 env에 추가해주세요.' }, { status: 200 })
  let oc = ocPrimary
  let ocNote = ''
  try {
    const probe = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(ocPrimary)}&target=licbyl&type=XML&query=a`, { cache: 'no-store' })
    if ((await probe.text()).includes('사용자 정보 검증에 실패')) {
      oc = 'test'
      ocNote = `주 계정(${ocPrimary}) 검증 실패 — 공용 샘플(test)로 폴백. 법제처 OPEN API 활용신청의 IP(121.78.123.230) 등록·승인 상태를 확인해주세요.`
    }
  } catch { /* probe 실패 시 주 계정으로 진행 — 아래 개별 호출에서 처리 */ }

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
        // ⚠ 알림이 실패하면 **기준일을 올리지 않는다.**
        //   올려 버리면 다음 실행에서 entry.date > announce_date가 거짓이 되어 개정 사실이
        //   통째로 사라지고, 재심기가 영영 돌지 않는다(법정 서식이 바뀌었는데 옛 서식으로 계속
        //   문서를 만든다). 실제로 type='law_revision'이 CHECK에 없어 insert가 항상 실패하는데
        //   오류를 안 보고 기준만 올리고 있었다 — 스테이징 실측 알림 0건, 마이그레이션 143에서 해소.
        //   신호를 잃느니 다음 실행이 다시 시도하게 두는 편이 낫다.
        const { error: notiErr } = rows.length > 0
          ? await admin.from('notifications').insert(rows as Record<string, unknown>[])
          : { error: null }
        if (notiErr) {
          results[w.key] = `개정 감지 ${base.announce_date} → ${entry.date} — ⚠ 알림 발송 실패로 기준 미갱신(다음 실행 재시도): ${notiErr.message.slice(0, 120)}`
          continue
        }
        await admin.from('law_form_baselines')
          .update({ announce_date: entry.date, updated_at: new Date().toISOString() }).eq('key', w.key)
        revised.push(w.key)
        results[w.key] = `개정 감지 ${base.announce_date} → ${entry.date} (알림 ${rows.length}건 발송)`
      } else {
        results[w.key] = `최신 (${base.announce_date})`
      }
    } catch (e) {
      results[w.key] = `조회 실패: ${(e as Error).message.slice(0, 100)}`
    }
  }
  return NextResponse.json({ ok: true, oc, ...(ocNote ? { ocNote } : {}), revised, results })
}
