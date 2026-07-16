# Google 연동 설정 — sjfirekorea@gmail.com (2026-07-15)

목적: ERP의 **회사 메일 조회 페이지**(전 직원) + **Drive 야간 백업**(소방계획서·보고서 버킷 미러) 활성화.
사용자 작업 약 15분 + 토큰 발급 2분.

## 1단계. Google Cloud 프로젝트 (5분)

1. **https://console.cloud.google.com** 접속 → **sjfirekorea@gmail.com으로 로그인**
2. 상단 프로젝트 선택 → [새 프로젝트] → 이름 `sjfire-erp` → 만들기
3. 만든 프로젝트가 선택된 상태인지 확인

## 2단계. API 활성화 (2분)

1. 좌측 메뉴 → **API 및 서비스 → 라이브러리**
2. **Gmail API** 검색 → [사용 설정]
3. **Google Drive API** 검색 → [사용 설정]

## 3단계. OAuth 동의 화면 (3분)

1. API 및 서비스 → **OAuth 동의 화면**
2. User Type: **외부(External)** → 만들기
3. 앱 이름 `sjfire-erp`, 사용자 지원 이메일 `sjfirekorea@gmail.com`, 개발자 연락처 동일 → 저장
4. 범위(Scope): 건너뛰어도 됨 (스크립트가 요청)
5. **테스트 사용자**: [+ ADD USERS] → `sjfirekorea@gmail.com` 추가 ← **중요! 빠뜨리면 동의 단계에서 차단됨**
6. 게시 상태는 일단 "테스트"로 진행
   > ⚠️ 구글 정책: 외부(External) + 테스트 상태 앱의 refresh token은 **7일 후 만료**됩니다.
   > 검증(1주일)에는 충분하지만 장기 운영은 아래 중 택1이 필요합니다:
   > - **권장: Google Workspace 도입 후 User Type을 "내부(Internal)"로 전환** — 토큰 무만료·검증 불필요
   >   (fire@sjfire.co.kr 계획과 결합, 절차: 구글workspace-가입절차.md)
   > - 무료 Gmail 유지: Drive 백업은 앱 게시로 유지 가능하나 Gmail 스코프는 구글 보안 검증 대상 —
   >   메일 조회를 IMAP(앱 비밀번호) 방식으로 재작업 필요

## 4단계. OAuth 클라이언트 생성 (2분)

1. API 및 서비스 → **사용자 인증 정보** → [+ 사용자 인증 정보 만들기] → **OAuth 클라이언트 ID**
2. 애플리케이션 유형: **웹 애플리케이션**
3. 이름: `sjfire-erp-oauth`
4. **승인된 리디렉션 URI**: `http://localhost:8756/callback` ← 정확히 이 값
5. 만들기 → **클라이언트 ID / 클라이언트 보안 비밀** 두 값을 복사해 둠

## 5단계. Refresh Token 발급 (2분 — 개발 PC에서)

PowerShell:
```powershell
cd F:\AI\ERP\erp
node scripts/google-oauth-setup.mjs <클라이언트ID> <클라이언트보안비밀>
```
1. 출력된 URL을 브라우저에서 열기 → **sjfirekorea@gmail.com** 로그인
2. "확인되지 않은 앱" 경고가 나오면 [고급] → [sjfire-erp(안전하지 않음)로 이동] (자체 앱이라 정상)
3. Gmail 읽기 + Drive 파일 권한 동의
4. 터미널에 출력된 **환경변수 3줄**을 복사

## 6단계. 환경변수 등록

발급된 3줄을 Claude에게 전달하거나 직접 등록:

- **로컬/스테이징 테스트**: `erp/.env.local`에 추가
- **스테이징 서버**: `/home/ubuntu/woni-staging/erp/.env.staging`에 추가 후 컨테이너 재시작
- **운영 서버**: `/home/ubuntu/woni/erp/.env.production`에 추가 후 재배포
  (⚠️ env 파일 마지막 줄 개행 확인 — 이전에 append 사고 있었음)

## 7단계. 동작 확인

1. ERP 사이드바 My Page → **회사 메일** → 받은편지함 목록 표시 확인
2. Drive 백업 수동 발화:
   ```
   curl -H "Authorization: Bearer {CRON_SECRET}" https://staging.sjfire.co.kr/api/cron/drive-backup
   ```
   → Drive에 `ERP백업/fire-plans/...` 폴더 생성 확인
3. 운영 VPS 크론 등록(매일 03:30 KST)은 확인 후 Claude가 진행

## 구성 요약

| 기능 | 스코프 | 비고 |
|---|---|---|
| 회사 메일 조회 | gmail.readonly | 전 직원, 읽기 전용 (삭제·발신 불가) |
| Drive 백업 | drive.file | 앱이 만든 파일만 접근 — 기존 Drive 파일은 못 봄(안전) |

문제 발생 시 화면 캡처와 함께 Claude에게 문의.
