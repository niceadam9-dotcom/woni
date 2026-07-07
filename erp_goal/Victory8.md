# 사용승인일 기반 — 소방안전관리 전체 프로세스 및 변경 명세

> `customers.use_approval_date`(사용승인일) 도입에 따른
> 점검계획등록·소방안전관리·대시보드·My Page 연계 프로세스 및 변경 명세

---

## 1. 전체 프로세스 흐름도

```
[고객 등록] customers
  └─ 사용승인일 입력 (use_approval_date) ✅ 구현됨
        │
        ▼
[점검계획등록] /inspection-plans
  └─ 월간 계획 수립 → inspection_plans(헤더) 생성
  └─ 고객별 날짜·담당자 배정 → inspection_plan_items 생성
  └─ 계획 확정 (status: draft → confirmed) ✅ 구현됨
        │
        ▼ ⚠️ [점검 시작 버튼] — Victory4.md 설계, 현재 미구현
        │   plan_item.scheduled_date 도래 시 manager/admin이 클릭
        │   → plan_items.inspection_id 연결
        │
        ▼
[점검 생성] inspections
  └─ inspection_start_date = 실제 점검 시작일
  └─ use_approval_date ← customers에서 가져와야 함 ⚠️ 연결 필요
        │
        ▼ [DB 트리거: trg_create_inspection_steps — 자동 발동]
        │   현재: inspection_start_date 기준 7단계 생성
        │   변경: use_approval_date 기준 6단계 생성으로 전환 필요 ⚠️
        │
        ▼
[단계 관리] inspection_steps (6단계)
  └─ 단계별 due_date 자동 계산 (영업일/절대일)
        │
        ├──▶ 소방안전관리 > 점검달력 (/inspections/calendar)
        ├──▶ 대시보드 (/dashboard) — 마감 임박 위젯
        └──▶ My Page > 일정관리 (/my/schedules) — 점검 마감 오버레이
```

---

## 2. 점검계획등록과 사용승인일의 관계

### 2-1. 점검계획등록이 하는 일

| 단계 | 동작 | 테이블 | 구현 상태 |
|------|------|--------|-----------|
| 월간 계획 초안 생성 | 고객 선택 + 날짜 배분 | `inspection_plans` + `inspection_plan_items` | ✅ 구현됨 |
| 계획 확정 | status: draft → confirmed (또는 바로 확정) | `inspection_plans.status` | ✅ 구현됨 |
| 점검항목추가 주소 검색 | 건물명·주소 실시간 콤보박스 | — (UI only) | ✅ 구현됨 |
| 달력·목록 사용승인일 표시 | 칩에 M/D 사용승인, 목록 컬럼 추가 | — (UI only) | ✅ 구현됨 |
| 미점검 초과 경보 | 담당자별 초과 건 경보 패널 | `inspection_plans` + `inspection_plan_items` | ✅ 구현됨 |
| 미점검 초과 자동 해결 | 연간 달력 + 승인 버튼 → 계획 자동 생성·추가 | `inspection_plans` + `inspection_plan_items` | ✅ 구현됨 |
| **점검 시작** | plan_item → inspections 생성, 목록·패널에서 바로 실행 | `inspections`, `plan_items.inspection_id` | ✅ 구현됨 |

> **점검계획등록은 "언제 누가 어느 고객을 점검할지" 계획만 세운다.**
> 실제 점검(`inspections`)과 단계 마감일(`inspection_steps`)은 "점검 시작" 버튼 클릭 시 생성된다.

### 2-2. 사용승인일이 개입하는 시점

사용승인일(`use_approval_date`)은 **점검 시작 시점**에 의미를 갖는다.

```
점검계획등록    →  어느 날짜에 점검할지 계획 (inspection_start_date)
사용승인일     →  점검 완료 후 6단계 후속 업무 마감일의 기준
```

즉, 두 날짜는 **역할이 다르다**:

| 날짜 | 의미 | 어디서 입력 |
|------|------|-------------|
| `inspection_start_date` | 실제 점검(방문) 시작일 | 점검 배정(/inspections/new) 또는 점검 시작 버튼 |
| `use_approval_date` | 사용승인일 — 6단계 마감 기산점 | 고객 등록/수정 (/customers) |

---

## 3. 현재 7단계 vs Victory7.md 6단계 — 구조 비교

### 현재 DB 트리거 (`create_inspection_steps`) — 7단계

기준일: `inspections.inspection_start_date` (점검 시작일)

| step_num | 단계명 | 기준 | 계산 | is_working_days |
|----------|--------|------|------|-----------------|
| 1 | 관계인 통보 1차 | inspection_start_date | +3일 | true (영업일) |
| 2 | 관계인 협의 2차 | inspection_start_date | +4일 | true |
| 3 | 보고서 작성 | inspection_start_date | +9일 | true |
| 4 | 소방서 제출 | step3 due_date | +1일 | true |
| 5 | 공사완료 | inspection_start_date | +10일 | false (절대일) |
| 6 | 이해관계자 보고서 | — | NULL | — |
| 7 | 이행완료 보고서 제출 | — | NULL | — |

### 목표 — 6단계 (image-9.png 기준 용어 적용)

기준일: `customers.use_approval_date` (사용승인일)

