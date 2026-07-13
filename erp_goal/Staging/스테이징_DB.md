# 스테이징 서버 & DB 구성 (2026-07-13 구축 완료)

> 목적: 로컬·프로덕션이 같은 Supabase DB를 공유하며 테스트 데이터가 운영에 섞이던 문제 해결.
> 추가 비용 0원 (Supabase free tier + 기존 VPS 공유).

## 1. 구성 개요

| 구분 | 프로덕션 | 스테이징 |
|------|---------|---------|
| URL | https://sjfire.co.kr | https://staging.sjfire.co.kr |
| Supabase 프로젝트 | `ryuozdhnilfjlahorizh` | `nwflnzugwylhpdyodyog` (ap-southeast-2, free) |
| 서버 | 가비아 VPS (121.78.123.230) | **같은 VPS**, 별도 컨테이너 |
| 체크아웃 | `/home/ubuntu/woni` (main) | `/home/ubuntu/woni-staging` (**staging 브랜치**) |
| 컨테이너 | erp-app-1 | erp-staging-app (프로덕션 네트워크 erp_default 합류) |
| 프록시 | Caddy (erp-caddy-1) | 같은 Caddy — `deploy/Caddyfile`의 staging vhost |
| 환경파일 | `erp/.env.production` | `erp/.env.staging` (+ 빌드용으로 `.env.production`에 동일 내용 복사) |
| 크론 | /etc/cron.d/sjfire-erp 4종 | 미등록 (의도 — 오발송 방지) |
| 메일(RESEND) | 활성 | **키 비움** (스테이징에서 실제 메일 발송 차단) |

## 2. 스테이징 DB 상태

- 마이그레이션 **001~055 전체 적용됨**
  - ⚠ 신규 DB에 처음부터 적용할 때 **030·031은 034(enum '작동' 추가) 이후에** 적용해야 함 (히스토리상 034가 먼저였음)
- Edge Functions 3개 배포 (create-inspection / add-defect / update-defect-photo), verify_jwt ON, `SB_SERVICE_KEY` 시크릿 설정
- 기초 데이터: 공휴일 22건 + 회사 프로필 복사, 고객 0건
- 관리자 계정: `staging-admin@sjfire.co.kr`
  - 비밀번호는 **공개 저장소인 이 문서에 기재하지 않음** — 구축 세션에서 전달됨. 분실 시 Supabase 대시보드(Authentication)에서 재설정

## 3. 배포 플로우

```
로컬 개발 (erp/.env.local = 스테이징 DB)
   ↓ git push origin staging
스테이징 검증: ssh 접속 후
   cd /home/ubuntu/woni-staging && git pull
   cd erp && cp .env.staging .env.production   # Next 빌드가 .env.production을 읽음
   sudo docker compose -f docker-compose.staging.yml up -d --build
   ↓ 검증 통과
main merge → 프로덕션 배포 (기존 방식: woni pull + docker-compose.prod.yml up -d --build)
```

- **DB 마이그레이션도 같은 순서**: 스테이징 먼저 → 검증 → 프로덕션
  - 스테이징 적용: `node scripts/_apply-sql-staging.mjs <파일>` (일괄: `_apply-migrations-staging.mjs`)
  - 프로덕션 적용: `node scripts/_apply-sql.mjs <파일>`
  - 토큰: `%TEMP%\sbtok.txt` (자격증명관리자 'Supabase CLI:supabase'에서 추출)

## 4. 로컬 개발환경

- `erp/.env.local`은 **스테이징 DB**를 가리킴 (2026-07-13 전환)
- 운영 키 백업: `erp/.env.local.prod-backup` — 운영 DB 대상 스크립트(check-plan-invariants 등)를 돌릴 땐 임시 스왑 후 원복할 것
- victory_test·시나리오 테스트(FIRE-S1 등)는 전부 .env.local을 읽으므로 수정 없이 스테이징 대상으로 동작

## 5. 주의사항

- **프로덕션 빌드와 스테이징 빌드 동시 실행 금지** — VPS 램 4GB(스왑 2GB)
- Supabase **free 프로젝트는 1주 미사용 시 일시정지** — 오래 안 쓰면 대시보드에서 깨울 것
- `.env.staging`·`.env.production`은 커밋 금지 (`.gitignore`의 `.env*`로 차단됨) — repo가 public이므로 특히 주의
- 스테이징 vhost에는 `X-Robots-Tag: noindex` 적용됨 (검색엔진 차단)
- 스테이징 데이터는 소모품 — 필요 시 초기화하고 `scripts/_staging-bootstrap.mjs`로 재시드 가능

## 6. 구축 이력 (2026-07-13)

1. Management API로 스테이징 프로젝트 생성 (조직 dvsteiqdjgfdqezrwcgo)
2. 마이그레이션 55개 일괄 적용 (030·031 순서 이슈 해결)
3. Edge Functions 배포 + verify_jwt 정렬 + 시크릿 설정
4. 관리자 계정·공휴일·회사프로필 부트스트랩 (`_staging-bootstrap.mjs`)
5. VPS: woni-staging 클론(staging 브랜치), .env.staging 배치, Caddy vhost 추가·리로드, 컨테이너 빌드·기동
6. 로컬 .env.local 스테이징 전환 (운영 백업 생성)
7. 잔여 작업: **가비아 DNS(dns.gabia.com)에 A레코드 `staging` → 121.78.123.230 추가** — 추가 시 Caddy가 인증서 자동 발급
