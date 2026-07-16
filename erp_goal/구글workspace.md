# Google Workspace 도입 검토 (2026-07-15)

## 1. 저장소 비교 — Google Drive / OneDrive vs Supabase Storage

현재 ERP는 소방계획서 PDF·사진·부속자료를 **Supabase Storage**(fire-plans 버킷 등)에 저장 중.

| 항목 | Supabase Storage (현행) | Google Drive API | OneDrive (MS Graph) |
|---|---|---|---|
| 앱 연동 | 이미 구현됨 — 서버 SDK로 업로드/다운로드/서명URL 한 줄 | OAuth2 + 서비스계정/공유드라이브 설정 필요, 토큰 갱신 관리 | OAuth2 + Azure 앱 등록 필요, 토큰 관리 |
| 권한 제어 | RLS + 비공개 버킷 + 5분 서명 URL — ERP 로그인과 일체 | 드라이브 자체 공유 권한 — ERP 역할과 별개로 이중 관리 | 동일한 이중 관리 문제 |
| 서버 파이프라인 | Gotenberg PDF 생성 → 바로 저장, E2E 검증 완료 | 생성 후 별도 업로드 단계 + 실패 처리 추가 | 동일 |
| 비용/용량 | Pro 요금제 100GB 포함 (현재 사용량 대비 매우 여유) | 15GB 무료, Workspace 계정이면 대용량 | 개인 5GB, M365 1TB |
| 속도·안정성 | DB와 같은 리전, API 한도 사실상 무제한 수준 | API 쿼터 제한(초당 요청 수), 429 대응 필요 | API 쿼터 제한 동일 |
| 사람이 직접 파일 탐색 | 약함 — ERP 화면을 통해서만 접근 | **강함** — 폴더 탐색·오피스 협업·모바일 앱 | 강함 — 오피스 파일 직접 편집에 유리 |
| 백업 관점 | Supabase 프로젝트에 종속 | 독립 사본 보관처로 유용 | 동일 |

**결론**: 애플리케이션 저장소는 Supabase Storage 유지가 명확히 우세. Drive/OneDrive는
① 사람이 직접 다루는 원본 작업 파일(HWP 등) 협업, ② 재해 대비 2차 백업 미러링 용도로만 적합.
"교체"가 아니라 **Supabase = 시스템 저장소, Drive = 협업·백업 보조**의 역할 분담.

## 2. Workspace 1계정 공용 운영 구성안

계정(사용자) 단위 과금이므로 공용 계정 1개(예: `office@sjfire.co.kr`)로
파일 허브 + 회사 대표 메일 운영 가능 — 소규모 조직에서 흔한 방식.

### ① 공용 메일 (`office@sjfire.co.kr`)
- 도메인 `sjfire.co.kr`을 Workspace에 연결 (가비아 DNS에 MX 레코드 추가 — 기존 웹서비스 A레코드와 공존)
- 수신: 직원들이 웹/모바일 Gmail로 공용 계정 접속
- 발신: 사람 발신 + **ERP 자동 발송 연결 가능** — 현재 ERP 이메일 알림은 미설정(RESEND 키 placeholder).
  Gmail SMTP(2단계 인증 + 앱 비밀번호)로 연결하면 점검 안내·보고서 발송 메일의 발신 주소가
  `office@sjfire.co.kr`이 됨. 발송 한도 일 2,000통 — 현재 규모 충분

### ② 공용 파일 (Drive)
- 업무 원본 파일(소방계획서 HWP, 엑셀)의 팀 공유·보관 허브 — PC에 Drive 클라이언트 설치 시 탐색기에서 바로 사용
- ERP 시스템 저장소는 Supabase 유지, Drive는 원본 협업 + (선택) ERP 버킷 야간 백업 미러링 대상

### 1계정 공용의 주의점 3가지
1. **다인 동시 로그인**: 구글이 이상 로그인으로 감지해 일시 차단 가능, 행위 추적 불가, 비밀번호 변경 시 전원 영향
   → 로그인 인원은 사무실 PC 1~2대로 최소화, 나머지 직원은 **링크 공유로 열람만**
2. **퇴사자 리스크**: 공용 비밀번호를 아는 직원 퇴사 시 즉시 변경 필요. 규모 커지면 인당 계정 전환 검토
3. **티어**: Business Starter(1인 약 ₩8,000/월) = 30GB·공유드라이브 없음.
   파일 많으면 Standard(약 ₩16,000/월, 2TB + 공유드라이브) 실용적

### 역할 분담 요약

| 용도 | 담당 |
|---|---|
| ERP 파일(계획서 PDF·사진·보고서) | Supabase Storage (현행 유지) |
| 팀 원본 파일 협업(HWP·엑셀) | Workspace 공용 계정 Drive |
| 회사 대표 메일 + ERP 발송 메일 | Workspace Gmail (`office@sjfire.co.kr`) |
| 2차 백업 (선택) | ERP 버킷 → Drive 야간 미러링 크론 |

### 도입 시 ERP 측 작업 (개발 가능 항목)
- ERP 메일 발송을 Gmail SMTP로 연결
- Supabase 버킷 → Drive 야간 백업 미러링 크론
- (Workspace 가입·DNS MX 설정은 관리자 콘솔에서 직접 수행 — 절차 안내 가능)