| step_num | 단계명 | 사이드바 메뉴 연결 | 기준 | 계산 | is_working_days |
|----------|--------|-------------------|------|------|-----------------|
| 1 | **1단계: 점검 완료** | 점검 업무 | use_approval_date | +1일 | true (영업일) |
| 2 | **2단계: 배치확인서 보고서 작성** | (메뉴 없음) | step1 due_date | +5일 | true |
| 3 | **3단계: 관계인 보고서 제출** | 보고서 제출현황 | step1 due_date | +10일 | true |
| 4 | **4단계: 소방서 보고서 제출 및 이행계획서 등록** | 이행계획서 등록 | step1 due_date | +15일 | true |
| 5 | **5단계: 소방보수 완료** | (메뉴 없음) | step4 due_date | +10일 | **false** (절대일) |
| 6 | **6단계: 이행완료보고서 제출** | 이행계획 제출현황 | step5 due_date | +10일 | true |

### 전환을 위해 필요한 작업

| 항목 | 현재 | 변경 필요 |
|------|------|-----------|
| 트리거 기준일 | `inspection_start_date` | `use_approval_date` (customers에서 JOIN) |
| 단계 수 | 7단계 | 6단계 |
| 단계 내용 | 관계인통보/협의/보고서/소방서/공사완료 등 | image-9.png 기준 6단계명으로 교체 |
| migration | 없음 | `019_update_inspection_steps_trigger.sql` 필요 |

---

## 4. 소방안전관리 > 점검달력 변경 명세

**경로**: `/inspections/calendar` → `InspectionCalendarClient`

### 4-1. 이벤트 블록 변경

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| 이벤트 텍스트 | 점검명 | 고객명 + · + 단계명 (예: `홍길동빌딩 · 3단계`) |
| D-Day 배지 | 없음 | D-7 / D-3 / D-Day / D+N(지연) 상시 노출 |
| 색상 | 단일색 | 긴박도 5단계 색상 (아래 표) |
| 클릭 동작 | 없음 | 6단계 Progress Bar 슬라이드 패널 |

### 4-2. 색상 긴박도 규칙

| 잔여 기간 | 색상 | Tailwind 클래스 |
|-----------|------|----------------|
| 7일 이상 | 초록 | `bg-green-100 text-green-700` |
| 3~6일 | 노랑 | `bg-yellow-100 text-yellow-700` |
| 1~2일 | 주황 | `bg-orange-100 text-orange-700` |
| 당일 (D-Day) | 빨강 | `bg-red-100 text-red-700 font-bold` |
| 초과 (지연) | 회색+취소선 | `bg-gray-100 text-gray-400 line-through` |

### 4-3. 퀵 필터 (달력 상단)

```
[ 오늘 마감 ]  [ 지연 ]  [ 이번 주 ]  [ 전체 ]
```

### 4-4. 슬라이드 패널 (이벤트 클릭 시)

```
┌──────────────────────────────────────────┐
│ 홍길동빌딩                      [닫기 ×] │
│ 사용승인일: 2026-06-30                   │
├──────────────────────────────────────────┤
│ ① 점검 완료                2026-07-01   ✅    │
│ ② 배치확인서 보고서 작성   2026-07-08   🔴 D-Day
│ ③ 관계인 보고서 제출       2026-07-15   ⬜    │
│ ④ 소방서 보고서 제출 및    2026-07-23   ⬜    │
│    이행계획서 등록                            │
│ ⑤ 소방보수 완료            2026-08-02   ⬜    │
│ ⑥ 이행완료보고서 제출      2026-08-14   ⬜    │
│                                          │
│            [점검 상세 보기 →]            │
└──────────────────────────────────────────┘
```

---

## 5. 대시보드 변경 명세

**경로**: `/dashboard`

### 5-1. KPI 카드 2개 추가 (manager/admin)

| 카드 | 데이터 소스 | 클릭 이동 |
|------|------------|-----------|
| 오늘 마감 N건 | `inspection_steps WHERE due_date = today AND status != 'completed'` | `/inspections/calendar?filter=today` |
| 지연 N건 | `inspection_steps WHERE due_date < today AND status != 'completed'` | `/inspections/calendar?filter=overdue` |

### 5-2. "마감 임박" 위젯 강화 (D-7 ~ D-Day, 최대 7건)

```
┌────────────────────────────────────────────────┐
│ 마감 임박                           [더보기 →] │
├────────────────────────────────────────────────┤
│ 홍길동빌딩   2단계 배치확인서 보고서 작성   D-2  🟠  │
│ 삼성건물     4단계 이행계획서 등록          D-Day 🔴  │
│ 강남타워     3단계 관계인 보고서 제출       D-5  🟡  │
│ 롯데빌딩     1단계 점검 완료               지연  ⬜  │
└────────────────────────────────────────────────┘
```

**역할별 표시 범위**:

| 역할 | 표시 대상 |
|------|-----------|
| employee | 본인 담당 고객만 |
| manager | 팀 전체 |
| admin | 전체 |

---

## 6. My Page > 일정관리 변경 명세

**경로**: `/my/schedules` → `SchedulesClient`

### 6-1. 점검 마감일 오버레이

기존 개인 일정(보라색) 위에 담당 고객의 `inspection_steps.due_date`를 다른 색으로 오버레이한다.

