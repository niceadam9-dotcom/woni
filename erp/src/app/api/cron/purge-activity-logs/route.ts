import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// 활동로그 보존 정책: 보존 기간(기본 24개월) 경과분을 월별 JSON으로
// Supabase Storage(log-archives 버킷)에 아카이브한 뒤 삭제한다.
// 근거: 개인정보 안전성 확보조치 기준 — 접속기록 최소 1년(대규모 고유식별정보 2년) 보관.
// 수동 삭제 UI는 감사 무결성 때문에 제공하지 않음 (FIX 문서·활동로그 화면 안내 참조).
//
// Vercel Cron: 매월 1일 03:00 (vercel.json)
// 수동 테스트: GET /api/cron/purge-activity-logs?dry_run=1[&retention_days=N]
// Authorization: Bearer {CRON_SECRET} 헤더 필수

const RETENTION_MONTHS = 24
const BUCKET = 'log-archives'
const BATCH = 5000 // 1회 실행당 최대 처리 행 수 (월간 실행 기준 충분)

type LogRow = {
  id: string
  actor_id: string | null
  action: string | null
  entity_type: string | null
  entity_id: string | null
  metadata: unknown
  ip_address: string | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  // retention_days: 수동 테스트용 오버라이드 (미지정 시 24개월)
  const overrideDays = parseInt(req.nextUrl.searchParams.get('retention_days') ?? '', 10)

  const cutoff = new Date()
  if (!isNaN(overrideDays) && overrideDays > 0) {
    cutoff.setDate(cutoff.getDate() - overrideDays)
  } else {
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS)
  }
  const cutoffIso = cutoff.toISOString()

  const admin = createAdminClient()

  // 1) 만료 로그 조회
  const { data: expiredRaw, error: selErr } = await admin
    .from('activity_logs')
    .select('*')
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (selErr) return NextResponse.json({ error: `조회 실패: ${selErr.message}` }, { status: 500 })

  const expired = (expiredRaw ?? []) as LogRow[]
  if (expired.length === 0) {
    return NextResponse.json({ ok: true, cutoff: cutoffIso, archived: 0, deleted: 0, months: [] })
  }

  // 2) 월별 그룹 → 아카이브 업로드 (버킷 없으면 생성)
  await admin.storage.createBucket(BUCKET, { public: false }).catch(() => {
    /* 이미 존재(409) — 무시 */
  })

  const byMonth = new Map<string, LogRow[]>()
  for (const row of expired) {
    const ym = row.created_at.slice(0, 7) // 'YYYY-MM'
    if (!byMonth.has(ym)) byMonth.set(ym, [])
    byMonth.get(ym)!.push(row)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const uploaded: string[] = []
  for (const [ym, rows] of byMonth) {
    // 재실행 시 덮어쓰기 방지를 위해 실행 시각을 파일명에 포함
    const path = `activity-logs/${ym}_${stamp}.json`
    const body = JSON.stringify(
      { exported_at: new Date().toISOString(), month: ym, retention_cutoff: cutoffIso, count: rows.length, rows },
      null, 2
    )
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, new Blob([body], { type: 'application/json' }))
    if (upErr) {
      // 아카이브 실패 시 해당 월은 삭제하지 않음 — 다음 실행에서 재시도
      return NextResponse.json(
        { error: `아카이브 업로드 실패(${path}): ${upErr.message}`, uploaded },
        { status: 500 }
      )
    }
    uploaded.push(path)
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true, dry_run: true, cutoff: cutoffIso,
      archived: expired.length, deleted: 0, months: uploaded,
      note: 'dry_run — 아카이브만 수행, 삭제 없음',
    })
  }

  // 3) 아카이브 완료분 삭제 — activity_logs는 append-only(트리거 차단)라
  //    migration 040의 purge_activity_logs() SECURITY DEFINER RPC로만 삭제 가능
  const ids = expired.map(r => r.id)
  const { data: deletedCount, error: delErr } = await admin.rpc('purge_activity_logs', { purge_ids: ids })
  if (delErr) {
    return NextResponse.json(
      { error: `삭제 실패(아카이브는 완료 — migration 040 적용 여부 확인): ${delErr.message}`, uploaded },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, cutoff: cutoffIso, archived: expired.length, deleted: deletedCount ?? ids.length, months: uploaded })
}
