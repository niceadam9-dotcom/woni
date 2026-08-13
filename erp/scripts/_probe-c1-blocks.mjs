/** 소방계획서_21 R5(C1) 정적 검증 — 점검 상세 블록 정리 (서버 불필요)
 *  실행: node scripts/_probe-c1-blocks.mjs
 *
 *  핵심 위험은 "월간 외관점검 건에서 기능이 사라지는 것"이다. 자체점검은 단계가 ①~⑥이라
 *  참여자→②·불량→⑤로 옮겨도 자리가 있지만, 월간 건은 단계가 ① 하나뿐이라
 *  같은 규칙을 적용하면 참여자·불량·외관점검표가 화면에서 통째로 증발한다.
 *  이 프로브는 슬롯 배선이 두 경우를 모두 덮는지 소스에서 확인한다.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const SRC = join(process.cwd(), 'src')
const page = readFileSync(join(SRC, 'app/(dashboard)/inspections/[id]/page.tsx'), 'utf8')
const tl = readFileSync(join(SRC, 'components/inspections/inspection-timeline-client.tsx'), 'utf8')

/** 주석 제거 — "…를 제거했다"는 설명 문구를 코드로 오인하지 않도록 (1차 실행에서 오탐 5건) */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
const pageCode = strip(page)

// ── R5-1 / R5-2 제거 ────────────────────────────────────────────────────────
console.log('— R5-1·R5-2 중복 블록 제거 (주석 제외 코드 기준)')
check('전체 진행률 카드 제거', !/전체 진행률/.test(pageCode))
check('progressPct 계산 잔재 없음', !/const progressPct/.test(pageCode))
check('6단계 2열 체크리스트(InspectionDetailClient) 제거', !/InspectionDetailClient/.test(pageCode))
check("'단계별 보고서' 안내 카드 제거", !/단계별 보고서/.test(pageCode))

