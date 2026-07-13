# 점검계획일(plan_anchor_date) 추가 — 계획 기산점 수동 지정

> 2026-07-12 확정. 고객등록 화면에 **점검계획일**을 필수 입력값으로 신설하고,
> 연간 점검계획의 기산점(기준일)을 수동으로 지정할 수 있게 한다.

## 1. 결정 사항

| # | 항목 | 결정 |
|---|------|------|
| 1 | 기준일 우선순위 | **점검계획일(수동) → 최초 점검시작일 → 사용승인일** (수동 최우선) |
| 2 | 날짜 변경 시 소급 범위 | **미확정(planned) 항목만 재계산.** 확정(confirmed)·완료·취소 항목은 재계획하지 않음 |
| 3 | 신규 등록 | 점검계획일이 **유일한 필수 날짜** (클라이언트 + 서버 양쪽 검증). 계약일·사용승인일은 선택 입력 (2026-07-12 확정, migration 054로 contract_date NOT NULL 해제) |
| 4 | 기존 고객 | DB 컬럼은 NULL 허용 — 미입력 고객은 기존 폴백 체인(점검시작일 → 사용승인일)으로 동작, 기존 데이터 영향 없음 |
| 5 | 수정 화면 | 점검계획일 수정·삭제 가능(레거시 고객 대응). 지우면 폴백 체인으로 복귀 |

## 2. DB

- **마이그레이션**: `supabase/migrations/053_plan_anchor_date.sql` — `customers.plan_anchor_date DATE NULL` 추가 (2026-07-12 사용자 적용 완료)
- **마이그레이션**: `supabase/migrations/054_contract_date_nullable.sql` — `contract_date` NOT NULL 해제 (2026-07-12 Management API로 적용 완료)

## 3. 동작 방식

- 기준일 결정은 `src/lib/inspection-plan-generator.ts`의 `loadAnchorDates()` 단일 지점에서 수행.
  `plan_anchor_date`가 있으면 그 날짜, 없으면 최초 점검시작일, 그것도 없으면 사용승인일.
- 신규 고객 등록 시 점검계획일 기준으로 연간 계획(특별 1·2차 + 정기) 자동 생성.
  targetYear 판정도 사용승인일이 아닌 점검계획일 기준.
- 점검계획일/사용승인일 변경 시(수정 폼·인라인 편집 모두) `_resetPlanItemsForCustomer`가
  **planned 상태 항목만** planned_date 재계산 — confirmed는 유지.
- 스마트 제안 라벨: 기준일 출처를 `점검계획일 / 사용승인일 / 점검시작일`로 구분 표시.
- 점검계획 화면·자동생성 위저드에 전달되는 고객의 `use_approval_date`는 서버에서
  기준일로 치환되어 클라이언트 날짜 제안이 항상 기준일과 일치.

## 4. 수정 파일

| 영역 | 파일 |
|------|------|
| 마이그레이션 | `supabase/migrations/053_plan_anchor_date.sql` (신규) |
| 기준일 로직 | `src/lib/inspection-plan-generator.ts` (`loadAnchorDates`, `generateYearlyPlanItems`) |
| 타입 | `src/types/index.ts` (`Customer`, Insert/Update) |
| 고객 액션 | `src/app/(dashboard)/customers/actions.ts` (등록 필수검증·자동생성·수정 재계산·인라인 패치·변경이력) |
| 고객 UI | `components/customers/customer-new-client.tsx`(필수 입력), `edit-customer-info-client.tsx`, `inline-customer-field-client.tsx`, `customers/page.tsx`(목록 컬럼), `customers/[id]/page.tsx` |
| 점검계획 | `inspection-plans/actions.ts`(다음달 복사·스마트 제안), `inspection-plans/page.tsx`(초과 판정·클라이언트 치환), `[year]/[month]/auto/page.tsx`(위저드 치환) |
| 크론 | `api/cron/generate-yearly-plans/route.ts` |
| 검증/테스트 | `scripts/check-plan-invariants.mjs`(INV-P2), `scripts/test-fire-s1.mts`(케이스 9: 수동 최우선) |

## 5. 미변경(의도적)

- **DB 트리거**(inspection due_date 생성): 앱이 `syncInspectionStepDates`로 확정일 기준 덮어쓰므로 수정 불필요 (Victory9 기준일 = 1단계 확정일 규칙 유지).
- **특별월에 정기 없음** 등 계획 생성 규칙 자체는 변경 없음 — 기산점 결정만 확장.
