import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileOutput, FileText, ClipboardCheck, FileStack, Search, ChevronRight, AlertTriangle } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { FirePlanGenerateRequestClient } from '@/components/fire-plans/generate-request-client'
import { getFirePlanGenStatusAction } from '@/app/(dashboard)/fire-plans/generate/actions'
import { ackLawRevisionAction } from './actions'

export const dynamic = 'force-dynamic'

/** 보고서 센터 (소방계획서_4.md §10, R-1·R-2·R-3) — 전 고객 대상 서식 선택·일괄 생성 + 처리 현황 + 서식 관리.
 *  역할 분담: 고객 탭 = 데이터 입력 + 개별 생성 / 이 페이지 = 서식 카탈로그·일괄 생성·현황.
 *  별지 9호는 준비 화면(점검 상세 §9-6⑦)이 단일 생성 지점 — 여기서는 점검 건 선택 → 준비 화면으로 이동.
 *  서식 버전은 law_form_baselines(106·108) 연동 — 개정 감지(announce>seed) 시 '새 개정판' 뱃지 + 재심기 배너 */

const FORMS = [
  { key: 'fire_plan', label: '소방계획서', desc: 'HWP+PDF · 고객 다중 선택', icon: FileOutput, active: true, blKeys: [] as string[], fallbackVersion: '소방청 표준양식 (25년 이후)' },
  { key: 'report9', label: '자체점검 실시결과 (별지 9호)', desc: '점검 건 선택 → 준비 화면', icon: ClipboardCheck, active: true, blKeys: ['report9'], fallbackVersion: '2026-07-01 공포 (법제처)' },
  { key: 'placement', label: '점검인력 배치확인서', desc: '협회 발급 — 점검 상세에 업로드', icon: FileText, active: false, blKeys: [] as string[], fallbackVersion: '' },
  { key: 'report10', label: '이행계획·완료 (별지 10·11호)', desc: '불량 생애주기 — 타임라인 ④⑥에서 생성', icon: FileStack, active: false, blKeys: ['report10', 'report11'], fallbackVersion: '' },
]

