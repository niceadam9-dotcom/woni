# Google Workspace 가입 절차 — fire@sjfire.co.kr (2026-07-15)

목표: Workspace Business Starter 1계정으로 `fire@sjfire.co.kr` 공용메일 + Drive 보관함 개설.
소요: 약 30~40분 (DNS 반영 대기 포함). 준비물: 가비아 로그인 정보, 결제 카드.

> ⚠️ 주의: sjfire.co.kr의 DNS는 **가비아 DNS 관리툴(dns.gabia.com)** 에서 관리합니다.
> 가비아 "클라우드 콘솔의 DNS"와 별개이니 반드시 dns.gabia.com 쪽에서 작업하세요.
> MX/TXT 레코드 추가는 웹사이트(sjfire.co.kr A레코드)에 영향을 주지 않습니다.

---

## 1단계. Workspace 가입 (약 10분)

1. https://workspace.google.com/ → **[무료로 시작하기]** (Business Starter, 14일 무료 체험 후 과금)
2. 입력 항목:
   - 비즈니스 이름: `승진소방이엔지`
   - 직원 수: 해당 규모 선택
   - 지역: 대한민국
3. "비즈니스에 사용할 도메인이 있나요?" → **"예, 사용할 수 있는 도메인이 있습니다"** → `sjfire.co.kr` 입력
4. 관리자 계정 만들기:
   - 사용자 이름: **`fire`** → 최종 주소 `fire@sjfire.co.kr`
   - 비밀번호: 공용 계정 규칙에 따라 대표자가 관리
5. 결제 정보 등록 (14일 체험 후 Business Starter 월 요금 — 연간 약정 시 할인)

## 2단계. 도메인 소유 확인 (약 10분 + 반영 대기)

가입 마지막에 Google이 **확인용 TXT 레코드**(`google-site-verification=...` 형태)를 보여줍니다.

1. 새 탭에서 **dns.gabia.com** 로그인 → `sjfire.co.kr` → DNS 레코드 관리
2. 레코드 추가:
   | 타입 | 호스트 | 값 | TTL |
   |---|---|---|---|
   | TXT | @ | `google-site-verification=...` (구글이 준 값 그대로) | 600 |
3. 저장 → Workspace 설정 화면으로 돌아와 **[내 도메인 확인]** 클릭
4. 반영에 수 분~1시간 걸릴 수 있음 — 실패하면 10분 후 재시도

## 3단계. MX 레코드 설정 — 메일 수신 활성화 (약 10분)

Google이 안내하는 MX 값을 dns.gabia.com에 추가합니다. 신규 가입은 아래 **1줄**이 표준입니다:

| 타입 | 호스트 | 값 | 우선순위 | TTL |
|---|---|---|---|---|
| MX | @ | `smtp.google.com.` | 1 | 3600 |

- ⚠️ 기존에 다른 MX 레코드가 있으면 **삭제** (없으면 그대로 진행)
- 설정 화면이 옛 방식(aspmx.l.google.com 등 5줄)을 안내하면 그 안내를 따르세요
- 저장 → Workspace 설정 화면에서 **[MX 확인/활성화]** 클릭

## 4단계. 발신 신뢰도 레코드 (권장 — 스팸함 방지)

메일이 상대방 스팸함에 안 가려면 아래 2개를 추가하세요:

1. **SPF** — dns.gabia.com에 TXT 추가:
   | 타입 | 호스트 | 값 |
   |---|---|---|
   | TXT | @ | `v=spf1 include:_spf.google.com ~all` |
   - ⚠️ 이미 `v=spf1 ...` TXT가 있으면 새로 만들지 말고 기존 값에 `include:_spf.google.com`만 끼워 넣기
2. **DKIM** — Workspace 관리 콘솔(admin.google.com) → 앱 → Google Workspace → Gmail → 이메일 인증(DKIM) → [새 레코드 생성] → 표시된 TXT(호스트 `google._domainkey`)를 가비아에 추가 → [인증 시작]

## 5단계. 동작 확인

1. https://mail.google.com 에 `fire@sjfire.co.kr`로 로그인
2. 개인 메일에서 `fire@sjfire.co.kr`로 테스트 발송 → 수신 확인
3. 반대로 발신도 1통 → 상대 스팸함이 아닌 받은편지함에 오는지 확인
4. https://drive.google.com 접속 → Drive 30GB 확인

## 6단계. 공용 계정 운영 규칙 (합의사항)

- 로그인 기기: 사무실 PC 1~2대로 제한 (다인 동시 로그인 시 구글 이상감지 차단 가능)
- 비밀번호: 대표자 관리, 변경 시 공유 절차 합의
- 2단계 인증: 대표자 휴대폰으로 설정 권장
- 직원 파일 접근: 계정 로그인 대신 **폴더 링크 공유(열람/편집 권한 지정)** 사용

## 7단계. 완료 후 Claude가 진행할 작업 (알려주시면 시작)

1. **Drive 폴더 구조 세팅 안내** — `ERP백업/소방계획서/{고객명}/{연도}/` 구조
2. **ERP → Drive 야간 미러 백업 크론 구현** — Google Cloud 콘솔 OAuth 클라이언트 생성 절차 안내 포함
3. **(선택) ERP 알림 메일 발신 연결** — `fire@sjfire.co.kr` SMTP (현재 ERP 메일 발송은 미설정 상태)

---

### 문제 발생 시

- 도메인 확인 실패 반복: TXT 값 앞뒤 공백/따옴표 확인, 1시간 후 재시도
- 메일 수신 안 됨: MX 반영 대기(최대 48시간이나 보통 1시간 내), `nslookup -type=mx sjfire.co.kr`로 확인
- Workspace 지원: 관리 콘솔 우측 하단 지원 문의 (한국어 지원)
