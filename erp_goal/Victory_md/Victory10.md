# Victory10 — ERP 시스템 현황 및 신규 요구사항 (2026-07-06)

| 문서 | 내용 |
|------|------|
| Victory8.md | use_approval_date 기반 6단계 프로세스 설계 |
| Victory9.md | 점검유형 재편, 고객관리 통합, 캘린더/모니터링 개선, 매월 정기점검 로직 |
| **Victory10.md** | Victory8+9 통합 현황 및 미구현 과제 정리 |

---

## 목차

1. 데이터베이스 테이블 관계도
2. 6단계 업무체크리스트 최신 명세
3. 구현 완료 항목 (git diff 기준)
4. Victory8.md 항목 현황
5. 1단계 점검확정 → 6단계 자동 재계산 상세 설계
6. 점검유형별 화면 상세 설계 (종합/작동/일반관리)
7. Victory9.md 신규 요구사항 전체
8. 미구현 항목 전체 목록 (우선순위별)

---

## 1. 데이터베이스 테이블 관계도

### 테이블 관계 다이어그램

```
profiles (직원/사용자)
  │  id, employee_id, name, role(employee/manager/admin)
  │  department_id, position, hire_date, is_active
  └─ assigned_employee_id ──────────────────────────────────────────┐
                                                                     │
customers (고객/건물)                                                │
  │  id, customer_code, customer_name                               │
  │  inspection_type(종합/최초/기타) ← Victory9: 변경 예정          │
  │  use_approval_date (사용승인일) ← 6단계 기산점                 │
  │  contract_date, address, zipcode                                │
  │  region_si, region_myeon, region_ri                            │
  │  assigned_employee_id → profiles                               │
  │  is_active                                                      │
  │                                                                 │
  ├─▶ customer_contacts (관계인)                                   │
  │     id, customer_id, role(대표/직원1/직원2), name, phone       │
  │                                                                 │
  ├─▶ buildings (건물 정보)                                        │
  │     id, customer_id, building_name, address, zipcode           │
  │     total_area, floors_above, floors_below                     │
  │     purpose, year_built, is_active                             │
  │                                                                 │
  ├─▶ inspection_plan_items (점검계획 항목) ───────────────────────┤
  │     │  id, plan_id, customer_id                                │
  │     │  inspection_type, sequence_num(1/2)                      │
  │     │  planned_date (자동계산 예상일, 변경 불가)                │  ← [신규]
  │     │  scheduled_date (관리자 확정일, NULL=미확정)             │
  │     │  assigned_employee_id → profiles ──────────────────────┤
  │     │  status(planned/confirmed/completed/cancelled)           │
  │     │  inspection_id → inspections (점검시작 후 연결)          │
  │     │  [신규] step1~6_date (6단계 날짜, 확정 시 자동계산)      │
  │     │  [신규] plan_type(special_종합/special_작동/monthly/event)│
  │     │                                                          │
  │     ├─▶ inspection_plans (월간 계획 헤더)                     │
  │     │     id, year, month, status(draft/confirmed/cancelled)   │
  │     │     UNIQUE(year, month)                                  │
  │     │                                                          │
  │     ├─▶ inspection_status_log (점검현황 모니터링: 1:1)        │
  │     │     id, plan_item_id(UNIQUE)                             │
  │     │     inspection_date, report_submitted_at                 │
  │     │     sent_at, filed_at                                    │
  │     │     sms_confirmed, sms_sent_at, sms_content              │
  │     │     sms_sender_phone, sms_recipients(JSONB)              │
  │     │                                                          │
  │     └─▶ inspection_report_status (보고서 제출현황: 1:1)       │
  │           id, plan_item_id(UNIQUE)                             │
  │           inspection_completed_at                              │
  │           notification_due_date (COMPUTED: +7일)              │
  │           submission_deadline (COMPUTED: +30일)               │
  │                                                                 │
  └─▶ inspections (실제 점검)                                     │
        │  id, customer_id, assigned_employee_id ─────────────────┘
        │  inspection_type, sequence_num                           
        │  inspection_start_date               
        │  year, status                                            
        │                                                          
        ├─▶ inspection_steps (6단계: DB 트리거 자동 생성)         
        │     id, inspection_id, step_num(1-6)                    
        │     name_ko, due_days, is_working_days                  
        │     due_date, status(pending/completed/overdue)         
        │                                                          
        └─▶ inspection_reports (제출 보고서)                      
              id, inspection_id                                    
              report_type(fire_station/stakeholder/.../step1~6)   
              submitted_at, file_name, file_path                  
```

### 주요 테이블 컬럼 요약

| 테이블 | 핵심 컬럼 |
|--------|-----------|
| customers | id, customer_code, customer_name, inspection_type(종합/최초/기타), use_approval_date, contract_date, address, zipcode, region_si, region_myeon, region_ri, assigned_employee_id, is_active |
| customer_contacts | id, customer_id, role(대표/직원1/직원2), name, phone, email |
| buildings | id, customer_id, building_name, address, total_area, floors_above, floors_below, purpose, year_built, is_active |
| inspection_plans | id, year, month, status(draft/confirmed/cancelled) — UNIQUE(year,month) |
| inspection_plan_items | id, plan_id, customer_id, inspection_type, sequence_num(1/2), **planned_date**(자동예상일), **scheduled_date**(관리자확정일), assigned_employee_id, status, inspection_id |
| inspections | id, customer_id, assigned_employee_id, inspection_type, sequence_num, inspection_start_date, year, status |
| inspection_steps | id, inspection_id, step_num(1-6), name_ko, due_date, status(pending/completed/overdue) |
| inspection_status_log | id, plan_item_id(1:1), inspection_date, report_submitted_at, sent_at, filed_at, sms_confirmed |
| inspection_report_status | id, plan_item_id(1:1), inspection_completed_at, notification_due_date(+7일 computed), submission_deadline(+30일 computed) |

### 마이그레이션 이력

```
001_initial.sql                          → HR 기본 (profiles, departments, documents, leaves)
002_fire_safety.sql                      → 소방안전관리 기본 (customers, inspections, 7단계 trigger)
003_assigned_employee.sql               → customers.assigned_employee_id
005_inspection_plans.sql                → 월간 점검계획 (inspection_plans, inspection_plan_items)
006_inspection_status_log.sql           → 점검현황 모니터링
007_inspection_report_status.sql        → 보고서 제출현황 (computed deadline 컬럼)
017_use_approval_date.sql               → customers.use_approval_date 추가
018_region.sql                          → customers.region_si/myeon/ri 추가 ✅
019_update_inspection_steps_trigger.sql → 7단계→6단계, 기준일 use_approval_date로 전환 ✅
020_buildings.sql                       → buildings 테이블
021_zipcode.sql                         → customers.address/zipcode 컬럼
022_building_zipcode.sql               → buildings.zipcode
023_report_types.sql                    → inspection_reports.report_type step1~6 추가
024_inspection_sheets.sql              → 점검표 체크리스트 템플릿
029_sms_recipients.sql                 → inspection_status_log.sms_sender_phone, sms_recipients(JSONB)
```

**신규 마이그레이션 필요 (Victory9.md):**
```
030_inspection_type_category.sql  → customers.inspection_category, inspection_sub_type
031_plan_item_stage_dates.sql     → inspection_plan_items.planned_date(자동예상일), step1~6_date, plan_type
032_company_settings.sql         → company_settings 테이블 (기본 지역 등 시스템 설정 저장)
```

---

## 2. 6단계 업무체크리스트 최신 명세

### 6단계 정의 (migration 019 기준)

기준일: `customers.use_approval_date` (사용승인일)
→ Victory9: 기준일이 `inspection_plan_items.scheduled_date` (1단계 점검일자확정일)로 변경됨