type Baseline = { key: string; form_name: string; announce_date: string; seed_date: string | null }
const fmtYmd = (d: string) => (d?.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d)

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ form?: string; q?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  const { form: formRaw, q } = await searchParams
  const form = FORMS.some(f => f.key === formRaw && f.active) ? formRaw! : 'fire_plan'

  // §10-R3: 서식 버전(law_form_baselines) — 개정 감지 크론(§9-5c)이 announce_date를 갱신
  const adminBl = createAdminClient()
  const { data: blRaw } = await adminBl.from('law_form_baselines').select('key, form_name, announce_date, seed_date')
  const baselines = new Map(((blRaw ?? []) as Baseline[]).map(b => [b.key, b]))
  const isRevised = (b?: Baseline) => !!b && !!b.seed_date && b.announce_date > b.seed_date
  const revisedList = [...baselines.values()].filter(b => isRevised(b))
  const canAck = ['admin', 'manager'].includes(profile.role)

  // 별지 9호 — 점검 건 선택 목록 (자체점검만 §9-8, 일반관리는 대상 아님)
  let inspections: Array<{
    id: string; year: number; sequence_num: number; inspection_type: string; status: string
    inspection_start_date: string | null; customer_name: string; report9_count: number
  }> = []
  if (form === 'report9') {
    const admin = createAdminClient()
    let query = admin.from('inspections')
      .select('id, year, sequence_num, inspection_type, status, inspection_start_date, customer:customers(customer_name)')
      .neq('inspection_type', '일반관리')
      .order('inspection_start_date', { ascending: false, nullsFirst: false })
      .limit(30)
    if (q?.trim()) {
      const { data: custIds } = await admin.from('customers').select('id').ilike('customer_name', `%${q.trim()}%`).limit(50)
      query = query.in('customer_id', ((custIds ?? []) as Array<{ id: string }>).map(c => c.id))
    }
    const { data: inspRaw } = await query
    const rows = (inspRaw ?? []) as unknown as Array<{
      id: string; year: number; sequence_num: number; inspection_type: string; status: string
      inspection_start_date: string | null; customer: { customer_name: string } | null
    }>
    // 생성 이력 수 (report9 잡 done 기준)
    const ids = rows.map(r => r.id)
    const countMap = new Map<string, number>()
    if (ids.length > 0) {
      const { data: jobs } = await admin.from('fire_plan_gen_jobs')
        .select('inspection_id').eq('report_type', 'report9').eq('status', 'done').in('inspection_id', ids)
      for (const j of (jobs ?? []) as Array<{ inspection_id: string }>) {
        countMap.set(j.inspection_id, (countMap.get(j.inspection_id) ?? 0) + 1)
      }
    }
    inspections = rows.map(r => ({
      id: r.id, year: r.year, sequence_num: r.sequence_num, inspection_type: r.inspection_type,
      status: r.status, inspection_start_date: r.inspection_start_date,
      customer_name: r.customer?.customer_name ?? '—', report9_count: countMap.get(r.id) ?? 0,
    }))
  }

  const status = form === 'fire_plan' ? await getFirePlanGenStatusAction() : null

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-xl font-bold text-[#090c1d]">보고서 센터</h1>

      {/* §10-R3: 서식 개정 감지 배너 — 재심기 후 [반영 완료]로 뱃지 해제 */}
      {revisedList.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" /> 법제처 서식 개정이 감지됐습니다 — 새 서식 수신 후 재심기(개발 PC)가 필요합니다
          </p>
          {revisedList.map(b => (
            <div key={b.key} className="flex items-center gap-2 text-[11px] text-amber-700">
              <span>{b.form_name}: 심어진 서식 {fmtYmd(b.seed_date!)} → 최신 공포 {fmtYmd(b.announce_date)}</span>
              {canAck && (
                <form action={ackLawRevisionAction}>
                  <input type="hidden" name="key" value={b.key} />
                  <button type="submit" title="재심기(placeholder 재실행)를 마친 뒤에만 눌러주세요"
                    className="h-5 px-2 rounded border border-amber-300 text-[10px] text-amber-800 hover:bg-amber-100">재심기 반영 완료</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 서식 카탈로그 (§10-2) — 해당 없는 서식은 흐림, 버전은 law_form_baselines 연동(R-3) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {FORMS.map(f => {
          const Icon = f.icon
          const selected = form === f.key
          const bls = f.blKeys.map(k => baselines.get(k)).filter(Boolean) as Baseline[]
          const latest = bls.length > 0 ? bls.reduce((a, b) => (a.announce_date >= b.announce_date ? a : b)) : null
          const version = latest ? `${fmtYmd(latest.announce_date)} 공포 (법제처)` : f.fallbackVersion
          const revised = bls.some(b => isRevised(b))
          const card = (
            <div className={`rounded-xl border p-3 h-full transition-colors ${
              !f.active ? 'border-[#eceafd] opacity-50'
                : selected ? 'border-[#7b68ee] bg-[#f5f4ff]' : 'border-[#c8c4d0] bg-white hover:border-[#7b68ee]'}`}>
              <div className="flex items-center gap-1.5">
                <Icon className={`size-4 ${selected ? 'text-[#7b68ee]' : 'text-[#514b81]'}`} />
                <span className={`text-xs font-semibold ${selected ? 'text-[#7b68ee]' : 'text-[#090c1d]'}`}>{f.label}</span>
                {revised && (
                  <span title="법제처 개정 감지 — 재심기 필요"
                    className="ml-auto shrink-0 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium">새 개정판</span>
                )}
              </div>
              <p className="text-[11px] text-[#514b81] mt-1">{f.desc}</p>
              {version && <p className="text-[10px] text-[#b0acd6] mt-0.5">{version}</p>}
              {!f.active && <p className="text-[10px] text-[#b0acd6] mt-0.5">예정</p>}
            </div>
          )
          return f.active
            ? <Link key={f.key} href={`/reports?form=${f.key}`}>{card}</Link>
            : <div key={f.key} title="후속 단계에서 제공됩니다">{card}</div>
        })}
      </div>

      {/* 소방계획서 — 기존 생성 화면 흡수 (고객 다중 선택·프리셋·큐 현황·프리셋 관리 포함) */}
      {form === 'fire_plan' && status && <FirePlanGenerateRequestClient initialStatus={status} />}

      {/* 별지 9호 — 점검 건 선택 → 준비 화면 (§9-6⑦ 진입점 2개·화면 1개) */}
      {form === 'report9' && (
        <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
          <p className="text-xs text-[#514b81] mb-3">
            점검 건을 선택하면 <span className="font-medium text-[#090c1d]">점검 상세의 실시결과 보고서 준비 화면</span>으로 이동합니다 —
            공통정보·인력·점검표·송달 동의 체크 후 생성하세요. (일반관리 점검은 별지 9호 대상이 아닙니다)
          </p>
          <form action="/reports" className="flex items-center gap-2 mb-3">
            <input type="hidden" name="form" value="report9" />
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input name="q" defaultValue={q ?? ''} placeholder="고객명 검색"
                className="h-8 w-full rounded-lg border border-[#d0ccf5] bg-white pl-7 pr-2 text-xs outline-none focus:border-[#7b68ee]" />
            </div>
            <button type="submit" className="h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium">검색</button>
          </form>
          {inspections.length === 0 ? (
            <p className="text-sm text-[#b0acd6] py-6 text-center">자체점검 건이 없습니다{q ? ` — '${q}' 검색 결과 없음` : ''}</p>
          ) : (
            <div className="divide-y divide-[#eceafd]">
              {inspections.map(i => (
                <Link key={i.id} href={`/inspections/${i.id}`}
                  className="flex items-center gap-2 py-2 px-1 text-xs hover:bg-[#f8f9fa] rounded transition-colors">
                  <span className="font-medium text-[#090c1d] w-44 truncate">{i.customer_name}</span>
                  <span className="text-[#514b81]">{i.year}년 {i.sequence_num}차 · {i.inspection_type}</span>
                  <span className="text-[#b0acd6]">{i.inspection_start_date ?? '일정 미정'}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    i.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
                    {i.status === 'completed' ? '완료' : i.status === 'in_progress' ? '진행중' : '예정'}
                  </span>
                  {i.report9_count > 0 && <span className="text-[10px] text-[#7b68ee]">9호 생성 {i.report9_count}회</span>}
                  <ChevronRight className="size-3.5 text-[#b0acd6] ml-auto" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
