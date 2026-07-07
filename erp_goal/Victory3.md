# 승진소방 ERP 시스템 — 현황 정리 v3

> 최종 업데이트: 2026-06-25
> 기준 문서: Victory.md · erpsystem.md · inspection_goal.md · checklist.json · inspection_checklist.json · **소방업무 유지보수 시스템은 소화.docx**

---

## 1. 프로젝트 개요

소방업체 사내 업무 효율화를 위한 웹 기반 통합 ERP 시스템.
소화·경보·피난 등 소방시설법에 따른 건물 내 소방설비의 점검 이력, 예방 정비, 법정 보고서 제출을 전산화하여 체계적으로 관리한다.

**핵심 기능 영역**

| 영역 | 설명 | 구현 상태 |
|------|------|-----------|
| 기본 ERP | 인증·전자결재·휴가·관리자 | ✅ 완료 |
| 소방 점검 모듈 | 고객 등록 → 점검 배정 → 7단계 워크플로우 → 보고서 | ✅ 완료 |
| My Page | 일정·ToDo·주소록·쪽지·노트·녹음메모 | 🔲 미착수 |
| 소방안전관리 확장 | 건물등록·점검표·이행계획서·청구서·세금계산서 | 🔲 미착수 |
| 영업·구매·재고 | 견적·수주·발주·품목·재고현황 | 🔲 미착수 |
| 회계관리 | 전표·손익계산서·재무상태표·부가가치세 | 🔲 미착수 |
| 인사급여 | 사원·급여·연차·증명서 | 🔲 미착수 (일부 겹침) |
| 차량관리 | 차량등록·운행일지 | 🔲 미착수 |
| 모바일 현장 점검 | AI 음성 입력·불량사진 등록·현장 점검결과 입력 | 🔲 미착수 |

---

## 2. 기술 스택