| step_num | 단계명 | 기준 | 계산 | is_working_days | 사이드바 연결 |
|----------|--------|------|------|-----------------|--------------|
| 1 | 1단계: 점검 완료 → **점검일자확정** | use_approval_date | +1영업일 | true | 점검업무 |
| 2 | 2단계: 배치확인서 보고서 작성 | step1_due | +5영업일 | true | — |
| 3 | 3단계: 관계인 보고서 제출 | step1_due | +10영업일 | true | 보고서제출현황 |
| 4 | 4단계: 소방서 보고서 제출 및 이행계획서 등록 | step1_due | +15영업일 | true | 이행계획서등록 |
| 5 | 5단계: 소방보수 완료 | step4_due | **+10절대일** | **false** | — |
| 6 | 6단계: 이행완료보고서 제출 | step5_due | +10영업일 | true | 이행계획제출현황 |

### 검증 기준 (사용승인일 2026-06-30 예시) — Victory9.md 수정 반영

| 단계 | 예시 마감일 | 검증 포인트 |
|------|------------|-------------|
| 1단계 | 2026-07-01 (수) | 사용승인일 + 영업일 1일 |
| 2단계 | 2026-07-08 (수) | 1단계 후 영업일 +5일 |
| 3단계 | 2026-07-15 (수) | 1단계 후 영업일 +10일 |
| 4단계 | 2026-07-23 (목) | 1단계 후 영업일 +15일 |
| **5단계** | **2026-08-01 (토)** | 4단계 후 절대일 +10일 ← Victory9.md 수정 (기존 08-02 오타) |
| 6단계 | 2026-08-14 (금) | 5단계 후 영업일 +10일 |

> 5단계: 4단계 2026-07-23 + 10절대일 = **2026-08-01** (토요일, 절대일이므로 주말도 카운트)

### 점검유형별 6단계 적용 범위 및 매월 계획 생성 원칙

| 고객유형 | 매월 1단계점검계획 생성 | 특별점검 | 1단계 처리 방식 |
|----------|------------------------|----------|----------------|
| 소방안전관리 > 종합 | ✅ 매월 (사용승인일 기준) | 연 2회 → 6단계 전체 | 실제점검일 업데이트 + 6단계 자동계산 |
| 소방안전관리 > 작동 | ✅ 매월 (사용승인일 기준) | 연 1회 → 6단계 전체 | 실제점검일 업데이트 + 6단계 자동계산 |
| 일반관리 | ❌ 자동 생성 없음 — **고객관리 페이지에서 직접 날짜 등록** (연 1~2회 이벤트성) | 없음 | 등록 → 달력 반영 → 완료처리 시 scheduled_date 업데이트 (6단계 없음) |

> **모든 유형 공통:** 사용승인일 기준으로 매월 `inspection_plan_items` 자동 생성 → 담당자가 실제 점검 수행 후 `scheduled_date` 업데이트

---

## 3. 구현 완료 항목 (현재 git diff 기준, 2026-07-06)

### 3-1. 권한 시스템: requireRole → requirePermission ✅
- **파일:** `erp/src/app/(dashboard)/inspection-plans/actions.ts`
- 모든 Server Action이 `requireRole` → `requirePermission` 방식으로 전환
- `updatePlanItemAction`: employee는 자신의 항목만, `assigned_employee_id` 변경 불가
- 각 액션 권한: `inspection_plan_manage` / `inspection_plan_item_update`

### 3-2. 스마트 제안 버그 수정 — 최초·기타 2차 제안 제거 ✅
- **파일:** `actions.ts`, `smart-suggest-modal.tsx`
- 종합 타입에만 2차 제안 생성, 최초·기타는 "연1회"
- 뱃지: 최초·기타 orange "1차" → emerald green "연1회"
- 통계 라벨: "이번달 N건 / 종합 2차 N건"
- Victory8.md Section 14 완료

### 3-3. 점검계획 데이터 병렬 처리 최적화 ✅
- **파일:** `erp/src/app/(dashboard)/inspection-plans/page.tsx`
- Wave 1: plans + currentPlan + employees + customers + yearPlans + holidays → 단일 Promise.all
- Wave 2: currentPlanItems + yearPlanItems → 2차 병렬
- Employee 역할: 서버사이드 `assigned_employee_id === profile.id` 필터링

### 3-4. 점검계획 UI — 년/월 빠른 선택 팝업 ✅
- **파일:** `erp/src/components/inspection-plans/inspection-plans-client.tsx`
- 년월 텍스트 클릭 → 팝업(년도 화살표 + 12개월 그리드) → 즉시 router.push
- Victory8.md Section 16 완료

### 3-5. 점검계획 UI — InlineDateCell 커스텀 미니 달력 ✅
- **파일:** `inspection-plans-client.tsx`
- native `<input type="date">` → `fixed` 포지셔닝 커스텀 달력 팝업
- 날짜 클릭 시 즉시 저장, "지우기" 버튼
- 강조: 일요일(빨강), 토요일(파랑), 공휴일(빨강), 오늘(보라 테두리), 선택일(보라 배경)
- Victory8.md Section 15 완료

### 3-6. 사이드바 메뉴 순서 재정렬 ✅
- **파일:** `erp/src/components/layout/sidebar.tsx`
- 소방안전관리 새 순서: 고객관리 → 건물관리 → 지역별담당배정 → **점검표관리** → 점검계획등록 → 점검업무 → **점검달력** → 점검현황모니터링 → 보고서제출현황 → 이행계획서등록 → 이행계획제출현황 → 문의요청 → 정산현황 → 세금계산서발행
- 시각 개선: border-2, 아이콘 보라-회색 계열 통일
- Victory9.md "점검달력 소방안전관리 최상위" 완료

### 3-7. 건물관리 서버사이드 필터링/페이지네이션 ✅
- **파일:** `erp/src/app/(dashboard)/buildings/page.tsx`
- JS 인메모리 필터 → Supabase `.ilike`, `.eq`, `.range()`, `count: 'exact'`
- 필터 폼 → `BuildingsFilterBar` 클라이언트 컴포넌트 분리 (Suspense)

### 3-8. 고객관리 마이그레이션 가드 제거 ✅
- **파일:** `erp/src/app/(dashboard)/customers/page.tsx`
- `hasRegionCols` 런타임 프로브 완전 제거 (migration 018 완료)
- `missingRegionRes` → Promise.all 병렬 처리
- `RegionEditClient` 조건 단순화

### 3-9. 점검업무 직원 역할 스코핑 + 쿼리 최적화 ✅
- **파일:** `erp/src/app/(dashboard)/inspections/page.tsx`
- Employee: DB 레벨 `.eq('assigned_employee_id', profile.id)` 필터
- 별도 customersRes 쿼리 제거 → `customers:customer_id(id, customer_name, customer_code)` JOIN

### 3-10. 전체 UI 시각적 일관성 개선 ✅ (9개 파일)
- 입력/셀렉트 테두리: `#e5e3f8` → `#d0ccf5`
- 카드/테이블/페이지네이션 테두리: `#e8e8e8` → `#c8c4d0`
- 박스 그림자 투명도: `0.04` → `0.08`
- 진행바 트랙: `#f0eff8` → `#e0ddf5`

---

## 4. Victory8.md 항목 현황