**추가 로드 데이터**:
```
assigned_inspections = inspections
  WHERE assigned_employee_id = profile.id
  JOIN inspection_steps (status != 'completed')
  JOIN customers (customer_name, use_approval_date)
  범위: 현재 기준 ±2개월
```

### 6-2. 색상 구분

| 이벤트 종류 | 색상 |
|-------------|------|
| 개인 일정 | 보라 `#7b68ee` |
| 점검 마감 (7일 이상) | 초록 |
| 점검 마감 (1~6일 임박) | 주황 |
| 점검 마감 (당일) | 빨강 |
| 점검 마감 (지연) | 회색 |

### 6-3. 클릭 동작

- 점검 마감 이벤트 클릭 → `/inspections/{inspection_id}` 상세 이동
- 개인 일정 클릭 → 기존 편집 모달 유지

---

## 7. 자동 알림 명세

기존 `NotificationType`에 이미 정의된 타입 재활용:
- `inspection_step_due` — D-3, D-1, D-Day
- `inspection_step_overdue` — 기한 초과

| 시점 | 수신자 | 내용 예시 |
|------|--------|-----------|
| D-3 오전 9시 | 담당자 + 관리자 | `[D-3] 홍길동빌딩 2단계 배치확인서 작성 마감 3일 전` |
| D-1 오전 9시 | 담당자 + 관리자 | `[D-1] 홍길동빌딩 2단계 배치확인서 작성 내일 마감` |
| D-Day 오전 9시 | 담당자 + 관리자 | `[오늘 마감] 홍길동빌딩 2단계 배치확인서 작성` |
| 마감 다음날 | 담당자 + 관리자 + admin | `[지연] 홍길동빌딩 2단계 배치확인서 작성 기한 초과` |

---

## 8. 구현 우선순위 (단계별 로드맵)

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | DB 트리거 수정 — 7단계→6단계, 기준일 use_approval_date로 전환 | `supabase/migrations/018_update_inspection_steps_trigger.sql` |
| 2 | 점검 시작 버튼 구현 — plan_item → inspections 연결 | `src/app/(dashboard)/inspection-plans/actions.ts` |
| 3 | 점검달력 — D-Day 배지·색상·퀵필터·슬라이드 패널 | `src/components/inspections/inspection-calendar-client.tsx` |
| 4 | 대시보드 — 오늘 마감/지연 KPI 카드, 마감 임박 위젯 강화 | `src/app/(dashboard)/dashboard/page.tsx` |
| 5 | My Page 일정관리 — 점검 마감일 오버레이 | `src/app/(dashboard)/my/schedules/page.tsx` |
| 6 | 자동 알림 cron API | `src/app/api/cron/inspection-deadline-notify/route.ts` |

---

## 9. 고객관리 — 지역별 담당자 일괄 배정 설계

### 9-1. 배경

현재 담당자 배정은 고객 상세 페이지에서 1건씩만 가능하다.
관리자가 시/읍면/리 단위로 지역을 구분하여 담당자를 일괄 배정할 수 있는 기능을 추가한다.

### 9-2. DB 변경 (`supabase/migrations/018_region.sql` ✅ 완료)

```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS region_si    TEXT,  -- 시/군/구  예) 광주시
  ADD COLUMN IF NOT EXISTS region_myeon TEXT,  -- 읍/면/동  예) 오포읍
  ADD COLUMN IF NOT EXISTS region_ri    TEXT;  -- 리/동     예) 신현리
```

### 9-3. 고객 등록/수정 폼 변경

주소 필드 아래에 3단계 지역 입력 추가:

| 필드 | 예시 |
|------|------|
| 시/군/구 | 광주시 |
| 읍/면/동 | 오포읍 |
| 리/동    | 신현리 |

### 9-4. 지역별 일괄 배정 화면 (`/customers/regional-assign`, admin 전용)

```
┌─────────────────────────────────────────────────────┐
│  지역별 담당자 일괄 배정             [관리자 전용]   │
├─────────────────────────────────────────────────────┤
│  시/군/구  [ 광주시      ▼ ]                        │
│  읍/면/동  [ 오포읍      ▼ ]  ← 시 선택 후 연동     │
│  리/동     [ 신현리      ▼ ]  ← 읍/면 선택 후 연동  │
│  배정 직원 [ 홍길동 (소방1팀) ▼ ]                  │
│                               [선택 고객 배정하기]   │
├─────────────────────────────────────────────────────┤
│  해당 지역 고객 목록 (12건)    [전체선택 ☑]         │
│                                                     │
│  ☑  홍길동빌딩    현 담당: 김철수  → 홍길동으로    │
│  ☑  삼성타워      현 담당: 미배정  → 홍길동으로    │
│  ☐  강남빌딩      현 담당: 홍길동  (유지)           │
│  ☑  오포타워      현 담당: 미배정  → 홍길동으로    │
│                                                     │
│  * 이미 배정된 고객은 기본 해제, 수동 선택 가능    │
└─────────────────────────────────────────────────────┘
```

**연동(Cascading) 드롭다운 로직:**
- 시/군/구 선택 → region_si DISTINCT 값으로 읍/면/동 목록 자동 로드
- 읍/면/동 선택 → region_myeon DISTINCT 값으로 리/동 목록 자동 로드
- 리/동은 선택사항 — 시/군/구 또는 읍/면/동 수준에서도 배정 가능

