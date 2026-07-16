// 배치2 결과 중 훅이 못 다루는 상태(partial/blocked) + note 갱신 (2026-07-16)
// summary 재계산은 scripts/sync-checklist.js updateEntire와 동일 방식.
import fs from 'fs'

const FILE = 'f:/AI/ERP/erp_goal/Victory_md/Victory10_entire.json'
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'))

const today = new Date().toISOString().split('T')[0]
const updates = {
  'BOARD-3': { status: 'partial', note: '배치2: 회의록 저장·참석자 DB 정합 재확인. 목록 표시 지연(캐시) 3회 재현 — 수동 재확인 필요. 참석자 알림은 코드상 미구현(INFO 개선후보).' },
  'MY-6':    { status: 'partial', note: '배치2: 권한거부 후 크래시 없음 확인. 실제 마이크 녹음·재생과 거부 안내 문구는 수동 확인 필요.' },
  'EX-P1':   { status: 'partial', note: '배치2: 세션 만료 제출 → 부분 커밋 없음(문서 미생성) 확인. 인라인 안내만 뜨고 /login 리다이렉트는 아님(INFO).' },
  'EX-C3':   { status: 'partial', note: '배치2: 재고 10 동시 출고 8+8 → 최종 2(음수 없음). 서버액션이 낙관적 체크라 이중 출고 레이스 취약 — 트랜잭션/RPC 도입 IMP 후보.' },
  'NF-PERF-1': { status: 'partial', note: '배치2(원격 스테이징 측정): 고객 7.5s/점검 4.2s/모니터 3.6s — 기준 3s는 로컬 기준. /customers 목록 병목 의심, 프로덕션 빌드·로컬 재측정 필요.' },
  'EX-X2':   { status: 'blocked', note: '배치2: 스테이징에 유효 API 키가 설정돼 실패 강제 불가. 오류 안내 경로는 코드 확인(fetchBuildingLedgerAction). 키 무효화 후 수동 확인 필요.' },
  'NF-RES-1': { status: 'blocked', note: '배치2: EX-X2와 동일 사유(유효 키) — API 장애 시 성능저하 없는 실패 확인은 키 무효화 후 수동.' },
}
// 통과 항목 중 참고 note 병기 (상태는 훅이 이미 passed 처리)
const notes = {
  'ADM-1': '배치2 PASS. INFO: 승격 후 매니저 메뉴 반영이 프로필 캐시(≤30s)만큼 지연 — updateUserAction revalidateTag 검토.',
  'HR-5': '배치2에서 버그 발견(profiles.full_name/department 미존재 컬럼) → 2026-07-16 수정(페이지에서 name/department_id 매핑) + E2E 재검증 PASS.',
  'HR-6': '배치2에서 버그 발견(certificates 테이블 미배포) → migration 093 작성, 스테이징·운영 적용 + 발급·목록 E2E PASS. 회사명 하드코딩(certificates-client.tsx)은 개선 후보.',
  'EX-R3': '배치2에서 버그 발견(head:true 응답 count 오독 → 소속 직원 있는 부서 삭제됨) → deleteDeptAction 수정 + 차단/빈부서 E2E PASS.',
  'E2E-F4': '배치2 PASS. INFO: 휴가일 점검 배정 충돌 경고 미구현 — 개선 후보.',
  'NF-SEC-4': 'AUTH-7(배치1)·EX-P4(배치2)와 동일 검증으로 커버 — 직접 호출 전부 거부 확인.',
}

let changed = 0
for (const item of doc.items || []) {
  const u = updates[item.id]
  if (u) { item.status = u.status; item.note = u.note; item.tested_date = today; changed++ }
  if (notes[item.id]) { item.note = notes[item.id]; changed++ }
}

const all = doc.items || []
doc.summary = {
  total: all.length,
  passed: all.filter(i => i.status === 'passed').length,
  failed: all.filter(i => i.status === 'failed').length,
  partial: all.filter(i => i.status === 'partial').length,
  blocked: all.filter(i => i.status === 'blocked').length,
  skipped: all.filter(i => i.status === 'skipped').length,
  known_issue: all.filter(i => i.status === 'known_issue').length,
  in_progress: all.filter(i => i.status === 'in_progress').length,
  pending: all.filter(i => i.status === 'pending').length,
}
doc.date = today
fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
console.log(`갱신 ${changed}건`, JSON.stringify(doc.summary))