| Victory8 섹션 | 내용 | 상태 |
|---------------|------|------|
| 3. DB 트리거 7→6단계, use_approval_date 기준 | migration 019 적용 | ✅ 완료 |
| 4. 점검달력 D-Day 배지/색상/퀵필터/슬라이드 패널 | — | ⬜ 미구현 |
| 5. 대시보드 KPI 카드 (오늘마감/지연), 마감임박 위젯 | — | ⬜ 미구현 |
| 6. My Page 일정관리 — 점검 마감일 오버레이 | — | ⬜ 미구현 |
| 7. 자동 알림 cron (D-3/D-1/D-Day/지연) | — | ⬜ 미구현 |
| 9. 지역별 담당 배정 DB+Actions | migration 018 + bulkAssignEmployeeAction | ✅ 완료 |
| 9. 고객등록/수정 시읍면리 입력 필드 UI | customer-new-client.tsx, edit-customer-info-client.tsx | ⬜ 미구현 |
| 9. 지역별 일괄 배정 페이지/컴포넌트 | regional-assign/page.tsx | ⬜ 미구현 |
| 11-1. 점검항목추가 주소 검색 콤보박스 | add-plan-item-modal.tsx | ✅ 완료 |
| 11-2. 달력·목록 사용승인일 표시 | CalendarView, ListView | ✅ 완료 |
| 11-3. 미점검 초과 경보 OverduePanel | page.tsx + inspection-plans-client.tsx | ✅ 완료 |
| 11-4. 미점검 초과 자동 해결 모달 | overdue-resolve-modal.tsx | ✅ 완료 |
| 11-5. 계획 상태 직접 확정 UI | inspection-plans-client.tsx | ✅ 완료 |
| 11-6. 점검 시작 버튼 | plan-item-slide-panel.tsx + ListView | ✅ 완료 |
| 12. 공휴일 자동 동기화 Cron | /api/cron/sync-holidays | ✅ 완료 |
| 14. 스마트 제안 최초·기타 2차 제외 | actions.ts + smart-suggest-modal.tsx | ✅ 완료 |
| 15. InlineDateCell 미니 달력 팝업 | inspection-plans-client.tsx | ✅ 완료 |
| 16. 연/월 빠른 선택 팝업 | inspection-plans-client.tsx | ✅ 완료 |
| 17. SMS 발신번호 설정 + 수신번호 자동 조회 | monitor/actions.ts + 029_sms.sql | ✅ 완료 |
| 17. 실제 SMS API 연동 (솔라피) | — | ⬜ 미구현 |

---

## 5. 1단계 점검확정 → 6단계 자동 재계산 상세 설계

### planned_date vs scheduled_date 컬럼 역할

| 컬럼 | 역할 | 언제 채워지나 | 변경 가능 여부 |
|------|------|--------------|--------------|
| `planned_date` | 사용승인일 기준 자동계산 예상일 | 매월 plan_item 자동생성 시 | ❌ 변경 안 함 (기준값) |
| `scheduled_date` | 관리자가 달력팝업에서 선택한 확정일 | 점검일자확정 클릭 시 | ✅ 달력팝업으로 재선택 가능 |

**planned_date 자동계산 규칙 (소방안전관리):**
```
use_approval_date = 2026-06-30 (30일)

7월 planned_date  → 2026-07-30 (목) ← 같은 일자
8월 planned_date  → 2026-09-01 (화) ← 31일 없으므로 말일(08-31 일요일) 후 다음 영업일 조정
9월 planned_date  → 2026-09-30 (화)
10월 planned_date → 2026-10-30 (금)

※ 해당 일자가 주말/공휴일이면 → 다음 영업일로 조정
```

### 전체 프로세스 흐름

```
[매월 자동 실행 — 소방안전관리 종합/작동]
  use_approval_date 기준 당월 plan_item 생성
  inspection_plan_items {
    planned_date:  2026-07-30  ← 자동계산 예상일 (변경 불가)
    scheduled_date: NULL       ← 미확정 (관리자 선택 전)
    status: 'planned',
    plan_type: 'special_종합' or 'special_작동' or 'monthly'
  }
        │
        ▼ 달력에 planned_date 기준 점선(░)으로 표시
        │
[관리자 "점검일자확정" 클릭 → 달력 팝업 → 날짜 선택]
  inspection_plan_items {
    scheduled_date: 2026-07-28  ← 관리자 선택 확정일
    status: 'confirmed'
  }
        │
        ▼ confirmPlanItemStageOneAction 자동 실행
[6단계 일정 자동 계산 및 저장]
  inspection_plan_items 업데이트:
    step1_date: 2026-07-28  ← scheduled_date (확정일 = 1단계 기준)
    step2_date: 2026-08-04  ← step1 + 5영업일
    step3_date: 2026-08-11  ← step1 + 10영업일
    step4_date: 2026-08-18  ← step1 + 15영업일
    step5_date: 2026-08-28  ← step4 + 10절대일
    step6_date: 2026-09-10  ← step5 + 10영업일
        │
        ▼ 달력에 scheduled_date 기준 실선(■)으로 전환 + 6단계 배지 표시
[점검달력 업데이트]
  계획일(점선) → 확정일(실선)로 전환
  6단계 날짜 칩 모두 표시
  점검현황모니터링 실시간 반영
  점검이력 INSERT: "1단계 점검일자 확정 (계획 2026-07-30 → 확정 2026-07-28)"
```

### 달력 표시 규칙

| 상태 | 표시 날짜 | 달력 스타일 | 색상 |
|------|----------|------------|------|
| `status='planned'` | `planned_date` | 점선 테두리, opacity-60 | 연보라 (소방) / 연회색 (일반관리) |
| `status='confirmed'` | `scheduled_date` | 실선 테두리, 진한 색 | 보라 (소방) / 회색 (일반관리) |
| D-3 이내 미확정 | `planned_date` | 주황 + ⚠️ 경고 배지 | `bg-orange-100` |
| 완료 | `scheduled_date` | 취소선 | 회색 |

### 점검계획 목록 표시

```
┌────────────────────────────────────────────────────────────────────┐
│ 건물명     │ 계획일(자동)   │ 확정일(관리자) │ 차이  │ 상태      │
├────────────────────────────────────────────────────────────────────┤
│ 홍길동빌딩 │ 07-30 (예상)  │ 07-28 ✓       │ -2일  │ ✅ 확정   │
│ 강남빌딩   │ 07-30 (예상)  │ — (미확정)    │  —    │ ○ 계획중  │ ← 클릭 → 날짜선택
│ 한강타워   │ 07-28 (예상)  │ — (미확정)    │  —    │ ⚠️ D-3   │ ← 긴박도 경고
└────────────────────────────────────────────────────────────────────┘
```

### 사용승인일 변경 시 1단계 리셋 흐름

```
사용승인일 변경 시:
  1. customers.use_approval_date 업데이트
  2. 해당 고객의 inspection_plan_items 조회
     WHERE customer_id = X AND status IN ('planned', 'confirmed')
  3. 각 plan_item:
     - planned_date 재계산 (새 use_approval_date 기준 각 월 예상일)
     - scheduled_date = NULL   ← 확정일 초기화
     - step1~6_date = NULL     ← 6단계 초기화
     - status = 'planned'      ← confirmed → planned 리셋
  4. 점검이력 INSERT:
     "사용승인일 변경(구: 2026-06-30 → 신: 2026-07-31)으로
      1단계 점검확정 취소, 1단계 점검계획으로 리셋"
  5. revalidatePath: /inspection-plans, /inspections/calendar
```

### DB 변경 (신규 마이그레이션 031)

```sql
-- 031_plan_item_stage_dates.sql
ALTER TABLE inspection_plan_items
  ADD COLUMN planned_date  DATE,         -- 자동계산 예상일 (변경 불가)
  ADD COLUMN step1_date DATE,
  ADD COLUMN step2_date DATE,
  ADD COLUMN step3_date DATE,
  ADD COLUMN step4_date DATE,
  ADD COLUMN step5_date DATE,
  ADD COLUMN step6_date DATE,
  ADD COLUMN plan_type TEXT CHECK (plan_type IN ('special_종합', 'special_작동', 'monthly', 'event'));

-- scheduled_date: 기존 컬럼 유지, 관리자 확정일 전용으로 의미 변경
-- COMMENT ON COLUMN inspection_plan_items.scheduled_date IS '관리자 확정일 (NULL=미확정)';
-- COMMENT ON COLUMN inspection_plan_items.planned_date   IS '사용승인일 기준 자동계산 예상일';
```

### 서버액션 신규 추가 (actions.ts)