### 9-5. 일괄 배정 Server Action (`bulkAssignEmployeeAction` ✅ 완료)

```typescript
bulkAssignEmployeeAction(customerIds: string[], employeeId: string | null)
→ customers IN (customerIds) 일괄 UPDATE
→ notifications 배치 INSERT (담당 직원에게 알림)
→ activity_logs에 일괄 배정 기록
```

### 9-6. 수정 대상 파일

| 파일 | 변경 내용 | 상태 |
|------|-----------|------|
| `supabase/migrations/018_region.sql` | region_si/myeon/ri 컬럼 추가 | ✅ 완료 |
| `src/types/index.ts` | Customer 인터페이스에 3단계 지역 필드 추가 | ✅ 완료 |
| `src/app/(dashboard)/customers/actions.ts` | INSERT/UPDATE 반영, bulkAssignEmployeeAction 추가 | ✅ 완료 |
| `src/components/customers/customer-new-client.tsx` | 시/읍면/리 입력 필드 추가 | ⬜ 미구현 |
| `src/components/customers/edit-customer-info-client.tsx` | 시/읍면/리 입력 필드 추가 | ⬜ 미구현 |
| `src/app/(dashboard)/customers/page.tsx` | 지역 필터 드롭다운 추가 | ⬜ 미구현 |
| `src/app/(dashboard)/customers/regional-assign/page.tsx` | 신규 — 지역별 일괄 배정 페이지 | ⬜ 미구현 |
| `src/components/customers/regional-assign-client.tsx` | 신규 — 일괄 배정 UI | ⬜ 미구현 |

---

## 10. 검증 기준 (사용승인일 2026-06-30 예시)

| 단계 | 예시 마감일 | 검증 포인트 |
|------|------------|-------------|
| 1단계 | 2026-07-01 (수) | 다음 영업일 1일 |
| 2단계 | 2026-07-08 (수) | 1단계 후 영업일 5일 |
| 3단계 | 2026-07-15 (수) | 1단계 후 영업일 10일 |
| 4단계 | 2026-07-23 (목) | 1단계 후 영업일 15일 |
| 5단계 | 2026-08-02 (일) | 4단계 후 절대일 +10 |
| 6단계 | 2026-08-14 (금) | 5단계 후 영업일 10일 |

- 테스트 환경상 admin@erp-test.com 임시 비밀번호(TestVerify2026!)로 설정됨.

---

## 11. 점검계획등록 — 추가 구현 기능 (2026-07)

### 11-1. 점검항목추가 주소 검색 ✅ 완료

`add-plan-item-modal.tsx`의 고객 선택 `<select>`를 검색 가능한 콤보박스로 교체.

| 항목 | 내용 |
|------|------|
| 검색 기준 | 건물명 + 주소(address) 실시간 OR 필터링 |
| 드롭다운 | 건물명(굵게) + 주소(회색 소형) 표시, 외부 클릭 시 자동 닫힘 |
| 선택 시 | `customerId` 세팅 + 담당직원 자동 세팅 유지 |
| 선택된 고객 | 점검유형 + 주소 확인 배너 표시 |

**수정 파일**

| 파일 | 변경 내용 |
|------|-----------|
| `add-plan-item-modal.tsx` | `CustomerOption`에 `address` 추가, 콤보박스 UI 구현 |
| `inspection-plans-client.tsx` | `CustomerOption` 타입에 `address: string \| null` 추가 |
| `page.tsx` | customers 쿼리에 `address` 필드 추가 |

---

### 11-2. 달력·목록에 사용승인일 표시 ✅ 완료

**달력 뷰** (`CalendarView`)

- 셀 높이 `h-24` → `h-28` (텍스트 2줄 수용)
- 각 항목 칩: 건물명 아래에 `M/D 사용승인` 소형 텍스트 추가 (예: `3/15 사용승인`)
- `customerMap` (id → CustomerOption) 으로 O(1) 조회

**목록 뷰** (`ListView`)

- `사용승인일` 컬럼 추가 (점검예정일·건물명 다음, `YYYY.MM.DD` 형식)
- 사용승인일 없는 경우 `—` 표시

**수정 파일**

| 파일 | 변경 내용 |
|------|-----------|
| `page.tsx` | customers 쿼리에 `use_approval_date` 추가 |
| `inspection-plans-client.tsx` | `CustomerOption`에 `use_approval_date` 추가, `CalendarView`·`ListView`에 customers prop 전달 |

---

### 11-3. 미점검 초과 경보 (`OverduePanel`) ✅ 완료

`page.tsx` 서버 컴포넌트에서 초과 대상을 계산 후 `OverduePanel`로 표시.

**초과 판정 로직** (page.tsx 서버 사이드 계산)

```
올해 inspection_plans → plan_month 맵 생성
올해 inspection_plan_items (취소 제외) → handledKey Set 생성
  handledKey = "customer_id-sequence_num-plan_month"

각 활성 고객의 use_approval_date에서:
  approvalMonth = 사용승인일의 월
  secondMonth   = ((approvalMonth - 1 + 6) % 12) + 1
  wraps         = secondMonth < approvalMonth  (2차가 내년으로 넘어가는 경우)

  1차 초과: approvalMonth < viewMonth AND `${id}-1-${approvalMonth}` not in handledKey
  2차 초과: !wraps AND secondMonth < viewMonth AND `${id}-2-${secondMonth}` not in handledKey
```

