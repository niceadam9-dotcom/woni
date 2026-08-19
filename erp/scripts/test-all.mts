// 전체 테스트 단일 진입점 — 신규 개발 후 회귀 확인용. 실행: npm run test:all  (또는 npx tsx scripts/test-all.mts)
// 무서버 게이트(빌드·불변식)는 항상 실행, E2E는 localhost:3000 기동 시에만 실행(없으면 건너뜀 안내).
import { execSync } from 'child_process'

type Step = { name: string; cmd: string; needServer?: boolean }
const steps: Step[] = [
  { name: '빌드(타입체크)',            cmd: 'npm run build' },
  { name: '데이터 불변식(스테이징)',    cmd: 'node scripts/check-data-invariants.mjs' },
  // 서버 불필요 — 순수 렌더 함수 대조. 중복 입력 제거(대장 파생·미러)가 문서에 반영되는지 고정
  { name: '세부제원 파생·미러 렌더',    cmd: 'npx tsx scripts/test-spec-derive.mts' },
  // 공휴일은 영업일 → 6단계 마감일을 결정한다. 하나만 틀려도 법정 제출기한이 밀리는데
  // 화면 어디에도 안 드러난다 — 순수 산출을 공공API 확정본과 대조해 상시 고정 (소방계획서_25)
  { name: '공휴일 대체 규칙',          cmd: 'npx tsx scripts/test-holiday-rules.mts' },
  // SMS는 돈이 나가고 되돌릴 수 없다. 수신자 선정·중복 접기·응답 판정이 틀려도 화면은 멀쩡해 보이므로
  // (실패를 '발송됨'으로 보이게 한 P-1·P-2가 정확히 그랬다) 순수 함수 단계에서 결정적으로 고정한다
  { name: 'SMS 순수 함수',             cmd: 'npx tsx scripts/test-sms-pure.mts' },
  { name: '게이트 정합성(E2E)',        cmd: 'npx tsx scripts/test-gate-consistency.mts', needServer: true },
  { name: '일반관리 자체점검 통주행(E2E)', cmd: 'npx tsx scripts/test-general-selfinspection.mts', needServer: true },
  { name: '문서 생성 회귀(E2E)',           cmd: 'npx tsx scripts/test-doc-generation.mts', needServer: true },
  { name: '클릭 예산(E2E)',           cmd: 'npx tsx scripts/test-click-budget.mts',     needServer: true },
  { name: 'EX-V1 음수전표(E2E)',      cmd: 'npx tsx scripts/test-ex-v1.mts',            needServer: true },
  // 소방계획서_16 S6-4 — 점검표 축·트리 인라인 입력(Realtime 포함) 상시 회귀
  { name: '점검표 범위 축(E2E)',        cmd: 'npx tsx scripts/test-sheet-scope-axis.mts',    needServer: true },
  { name: '점검표 트리 인라인(E2E)',    cmd: 'npx tsx scripts/test-annex-sheet-inline.mts',  needServer: true },
  // 고객명 검색은 목록을 거르는 축이라 조용히 깨지면 '검색해도 안 나온다'로만 드러난다
  { name: '점검 고객명 검색(E2E)',      cmd: 'npx tsx scripts/test-inspection-customer-search.mts', needServer: true },
  // 최근 본 고객 스트립 — '기본 정렬은 그대로 둔다'가 이 기능의 설계 전제라 그것까지 고정한다
  { name: '최근 본 고객(E2E)',          cmd: 'npx tsx scripts/test-recent-customers.mts',           needServer: true },
  // 불량 전/후 사진 — 비공개 버킷에 public URL을 저장해 사진이 전부 안 뜨던 결함의 회귀 방어.
  // src만 보면 통과하므로 naturalWidth로 '실제로 그려졌는지'까지 본다
  { name: '불량 전/후 사진(E2E)',       cmd: 'npx tsx scripts/test-defect-photos.mts',              needServer: true },
  // ④⑥ 제출일 — 화면 반영이 느려지면 '눌러도 반응이 없다'로 읽힌다(실측 5초 → 2초로 고친 건).
  // 눈에 안 보이는 회귀라 시간 예산을 테스트로 고정한다
  { name: '제출일 즉시 피드백(E2E)',    cmd: 'npx tsx scripts/test-step-submit-feedback.mts',       needServer: true },
  // 보관함 과거본 정리(소방계획서_18)는 폐기됨(2026-08-18) — 관련 E2E·프로브 2건도 함께 삭제.
  // 마커 보존 프로브는 남긴다: 정리 기능은 없어져도 **과거 마커를 읽는 판정**은 그대로 살아 있고,
  // 오프라인 보고·사유 완료 마커까지 보존 대상이라 크론이 지우면 그 단계들이 되살아난다.
  { name: '로그 보존 마커 제외(프로브)', cmd: 'npx tsx --conditions=react-server scripts/_probe-purge-marker.mts' },
  // ② 배치확인서 — 종이 보관 기록 + 업로드 파일 삭제(제안1·2)
  { name: '배치확인서 종이·삭제(E2E)',   cmd: 'npx tsx scripts/test-cert-paper-delete.mts',   needServer: true },
  // 점검일은 계획·체크리스트·서류가 같이 봐야 하는 값인데 축이 넷이라 한 경로만 빠져도 조용히 갈라진다
  // (소방계획서_24 P-19: 인라인 달력이 inspections.inspection_start_date를 안 고쳐 별지 9호 점검기간이
  //  옛 날짜로 인쇄될 수 있었다). 다섯 경로 × 네 축을 상시 고정한다
  { name: '점검일 동기화 5경로(E2E)',    cmd: 'npx tsx scripts/test-plan-date-sync.mts',      needServer: true },
  // 사전 안내 SMS — 서버 로직은 _probe-sms-send가 덮고, 여기서는 **화면 배선**을 고정한다:
  // 모니터링 폐지 후 링크가 살아 있는지 · 달력에서 열어도 자체점검이 목록에 드는지(Q-14의 핵심) ·
  // 미확정 건이 조용히 빠지지 않는지 · 수신 미지정 시 폴백 1명인지(문자량이 몇 배가 되지 않게)
  { name: '사전 안내 SMS 배선(E2E)',     cmd: 'npx tsx scripts/test-inspection-sms.mts',      needServer: true },
  // 지역 일괄 이동 — 건별 실패를 삼키면 담당자는 5건이 다 옮겨진 줄 알고 **안 옮겨진 곳에 안 간다**.
  // 실제로 정기의 '같은 달' 가드가 이 경로에서만 새고 있었다(S11-9 E2E가 잡아냄: moved:2·failed:[]).
  // 반환값과 DB를 함께 대조한다 — 응답과 데이터가 갈라지는 것이 이 기능의 최악 시나리오다
  { name: '지역 일괄 이동(E2E)',         cmd: 'npx tsx scripts/test-sms-bulk-move.mts',       needServer: true },
  { name: 'SMS 발송 모듈(프로브)',       cmd: 'npx tsx --conditions=react-server scripts/_probe-sms-send.mts' },
  // ★ 독립 검증 J24-B1 — 발송 이력 기록이 실패하면 **보내지 않는다**. 종전엔 insert 오류를 버리고
  // 그대로 발송해 '돈은 나갔는데 기록이 없는' 건이 생길 수 있었다(→ 화면은 미발송 → 재발송·이중 과금).
  // 자격증명을 넣은 상태로 시험해야 변별력이 생긴다 — 키가 없으면 어차피 안 나가기 때문
  { name: 'SMS 기록 실패 시 발송 중단(프로브)', cmd: 'npx tsx --conditions=react-server scripts/_probe-sms-claim-fail.mts' },
]