```typescript
// 1단계 확정 + 6단계 자동 계산
confirmPlanItemStageOneAction(planItemId: string, confirmedDate: Date)
// planned_date는 그대로 유지, scheduled_date만 업데이트

// 사용승인일 변경 → planned_date 재계산 + 확정일/6단계 초기화
resetPlanItemsOnUseApprovalDateChange(customerId: string, newUseApprovalDate: Date)

// 매월 자동 plan_item 생성 (cron or 사용승인일 등록 시)
generateMonthlyPlanItemsAction(year: number, month: number)
// planned_date = use_approval_date 기준 해당 월 예상일 계산
// scheduled_date = NULL
```

### 재계산 트리거 조건

| 트리거 이벤트 | planned_date | scheduled_date | step1~6_date |
|-------------|-------------|----------------|-------------|
| 매월 자동생성 | ✅ 계산 저장 | NULL | NULL |
| 점검일자 최초 확정 | 변경 없음 | ✅ 저장 | ✅ 자동계산 |
| 점검일자 변경 (재확정) | 변경 없음 | ✅ 재저장 | ✅ 재계산 |
| 사용승인일 변경 | ✅ 재계산 | NULL 초기화 | NULL 초기화 |
| 확정 취소 | 변경 없음 | NULL 초기화 | NULL 초기화 |

---

## 6. 점검유형별 화면 상세 설계

### 점검유형 체계 (Victory9.md 기준)

```
대분류 (inspection_category)   중분류 (inspection_sub_type)   연간 특별점검   1단계점검계획 생성방식
───────────────────────────────────────────────────────────────────────────────────────────────────
소방안전관리                    종합                            연 2회           사용승인일 기준 매월 자동생성
소방안전관리                    작동 (구: 최초/기타)            연 1회           사용승인일 기준 매월 자동생성
일반관리                        —                               없음             고객요청 시 이벤트성 생성 (연 1~2회)
```

**연간 총 점검 횟수 및 계획 생성 방식:**
- 종합: 연 2회 특별점검(6단계 전체) + 10개월 매월 1단계점검계획 = **12회/년**
- 작동: 연 1회 특별점검(6단계 전체) + 11개월 매월 1단계점검계획 = **12회/년**
- 일반관리: **고객 요청에 따라 이벤트성으로 1~2회/년** (매월 자동 생성 아님)

> **소방안전관리 공통 원칙:**
> - `customers.use_approval_date` (사용승인일) 기준으로 매월 `inspection_plan_items` (1단계점검계획) 자동 생성
> - 각 plan_item에 담당자가 실제 점검을 수행하면 `scheduled_date` (실제점검일) 업데이트
> - 특별점검(종합/작동): plan_item 확정 시 6단계 전체 step1~6_date 자동 계산
> - 일반 정기점검(종합/작동 나머지 달): 1단계 실제점검일 업데이트만 수행 (2~6단계 없음)
>
> **일반관리 원칙:**
> - 사용승인일 기준 자동 생성 없음
> - **고객관리 페이지 일반관리 탭에서 [점검일 등록 +] 버튼으로 날짜 직접 등록** → plan_item 생성 → 점검달력 즉시 반영 (연 1~2회 이벤트성)
> - 점검 완료 처리 시 scheduled_date 업데이트 (6단계 없음)

### DB 변경 (신규 마이그레이션 030)

```sql
-- 030_inspection_type_category.sql
ALTER TABLE customers
  ADD COLUMN inspection_category TEXT CHECK (inspection_category IN ('소방안전관리', '일반관리')),
  ADD COLUMN inspection_sub_type TEXT CHECK (inspection_sub_type IN ('종합', '작동') OR inspection_sub_type IS NULL);

-- 기존 데이터 마이그레이션
UPDATE customers SET
  inspection_category = '소방안전관리',
  inspection_sub_type = CASE inspection_type
    WHEN '종합' THEN '종합'
    WHEN '최초' THEN '작동'
    WHEN '기타' THEN '작동'
  END;
```

### A. 소방안전관리 > 종합 (연 2회 특별 + 매월 정기)

**월간점검계획/점검업무 통합 화면:**
```
┌────────────────────────────────────────────────────────────────┐
│  2026년 7월 점검계획확정        [소방안전관리 > 종합]          │
├────────────────────────────────────────────────────────────────┤
│  유형  │ 건물명       │ 차수  │ 점검예정일    │ 담당자  │ 상태  │
├────────────────────────────────────────────────────────────────┤
│ 특별   │ 홍길동빌딩   │ 1차   │ [07-01] ◦     │ 김철수  │ 계획중│
│        │              │       │ "점검일자확정" ↓ 달력 팝업      │
├────────────────────────────────────────────────────────────────┤
│ 정기   │ 삼성타워     │ 정기  │ [07-10] ✓    │ 이영희  │ 확정  │
│ 정기   │ 강남빌딩     │ 정기  │ [07-15] ✓    │ 박민수  │ 확정  │
└────────────────────────────────────────────────────────────────┘
```

**점검달력 — 종합 고객:**
```
7월  [종합특별] [작동특별] [정기점검] [일반관리]  ← 필터탭
  1일(수): [홍길동빌딩 · 종합1차 · 1단계확정] ■진보라
  8일(수): [홍길동빌딩 · 2단계 D-3]          ■노랑
  10일(금): [삼성타워 · 정기1단계 확정]       ■연보라
  15일(수): [홍길동빌딩 · 3단계 D-7]          ■초록
```

**오른쪽 슬라이드 패널 (종합 특별점검):**
```
┌──────────────────────────────────────────┐
│ 홍길동빌딩 (소방안전관리 > 종합 1차)    │
│ 사용승인일: 2026-06-30                   │
├──────────────────────────────────────────┤
│ 1단계: 점검일자확정  [07-01] ✓ ← 변경가│
│ 2단계: 배치확인서    [07-08] ⬜          │
│ 3단계: 관계인보고서  [07-15] ⬜          │
│ 4단계: 소방서제출    [07-23] ⬜          │
│ 5단계: 소방보수완료  [08-01] ⬜          │
│ 6단계: 이행완료보고서[08-14] ⬜          │
├──────────────────────────────────────────┤
│ [SMS 발송]  [점검 시작]  [닫기]           │
└──────────────────────────────────────────┘
```

### B. 소방안전관리 > 작동 (연 1회 특별 + 매월 정기)

- 특별점검: 연 1회 (사용승인월), 6단계 전체 진행
- 정기점검: 나머지 11개월, 1단계만
- 차수: "연1회" 표시 (1차/2차 없음)
- UI: 종합과 동일 구조

### C. 일반관리 (고객 요청 이벤트성, 연 1~2회)

- 특별점검 없음, 6단계 없음
- 사용승인일 기준 자동 생성 없음
- **고객관리 페이지에서 직접 점검일 등록** → `inspection_plan_items` 생성 → 점검달력 반영

#### 고객관리 → 일반관리 탭: 점검일 등록 흐름

```
고객관리 페이지
  [소방안전관리] [일반관리]  ← 탭

  일반관리 탭 목록:
  ┌──────────────────────────────────────────────────────────────────┐
  │ 건물명      │ 담당자  │ 최근점검일  │ 연간횟수 │ 액션            │
  ├──────────────────────────────────────────────────────────────────┤
  │ 오피스빌딩  │ 김철수  │ 2026-03-15  │ 1회      │ [점검일 등록 +] │
  │ 한강타워    │ 이영희  │ 2026-05-20  │ 2회      │ [점검일 등록 +] │
  └──────────────────────────────────────────────────────────────────┘

  [점검일 등록 +] 클릭
        │
        ▼ 인라인 날짜 등록 팝업
  ┌─────────────────────────────────────┐
  │  오피스빌딩 점검일 등록             │
  ├─────────────────────────────────────┤
  │  점검 예정일 *  [달력 팝업 선택]   │
  │  담당자 *       [직원 선택 ▼]      │
  │  메모           [텍스트 입력]       │
  ├─────────────────────────────────────┤
  │  [취소]              [등록]         │
  └─────────────────────────────────────┘
        │
        ▼ 등록 완료
  inspection_plan_items INSERT {
    customer_id, plan_type: 'event',
    planned_date: 선택한 날짜,
    scheduled_date: NULL (미확정),
    status: 'planned'
  }
  → 점검달력 즉시 반영 (연회색 점선으로 표시)
```

