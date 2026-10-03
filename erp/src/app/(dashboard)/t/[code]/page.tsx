import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { QrCode } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTagInput, tagHuman, TAG_LEN } from '@/lib/equipment-tag'
import { findAssetByTag, findPointByTag, findBuildingByTag, openInspectionIdForCustomer, recentAssetEvents } from '@/lib/equipment-tag-lookup'
import { getSheets } from '@/lib/sheet-catalog'
import { Bookmark, ClipboardList } from 'lucide-react'
import { CATEGORY_LABEL, RULE_LABEL, expiryOf, expiryState } from '@/lib/equipment-lifespan'
import { todayKst } from '@/lib/kst-date'
import { TagSearchForm } from '@/components/equipment/tag-search-form'
import { TagScanRecorder, TagCardActions, TagRegisterForm } from '@/components/equipment/tag-card-actions'

/** QR 리졸버 — `/t/{tag_code}` (통합계획 C3 3단계 = 설비 QR 절 1단계, 2026-10-03)
 *  로그인 뒤 경로(proxy가 비로그인을 /login으로). 공개 카드는 없다 — 개체 위치·불량은 외부에 보이지 않는다.
 *  1단계는 개체(C)만. 못 찾으면 수기 조회 칸과 함께 「등록되지 않은 코드」(스캔 첫 등록은 모바일 2단계). */
const EVENT_LABEL: Record<string, string> = { install: '설치', inspect: '점검', measure: '약제량 측정', perf_check: '성능확인', repair: '수리', replace: '교체', dispose: '폐기', scan: 'QR 확인' }
const RESULT_LABEL: Record<string, string> = { good: '양호', aging: '노후', defect: '불량' }
const STATE_LABEL = { expired: '내용연수 경과', soon: '12개월 내 만료', ok: '정상', unknown: '제조연월 미입력', none: '연수 판정 없음' } as const
const STATUS_LABEL: Record<string, string> = { in_use: '사용 중', replaced: '교체됨', disposed: '폐기', lost: '분실' }