| 항목 | 내용 |
|------|------|
| 프레임워크 | Next.js 16.2.9 (App Router, Turbopack) |
| 데이터베이스 | Supabase (PostgreSQL + RLS) |
| 인증 | Supabase Auth (이메일/비밀번호) |
| 달력 UI | react-big-calendar + date-fns (ko locale) |
| 공휴일 데이터 | date-holidays (KR) |
| 디자인 시스템 | ClickUp 토큰 기반 (#7b68ee brand violet) |
| 접근 권한 | RLS + 미들웨어 RBAC (employee / manager / admin) |

---

## 3. 구현 완료 현황 (Phase 1~8 ✅)

### 기본 ERP

| 카테고리 | 주요 내용 |
|----------|-----------|
| 사용자 인증 | 로그인/로그아웃, RBAC 미들웨어, 로그인 실패 제한·계정 잠금 |
| 전자 기안서 | 작성·첨부파일·결재선 지정, 순차 결재(승인/반려/회수), 인앱 알림 |
| 휴가 신청 | 연차/반차/병가/특별휴가, 팀장→관리자 2단계 승인, 잔여일수 자동 계산 |
| 휴가 달력 | react-big-calendar, 직원별 색상 구분, 월간/주간 뷰 |
| 대시보드 | 미결재 문서·내 휴가 현황·마감임박·기한초과·점검현황 위젯 |
| 관리자 | 직원 계정·역할 관리, 부서 관리, 활동 로그 조회 |

### 소방 점검 모듈

| Phase | 내용 | 상태 |
|-------|------|------|
| Phase 1 | DB 마이그레이션 (002_fire_safety.sql + 003_customer_assignee.sql) | ✅ |
| Phase 2 | TypeScript 타입 정의 (6개 테이블 + enum 유니온) | ✅ |
| Phase 3 | 고객 관리 (목록·등록·상세·담당직원 배정·관계인 수정·기본정보 편집) | ✅ |
| Phase 4 | 점검 업무 (목록·등록·상세·7단계 체크리스트) | ✅ |
| Phase 5 | Outlook 달력 계획표 (/inspections/calendar) | ✅ |
| Phase 6 | 보고서 첨부 기능 (Supabase Storage, 3종) | ✅ |
| Phase 7 | 대시보드 위젯 통합 | ✅ |
| Phase 8 | 공휴일 관리 (국가공휴일 자동 동기화 + 자체 휴무일) | ✅ |

---

## 4. 목표 시스템 전체 메뉴 구조 (docx 기준)

> ✅ = 구현 완료 · 🔲 = 미착수

### My Page
| 메뉴 | 설명 | 상태 |
|------|------|------|
| 일정 등록 | 개인/그룹 소방 점검·유지보수 스케줄 관리 | 🔲 |
| ToDo 등록 | 오늘 처리할 업무 체크리스트 | 🔲 |
| 주소록 등록 | 고객사·협력업체 담당자 연락처 | 🔲 |
| 녹음메모장 | 현장 점검 음성 메모 + 텍스트 연동 | 🔲 |
| 노트 등록 | 점검결과·보수내역 기록지 (게시판형) | 🔲 |
| 쪽지 | 직원 간 사내 메시지 | 🔲 |
| 나의결재 Sign 등록 | 전자서명 첨부 결재 문서 | 🔲 |

### 전자결재
| 메뉴 | 상태 |
|------|------|
| 문서 기안 등록 | ✅ |
| 결재할 문서 | ✅ |
| 결재한 문서 | ✅ |
| 결재중 문서 | ✅ |
| 승인된 문서 | ✅ |
| 반려된 문서 | ✅ |
| 임시보관함 | ✅ |

### 업무관리
| 메뉴 | 상태 |
|------|------|
| 업무지시 등록 | 🔲 |
| 업무(계획) 일지 | 🔲 |

### 소방안전관리
| 메뉴 | 설명 | 상태 |
|------|------|------|
| 고객 등록 | 고객코드·고객명·계약일·점검유형 | ✅ |
| 건물 등록 | 고객별 건물 정보 (면적·층수·용도 등) | 🔲 |
| 문의요청 등록 | 고객 AS 및 문의 접수 | 🔲 |
| 점검계획 등록 | 월간 점검계획 수립 (자동 생성) | 🔲 |
| 점검표 등록 | 점검 체크리스트 양식 관리 | 🔲 |
| 점검결과 등록 | 현장 점검결과 입력 (불량내역·사진) | 부분 (7단계) |
| 점검보고서 등록 | 법정 보고서 생성·제출 | ✅ |
| 이행계획서 등록 | 불량내역 기반 이행계획 자동 생성·제출 | 🔲 |
| 이행완료보고서 등록 | 이행완료 확인 보고서 생성·제출 | ✅ (step 7) |
| 청구서 등록 | 점검완료 후 청구서 생성·관리 | 🔲 |
| 전자세금계산서 발행 | 청구서 기반 세금계산서 발행 | 🔲 |

### 영업관리
| 메뉴 | 상태 |
|------|------|
| 견적 등록 | 🔲 |
| 수주 등록 | 🔲 |

### 구매관리
| 메뉴 | 상태 |
|------|------|
| 발주 등록 | 🔲 |
| 품목 등록 | 🔲 |
| 분류 등록 | 🔲 |

### 재고관리
| 메뉴 | 상태 |
|------|------|
| 입고 등록 | 🔲 |
| 출고 등록 | 🔲 |
| 재고 현황 | 🔲 |
| 재고 조정 | 🔲 |

### 회계관리
| 메뉴 | 상태 |
|------|------|
| 전표 등록 | 🔲 |
| 손익계산서 | 🔲 |
| 재무상태표 | 🔲 |
| 부가가치세 현황 | 🔲 |

### 인사급여관리
| 메뉴 | 설명 | 상태 |
|------|------|------|
| 사원 등록 | 직원 계정·정보 관리 | ✅ (admin/users) |
| 사용자권한 등록 | 역할 기반 권한 설정 | ✅ |
| 증명서 발급 | 재직증명서 등 | 🔲 |
| 근무달력 등록 | 근무일/휴일 설정 | ✅ (admin/holidays) |
| 급여 등록 | 급여 계산·지급 관리 | 🔲 |
| 연차 등록 | 연차 생성·사용현황 | ✅ (leaves) |

### 차량관리
| 메뉴 | 상태 |
|------|------|
| 차량 등록 | 🔲 |
| 차량운행일지 등록 | 🔲 |

### 기초정보관리
| 메뉴 | 상태 |
|------|------|
| 거래처 등록 | 🔲 |
| 본사 등록 | 🔲 |

### Dashboard (경영정보 모니터링)
| 위젯 | 상태 |
|------|------|
| 월간 점검계획 자동 생성 현황 | 🔲 |
| 점검 현황 모니터링 (상태·점검자·유형) | ✅ (일부) |
| 점검보고서 제출현황 모니터링 | 🔲 |
| 이행계획/완료 제출현황 모니터링 | 🔲 |
| 정산현황 모니터링 (회계연동) | 🔲 |
| 전자세금계산서 발행현황 모니터링 | 🔲 |
| 역할별 경영정보 (점검·회계·인사·결재) | 부분 |

### 모바일 (현장 점검)
| 기능 | 상태 |
|------|------|
| 모바일 앱 기반 현장 점검결과 입력 | 🔲 |
| AI 음성 입력 → 불량항목 자동 인식 | 🔲 |
| 스마트폰 불량시설 사진 등록 | 🔲 |
| 소방계획서 작성 | 🔲 |
| 업무수행기록표 작성 | 🔲 |
| 자체점검기록부 작성 (공동주택 세대별) | 🔲 |
| 자위소방대·교육훈련기록부 | 🔲 |
| 화재/비화재보 기록부 | 🔲 |

---

## 5. 현재 구현된 화면 목록

| 경로 | 설명 | 권한 |
|------|------|------|
| `/login` | 로그인 | 전체 |
| `/dashboard` | 메인 대시보드 | 전 직원 |
| `/documents` | 내 기안서 목록 | 전 직원 |
| `/documents/new` | 기안서 작성 | 전 직원 |
| `/documents/[id]` | 기안서 상세·결재 처리 | 전 직원 |
| `/approvals` | 결재함 | manager/admin |
| `/approvals/[id]` | 결재 처리 | manager/admin |
| `/leaves` | 휴가 신청 목록 | 전 직원 |
| `/leaves/new` | 휴가 신청서 작성 | 전 직원 |
| `/leaves/calendar` | 팀 휴가 달력 | 전 직원 |
| `/leaves/manage` | 휴가 승인 관리 | manager/admin |
| `/customers` | 고객 목록 (검색·유형 필터·담당자 표시) | 전 직원 |
| `/customers/new` | 고객 + 관계인 등록 + 담당직원 배정 | manager/admin |
| `/customers/[id]` | 고객 상세 (기본정보 편집·관계인 수정·점검 이력) | 전 직원 |
| `/inspections` | 점검 목록 (연도·상태·담당자 필터) | 전 직원 |
| `/inspections/new` | 점검 배정 폼 | manager/admin |
| `/inspections/[id]` | 점검 상세 (7단계 체크리스트 + 보고서) | 배정직원 + manager/admin |
| `/inspections/calendar` | **Outlook 달력 계획표** ★ | 전 직원 |
| `/admin` | 관리자 현황 대시보드 | admin |
| `/admin/users` | 직원 계정 관리 | admin |
| `/admin/departments` | 부서 관리 | admin |
| `/admin/logs` | 활동 로그 조회 | admin |
| `/admin/holidays` | 공휴일 관리 (국가공휴일 자동 동기화) | admin |

---

## 6. 데이터베이스 스키마

### 마이그레이션 이력

| 파일 | 내용 | 상태 |
|------|------|------|
| `001_initial.sql` | 기본 스키마 (profiles, documents, leaves, notifications, activity_logs 등) | ✅ |
| `002_fire_safety.sql` | 소방 점검 모듈 신규 테이블 6개 + 함수·트리거·RLS | ✅ |
| `003_customer_assignee.sql` | customers.assigned_employee_id 컬럼 추가 | ✅ |
| `004_storage.sql` | Supabase Storage 버킷 설정 | ✅ |

### ENUM 타입

| 타입명 | 값 |
|--------|----|
| `inspection_type` | `'종합'`, `'최초'`, `'기타'` |
| `inspection_status` | `'scheduled'`, `'in_progress'`, `'completed'`, `'overdue'` |
| `step_status` | `'pending'`, `'completed'`, `'overdue'` |
| `report_type` | `'fire_station'`, `'stakeholder'`, `'completion'` |
| `contact_role` | `'대표'`, `'직원1'`, `'직원2'` |

### 구현 완료 테이블 6개

#### holidays (공휴일)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | UUID PK | |
| date | DATE UNIQUE | |
| name | TEXT | e.g. '추석' |
| is_national | BOOLEAN | FALSE = 회사 자체 휴무 |
| year | INT GENERATED | EXTRACT(YEAR FROM date) 자동 계산 |
| created_at | TIMESTAMPTZ | |

#### customers (고객)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | UUID PK | |
| customer_code | TEXT UNIQUE | e.g. 'C-2024-001' |
| customer_name | TEXT | |
| contract_date | DATE | |
| inspection_type | inspection_type | 종합/최초/기타 |
| address | TEXT | |
| notes | TEXT | |
| is_active | BOOLEAN DEFAULT true | |
| assigned_employee_id | UUID → profiles(id) SET NULL | 고객 주담당자 ★ |
| created_by | UUID → profiles(id) | |
| created_at / updated_at | TIMESTAMPTZ | |

#### customer_contacts (관계인)
고객당 최대 3명. `UNIQUE(customer_id, role)` 강제.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | UUID PK | |
| customer_id | UUID → customers(id) CASCADE | |
| role | contact_role | 대표/직원1/직원2 |
| name | TEXT | |
| phone | TEXT | |
| email | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | |

#### inspections (점검 업무)
`UNIQUE(customer_id, year, sequence_num)`

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | UUID PK | |
| customer_id | UUID → customers(id) RESTRICT | |
| contact_id | UUID → customer_contacts(id) SET NULL | |
| assigned_employee_id | UUID → profiles(id) RESTRICT | |
| inspection_type | inspection_type | |
| inspection_start_date | DATE | |
| notification_date | DATE | step 1 완료 시 기록 |
| year | INT GENERATED | 자동 계산 (직접 입력 불가) |
| sequence_num | SMALLINT DEFAULT 1 CHECK IN (1,2) | 종합: 1차/2차 |
| status | inspection_status DEFAULT 'scheduled' | |
| notes | TEXT | |
| created_by | UUID → profiles(id) | |
| created_at / updated_at | TIMESTAMPTZ | |

#### inspection_steps (업무 단계 — 7개)
점검 INSERT 시 트리거 자동 생성. `UNIQUE(inspection_id, step_num)`

| step | 업무명 | 기준일 | 기한 | 계산 |
|------|--------|--------|------|------|
| 1 | 관계인 통보 1차 | 점검시작일 | +3일 | 작업일 |
| 2 | 관계인 협의 2차 보강 | 점검시작일 | +4일 | 작업일 |
| 3 | 보고서 작성 | 점검시작일 | +9일 | 작업일 |
| 4 | 소방서 제출 | step 3 마감일 | +1일 | 작업일 |
| 5 | 공사완료 | 점검시작일 | +10일 | 달력일 |
| 6 | 이해관계자 보고서 | — | — | 마감일 없음 |
| 7 | 이행완료 보고서 제출 | — | — | 마감일 없음 |

#### inspection_reports (보고서)
`UNIQUE(inspection_id, report_type)`

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | UUID PK | |
| inspection_id | UUID → inspections(id) RESTRICT | |
| report_type | report_type | fire_station / stakeholder / completion |
| customer_code / customer_name | TEXT | 제출 시점 스냅샷 |
| submitted_at | TIMESTAMPTZ | NULL = 초안 |
| submitted_by | UUID → profiles(id) | |
| file_name / file_path / file_size / mime_type | TEXT/INT | Supabase Storage |
| notes | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | |

### DB 함수 및 트리거
| 이름 | 종류 | 역할 |
|------|------|------|
| `add_working_days(date, n)` | FUNCTION STABLE | holidays 기반 N 작업일 후 날짜 반환 |
| `create_inspection_steps()` | TRIGGER FUNCTION | inspections INSERT 시 7개 step 자동 생성 |
| `check_inspection_sequence()` | TRIGGER FUNCTION | sequence_num=2 → 종합 유형만 허용 |
| `update_updated_at()` | FUNCTION | 모든 테이블 BEFORE UPDATE 트리거 |

### RLS 정책 요약
| 테이블 | 읽기 | 쓰기 |
|--------|------|------|
| holidays | 전 직원 | admin |
| customers, customer_contacts | 전 직원 | manager/admin |
| inspections | 배정 직원 + manager/admin | INSERT·DELETE: manager/admin, UPDATE: 배정 직원 |
| inspection_steps | 배정 직원 + manager/admin | 완료 체크: 배정 직원, INSERT: 트리거(service role) |
| inspection_reports | 배정 직원 + manager/admin | 배정 직원 + manager/admin |

### 목표 테이블 (My Page — docx 기준, 미구현)

#### schedules (일정)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| user_id | UUID → profiles(id) | 작성자 |
| title | TEXT | 일정 제목 |
| content | TEXT | 상세 내용 |
| start_date | TIMESTAMPTZ | 시작 일시 |
| end_date | TIMESTAMPTZ | 종료 일시 |
| location | TEXT | 장소/건물명 |
| color | TEXT | 달력 표시 색상 |

#### todos (ToDo)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| user_id | UUID → profiles(id) | |
| task_name | TEXT | 할 일 제목 |
| due_date | DATE | 마감일 |
| priority | SMALLINT | 1=상, 2=중, 3=하 |
| status | TEXT | PENDING / IN_PROGRESS / COMPLETED |

#### address_book (주소록)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| company_name | TEXT | 회사/건물명 |
| name | TEXT | 담당자 이름 |
| phone_number | TEXT | |
| email | TEXT | |
| address | TEXT | |
| remark | TEXT | 특이사항 |

#### voice_memos (녹음메모장)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| user_id | UUID → profiles(id) | |
| title | TEXT | |
| text_content | TEXT | 텍스트 메모 |
| audio_file_path | TEXT | Supabase Storage 경로 |
| recorded_at | TIMESTAMPTZ | |

#### notes (노트)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| user_id | UUID → profiles(id) | |
| category | TEXT | 점검일지 / 보수내역 / 법정소방 |
| title | TEXT | |
| content | TEXT | HTML 또는 마크다운 |
| created_at | TIMESTAMPTZ | |

#### messages (쪽지)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| sender_id | UUID → profiles(id) | |
| receiver_id | UUID → profiles(id) | |
| title | TEXT | |
| content | TEXT | |
| is_read | BOOLEAN | |
| sent_at | TIMESTAMPTZ | |

---

## 7. Outlook 달력 계획표 (/inspections/calendar)

react-big-calendar 기반, Microsoft Outlook과 동일한 UX.

| 기능 | 설명 |
|------|------|
| 뷰 전환 | 월간(Month) / 주간(Week) / 목록(Agenda) |
| 담당자 뷰 | 직원별 색상(10색), 단계 마감일 이벤트 표시 |
| 고객 뷰 | 고객별 색상, 고객 수신·처리 단계 강조 |
| 왼쪽 필터 패널 | 뷰 토글, 직원 체크박스, 고객 검색, 점검유형·상태 필터 |
| 이벤트 스타일 | 완료: 반투명 + 체크 배지, 기한초과: 빨간 테두리 |
| 이벤트 클릭 | 슬라이드 패널 → 고객명·담당자·7단계 진행률·완료 체크 |

---

## 8. 다음 개발 우선순위 (Backlog)

### 우선순위 높음 — 소방안전관리 확장
| 항목 | 설명 |
|------|------|
| 건물 등록 | 고객별 건물 정보 (면적·층수·소방시설 목록) |
| 이행계획서 | 불량내역 기반 이행계획 자동 생성 및 제출현황 모니터링 |
| 청구서 등록 | 점검완료 건 청구서 생성·입금·미납금 현황 |
| 점검계획 자동 생성 | 전월 계획 + 근무달력 기반 월간 점검계획 자동 생성 |
| 점검결과 상세 입력 | 불량내역·불량사진 등록 (현재 7단계 체크만 있음) |

### 우선순위 중간 — My Page
| 항목 | 설명 |
|------|------|
| 일정 관리 | 개인/그룹 스케줄, 달력 연동 |
| ToDo | 업무 체크리스트, 우선순위·상태 관리 |
| 쪽지 | 직원 간 사내 메시지 |
| 노트 | 점검일지·보수내역 기록 |
| 주소록 | 고객사·협력업체 담당자 연락처 |

### 우선순위 낮음 — 확장 모듈
| 항목 | 설명 |
|------|------|
| 모바일 반응형 UI | 현장 점검용 태블릿/스마트폰 최적화 |
| AI 음성 입력 | 음성 → 불량항목 자동 인식 |
| 전자세금계산서 | 청구서 기반 세금계산서 발행 |
| 영업관리 | 견적·수주 등록 |
| 구매·재고관리 | 소방자재 발주·재고현황 |
| 회계관리 | 전표·손익계산서·재무상태표·부가가치세 |
| 급여관리 | 사원 급여 계산·지급 |
| 차량관리 | 차량등록·운행일지 |
| 녹음메모장 | 현장 음성 메모 (Supabase Storage 연동) |
| 이메일 알림 | Resend API 연동 (키 미설정) |
| 푸시 알림 | VAPID 키 미설정 |
| 전자서명 | 결재 문서 서명 기능 |
| SSO 연동 | 단일 로그인 |