#### 고객 상세 → 일반관리 점검 이력 패널

```
오피스빌딩 (일반관리) 상세
├── 기본정보
├── 담당자
└── 점검 이력                         [점검일 등록 +]
    ┌───────────────────────────────────────────────┐
    │ 날짜        │ 담당자  │ 상태    │ 메모         │
    ├───────────────────────────────────────────────┤
    │ 2026-07-15  │ 김철수  │ ○ 예정  │ 연간 1차     │ ← 등록됨
    │ 2026-03-15  │ 김철수  │ ✅ 완료 │ 연간 1차     │ ← 완료됨
    │ 2025-07-10  │ 이영희  │ ✅ 완료 │ —            │
    └───────────────────────────────────────────────┘
```

#### 점검달력 ↔ 고객관리 양방향 연동

```
고객관리에서 점검일 등록
    ↓ inspection_plan_items 생성
점검달력에 연회색 점선으로 표시
    ↓ 관리자가 달력에서 날짜 클릭 → 확정일 선택
scheduled_date 저장 (실선으로 전환)
    ↓ 점검완료 처리 클릭
status = 'completed', 고객관리 점검이력 자동 업데이트
```

**점검달력 — 일반관리:**
```
20일(월): [오피스빌딩 · 일반관리 · 예정] ░연회색 점선 (미확정)
20일(월): [오피스빌딩 · 일반관리 · 확정] ■연회색 실선 (확정)
```

### 달력 시각 우선순위 원칙

> **6단계 마감일을 담당자가 절대 놓치지 않도록** 6단계가 달력에서 시각적으로 가장 우선합니다.
> 정기점검(monthly)은 단순 완료처리이므로 달력에서 최소화하여 6단계 표시를 방해하지 않습니다.

```
달력 시각 우선순위
  1순위 ████  6단계 마감일 (step1~6_date)  → 크고 진하게, 긴박도 배지 필수
  2순위 ███   특별점검 확정일 (scheduled)  → 중간 크기
  3순위 ██    정기점검 (monthly)           → 작고 흐리게 (6단계 방해 금지)
  4순위 █     일반관리 이벤트              → 최소 표시
```

### 6단계 긴박도 색상 체계

| 긴박도 | 조건 | 배경색 | 텍스트 | 추가 표시 |
|--------|------|--------|--------|-----------|
| 🔴 지연 | 마감일 초과 | `bg-red-600` | `text-white font-bold` | ⚠️ 완료 전까지 유지 (취소선 없음) |
| 🔴 D-Day | 오늘 마감 | `bg-red-500` | `text-white font-bold` | 🔔 오늘마감 뱃지 |
| 🟠 D-1~2 | 1~2일 남음 | `bg-orange-400` | `text-white font-bold` | 굵은 테두리 |
| 🟡 D-3~6 | 3~6일 남음 | `bg-yellow-300` | `text-gray-800 font-semibold` | — |
| 🟢 D-7~13 | 1주 남음 | `bg-green-200` | `text-green-800` | — |
| ⚪ D-14+ | 여유 | `bg-purple-100` | `text-purple-700 text-sm` | — |
| ░ 정기점검 미확정 | monthly planned | `bg-purple-50 opacity-60` | `text-purple-400 text-xs` | 점(·) 최소 표시 |
| ✓ 정기점검 확정 | monthly confirmed | `bg-purple-50` | `text-purple-500 text-xs` | 체크마크만 |
| 일반관리 이벤트 | event | `bg-gray-100` | `text-gray-500 text-xs` | — |
| 완료 | completed | `bg-gray-100` | `text-gray-400 line-through` | — |

### 달력 상단 — 이번달 6단계 요약 카드 (필수)

```
┌─────────────────────────────────────────────────────────────────┐
│  2026년 7월 점검달력                                            │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│  🔴 지연     │  🟠 D-3 이내 │  🟡 이번달   │  ✅ 완료           │
│   2건        │   5건        │   18건       │   12건             │
└──────────────┴──────────────┴──────────────┴────────────────────┘
  ↑ 각 카드 클릭 시 해당 건만 필터링
```

### 달력 상단 고정 경고 배너 (D-3 이내 자동 표시)

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️  마감 임박 6단계 — 오늘 확인 필요                           │
│  · 홍길동빌딩  4단계 (소방서 제출)    D-Day  → [바로가기]      │
│  · 강남타워    2단계 (배치확인서)     D-2    → [바로가기]      │
│  · 파크빌딩    3단계 (관계인 보고서)  D-3    → [바로가기]      │
└─────────────────────────────────────────────────────────────────┘
D-3 이내 6단계 건만 달력 상단에 항상 고정 표시
```

### 달력 셀 내 표시 계층

```
┌─────────────────────────────────────────────────────┐
│  23일 (목)                                          │
│  🟠 [홍길동빌딩 · 4단계 D-3] ← 주황 굵게          │  ← 6단계 최우선
│  🟡 [강남타워   · 4단계 D-5] ← 노랑               │  ← 6단계
│  ·  삼성빌딩 정기             ← 점·만 표시 (xs)   │  ← 정기 최소화
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  30일 (목)                                          │
│  🔴 [오피스빌 · 2단계 D-Day]  ← 빨강 white 볼드   │  ← 최긴박
│  🟠 [파크빌딩 · 3단계 D-1]   ← 주황 white 볼드   │
│  🟡 [홍길동   · 4단계 D-6]   ← 노랑               │
│  · 강남타워 정기 · 한강빌딩 정기  ← 점(·) 2건     │  ← 정기는 점으로만
└─────────────────────────────────────────────────────┘
```

### 사이드바 — 6단계 미완료 카운터 뱃지

```
소방안전관리
  점검계획등록(점검확정)
  점검업무
  점검달력          🔴 3   ← D-Day/지연 건수
  점검현황모니터링  🟠 8   ← D-3 이내 건수
  보고서제출현황
  이행계획서등록
  이행계획제출현황
```

### 슬라이드 패널 — 현재 진행 단계 강조

```
┌──────────────────────────────────────────────────┐
│ 홍길동빌딩 (종합 1차)              [SMS] [닫기]  │
├──────────────────────────────────────────────────┤
│ ✅ 1단계: 점검일자확정   07-01  완료             │
│ ✅ 2단계: 배치확인서     07-08  완료             │
│ ✅ 3단계: 관계인 보고서  07-15  완료             │
│ 🔴 4단계: 소방서 제출    07-23  ← 오늘! D-Day   │  ← 현재 단계 빨강
│ ⬜ 5단계: 소방보수 완료  08-01                   │
│ ⬜ 6단계: 이행완료보고서 08-14                   │
├──────────────────────────────────────────────────┤
│            [4단계 완료 처리 ✓]                   │  ← 현재 단계만 버튼 표시
└──────────────────────────────────────────────────┘
```

### 고객관리 — 통합 검색 설계

#### 검색창 + 빠른 필터 칩

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍  건물명, 주소, 담당자 이름으로 검색...          [×] [검색] │
├─────────────────────────────────────────────────────────────────┤
│  [전체] [종합] [작동] [일반관리]   │  [담당자 ▼]  [지역 ▼]   │
└─────────────────────────────────────────────────────────────────┘
```

**스마트 감지 규칙 — 단일 입력창에서 자동 판별:**