export default async function TagPage({ params }: { params: Promise<{ code: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role as UserRole, 'inspection_register')) redirect('/dashboard')
  const { code: raw } = await params
  const code = normalizeTagInput(decodeURIComponent(raw))
  if (!code) notFound()
  if (code.length < TAG_LEN) redirect(`/t?q=${code}`)
  if (code !== raw) redirect(`/t/${code}`)

  const admin = createAdminClient()
  const a = await findAssetByTag(admin, code)
  // 지점(책갈피, 178) — 개체가 아니면 지점에서 찾는다. 찍는 즉시 점검표로 가는 것이 목적이라 카드가 다르다
  if (!a) {
    const p = await findPointByTag(admin, code)
    if (p) {
      const [inspId, allSheets] = await Promise.all([openInspectionIdForCustomer(admin, p.customer_id), getSheets()])
      const nameOf = new Map(allSheets.map(s => [s.sheet_code, s.sheet_name]))
      return (
        <div className="mx-auto max-w-md space-y-3 p-4" data-testid="tag-point-card">
          <div className="flex items-center gap-2 text-ink-meta text-xs"><QrCode className="size-4" /> {tagHuman(code)}</div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-ink" data-testid="tag-point-label"><Bookmark className="size-5 text-brand" /> {p.label}</h1>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-ink-meta">고객</dt><dd><Link className="underline" href={`/customers/${p.customer_id}?tab=facilities&form=1.4`}>{p.customer?.customer_name ?? '고객'}</Link></dd>
            <dt className="text-ink-meta">위치</dt><dd>{[p.building?.building_name, p.floor && `${p.floor}층`, p.room].filter(Boolean).join(' · ') || '—'}</dd>
            {p.note && <><dt className="text-ink-meta">메모</dt><dd>{p.note}</dd></>}
          </dl>
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-ink">이 자리의 점검표</h2>
            {p.sheet_codes.length === 0 ? (
              <p className="text-sm text-ink-meta">등록된 시트가 없습니다 — 고객 [공통] 1.4 지점 QR에서 시트를 고르세요.</p>
            ) : inspId ? (
              <div className="flex flex-col gap-1.5" data-testid="tag-point-sheets">
                {p.sheet_codes.map(c => (
                  <Link key={c} href={`/inspections/${inspId}/sheet?sheet=${encodeURIComponent(c)}&from=tag`} data-testid="tag-point-sheet-link"
                    className="inline-flex h-11 items-center gap-2 rounded-lg border border-brand-line px-3 text-sm text-brand">
                    <ClipboardList className="size-4" /> {c} {nameOf.get(c) ?? ''}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-amber-700" data-testid="tag-point-no-inspection">진행 중 점검 회차가 없습니다 — 점검 달력에서 회차를 시작한 뒤 다시 찍으세요.</p>
            )}
          </div>
        </div>
      )
    }
  }
  // 건물(기록표 QR, 179) — 출입구 게시물의 QR. 회차 목록과 단계 상태(직원용 — 공개 카드는 두지 않는다, 사용자 결정)
  if (!a) {
    const b = await findBuildingByTag(admin, code)
    if (b) {
      const { data: inspsRaw } = await admin.from('inspections')
        .select('id, year, sequence_num, inspection_type, status, inspection_start_date, inspection_end_date')
        .eq('customer_id', b.customer_id)
        .order('inspection_start_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
        .limit(5)
      const insps = (inspsRaw ?? []) as Array<{ id: string; year: number; sequence_num: number; inspection_type: string | null; status: string; inspection_start_date: string | null; inspection_end_date: string | null }>
      const { data: stepsRaw } = insps.length
        ? await admin.from('inspection_steps').select('inspection_id, status').in('inspection_id', insps.map(i => i.id))
        : { data: [] }
      const done = new Map<string, { d: number; t: number }>()
      for (const s of (stepsRaw ?? []) as Array<{ inspection_id: string; status: string }>) {
        const e = done.get(s.inspection_id) ?? { d: 0, t: 0 }
        e.t++; if (s.status === 'done') e.d++
        done.set(s.inspection_id, e)
      }
      const INS_STATUS: Record<string, string> = { in_progress: '진행 중', completed: '완료' }
      return (
        <div className="mx-auto max-w-md space-y-3 p-4" data-testid="tag-building-card">
          <div className="flex items-center gap-2 text-ink-meta text-xs"><QrCode className="size-4" /> {tagHuman(code)}</div>
          <h1 className="text-lg font-bold text-ink" data-testid="tag-building-name">{b.building_name}</h1>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-ink-meta">고객</dt><dd><Link className="underline" href={`/customers/${b.customer_id}`}>{b.customer?.customer_name ?? '고객'}</Link></dd>
            <dt className="text-ink-meta">주소</dt><dd>{b.address || '—'}</dd>
          </dl>
          <div>
            <h2 className="mb-1 text-sm font-semibold text-ink">자체점검 회차</h2>
            {insps.length === 0 ? <p className="text-sm text-ink-meta">회차가 없습니다.</p> : (
              <ul className="divide-y rounded-lg border text-sm" data-testid="tag-building-inspections">
                {insps.map(i => {
                  const st = done.get(i.id)
                  return (
                    <li key={i.id}><Link className="flex items-center gap-2 px-3 py-2 hover:bg-paper" href={`/inspections/${i.id}`}>
                      <b>{i.year}년 {i.sequence_num}차</b> {i.inspection_type ?? ''}
                      <span className="flex-1" />
                      {st && <span className="text-ink-meta">단계 {st.d}/{st.t}</span>}
                      <span className={`rounded-full px-1.5 py-0.5 text-xs ${i.status === 'completed' ? 'bg-gray-100 text-gray-600' : 'bg-brand-tint text-brand'}`}>{INS_STATUS[i.status] ?? i.status}</span>
                    </Link></li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )
    }
  }
  if (!a) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-4" data-testid="tag-unknown">
        <h1 className="flex items-center gap-2 text-lg font-bold text-ink"><QrCode className="size-5" /> {tagHuman(code)}</h1>
        <p className="text-sm text-ink-sub">등록되지 않은 코드입니다. 라벨의 앞 6자를 다시 확인하거나 아래에서 찾아 보세요.</p>
        <TagSearchForm />
        {/* C4 2단계 — 선인쇄 라벨을 붙이며 찍었다면 여기서 바로 첫 등록(라벨 부착 = 대장 입력) */}
        {can(profile.role as UserRole, 'customer_manage') && <TagRegisterForm code={code} />}
      </div>
    )
  }
  const today = todayKst()
  const st = expiryState(a, today)
  const events = await recentAssetEvents(admin, a.id)
  return (
    <div className="mx-auto max-w-md space-y-3 p-4" data-testid="tag-card">
      <TagScanRecorder assetId={a.id} />
      <div className="flex items-center gap-2 text-ink-meta text-xs"><QrCode className="size-4" /> {tagHuman(a.tag_code)}</div>
      <h1 className="text-lg font-bold text-ink" data-testid="tag-card-title">
        {CATEGORY_LABEL[a.category]}{a.sub_type ? <span className="font-normal text-ink-sub"> · {a.sub_type}</span> : null}
      </h1>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm">
        <dt className="text-ink-meta">고객</dt><dd><Link className="underline" href={`/customers/${a.customer_id}?tab=facilities&form=1.4`}>{a.customer?.customer_name ?? '고객'}</Link></dd>
        <dt className="text-ink-meta">위치</dt><dd data-testid="tag-card-location">{[a.building?.building_name, a.location].filter(Boolean).join(' · ') || '—'}</dd>
        <dt className="text-ink-meta">제조연월</dt><dd>{a.manufactured_on?.slice(0, 7) ?? '—'}</dd>
        <dt className="text-ink-meta">내용연수</dt>
        <dd data-testid="tag-card-expiry">{RULE_LABEL[a.lifespan_rule]}{expiryOf(a) ? ` · 만료 ${expiryOf(a)}` : ''} <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${st === 'expired' ? 'bg-red-100 text-red-700' : st === 'soon' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{STATE_LABEL[st]}</span></dd>
        {a.warranty_until && <><dt className="text-ink-meta">하자보수</dt><dd>~{a.warranty_until}{a.warranty_until >= today ? ' (시공사 무상 기간)' : ' (종료)'}</dd></>}
        <dt className="text-ink-meta">상태</dt><dd data-testid="tag-card-status">{STATUS_LABEL[a.status] ?? a.status}</dd>
      </dl>
      {/* C4 2단계 — 현장 버튼(사용 중인 설비만). 교체는 대장 관리 권한 */}
      {a.status === 'in_use' && <TagCardActions assetId={a.id} canReplace={can(profile.role as UserRole, 'customer_manage')} />}
      <div>
        <h2 className="mb-1 text-sm font-semibold text-ink">최근 이력</h2>
        {events.length === 0 ? <p className="text-sm text-ink-meta">이력이 없습니다.</p> : (
          <ul className="space-y-1 text-sm" data-testid="tag-card-events">
            {events.map((e, i) => (
              <li key={i}>{e.event_date} · {EVENT_LABEL[e.event_type] ?? e.event_type}{e.result ? ` · ${RESULT_LABEL[e.result] ?? e.result}` : ''}
                {e.event_type === 'measure' && typeof e.values.loss_rate === 'number' ? ` (손실 ${Math.round(e.values.loss_rate * 1000) / 10}%)` : ''}</li>
            ))}
          </ul>
        )}
      </div>
      <Link href={`/customers/${a.customer_id}?tab=facilities&form=1.4`} className="inline-flex h-9 items-center rounded-lg border border-brand-line px-3 text-sm text-brand">설비 대장 열기</Link>
    </div>
  )
}