**UI 구성** (헤더와 그리드 사이 전체 너비)

```
[⚠] 미점검 초과 N건 — YYYY년 MM월 기준 계획 미등록     [자동 해결]  [접기 ∧]
├ 담당: 김철수 (2건)
│  건물A  종합  1차  3월 예정  사용승인 3/15
│  건물B  최초  1차  3월 예정  사용승인 3/20
└ 담당: 이영희 (1건)
   건물C  종합  2차  6월 예정  사용승인 12/10
```

**수정 파일**

| 파일 | 변경 내용 |
|------|-----------|
| `page.tsx` | `OverdueItem` 타입 export, 초과 계산 로직 추가 (연간 plans + items 병렬 조회) |
| `inspection-plans-client.tsx` | `overdueItems` prop 추가, `OverduePanel` 컴포넌트 추가, `AlertTriangle`·`ChevronDown` import |

---

### 11-4. 미점검 초과 자동 해결 (`OverdueResolveModal`) ✅ 완료

`OverduePanel`의 `[자동 해결]` 버튼 클릭 시 모달 열림.

**모달 UI 구성**

```
헤더: YYYY년 미점검 초과 자동 해결

연간 달력 (6×2 그리드)
  주황 활성(선택 있음): 클릭 → 해당 월 전체 선택
  주황 비활성(선택 없음): 클릭 → 해당 월 전체 선택
  회색: 초과 없는 월 (비활성)
  셀에 "선택/전체 건수" 표시

월별 항목 목록
  월 헤더 체크박스 (월 전체 선택/해제)
  개별 체크박스: 건물명 / 유형 / 차수 / 담당자 / 사용승인일

[취소]  [승인 — N건 계획에 추가]  ← 주황 버튼

완료 화면: 월별 처리 결과 (추가 건수 또는 오류)
[완료 — 달력 새로고침]
```

**Server Action** `resolveOverdueItemsAction(year, items[])` (actions.ts)

```
월별 그룹화
  → inspection_plans 조회: 없으면 draft 자동 생성, 있으면 기존 planId 사용
  → inspection_plan_items INSERT
     UNIQUE 충돌(23505): 이미 등록된 항목으로 처리 (오류 무시, 성공 카운트)
  → revalidatePath('/inspection-plans')
반환: { results: Array<{ month, added, error? }> }
```

**신규/수정 파일**

| 파일 | 변경 내용 |
|------|-----------|
| `overdue-resolve-modal.tsx` | 신규 생성 |
| `actions.ts` | `resolveOverdueItemsAction` 추가 |
| `inspection-plans-client.tsx` | `OverdueResolveModal` import, `OverduePanel`에 `onResolved` prop 추가 |

---

### 11-5. 계획 상태 직접 확정 ✅ 완료

사이드바 계획 상태 배지를 액션 버튼 포함 섹션으로 교체.

**상황별 UI**

| 상황 | 표시 |
|------|------|
| 계획 없음 (관리자) | `[초안 생성]` + `[바로 확정]` 나란히 |
| 초안 상태 | 상태 배지(보라) + `[확정하기]` 초록 버튼 |
| 확정 상태 | 상태 배지(초록 ✓ 확정) + `[초안으로 변경]` 회색 버튼 |
| 취소 상태 | 상태 배지만 표시 |
| employee 역할 | 버튼 미표시 |

**"바로 확정" 흐름**

```
handleCreateConfirm()
  → createInspectionPlanAction({ year, month })  → planId
  → updatePlanStatusAction(planId, 'confirmed')
  → router.push(...)  → 페이지 새로고침
```

**수정 파일**

| 파일 | 변경 내용 |
|------|-----------|
| `inspection-plans-client.tsx` | `updatePlanStatusAction` import 추가, `handleCreateConfirm`·`handleConfirmPlan`·`handleRevertDraft` 핸들러 추가, 사이드바 상태 섹션 교체 |

---

### 11-6. 점검 시작 버튼 ✅ 완료

`startInspectionAction` + `PlanItemSlidePanel` 버튼 + ListView 액션 컬럼.

**시작 조건**

| 조건 | 충족 시 | 미충족 시 |
|------|---------|-----------|
| 담당직원 배정 | ✅ 초록 체크 | ⚠️ 주황 경고 |
| 점검 예정일 설정 | ✅ 초록 체크 | ⚠️ 주황 경고 |
| inspection_id 없음 | — | 버튼 대신 "점검 보기" 링크 |
| 취소 상태 아님 | — | 버튼 미표시 |

**`PlanItemSlidePanel` 변경**

- 조건 충족 → `[▶ 점검 시작]` 검정 버튼 활성화, 클릭 시 `/inspections/{id}`로 이동
- 조건 미충족 → 회색 비활성 버튼 + 체크리스트(담당직원/예정일 상태 표시)
- 이미 시작됨 → `[점검 보기]` 초록 버튼 (`Link href=/inspections/{id}`)

**ListView 액션 컬럼 추가**

| 상태 | 표시 |
|------|------|
| 미시작 + 조건 충족 | `[▶ 시작]` 검정 버튼 → `startInspectionAction` 직접 호출 후 이동 |
| 이미 시작됨 | `[점검 보기 →]` 초록 링크 → `/inspections/{inspection_id}` |
| 미시작 + 조건 미충족 | 빈 셀 (행 클릭 → 패널에서 설정 필요) |