| 입력 패턴 | 자동 감지 | 검색 대상 |
|-----------|----------|----------|
| `빌딩`, `타워`, `센터` 등 | 건물명 | `customer_name ILIKE` |
| `서울`, `경기`, `인천` 등 광역시도 | 주소 시도 | `region_si ILIKE` |
| `양평동`, `역삼동` 등 동/리 | 읍면동 | `region_myeon ILIKE` |
| 숫자 포함 (`양평로 92`) | 도로명 주소 | `address ILIKE` |
| 사람 이름 (`김철수`) | 담당자 | `profiles.name ILIKE` |
| 혼합 (`서울 홍길동빌딩`) | 주소 + 건물명 | 두 필드 AND 검색 |

#### 검색 자동완성 드롭다운

```
🔍  양평  입력 중...
┌─────────────────────────────────────────────────┐
│  📍 주소                                        │
│    서울 영등포구 양평동                  3건    │
│    경기 양평군 양평읍                    1건    │
│                                                 │
│  🏢 건물명                                      │
│    양평동우체국빌딩                             │
│    양평로타워                                   │
│                                                 │
│  👤 담당자                                      │
│    양평구 담당 김철수                   12건   │
└─────────────────────────────────────────────────┘
```
- 주소 / 건물명 / 담당자 섹션 분리, 건수 표시
- 클릭 시 해당 필터 즉시 적용

#### 지역 계층 드릴다운 ([지역 ▼])

```
[지역 ▼] 클릭
┌─────────────────────────┐      ┌─────────────────────────┐
│  시/도 선택             │  →   │  ← 서울특별시           │
│  ○ 서울특별시  (24건)   │      │  읍/면/동 선택          │
│  ○ 경기도      (18건)   │      │  ○ 영등포구    ( 8건)  │
│  ○ 인천광역시  ( 5건)   │      │  ○ 강남구      ( 6건)  │
│  ○ 강원도      ( 3건)   │      │  ○ 마포구      ( 5건)  │
└─────────────────────────┘      └─────────────────────────┘
```

#### 검색 결과 — 키워드 하이라이트

```
검색어: "양평"  →  2건 검색됨

┌────────────────────────────────────────────────────────────────┐
│ 건물명                  │ 주소                     │ 담당자 │유형│
├────────────────────────────────────────────────────────────────┤
│ **양평**동우체국빌딩    │ 서울 영등포구 **양평**로  │ 김철수 │종합│
│ **양평**로타워          │ 서울 영등포구 **양평**동  │ 이영희 │작동│
└────────────────────────────────────────────────────────────────┘
```

#### 서버사이드 구현 (Supabase OR 검색)

```typescript
const { data, count } = await supabase
  .from('customers')
  .select(`*, assigned_employee:profiles!assigned_employee_id(name)`, { count: 'exact' })
  .or([
    `customer_name.ilike.%${query}%`,
    `address.ilike.%${query}%`,
    `region_si.ilike.%${query}%`,
    `region_myeon.ilike.%${query}%`,
  ].join(','))
  .eq('inspection_category', typeFilter ?? undefined)
  .eq('assigned_employee_id', empFilter ?? undefined)
  .range(offset, offset + pageSize - 1)
  .order('customer_name', { ascending: true })
```

### 고객관리 — 기본 지역 설정 (승진소방ENG · 양평군 특화)

> 주 고객 소재지가 경기도 양평군이므로, 기본 지역을 시스템에 저장하여 등록/검색 모든 흐름에서 자동 적용합니다.

#### 전략 개요

```
1단계: 관리자 시스템 설정에서 기본 지역 저장 (DB)
2단계: 고객 등록 폼 자동 pre-fill (읍/면만 선택하면 완료)
3단계: 검색 결과에서 양평군 우선 표시
4단계: 양평군 읍/면 빠른 선택 칩 제공
5단계: 최근 사용 읍/면 localStorage 기억
```

#### 시스템 설정 — 기본 지역 등록

```
관리자 > 시스템 설정 > 회사 정보

```
┌─────────────────────────────────────────────────────────────┐
│  회사 로고/마크                                             │
│  ┌──────────────┐                                          │
│  │   [로고 이미지]│  [변경] [삭제]                         │
│  │  승진소방ENG  │  권장: PNG 투명배경, 200×200px 이하     │
│  └──────────────┘                                          │
├─────────────────────────────────────────────────────────────┤
│  업체명 *   [ 승진소방ENG              ]                   │
│  대표자      [ 홍길동                  ]                   │
│  사업자번호  [ 123-45-67890           ]                   │
│  대표전화    [ 031-000-0000           ]                   │
│  이메일      [ info@example.com       ]                   │
│  주소        [ 경기도 양평군 양평읍...  ]                  │
├─────────────────────────────────────────────────────────────┤
│  기본 지역   [경기도 ▼]  [양평군 ▼]                       │
│              → 고객 등록/검색 기본값으로 사용됨            │
├─────────────────────────────────────────────────────────────┤
│                              [저장]                        │
└─────────────────────────────────────────────────────────────┘
```

#### DB 설계 — company_profile 테이블 (migration 032)

```sql
-- 032_company_settings.sql
CREATE TABLE company_profile (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name      TEXT NOT NULL,           -- 업체명 (승진소방ENG)
  representative    TEXT,                    -- 대표자
  business_number   TEXT,                    -- 사업자등록번호
  phone             TEXT,                    -- 대표전화
  email             TEXT,                    -- 이메일
  address           TEXT,                    -- 주소
  logo_url          TEXT,                    -- 로고 이미지 URL (Supabase Storage)
  mark_url          TEXT,                    -- 마크/심볼 URL (Supabase Storage)
  default_region_si    TEXT DEFAULT '경기도', -- 기본 시/도
  default_region_myeon TEXT DEFAULT '양평군', -- 기본 시/군/구
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        UUID REFERENCES profiles(id)
);

-- 초기 데이터
INSERT INTO company_profile (
  company_name, default_region_si, default_region_myeon
) VALUES (
  '승진소방ENG', '경기도', '양평군'
);
```

#### 로고/마크 파일 저장 — Supabase Storage

```
Supabase Storage 버킷: company-assets (public)

업로드 경로:
  company-assets/logo/logo.png      ← 로고 (헤더, 보고서 상단 등)
  company-assets/mark/mark.png      ← 마크/심볼 (파비콘, 축소 아이콘)

저장 흐름:
  1. 관리자 파일 선택 (PNG/JPG, 2MB 이하)
  2. 미리보기 표시
  3. [저장] → Supabase Storage upload
  4. 반환된 public URL → company_profile.logo_url 업데이트
  5. 사이드바/헤더 즉시 반영 (revalidatePath)
```

#### 로고 사용처 자동 반영

```
logo_url 저장 시 반영 위치:
  ├── 사이드바 상단 로고
  ├── 로그인 페이지 로고
  ├── 보고서 PDF 헤더
  ├── SMS 발송 서명
  └── 대시보드 헤더
```

#### 고객 등록 폼 — 전체 흐름

```
새 고객 등록 (폼 최상단: 주소 검색)

① 주소 검색  [🔍 도로명/건물명 검색...]
              ↓ 결과 선택 시 아래 자동 처리

② 건물명    ┌─────────────────────────────────────────────────┐
            │  괄호 있는 경우                                 │
            │  주소: "경기 양평군 양평읍 양평로 92 (양평동우체국)"│
            │  건물명: [ 양평동우체국          ] [×]          │
            │           ↑ 괄호 안 텍스트 자동 추출             │
            │             바로 편집 가능 (추가 클릭 불필요)    │
            ├─────────────────────────────────────────────────┤
            │  괄호 없는 경우                                 │
            │  주소: "경기 양평군 용문면 연수리 12"            │
            │  건물명: [ |                    ]               │
            │           ↑ 자동 포커스 + 커서 → 바로 타이핑    │
            └─────────────────────────────────────────────────┘

③ 지역 (기본값 자동 입력)
   시/도      [경기도  ▼]  ← company_settings 기본값
   시/군/구   [양평군  ▼]  ← company_settings 기본값
   읍/면/동   [       ▼]   ← 여기만 선택 (양평읍/강상면/강하면 …)
   상세주소   [              ]