// ── R5-2 월간 건도 타임라인 ─────────────────────────────────────────────────
console.log('\n— R5-2 월간 외관점검 건도 타임라인으로')
// 비자체점검 분기 = `if (!isSpecial && customer) {` 부터 다음 `if (isSpecial` 직전까지
const nsStart = pageCode.indexOf('if (!isSpecial && customer)')
const nsEnd = pageCode.indexOf('if (isSpecial && customer)')
const ns = nsStart >= 0 && nsEnd > nsStart ? pageCode.slice(nsStart, nsEnd) : ''
check('비자체점검 분기 파싱', !!ns, `${ns.length}자`)
check('비자체점검에서 timelineData를 만든다', /timelineData = \{[\s\S]*?isGeneral: true/.test(ns))
check('단계는 stepDocs({ isSpecial: false }) — ① 하나', /steps: stepDocs\(\{ isSpecial: false \}\)/.test(ns))
check('자체점검 분기에도 timelineData가 남아 있다(양쪽 모두 생성)',
  /timelineData = \{/.test(pageCode.slice(nsEnd)))
// R6에서 렌더 컴포넌트가 InspectionTimelineClient → InspectionWorkbench로 바뀌었다.
// 이 단언의 취지는 '컴포넌트 이름'이 아니라 **isSpecial이 아니라 timelineData만 보고 렌더한다**는 것
check('단계 화면 렌더가 isSpecial 조건에 묶여 있지 않다(timelineData만 본다)',
  /\{timelineData && \(\s*<(InspectionTimelineClient|InspectionWorkbench)/.test(page))

// ── R5-3·R5-4·R5-5 슬롯 배선 ────────────────────────────────────────────────
console.log('\n— R5-3·R5-4·R5-5 슬롯 배선')
for (const s of ['multiday', 'sheet', 'exterior', 'participants', 'defects']) {
  check(`page가 slots.${s}를 넘긴다`, new RegExp(`${s}:`).test(page))
  check(`타임라인이 slots?.${s}를 렌더한다`, new RegExp(`slots\\??\\.${s}`).test(tl))
}
check('점검표가 ExteriorMonthProvider 안에 있다(EX-4 월 축 유지)',
  /<ExteriorMonthProvider[\s\S]{0,600}<InspectionSheetClient/.test(page))
check('#defects 앵커 유지(딥링크)', /id="defects"/.test(page))

// ── 회귀 방지: 월간 건에서 기능이 사라지지 않는가 ────────────────────────────
console.log('\n— 월간 외관점검 건 기능 보존 (핵심 위험)')
// ① 본문에서 비자체점검일 때 exterior·participants·defects를 함께 렌더하는지
const step1Body = /C1（?R5-3[\s\S]{0,900}?\n {8}<\/div>/.exec(tl) ?? /C1\(R5-3[\s\S]{0,900}/.exec(tl)
const s1 = step1Body?.[0] ?? ''
check('① 본문이 !isSpecialTimeline일 때 exterior를 렌더', /!isSpecialTimeline && slots\?\.exterior/.test(s1), s1 ? 'ok' : '블록 미검출')
check('① 본문이 !isSpecialTimeline일 때 participants를 렌더', /!isSpecialTimeline && slots\?\.participants/.test(s1))
check('① 본문이 !isSpecialTimeline일 때 defects를 렌더', /!isSpecialTimeline && slots\?\.defects/.test(s1))
check('② 안에 participants(자체점검 경로)', /isOpen\('cert'\) && slots\?\.participants/.test(tl))
check('⑤ 안에 defects(자체점검 경로)', /\{slots\?\.defects\}/.test(tl))
// 불량 0건이어도 등록 경로가 열려 있어야 ⑤가 활성화될 수 있다
check('불량 0건 ⑤에서도 defects 슬롯 접근 가능(등록 경로 유지)',
  /isOpen\('repair'\) && slots\?\.defects/.test(tl))

// ── R5-6 엑셀 생성 폐지 (2026-08-13 실행) ──────────────────────────────────
// 종전 이 절은 '존치'를 단언했다 — R5-7 대조로 유실 0을 확인하고 걷어냈으므로 반대로 뒤집는다.
console.log('\n— R5-6 엑셀 생성 폐지')
const genActions = readFileSync(join(SRC, 'app/(dashboard)/inspections/report-generate-actions.ts'), 'utf8')
check('생성 액션 제거 — generateOperationalReportAction', !/export async function generateOperationalReportAction/.test(genActions))
check('인쇄 액션 제거 — printOperationalReportAction', !/export async function printOperationalReportAction/.test(genActions))
check('37시트 주입기 제거 — lib/report-generator.ts', !existsSync(join(SRC, 'lib/report-generator.ts')))
// 주석에는 템플릿 이름이 남는다(왜 Storage에서 지우지 않았는지 설명) — **코드 사용**만 본다
const genCode = genActions.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('템플릿 상수·다운로드 제거(주석 제외)',
  !/TEMPLATE_PATH/.test(genCode) && !/operational_v2026\.xlsx/.test(genCode))
// 폐지 대상은 '생성'이지 이미 만들어 둔 기록이 아니다 — 실고객 xlsx가 Storage에 남아 있다
check('★ 과거 생성물 다운로드는 남는다', /export async function getGeneratedReportUrlAction/.test(genActions))
check('★ 이력 조회 컴포넌트는 남는다', /<ReportGenerateClient/.test(pageCode))
check('폐지 사유·남긴 이유가 주석에 있다', /R5-6/.test(genActions) && /과거 생성물|기록/.test(genActions))

// ── R5-5 기본정보 팝오버 ────────────────────────────────────────────────────
console.log('\n— R5-5 기본정보 → 헤더 접이식')
check('InspectionInfoPopover 신설·사용', existsSync(join(SRC, 'components/inspections/inspection-info-popover.tsx')) && /<InspectionInfoPopover/.test(pageCode))
check('기본정보 카드(InfoChip) 제거', !/function InfoChip/.test(pageCode))
check('헤더에 담당·시작일 요약 노출', /담당 미배정/.test(pageCode))

// ── 삭제 버튼 보존 ──────────────────────────────────────────────────────────
console.log('\n— 부수 확인')
check('점검 삭제 버튼 보존', /<InspectionDeleteClient/.test(pageCode))
check('타임라인 slots 타입 export', /export type TimelineSlots/.test(tl))

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