**클릭 이벤트 격리**: 액션 버튼 클릭 시 `e.stopPropagation()` → 슬라이드 패널 열림 방지

**수정 파일**

| 파일 | 변경 내용 |
|------|-----------|
| `plan-item-slide-panel.tsx` | `Link`, `ExternalLink`, `CheckCircle2`, `AlertCircle` import 추가, 버튼 영역 리팩토링 |
| `inspection-plans-client.tsx` | `startInspectionAction`, `PlayCircle`, `ExternalLink`, `Link` import 추가, `handleStartItem` 핸들러, ListView `onStart`/`isPending` prop |

---

## 12. 공휴일 관리 (2026-07)

### 12-1. 국가공휴일 자동 동기화 ✅ 완료

기존에는 관리자가 `/admin/holidays` 화면에서 연도별로 수동 동기화해야 했다.
Vercel Cron을 활용해 **매년 1월 1일 · 12월 1일** 자동으로 올해·내년 공휴일을 DB에 upsert한다.

**동작 타이밍**

| 스케줄 | 동기화 대상 | 용도 |
|--------|------------|------|
| 매년 1월 1일 00:00 UTC (09:00 KST) | 올해 + 내년 | 새해 시작 시 당해 연도 확정 |
| 매년 12월 1일 00:00 UTC (09:00 KST) | 올해 + 내년 | 다음 해 데이터 선행 로드 |

**공유 유틸 분리**: `getKoreanHolidays(year)` 함수를 `src/lib/holidays.ts`로 추출하여 Server Action과 Cron Route 양쪽에서 재사용.

처리 내용 (기존 동일):
- `date-holidays` 패키지로 대한민국 법정 공휴일 조회
- 설날 라이브러리 버그 보정 (전날부터 3일 연휴)
- 공휴일이 토·일이면 대체공휴일(다음 평일) 자동 생성
- `holidays` 테이블에 `ON CONFLICT(date) DO UPDATE` upsert → 중복 없음

수동 테스트: `GET /api/cron/sync-holidays?year=2027` (Authorization: Bearer {CRON_SECRET})

**신규/수정 파일**

| 파일 | 변경 내용 |
|------|-----------|
| `src/lib/holidays.ts` | 신규 — `getKoreanHolidays(year)` 공유 유틸 |
| `src/app/api/cron/sync-holidays/route.ts` | 신규 — 자동 동기화 cron API |
| `vercel.json` | cron 2개 추가 (`0 0 1 1 *`, `0 0 1 12 *`) |
| `src/app/(dashboard)/admin/holidays/actions.ts` | 중복 함수 제거 → `@/lib/holidays` import |
| `src/components/admin/holidays-manager.tsx` | 자동 동기화 일정 안내 문구 추가 |

---

### 12-2. 회사 자체 휴무일 — 영업일 계산 반영 ✅ 확인 완료

관리자가 `/admin/holidays`에서 추가한 자체 휴무일(`is_national = false`)은
**추가 수정 없이 이미 영업일 계산에서 제외**된다.

**확인 포인트**

| 계산 경로 | 코드 위치 | 필터 여부 |
|-----------|-----------|-----------|
| DB 트리거 `add_working_days` | `002_fire_safety.sql:43` | `is_national` 조건 없음 — 테이블 전체 참조 |
| 프론트엔드 날짜 제안 | `inspection-plans/page.tsx:139-144` | `is_national` 조건 없음 — 전체 로드 |
| 점검계획 자동 배분 | `auto-generate-wizard.tsx` | `holidaySet`에 자체 휴무일 포함 |

`is_national` 필드는 관리 UI의 뱃지 표시(국가공휴일 / 자체휴무)에만 사용된다.

---

## 13. 차수(1차/2차) 용어 근거

### 13-1. 법적 배경

차수(`sequence_num`)는 **소방시설법에 따른 연간 점검 횟수 의무**를 기반으로 설계되었다.

| 점검유형 | 연간 횟수 | 사용 차수 |
|--------|---------|---------|
| **종합** | 연 2회 | 1차 · 2차 모두 사용 |
| **최초** | 연 1회 | 1차만 사용 |
| **기타** | 연 1회 | 1차만 사용 |

> 출처: `inspection_goal.md` — "점검유형별 연간 점검 횟수 자동 적용"

### 13-2. DB 설계 근거

**`supabase/migrations/002_fire_safety.sql`**

```sql
sequence_num  SMALLINT  NOT NULL DEFAULT 1
              CHECK (sequence_num IN (1, 2)),
UNIQUE (customer_id, year, sequence_num)

-- sequence_num=2 는 종합 점검만 허용 (트리거)
IF NEW.sequence_num = 2 AND NEW.inspection_type <> '종합' THEN
  RAISE EXCEPTION 'sequence_num=2 는 종합 점검 유형에만 허용됩니다';
```

- `sequence_num`은 1 또는 2만 허용
- 동일 고객·연도·차수 중복 방지 (`UNIQUE` 제약)
- **종합 이외(최초·기타) 고객에게 2차를 배정하면 DB가 거부**

### 13-3. 2차 점검 월 계산 규칙

**`inspection-plans/actions.ts:379`**

