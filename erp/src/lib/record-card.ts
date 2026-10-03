import QRCode from 'qrcode'
// 타입 위치에서만 쓴다 — 값으로 가져오면 server-only가 딸려 와 tsx 검증 스크립트가 못 부른다(annex 모듈 규약)
import type { createAdminClient } from '@/lib/supabase/admin'
import { loadAnnexInputs, actionPlanPeriod } from '@/lib/report9-assemble'
import { resolveActionPeriod } from '@/lib/annex-total-period'
import { newTagCode } from '@/lib/equipment-tag'
import { todayKst } from '@/lib/kst-date'

/** 소방시설등 자체점검기록표(별표 5) — 게시용 PDF (통합 실행계획 C4 — 설비 QR 절 4단계, 2026-10-03)
 *
 *  원문: 시행규칙 [별표 5](제25조 관련) — erp_goal/_doc01/「[별표 5] …기록표」.hwp·.pdf·미리보기.gif
 *  (law.go.kr flSeq 124641137·124641139에서 2026-10-03 내려받아 보관. 파생 요약이 아니라 서식 원문이다.)
 *  관계인은 결과 보고 후 10일 안에 출입구에 30일 이상 게시한다 — 인쇄물일 뿐, 6단계 완료 조건이 아니다.
 *
 *  서식 규격(별표 5 비고를 그대로): A4 가로(297×210) · 외측 테두리 파랑 RGB(65,143,222) ·
 *  내측 테두리 하늘 RGB(193,214,237) · 제목 45pt·본문 20pt. 글씨체는 비고가 HY헤드라인M·윤고딕을
 *  지정하지만 PDF 변환 컨테이너에는 NanumGothic뿐이라 대체한다(표지 제목과 같은 사정 — 자형만 다르고
 *  배치·크기·색은 서식대로). 건물 QR은 서식 밖 여백(오른쪽 아래)에 — 서식 본문은 건드리지 않는다.
 *
 *  불량사항 체크의 분류는 시행령 별표 1의 소방시설 분류 축이다. 불량의 defect_code 머리 숫자가
 *  점검표 시트 번호(STD-nn)이므로 그 번호로 가른다: 1~13 소화설비 · 14~19 경보설비 · 20~22 피난구조설비 ·
 *  23~24 소화용수설비 · 25~30 소화활동설비 · 그 밖(31·32·X·코드 없음) 기타설비. 불량 0건 = 「없음」.
 *
 *  정비기간은 ④ 수기값(annex_inputs report10) > 불량 조치계획 자동값 — **법정 폴백은 깔지 않는다**
 *  (그 폴백은 기산일이 없으면 오늘로 움직인다. 게시물에 매일 달라지는 기간을 찍을 수 없다 — 비면 빈칸). */

type Admin = ReturnType<typeof createAdminClient>

export type RecordCardBoxes = { fire: boolean; alarm: boolean; evac: boolean; water: boolean; activity: boolean; etc: boolean; none: boolean }

export type RecordCardPage = { buildingName: string; address: string; tagCode: string | null }

export type RecordCardData = {
  customerName: string
  isComprehensive: boolean          // 종합점검이면 true, 작동점검이면 false
  periodStart: string | null        // ISO
  periodEnd: string | null
  inspectorName: string             // 점검자(관리업체 약식 상호)
  boxes: RecordCardBoxes
  repairStart: string | null
  repairEnd: string | null
  writtenDate: string               // 작성일(인쇄일, KST)
  pages: RecordCardPage[]
}

/** 불량 defect_code 목록 → 별표 5 불량사항 체크 7칸 */
export function defectBoxes(codes: Array<string | null>): RecordCardBoxes {
  const b: RecordCardBoxes = { fire: false, alarm: false, evac: false, water: false, activity: false, etc: false, none: false }
  if (codes.length === 0) { b.none = true; return b }
  for (const c of codes) {
    const n = parseInt(String(c ?? ''), 10)
    if (!Number.isFinite(n)) b.etc = true
    else if (n <= 13) b.fire = true
    else if (n <= 19) b.alarm = true
    else if (n <= 22) b.evac = true
    else if (n <= 24) b.water = true
    else if (n <= 30) b.activity = true
    else b.etc = true
  }
  return b
}