```

**건물명 자동추출 로직:**
```typescript
function extractBuildingName(fullAddress: string): string {
  const match = fullAddress.match(/\(([^)]+)\)$/)
  return match ? match[1] : ''
}

// 주소 검색 결과 선택 시
const building = extractBuildingName(selectedAddress)
if (building) {
  setBuildingName(building)          // 자동 입력
  buildingNameRef.current?.select()  // 전체 선택 → 바로 덮어쓰기 가능
} else {
  setBuildingName('')
  buildingNameRef.current?.focus()   // 빈 칸 자동 포커스 → 바로 타이핑
}
```

#### 검색창 — 양평군 읍/면 빠른 선택 칩

```
┌────────────────────────────────────────────────────────────┐
│  🔍  건물명, 주소, 담당자...                               │
├────────────────────────────────────────────────────────────┤
│  [전체] [종합] [작동] [일반관리]   │  [담당자 ▼]          │
│                                                            │
│  📍 양평군 읍/면:                                          │
│  [양평읍] [강상면] [강하면] [양서면] [옥천면] [서종면]    │
│  [봉미면] [용문면] [지평면] [단월면] [청운면]             │
└────────────────────────────────────────────────────────────┘
  ↑ 칩 클릭 시 해당 읍/면 즉시 필터, 건수 표시
```

#### 검색 결과 — 양평군 우선 정렬

```
🔍  용문  입력 중...
┌──────────────────────────────────────────────────┐
│  📍 양평군 (기본 지역)              ← 상단 고정  │
│    경기 양평군 용문면 다원로 33      5건          │
│    경기 양평군 용문면 연수리 12      2건          │
│                                                   │
│  📍 기타 지역                                     │
│    서울 용문동 ...                   1건          │
└──────────────────────────────────────────────────┘
```

```typescript
// 기본 지역 우선 정렬: 양평군 결과 상단 고정
const { data } = await supabase
  .from('customers')
  .select('*')
  .or(`customer_name.ilike.%${query}%,address.ilike.%${query}%,region_myeon.ilike.%${query}%`)
  .order(`region_myeon.eq.양평군`, { ascending: false })  // 양평군 먼저
  .order('customer_name', { ascending: true })

// 고객 등록 폼 pre-fill (서버에서 기본 지역 로드)
const defaultRegion = await getCompanySetting(['default_region_si', 'default_region_myeon'])
// → { si: '경기도', myeon: '양평군' }
```

#### 최근 읍/면 기억 (localStorage)

```typescript
// 고객 등록 완료 시 마지막 사용 읍/면 저장
localStorage.setItem('lastUsedMyeon', '용문면')

// 다음 고객 등록 시 자동 pre-fill 우선순위
// 1순위: localStorage 최근 읍/면
// 2순위: company_settings 기본 지역
// 3순위: 빈칸
```

#### 구현 파일 목록

| 파일 | 작업 내용 |
|------|----------|
| `migration 032_company_profile.sql` | `company_profile` 테이블 + 업체명/로고/마크/기본 지역 seed |
| `admin/settings/page.tsx` | 회사 정보 + 기본 지역 설정 UI |
| `customers/page.tsx` | 양평군 우선 정렬 + 읍/면 빠른 칩 |
| `customers/customer-new-client.tsx` | 기본 지역 pre-fill + localStorage |
| `lib/company-profile.ts` | `getCompanyProfile()` 유틸 함수 |

### 고객관리 — 점검유형 선택 UI

```
점검유형 * (필수)
  ○ 소방안전관리     ○ 일반관리
  
  [소방안전관리 선택 시]
  ○ 종합             ○ 작동