```
2차 점검 월 = 사용승인일 월 + 6개월
```

예시 — 사용승인일이 3월인 경우:
- 1차 점검: 3월
- 2차 점검: 9월 (3 + 6)

월이 12를 초과하면 다음 해로 넘어간다 (`wraps` 플래그로 처리).

### 13-4. UI 표현 규칙

- 점검계획등록 항목 추가 모달: 종합일 때만 차수 선택 `[1차 ▼ / 2차]` 활성화, 최초·기타는 1차 고정
- 미점검 초과 경보(`OverduePanel`): 1차·2차 각각 독립적으로 초과 판정
- `Victory4.md:280` — "종합 고객 연 2회 | 1차·2차 모두 같은 월 배치 불가 (최소 30일 간격 권장)"

---

## 14. 스마트 일정 제안 UX 개선 (2026-07)

### 14-1. 버그 수정 — 최초·기타의 2차 제안 제외 ✅ 완료

**파일**: `inspection-plans/actions.ts` (`getSuggestedItemsAction`)

**문제**: 2차 제안 조건에 inspection_type 구분이 없어 최초·기타 고객도 2차로 제안됨.
DB 트리거는 최초·기타의 sequence_num=2 삽입을 막지만, UI에서 잘못된 항목이 표시되었음.

**수정**:
```typescript
// Before
if (approvalMonth === secondMonth && !existingKeys.has(`${c.id}-2`)) { ... }

// After
if (c.inspection_type === '종합' && approvalMonth === secondMonth && !existingKeys.has(`${c.id}-2`)) { ... }
```

reason 텍스트도 유형에 따라 구분:
- 종합: `→ 1차 점검`
- 최초·기타: `→ 연 1회 점검`

### 14-2. UI 표현 개선 ✅ 완료

**파일**: `smart-suggest-modal.tsx`

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| 서브타이틀 | 사용승인일 기준 1차·2차 점검 대상 | 사용승인일 기준 점검 일정 자동 제안 |
| 1차 그룹 헤더 | 1차 점검 — 사용승인일 N월 고객 | 사용승인월 N월 고객 — 종합 1차 / 최초·기타 연1회 |
| 차수 뱃지 (종합) | "1차" / "2차" (주황) | "1차" / "2차" (주황) — 유지 |
| 차수 뱃지 (최초·기타) | "1차" (주황) — 오인 가능 | **"연1회"** (초록 `bg-emerald-50`) |
| 통계 라벨 | 1차 N건 / 2차 N건 | 이번달 N건 / 종합 2차 N건 |

---

## 15. 점검예정일 미니 달력 팝업 (2026-07)

**파일**: `inspection-plans-client.tsx` (`InlineDateCell` 컴포넌트 전체 교체)

### 15-1. 문제

- `<input type="date">` 네이티브 달력: 브라우저가 현재 월을 기준으로 열려 계획 월로 이동해야 함
- 날짜 미설정 항목의 기본값이 `today`라 계획 월(미래)과 다를 경우 틀린 월이 표시됨

### 15-2. 해결 — 미니 달력 팝업 ✅ 완료

날짜 셀 클릭 → **해당 계획 월만 표시하는 커스텀 달력 팝업** 표시.

**새 동작**:
- 날짜 클릭 1번 → 즉시 저장 (저장 버튼 없음)
- 주말: 일요일 빨강, 토요일 파랑
- 공휴일: 빨강 표시 (`holidays[]` prop 활용)
- 오늘 날짜: 보라 테두리 강조
- 현재 선택된 날짜: 보라 배경 강조
- "지우기" 버튼으로 날짜 삭제
- 팝업 외부 클릭 시 닫힘 (`mousedown` 이벤트)

**Props 체인 추가**:

```
InspectionPlansClient (viewYear, viewMonth, holidays)
  └─ ListView (planYear, planMonth, holidays) ← 신규 추가
       └─ InlineDateCell (planYear, planMonth, holidays) ← 신규 추가
```

---

## 16. 연/월 빠른 선택 팝업 (2026-07)

### 16-1. 문제

월 네비게이션(`< 2026년 7월 >`)이 화살표만 있어 먼 달(예: 현재 7월 → 2027년 1월)까지 6번 클릭 필요.

### 16-2. 해결 ✅ 완료

**연도·월 텍스트를 클릭 가능한 버튼**으로 교체. 클릭 시 연/월 선택 팝업 표시.

**팝업 구조**:
```
[ < ]  2026년  [ > ]      ← 연도 이동
 1월  2월  3월  4월
 5월  6월  7월  8월       ← 현재 월 보라색 강조
 9월 10월 11월 12월
```

---

## 17. SMS 발송 — 발신번호 설정 및 수신번호 자동 조회 (2026-07)

### 17-1. 현황 분석

기존 `saveSmsAction`은 DB에 발송 의도만 기록하고 **실제 SMS를 전송하지 않음**.
- 외부 SMS API 미연동
- 발신번호 없음
- 수신번호(`customer_contacts.phone`) 쿼리 미포함

### 17-2. 구현 내용 ✅ 완료

#### 발신번호 설정

`.env.local`에 환경변수 추가:
```
NEXT_PUBLIC_SMS_SENDER_PHONE=010-0000-0000
```
- 실제 발신번호로 변경 필요 (SMS 제공업체에 사전 등록 필요)
- 클라이언트에서 `process.env.NEXT_PUBLIC_SMS_SENDER_PHONE`으로 읽음