/** 조립 — 회차 하나의 기록표 데이터. 활성 건물마다 1쪽(건물 0이면 고객 주소로 1쪽·QR 없음).
 *  issueTags=true면 코드 없는 활성 건물에 발급한다(재발급 없음 — tag_code IS NULL 조건부) */
export async function assembleRecordCard(
  admin: Admin, inspectionId: string,
  company: { company_name: string | null; official_sender_name: string | null } | null,
  opts: { issueTags?: boolean } = {},
): Promise<{ data: RecordCardData; missing: string[] } | null> {
  const { data: inspRaw } = await admin.from('inspections')
    .select('id, customer_id, inspection_type, inspection_start_date, inspection_end_date, customers:customer_id (customer_name, address)')
    .eq('id', inspectionId).maybeSingle()
  if (!inspRaw) return null
  const insp = inspRaw as unknown as {
    id: string; customer_id: string; inspection_type: string | null
    inspection_start_date: string | null; inspection_end_date: string | null
    customers: { customer_name: string; address: string | null } | null
  }
  const missing: string[] = []

  const [fields, defectsRes, buildingsRes] = await Promise.all([
    loadAnnexInputs(admin, inspectionId, 'report10'),
    admin.from('inspection_defects').select('defect_code, action_plan, action_start, action_end').eq('inspection_id', inspectionId),
    admin.from('buildings').select('id, building_name, address, tag_code').eq('customer_id', insp.customer_id).eq('is_active', true).order('created_at'),
  ])
  const defects = (defectsRes.data ?? []) as Array<{ defect_code: string | null; action_plan: string | null; action_start: string | null; action_end: string | null }>
  const buildings = (buildingsRes.data ?? []) as Array<{ id: string; building_name: string; address: string | null; tag_code: string | null }>

  if (opts.issueTags) {
    for (const b of buildings.filter(x => !x.tag_code)) {
      for (let i = 0; i < 3; i++) {
        const code = newTagCode()
        const { data: up, error } = await admin.from('buildings').update({ tag_code: code }).eq('id', b.id).is('tag_code', null).select('id')
        if (!error && up?.length) { b.tag_code = code; break }
        if (!error) break // 다른 요청이 먼저 발급 — 다시 읽기보다 이번 인쇄는 그대로(다음 인쇄에 실린다)
      }
      if (!b.tag_code) missing.push(`건물 「${b.building_name}」 QR 코드 발급 실패 — 다시 인쇄해 보세요.`)
    }
  }

  const period = resolveActionPeriod(fields, actionPlanPeriod(defects))
  if (defects.length > 0 && !period) missing.push('정비기간이 아직 없습니다 — ④ 소방서 제출에서 총 이행기간을 정하면 실립니다.')

  const pages: RecordCardPage[] = buildings.length
    ? buildings.map(b => ({ buildingName: b.building_name, address: b.address ?? insp.customers?.address ?? '', tagCode: b.tag_code }))
    : [{ buildingName: insp.customers?.customer_name ?? '', address: insp.customers?.address ?? '', tagCode: null }]
  if (!buildings.length) missing.push('활성 건물이 없어 고객 주소로 1쪽만 만들었습니다(건물 QR 없음).')

  const name = (company?.company_name ?? '').trim()
  const inspector = name || (company?.official_sender_name ?? '').trim()
  if (!inspector) missing.push('회사 정보(상호)가 없어 점검자 칸이 빕니다 — 본사 정보에서 입력하세요.')

  return {
    data: {
      customerName: insp.customers?.customer_name ?? '',
      isComprehensive: (insp.inspection_type ?? '').includes('종합'),
      periodStart: insp.inspection_start_date, periodEnd: insp.inspection_end_date,
      inspectorName: inspector,
      boxes: defectBoxes(defects.map(d => d.defect_code)),
      repairStart: period?.startISO ?? null, repairEnd: period?.endISO ?? null,
      writtenDate: todayKst(),
      pages,
    },
    missing,
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const BLUE = 'rgb(65,143,222)'
const SKY = 'rgb(193,214,237)'

/** 'YYYY-MM-DD' → 「2026년 08월 20일」. 없으면 빈 칸 꼴(「    년   월   일」 — 서식 원문처럼) */
const kdate = (iso: string | null) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '<span class="blank">년</span> <span class="blank">월</span> <span class="blank">일</span>'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${y}년 ${m}월 ${d}일`
}
const box = (on: boolean, label: string) => `<span class="bx">[${on ? '■' : '&nbsp;&nbsp;'}]</span> ${esc(label)}`

/** 별표 5 그대로 1쪽(건물마다) — A4 가로·테두리 2겹·행 8개·하단 법명 문구. QR은 서식 밖 여백 오른쪽 아래 */
export async function renderRecordCardHtml(d: RecordCardData, baseUrl: string): Promise<string> {
  const sheets = await Promise.all(d.pages.map(async p => {
    const qr = p.tagCode
      ? await QRCode.toString(`${baseUrl.replace(/\/$/, '')}/t/${p.tagCode}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      : ''
    const rows = [
      ['대상물명', esc(p.buildingName || d.customerName)],
      ['주  소', esc(p.address)],
      ['점검구분', `${box(!d.isComprehensive, '작동점검')}&nbsp;&nbsp;&nbsp;&nbsp;${box(d.isComprehensive, '종합점검')}`],
      ['점 검 자', esc(d.inspectorName)],
      ['점검기간', `${kdate(d.periodStart)} ~ ${kdate(d.periodEnd)}`],
      ['불량사항', `${box(d.boxes.fire, '소화설비')} ${box(d.boxes.alarm, '경보설비')} ${box(d.boxes.evac, '피난구조설비')}<br>${box(d.boxes.water, '소화용수설비')} ${box(d.boxes.activity, '소화활동설비')} ${box(d.boxes.etc, '기타설비')} ${box(d.boxes.none, '없음')}`],
      ['정비기간', `${kdate(d.repairStart)} ~ ${kdate(d.repairEnd)}`],
    ].map(([k, v]) => `<div class="row"><span class="k">•${k}</span><span class="c">:</span><span class="v">${v}</span></div>`).join('')
    return `<section class="sheet">
  <div class="outer"><div class="inner">
    <h1>소방시설등 자체점검기록표</h1>
    ${rows}
    <div class="written">${kdate(d.writtenDate)}</div>
    <p class="foot">「<b class="law">소방시설 설치 및 관리에 관한 법률</b>」 제24조제1항 및 같은 법 시행규칙 제25조에<br>따라 소방시설등 자체점검결과를 게시합니다.</p>
  </div></div>
  ${p.tagCode ? `<div class="qr" data-tag="${esc(p.tagCode)}">${qr}<div class="qrcode-text">${esc(p.tagCode)}</div></div>` : ''}
</section>`
  }))
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>소방시설등 자체점검기록표</title>
<style>
@page { size: A4 landscape; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font-family: 'NanumGothic', 'Noto Sans CJK KR', 'Malgun Gothic', sans-serif }
.sheet { position: relative; width: 297mm; height: 210mm; padding: 10mm 14mm; page-break-after: always; break-after: page }
.sheet:last-child { page-break-after: auto; break-after: auto }
.outer { height: 100%; border: 2.6mm solid ${BLUE}; padding: 1.8mm }
.inner { height: 100%; border: 1.4mm solid ${SKY}; padding: 7mm 12mm 5mm }
h1 { margin: 1mm 0 6mm; text-align: center; color: ${BLUE}; font-size: 45pt; letter-spacing: .05em; font-weight: 800 }
.row { display: flex; gap: 3mm; font-size: 20pt; line-height: 1.52 }
.k { color: ${BLUE}; font-weight: 700; width: 46mm; letter-spacing: .04em; white-space: pre }
.c { color: ${BLUE}; font-weight: 700 }
.v { color: #111; flex: 1 }
.bx { font-weight: 700 }
.blank { letter-spacing: 2.2em; padding-left: 2.2em }
.written { text-align: right; font-size: 20pt; margin: 2mm 8mm 0 0; color: #111 }
.foot { margin: 4mm 0 0; font-size: 17.5pt; font-weight: 700; color: #111 }
.foot .law { color: ${BLUE} }
/* QR은 서식 본문 밖 — 내측 테두리 안 오른쪽 아래의 빈 자리(하단 문구 오른쪽) */
.qr { position: absolute; right: 22mm; bottom: 15mm; width: 20mm; text-align: center; background: #fff; padding: 1mm }
.qr svg { width: 18mm; height: 18mm }
.qrcode-text { font-family: 'Consolas', monospace; font-size: 6.5pt; letter-spacing: .08em }
</style></head><body>${sheets.join('')}</body></html>`
}
