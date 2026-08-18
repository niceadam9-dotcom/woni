// 전체 테스트 단일 진입점 — 신규 개발 후 회귀 확인용. 실행: npm run test:all  (또는 npx tsx scripts/test-all.mts)
// 무서버 게이트(빌드·불변식)는 항상 실행, E2E는 localhost:3000 기동 시에만 실행(없으면 건너뜀 안내).
import { execSync } from 'child_process'

type Step = { name: string; cmd: string; needServer?: boolean }
const steps: Step[] = [
  { name: '빌드(타입체크)',            cmd: 'npm run build' },
  { name: '데이터 불변식(스테이징)',    cmd: 'node scripts/check-data-invariants.mjs' },
  // 서버 불필요 — 순수 렌더 함수 대조. 중복 입력 제거(대장 파생·미러)가 문서에 반영되는지 고정
  { name: '세부제원 파생·미러 렌더',    cmd: 'npx tsx scripts/test-spec-derive.mts' },
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
  // 보관함 과거본 정리(소방계획서_18)는 폐기됨(2026-08-18) — 관련 E2E·프로브 2건도 함께 삭제.
  // 마커 보존 프로브는 남긴다: 정리 기능은 없어져도 **과거 마커를 읽는 판정**은 그대로 살아 있고,
  // 오프라인 보고·사유 완료 마커까지 보존 대상이라 크론이 지우면 그 단계들이 되살아난다.
  { name: '로그 보존 마커 제외(프로브)', cmd: 'npx tsx --conditions=react-server scripts/_probe-purge-marker.mts' },
  // ② 배치확인서 — 종이 보관 기록 + 업로드 파일 삭제(제안1·2)
  { name: '배치확인서 종이·삭제(E2E)',   cmd: 'npx tsx scripts/test-cert-paper-delete.mts',   needServer: true },
]

let serverUp = false
try { const r = await fetch('http://localhost:3000/login', { method: 'HEAD' }); serverUp = r.ok } catch { serverUp = false }
if (!serverUp) console.log('ℹ localhost:3000 미기동 — E2E 단계는 건너뜁니다(무서버 게이트만 실행). 전체 실행하려면 먼저 `npm run dev` 또는 `npm start`.\n')

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