#### 수신번호 자동 조회 (`customer_contacts` 조인)

`getMonitorItemsAction` 및 `monitor/page.tsx` 초기 쿼리에 중첩 조인 추가:
```ts
customers:customer_id (
  customer_name, customer_code, address,
  customer_contacts ( role, name, phone )   // ← 추가
),
contacts:contact_id ( role, name, phone ),  // 계획항목 지정 관계인
```

수신번호 우선순위 (`pickContact` 함수):
```
1순위: plan_item.contact_id (점검계획 지정 관계인)
2순위: customer_contacts[role='대표']
3순위: customer_contacts[role='직원1']
4순위: customer_contacts[role='직원2']
```

#### SMS 모달 개선

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| 발신번호 | 표시 없음 | 보라색 배지로 상단 표시 |
| 수신자 목록 | 고객명만 표시 | 고객명 + 관계인 역할 + 전화번호 + 이름 |
| 연락처 없는 경우 | 구분 없음 | 빨간 배경 강조 + 건수 표시 |
| 발송 버튼 | "발송" | "발송 기록 저장 (N건)" — 실제 전송 건수 명시 |

#### DB 마이그레이션 (029_sms_recipients.sql)

`inspection_status_log` 테이블에 컬럼 추가:
```sql
ALTER TABLE inspection_status_log
  ADD COLUMN IF NOT EXISTS sms_sender_phone TEXT,
  ADD COLUMN IF NOT EXISTS sms_recipients   JSONB;  -- [{role, name, phone}]
```

### 17-3. 실제 SMS 전송을 위한 추가 작업 (미구현)

실제 문자 전송은 SMS API 제공업체 연동이 필요:
- 추천: **솔라피(CoolSMS)** — Node.js SDK 제공, 건당 ~8~20원
- 필요한 것: API Key / API Secret (솔라피 가입 후 발급)
- 연동 시 `saveSmsAction`에서 솔라피 SDK 호출 → 수신번호로 전송 → 결과 DB 저장
- 월 클릭 → 즉시 해당 월로 이동
- 팝업 외부 클릭 시 닫힘

**적용 파일 4개**:

| 파일 | 화면 | 상태 특이사항 |
|------|------|-------------|
| `inspection-plans-client.tsx` | 월간 점검계획 | `viewYear`/`viewMonth` + `router.push` |
| `monitor-client.tsx` | 점검현황 모니터링 | `yearMonth` 문자열 (`"2026-07"`) |
| `report-status-client.tsx` | 점검보고서 제출현황 | `yearMonth` 문자열 (`"2026-07"`) |
| `schedules-client.tsx` | My 일정 캘린더 | `month` 0-indexed, 팝업 가운데 정렬 |

---

## 17. 취소(cancelled) 상태 및 슬라이드 패널

### 17-1. 슬라이드 패널 위치 및 열기

**파일**: `plan-item-slide-panel.tsx`

```css
.panel { fixed right-0 top-0 h-full w-80 /* 320px */ z-50 }
.overlay { fixed inset-0 bg-black/20 z-40 }
```

| 동작 | 방법 |
|------|------|
| 열기 | 목록 행(row) 아무 곳 클릭 (체크박스·점검 시작 버튼 제외) |
| 닫기 | 패널 바깥 어두운 오버레이 클릭 |

**슬라이드 패널에서 가능한 작업**:
- 점검예정일 변경
- 담당직원 변경
- 상태 변경 (계획중 → 확정 → 취소 등)
- 메모 입력
- 점검 시작 (조건 충족 시)

### 17-2. 취소(cancelled) 상태 사용 시점

**취소 상태로 변경 조건**:
- `canManage` (manager/admin) 권한 필요
- 슬라이드 패널 > 상태 드롭다운에서 변경

**취소 가능 상태**:

| 현재 상태 | 취소 가능 여부 |
|-----------|--------------|
| 계획 (planned) | ✅ 가능 |
| 확정 (confirmed) | ✅ 가능 |
| 완료 (completed) | ✅ UI상 가능 |
| 취소 (cancelled) | — 이미 취소됨 |

**실무 사용 케이스**:

| 상황 | 설명 |
|------|------|
| 고객이 점검 거부 | 건물주가 이번 달 점검 불가 통보 |
| 점검 일정 연기 | 다음 달로 미루면서 이번 달 항목 취소 |
| 잘못 등록된 항목 | 삭제 대신 취소 처리 |
| 폐업·계약 종료 | 해당 월 점검 불필요 |

> ⚠️ `inspection_id`가 연결된 항목(점검이 시작된 항목)을 취소해도 `inspections` 레코드는 별도로 유지됨. 계획 항목 상태만 변경됨.

**취소 항목의 효과**:

| 항목 | 효과 |
|------|------|
| 일괄 확정 체크박스 | 비활성 (선택 불가) |
| 점검 시작 버튼 | 숨김 |
| 미점검 초과 경보 | 집계에서 제외 |
| 스마트 일정 제안 | 취소 항목은 "등록됨"으로 보지 않음 → 재제안 가능 |
| 취소 탭 필터 | 목록 상단 [취소] 탭에서 이번 달 취소 항목 일괄 확인 |