let serverUp = false
try { const r = await fetch('http://localhost:3000/login', { method: 'HEAD' }); serverUp = r.ok } catch { serverUp = false }
if (!serverUp) console.log('ℹ localhost:3000 미기동 — E2E 단계는 건너뜁니다(무서버 게이트만 실행). 전체 실행하려면 먼저 `npm run dev` 또는 `npm start`.\n')

// ── 시작 전에 **환경**부터 본다 (2026-08-19) ────────────────────────────────
// dev 서버는 회귀 한 번에 수 GB를 먹는다(재기동 30분 만에 26MB → 4.2GB 실측).
// 여유 메모리가 마르면 page.goto가 타임아웃하는데, 그 증상이 하필
// "실행마다 다른 테스트가 실패하고 단독 실행은 통과"로 나타나 코드를 의심하게 만든다.
// 여기서 미리 경고해 두면, 뒤에 실패가 나왔을 때 로그 맨 위를 보고 원인을 바로 안다.
if (serverUp) {
  try { execSync('node scripts/check-dev-memory.mjs', { stdio: 'inherit' }) } catch { /* 진단 실패는 무시 */ }
}

const results: Array<{ name: string; status: 'PASS' | 'FAIL' | 'SKIP' }> = []
for (const s of steps) {
  if (s.needServer && !serverUp) { results.push({ name: s.name, status: 'SKIP' }); console.log(`⏭  ${s.name} — 건너뜀(서버 없음)`); continue }
  console.log(`\n▶ ${s.name} …`)
  try {
    execSync(s.cmd, { stdio: 'inherit' })
    results.push({ name: s.name, status: 'PASS' })
  } catch {
    results.push({ name: s.name, status: 'FAIL' })
  }
}

console.log('\n──────── 전체 테스트 요약 ────────')
for (const r of results) console.log(`  ${r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭'} ${r.name} — ${r.status}`)
const failed = results.filter(r => r.status === 'FAIL').length
console.log(failed === 0 ? '\n✅ 실패 0건' : `\n❌ 실패 ${failed}건`)
process.exit(failed > 0 ? 1 : 0)