```

---

## 7. Victory9.md 신규 요구사항 전체

### V9-1. 점검유형 체계 재편 ⬜

- 대분류: 소방안전관리 / 일반관리 (라디오, 필수)
- 중분류: 소방안전관리 → 종합 / 작동 (라디오, 필수)
- 최초/기타 → 작동으로 명칭 변경
- DB: migration 030, 031 필요

**핵심 로직 — 점검계획 생성 방식:**

| 고객유형 | plan_item 생성 방식 | 특별점검달 처리 | 실제점검일 업데이트 |
|----------|---------------------|----------------|-------------------|
| 종합 | ✅ use_approval_date 기준 매월 자동 (연 12회) | 특별점검달: `plan_type='special_종합'` | 1단계 확정 시 scheduled_date 저장 + 6단계 자동계산 |
| 작동 | ✅ use_approval_date 기준 매월 자동 (연 12회) | 특별점검달: `plan_type='special_작동'` | 1단계 확정 시 scheduled_date 저장 + 6단계 자동계산 |
| 일반관리 | ❌ 자동 생성 없음 — **고객관리 페이지에서 직접 날짜 등록** (연 1~2회) | 없음 | 등록 → 달력 반영 → 완료처리 시 scheduled_date 저장 (6단계 없음) |

### V9-2. 고객명 = 건물명 통일 ⬜

- 고객명/건물명 → "건물명"으로 통일
- 고객코드는 UI에서 숨김 (내부 코드)

### V9-3. 고객관리 + 건물관리 통합 ⬜

- 고객관리 페이지에서 건물 정보 함께 관리
- 고객등록 시 주소 → 건물관리 자동 입력 (중복 주소 검색 제거)

### V9-4. 고객관리 인라인 빠른 수정 ⬜

인라인 수정 가능 필드:
- 고객명(건물명) / 점검유형 / 계약일 / 사용승인일 / 담당직원 / 상태

### V9-5. 사용승인일 변경 → 6단계 자동 재계산 + 1단계 리셋 ⬜

- 1단계점검확정 취소 → 1단계점검계획으로 리셋
- 월간점검계획, 점검달력, 점검업무 모두 업데이트
- 점검이력에 변경 기록

### V9-6. 고객등록: 주소검색 → 건물명 자동추출 + 즉시 수정 ⬜

- 주소 검색 폼 최상단 배치
- 검색 결과 선택 시 괄호 안 텍스트 → 건물명 자동 추출

| 주소 형태 | 건물명 처리 |
|-----------|-----------|
| `"...양평로 92 (양평동우체국)"` | `"양평동우체국"` 자동 입력 + `[×]` 버튼 + 즉시 편집 가능 |
| 괄호 없음 `"...연수리 12"` | 빈 입력창 자동 포커스 → 커서 위치, 바로 타이핑 |
| 사용자 직접 수정 | 수정값 우선 저장 |

> 상세 UI 흐름 및 코드: **섹션 6 › 고객관리 기본 지역 설정 › 고객 등록 폼 전체 흐름** 참조

### V9-7. 고객등록: 점검이력 자동 기록 ⬜

변경 시 이력 기록 필드:
- 고객명 / 점검유형 / 계약일 / 사용승인일 / 주소 / 담당직원 / 관계인 / 저장/변경/삭제

### V9-8. 고객등록: 건물목록 정보 자동 동기화 ⬜

- 건물등록(용도/연면적/층수/준공/상태) → 고객등록 화면에도 동일 값 표시

### V9-9. 월간점검계획 자동화 (버튼 제거) ⬜

- "일정제안" 버튼 삭제
- "항목추가" 버튼 삭제
- 사용승인일 등록/변경 시 자동 plan_item 생성
- 월간점검계획 → 1단계 점검계획/확정 조회 페이지로만 사용

### V9-10. 1단계 "점검일자확정" 전체 적용 ⬜

모든 화면(월간점검계획/점검업무/점검달력)에서:
- "1단계:점검완료" → "1단계:점검일자확정" 문구 변경
- 달력 팝업으로 날짜 직접 선택/변경
- 확정 날짜 기준 6단계 전체 일자 자동 업데이트
- 확정 시 SMS 발송 + 이력 기록

### V9-11. 점검보기 → 오른쪽 슬라이드 패널 ⬜

- "점검보기" 클릭 → 새 창 대신 오른쪽 슬라이드 패널
- 6단계업무체크리스트 조회 및 입력
- 월간점검계획, 점검업무 모두 해당

### V9-12. 월간점검계획 + 점검업무 한 페이지 통합 ⬜

- 두 화면을 하나의 페이지로 통합

### V9-13. 점검달력 개선 ⬜

- 지연 색상 진하게 (기존 너무 흐림) → `bg-red-200` 사용
- 각 6단계 날짜 업데이트 → 달력 실시간 반영
- 1단계 달력 클릭 → 점검계획등록도 업데이트 (양방향)
- 고객명 / 단계 / 담당자 달력에 표시
- 비활성/삭제 건도 표시 (회색 취소선)

### V9-14. 점검현황모니터링 개선 ⬜

6단계 명칭 수정:
| 현재 | 변경 후 | 6단계 매핑 |
|------|---------|-----------|
| 점검일 | 점검일 (1단계) | step_num=1 |
| 배치신고일 | 배치신고일 (2단계) | step_num=2 |
| 송부일 | 송부일 (3단계) | step_num=3 |
| 계출일 | 계출일 (4단계) | step_num=4 |
| — | 소방보수완료 (5단계) | step_num=5 |
| — | 이행완료보고서 (6단계) | step_num=6 |

- "선택" 컬럼 제거
- 각 날짜 = 해당 단계 완료 클릭 시 자동 업데이트

### V9-15. 지역별 담당 배정 — 직원 조회 ⬜

- 배정직원 필드 조회 가능하도록
- 직원 변경 시 고객관리>점검이력 업데이트

### V9-16. 메뉴 명칭 변경 ⬜

| 현재 | 변경 후 |
|------|---------|
| 점검계획등록 | 점검확정 |
| 월간점검계획 | 월간점검계획확정 |

### V9-17. 점검달력 ↔ 점검계획등록 양방향 연동 ⬜

- 달력에서 날짜 클릭 → inspection_plan_items 업데이트
- 달력에서 단계 완료 처리 → 점검현황모니터링 실시간 반영

### V9-18. 고객관리 UX 개선 ⬜

| # | 항목 |
|---|------|
| 1 | 최신 등록 고객 목록 최상단 표시 |
| 2 | 비활성 버튼: 목록에서 활성↔비활성 즉시 전환 |
| 3 | 고객코드 목록/상세에서 숨김 |
| 4 | 고객코드 자동생성 (최종번호+1) |
| 5 | 관계인: 대표 1명 필수 + 추가 입력 가능 |
| 6 | 엔터키로 저장 가능 |
| 7 | 저장과 수정 동시 (단일 폼) |
| 8 | 삭제 버튼 추가 |
| 9 | 화면 스크롤 없이 전체 표시 |
| 10 | **통합 검색창** (건물명/주소/담당자 단일 입력, 스마트 자동감지) |
| 11 | **자동완성 드롭다운** (주소·건물명·담당자 섹션 분리, 건수 표시) |
| 12 | **빠른 필터 칩** (점검유형 원클릭 토글: 전체/종합/작동/일반관리) |
| 13 | **지역 계층 드릴다운** (시/도 → 읍/면/동 단계별 선택) |
| 14 | **검색 결과 키워드 하이라이트** (매칭 부분 볼드 표시) |
| 15 | **서버사이드 OR 검색** (Supabase `.or()` 다중 컬럼 동시 검색) |

### V9-19. 점검업무 — 점검배정 버튼 삭제 ⬜

- 점검업무 화면에서 "점검배정" 버튼 제거

### V9-20. 담당자 변경 시 전체 연동 ⬜

담당자 변경 시 연동 대상:
- 월간점검계획 / 점검업무 / 점검달력 / 지역별담당배정 / 고객관리 점검이력

### V9-21. 점검유형별 각각의 화면 구성 ⬜

점검유형(종합/작동/일반)에 따라 각각 별도 화면 필요:
- 점검계획등록(점검업무 통합)
- 점검달력
- 점검현황모니터링
- 지역별담당배정

---

## 8. 미구현 항목 전체 목록 (우선순위별)

### 🔴 최우선 (핵심 비즈니스 로직)

| # | 항목 | 파일 | 출처 |
|---|------|------|------|
| 1 | **점검유형 재편** (소방안전관리 종합/작동 + 일반관리 분리) + migration 030/031 | customers DB+UI, inspection_plan_items | V9 |
| 2 | **소방안전관리: planned_date 자동생성 + 점검일자확정 → scheduled_date + step1~6 자동계산** | migration 031, actions.ts, inspection-plans-client | V9 |
| 3 | **일반관리: 고객관리 페이지에서 [점검일 등록 +] → plan_item 생성 → 점검달력 반영** | customers/page.tsx, customers/actions.ts | V10 신규 |
| 4 | **사용승인일 변경 → planned_date 재계산 + scheduled_date/step1~6 초기화 + 이력** | customers/actions.ts | V9 |
| 5 | **점검달력: 6단계 최우선 표시** (긴박도 색상/상단 요약카드/고정 배너/사이드바 뱃지) | inspection-calendar-client.tsx | V8+V9+V10 |
| 6 | **고객관리 인라인 빠른 수정** (6개 필드) | customers/page.tsx | V9 |

### 🟡 중간 우선순위

| # | 항목 | 파일 | 출처 |
|---|------|------|------|
| 7 | 고객관리 + 건물관리 통합 (주소 자동 공유) | customers/page.tsx | V9 |
| 8 | **고객등록: 주소 괄호→건물명 자동추출 + 즉시 인라인 수정** (괄호 없으면 빈칸 포커스) | customer-new-client.tsx | V9 |
| 9 | 고객등록: 점검이력 자동 기록 (모든 변경 필드) | customers/actions.ts | V9 |
| 10 | 담당자 변경 시 전체 연동 | customers/actions.ts + 관련 테이블 | V9 |
| 11 | 점검현황모니터링: 6단계 명칭 수정 + 자동 업데이트 | monitor-client.tsx | V9 |
| 12 | 메뉴명 변경: 점검계획등록→점검확정, 월간→월간점검계획확정 | sidebar.tsx + 페이지 헤더 | V9 |
| 13 | 지역별 담당 배정 UI + 직원 조회 | regional-assign/page.tsx | V8 + V9 |
| 14 | 고객관리 UX: 최신순/비활성전환/코드숨김/엔터저장/삭제 | customers/ 컴포넌트 | V9 |
| 15 | **고객관리 통합 검색** (건물명/주소/담당자 단일창, 자동완성, 지역 드릴다운, 키워드 하이라이트) | customers/page.tsx | V10 |
| 16 | **기본 지역 설정** (양평군 default: 시스템 설정 저장 + 등록 폼 pre-fill + 읍/면 칩 + 검색 우선정렬) | migration 032, admin/settings, customer-new-client.tsx | V10 |
| 17 | 대시보드 KPI 카드 + 마감임박 위젯 | dashboard/page.tsx | V8 Sec5 |

### 🟢 낮은 우선순위

| # | 항목 | 파일 | 출처 |
|---|------|------|------|
| 15 | My Page 일정관리 점검 마감일 오버레이 | my/schedules/page.tsx | V8 Sec6 |
| 16 | 자동 알림 cron (D-3/D-1/D-Day) | /api/cron/inspection-deadline-notify | V8 Sec7 |
| 17 | 실제 SMS API 연동 (솔라피 CoolSMS) | saveSmsAction | V8 |
| 18 | 월간점검계획 + 점검업무 한 페이지 통합 | 신규 통합 페이지 | V9 |
| 19 | 점검달력 ↔ 점검계획등록 양방향 연동 | calendar-client + plan actions | V9 |
| 20 | 고객코드 자동생성 시스템 | customers/actions.ts | V9 |
