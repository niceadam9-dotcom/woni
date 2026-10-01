# 승진소방 ERP → 소방점검 대행업체용 SaaS 전환 — 진단 + 단계별 로드맵

> 작성 2026-10-01 · 상태 **진단·로드맵 확정(사용자 승인)**, 구현 미착수 · 기준 커밋 `bb56b4ee`(운영 104회차)
> 수치·파일·줄 번호는 전부 이 날 실측값이다 — 인용 전 최신 트리에서 재확인할 것.

## Context

- 요청: 「saas 시스템을 만들기 위해 개선해야 할 사항을 알려줘」
- 확정(사용자 답변): **테넌트 = 다른 소방점검 대행업체** · **범위 = 소방안전관리 모듈만**(고객·점검 달력·6단계 점검·점검표·별지 9/10/11호·소방계획서·문자. 정산/세금계산서는 후순위) · **산출물 = 진단 + 단계별 로드맵**(구현 착수는 다음 턴에 별도 지시)
- 현황: 승진소방 1개 회사 전용으로 설계·운영. 운영 고객 4·스테이징 309. 개발자 1명 + AI 세션.
- 근거: Explore 에이전트 3개(DB·인증 / 앱 코드 / 인프라·운영) 전수 조사 + Plan 에이전트 설계. 수치는 전부 실측(파일·줄 병기).

## 1. 진단 — 한 줄 요약

**테넌트 개념이 어디에도 없다.** 87개 테이블 중 `company_id` 0개, RLS는 역할(employee/manager/admin)만 보고, 서버 코드 거의 전부가 RLS를 우회하는 service-role 클라이언트(`createAdminClient` 385호출/160파일 in src)를 쓴다. 회사 정체성은 `company_profile` 단일 행 + 엑셀 템플릿 안의 동결 리터럴이고, 문자·메일·크론·도메인·모바일 앱이 전부 승진소방 하나에 고정돼 있다. 인프라는 4GB VPS 한 대에서 서버 빌드·수동 마이그레이션·백업/관측/CI 없음.

## 2. 격차 목록 (코드 근거)

### A. 데이터·인증 (`erp/supabase/migrations`, `src/lib/supabase`)
| # | 격차 | 근거 |
|---|---|---|
| A1 | 테넌트 키 전무 — 87테이블 어디에도 `company_id`/`org_id` 없음 | `001_initial.sql`, `002_fire_safety.sql` 이하 151개 |
| A2 | 회사 정보가 싱글턴 — `company_profile`은 `'승진소방ENG'` 시드 1행, `.order('id').limit(1)`로 읽음(스테이징엔 이미 2행) + 설정 가방(`default_assignee_id`·`sms_lead_rules`·`default_region_*`) | `032_company_profile.sql`, `src/lib/company-profile.ts:37-54`, bare `.limit(1)` 5곳(`report9-assemble.ts:389`, `report9-actions.ts:166`, `fire-plan-generate.ts:93`, `customers/[id]/page.tsx:201`, `tax-invoices/issue/page.tsx:36`) |
| A3 | 사용자에 소속 없음 — `profiles`는 role+department뿐 | `001_initial.sql:22-37`, `045` |
| A4 | RLS 87/87 켜져 있으나 **역할만 판정** — `USING(true)` ~30개, `auth.uid() IS NOT NULL` 다수. A사 manager가 B사 데이터를 읽고 쓴다 | `002:279-321`, `039_rls_restrict_anon.sql`; `current_user_role()` 001:225 |
| A5 | service-role이 전역 — 모든 서버 액션·페이지·크론·로그인·`getProfile`. 세션 클라이언트는 17파일뿐. 모바일(Expo)은 anon+JWT로 DB 직접 → RLS가 유일한 격리 | `src/lib/supabase/admin.ts`, `customers/actions.ts`(35회), `src/lib/auth.ts` |
| A6 | 전역 유니크 키 충돌 — `customers.customer_code`, `profiles.employee_id`, `inspection_plans UNIQUE(year,month)`, `holidays.date`, `message_templates.key` PK, `building_purposes.name`, `inspection_sheets(sheet_code,version)`, `plan_text_library` 기본값, 전표/계정/품목/차량 코드 | 002:57, 001:24, 005:27, 002:20, 130:10, 049:9, 024:15, 119, 014, 041 |
| A7 | 스토리지 7버킷 경로에 회사 접두 없음·정책은 로그인 여부만. 로고/마크는 `company-assets/logo/logo.png` 고정 | `004`, `056`, `customer-assets.ts`, `inspections/[id]/page.tsx:381`, `defect-actions.ts:148` |
| A8 | Edge Function 3개 — service-role로 본문의 id를 그대로 씀(소유 검사 없음), CORS `*` | `supabase/functions/{add-defect,create-inspection,update-defect-photo}` |
| A9 | 크론 11개 — 하나의 `CRON_SECRET`, 전 행 순회, 알림은 admin/manager 전원, 생성자는 전역 `is_system` 1명(047에 개발자 이메일 하드코딩) | `src/app/api/cron/*`, `047`, `generate-monthly-bills/route.ts:32-36` |
| A10 | 초대·자가가입 없음 — 관리자가 비밀번호 지정 생성. 로그인에 워크스페이스 개념 없음 | `admin/users/actions.ts`, `login/actions.ts` |

### B. 앱 코드·문서·발신 (`erp/src`, `erp/templates`)
| # | 격차 | 근거 |
|---|---|---|
| B1 | 회사명 하드코딩 — 내용증명 `승진소방방재 (주)`, 재직증명서 `(주) 승진소방 대표`, 사이드바 폴백·SJ 모노그램 SVG, 공문 문서번호 접두 `승 진`, 소방계획서 예문 | `action-plan-status-client.tsx:111,150`, `certificates-client.tsx:92`, `sidebar.tsx:239,305`, `annex-cover-official.ts:132`, `fire-plan-anchors.ts:1982`, `fire-plan-scrub.ts:13-17`(운영사 정체성을 **의도적으로 보존**) |
| B2 | 엑셀 템플릿 동결 리터럴 — 갑지/별지 워크북 회사 칸 18개 중 4개만 DB(`㈜승진소방ENG` 4종 표기·덕평리 주소·`management_reg_no` 더미 1234567); 소방계획서 워크북 U6 업무대행 업체명(`:1184`)·J9(`:2964`)·비상연락 카드 전화(`:3505-3574`) | `xlsx-anchors.ts:260-277`, `fire-plan-xlsx-manifest.json` |
| B3 | 직인 기능 없음 — 공문은 `(직인생략)` 고정 | `official.ts:69` |
| B4 | 문자 = Solapi 계정·발신번호 1벌(env), 가드(`SMS_DRY_RUN/ALLOWLIST/MAX_PER_RUN`) 프로세스 전역 | `lib/sms.ts:62-92` |
| B5 | 메일 = 단일 Gmail OAuth(`sjfirekorea@gmail.com`) 하드코딩, `/mail` 모듈 전체가 그 받은편지함 | `lib/google.ts:3-30`, `mail/page.tsx:9,130`, `mail-compose-client.tsx:102` |
| B6 | 설정이 전역 — `message_templates` key로만 upsert, `permissions.ts` 고정 역할 맵, 지역 배정 기본 `'양평군'`, 점검표 마스터(~860항목) 전역 캐시 태그 `['sheet-catalog','items']`, 공통문구·용도·공휴일 전역 | `message-template-actions.ts:72`, `regional-assign-client.tsx:36`, `sheet-catalog.ts:93-95` |
| B7 | 라우팅·과금 없음 — `proxy.ts`는 세션+`/admin`·`/approvals` 역할만, 호스트/서브도메인/조직 로직 0; 과금·미터링·기능 플래그·i18n 0; Anthropic 호출 무계량(`claude-opus-4-8` 하드코딩) | `src/proxy.ts`, `api/mobile/classify-defects/route.ts:4,33`, `billing/status/actions.ts:118-123` |
| B8 | 범위 밖 ERP 모듈이 같은 사이드바 — My Page·업무·영업·구매/재고·회계·게시판·전자결재·인사/휴가 | `sidebar.tsx:48-205` |
| B9 | 성능 상한 — 1000행 cap(`fetchAllRows` 22파일), 점검 상세 refresh ~5초, 고객 상세 ~2.5초(직렬 10왕복), 계획 생성 2.4~5초 | `paginate.ts`, `inspection-workbench.tsx:165,266`, `customers/[id]/page.tsx:139` |

### C. 인프라·운영 (`docker-compose*.yml`, `deploy/`, `배포순서.md`)
| # | 격차 | 근거 |
|---|---|---|
| C1 | VPS 1대(2vCPU/4GB)에 caddy+app+gotenberg+**스테이징까지 같은 네트워크**(2026-07-13 스테이징→운영 트래픽 혼입 사고). 헬스체크·메모리 제한 없음 | `docker-compose.prod.yml`, `docker-compose.staging.yml` 머리 경고 |
| C2 | 운영 서버에서 `up -d --build`(무중단 아님), 이미지 레지스트리 없음, 복귀점은 로컬 태그, 회차별 수기 스크립트 104개(회차 번호 충돌 전례 61·101) | `scripts/_deploy104-up.sh`, `배포순서.md:9` |
| C3 | CI 없음(`.github` 부재). pre-push 훅이 `.env.production`으로 스키마 드리프트 검사 → **개발 PC가 운영 비밀을 보유** | `.githooks/pre-push` |
| C4 | 마이그레이션 수동(SQL Editor/`db push`), 배포는 파일 수만 셈. 2026-09-14 하루 두 번 스키마 드리프트 장애 | `배포순서.md:220-237`, `apply-113-127-prod.sql` |
| C5 | 백업·DR 미문서 — JSON 덤프 1회, Drive 백업 폐기, PITR·복구 리허설 없음 | `배포순서.md:102`, `sjfire-erp.cron` |
| C6 | 관측 0 — Sentry/health/alert 없음, 크론 실패는 `curl -s`+`MAILTO=""`로 묵음 | `deploy/cron/sjfire-erp.cron` |
| C7 | PDF 동기 생성(Gotenberg 60~120s 타임아웃, 큐 없음) + **소방계획서 본문 HWP는 개발 PC 상주 워커 `fireplan-worker.py`(한컴 SDK, Windows 작업 스케줄러)** — 호스팅 스택 밖, 저장소 밖, 감시 없음 | `report9-actions.ts:518,576`, `erp_goal/소방계획서_7.md:33,339`, `_smoke-worker-queue.mjs` |
| C8 | 모바일 앱에 `supabaseUrl`/`erpUrl` 베이크, 번들 `com.sjfire.mobile` | `mobile/app.json:52-54` |
| C9 | 보안 — 공개 저장소 service_role 유출 이력(로테이션 완료), VPS 평문 `.env`, 레이트리밋 0, 업로드 MIME 검사 불일치(`defect-actions.ts:153`), `config.toml enable_signup=true` | — |
| C10 | 테스트 격리·저장소 비대 — E2E가 공유 스테이징 DB에 쓰고 2시간 창으로 정리, `scripts/` 1,871파일, 루트 `_*` 360개, 워크트리 22개, 실고객 데이터 파일이 디스크에(ignored) | `scripts/test-all.mts`, 루트 |

## 3. 테넌시 모델 — 권장: **공유 DB + `company_id` + JWT 클레임 RLS**

| 기준 | (a) 공유 DB + company_id + RLS | (b) 스키마/테넌트 | (c) Supabase 프로젝트/테넌트 |
|---|---|---|---|
| Supabase 적합성 | 네이티브(`auth.jwt()`·`app_metadata`·스토리지 정책) | 나쁨(PostgREST 스키마 고정, 스토리지/Auth 비인식) | 가능하나 Auth·Storage·크론·비밀 N벌 |
| 마이그레이션(151개, 수동) | 릴리스당 1회 | N회(트리거 111도 스키마마다) | N회 + 대시보드 N개 |
| 격리 | 논리(RLS) — 버그 1개=유출, §5 게이트로 완화 | 논리(search_path) | 물리(최강) |
| 비용 | Pro 1개 | 동일 | $25×N 이상 |
| 크론 11개 | `tenants` 루프 1회 | 스키마 루프 | N배포 |
| 모바일 | 무변경(JWT에 tenant_id) | 로그인별 스키마 전환 | 앱에 URL/키 N벌 |
| 승진소방 기존 데이터 | `company_id` 백필 = 테넌트 #1 | `public` 개명 → 전부 깨짐 | 그대로 = 프로젝트 #1 |

1인 팀이 운영 가능한 유일한 선택이 (a). 공공기관 등 물리 격리 요구 테넌트가 생기면 그때 (c)를 **프리미엄 옵션**으로 — 모든 행에 키가 있으므로 전환이 막히지 않는다.

**승진소방 → 테넌트 #1 이행**: `company_profile` 중복 행 정리 → `tenants` 1행(고정 UUID) → 과도기엔 `company_profile`을 **뷰**로 남겨 A2의 6개 호출부 보호 → 범위 내 테이블마다 `ADD COLUMN company_id`(nullable)→백필→`NOT NULL DEFAULT app.tenant_id()`+FK+복합 인덱스 → `profiles.company_id`·`auth.users.app_metadata.tenant_id` 일괄 세팅(**1회 재로그인 필요**) → 스토리지 `{tenant_id}/...`로 이동 → 스테이징은 같은 백필 + 격리 프로브용 가짜 테넌트 #2.

## 4. 단계별 로드맵

### Stage 0 — SaaS와 무관하게 막힌 전제 (3~4 인주)
| # | 항목 | 대상 |
|---|---|---|
| 0.1 | **백업**: Supabase 일일 백업(+PITR 검토) + 야간 `pg_dump`·버킷 동기화를 외부 저장소로 + 복구 런북 + 스테이징 복구 리허설 1회 | — |
| 0.2 | **CI**(GitHub Actions): tsc·lint·build·`_judge*-static.mjs`·드리프트 검사(**스테이징 대상**). pre-push는 lint/tsc만. **개발 PC에서 `.env.production` 제거**(비밀은 GitHub Secrets+VPS만). 배포 스크립트 104개 → `deploy-staging`/`deploy-prod` 2개 | `.github/workflows/`, `.githooks/pre-push` |
| 0.3 | **마이그레이션 규율**: 태그 시 CI에서 `supabase db push`, 번호 공백 감사(파일 151·최신 165), 스테이징→운영 같은 파이프라인 | `supabase/migrations/` |
| 0.4 | **관측**: `@sentry/nextjs`(앱+Edge), `/api/health`(DB+gotenberg ping, `proxy.ts` 공개 경로), `cron_runs` 테이블을 11개 크론이 기록, 업타임·크론 신선도 알림 | `api/cron/*`, `proxy.ts` |
| 0.5 | **보안 즉효**: `enable_signup=false`, Auth 레이트리밋, caddy `rate_limit`(`/login`·`/api/*`), Edge CORS 축소+본문 id 소유 검사, 업로드 MIME 허용목록 통일(`defect-actions.ts:153`), VPS `.env` 권한 | `supabase/functions/*`, `Caddyfile` |
| 0.6 | **저장소 정리**: scripts 1,871 → `scripts/archive/`, 루트 `_*` 360개 삭제, 실고객 데이터 파일 삭제+이력 확인, 워크트리 22개 정리 | 루트 |
| 0.7 | **인프라 위생**: `healthcheck`·`mem_limit`, 스테이징을 별도 네트워크/`.env`/호스트로(C1 사고 재발 방지), 이미지 태그 롤백 문서화 | `docker-compose*.yml` |
| 0.8 | **데이터 정리**: `company_profile` 중복 행, 047의 개발자 이메일 → 이메일 리터럴 없는 `is_system` 시드 | 마이그레이션 |

종료 기준: 스테이징 복구 리허설 통과 · `main`→스테이징 자동 배포 · 크론 실패가 5분 내 Sentry 알림 · `git grep SUPABASE_SERVICE_ROLE_KEY`가 `admin.ts`·CI만 · 개발 PC에 운영 비밀 0.

### Stage 1 — 테넌시 기반 (6~8 인주)
목표: 스테이징에서 테넌트 2개가 교차 읽기/쓰기 0으로 공존, 운영 승진소방은 테넌트 #1로 **무변화**.

- **스키마**: `tenants`(= `company_profile` + `slug`·`status`·`plan`·`settings jsonb`·`enabled_modules`·`doc_number_prefix`·`seal_url`·`system_user_id`) · `app.tenant_id()` = `request.jwt.claims`의 `tenant_id`/`app_metadata.tenant_id` · `profiles.company_id NOT NULL FK` · 범위 내 테이블 전부 `company_id`(범위 밖 ERP 테이블도 컬럼+백필만 — 게이트 규칙 단일화) · **컬럼 기본값 `app.tenant_id()`** → raw service-role로 INSERT하면 NULL→NOT NULL 위반으로 **조용한 유출 대신 시끄러운 실패** · 유니크 키 재범위(A6 전부 `(company_id, …)`, 전역 참조는 `company_id IS NULL` 부분 유니크) · 트리거 111의 공휴일 조회에 `company_id IS NULL OR = NEW.company_id` · RLS 정책을 `information_schema`에서 **스크립트로 생성**(87개 수기 금지) · 스토리지 7버킷 정책 `(storage.foldername(name))[1] = app.tenant_id()::text`, 경로 빌더 `storagePath(ctx, bucket, …)` 하나로.
- **앱**: `src/lib/supabase/tenant.ts` — `tenantClient(ctx)`·`getTenantContext()`(`getCompanyProfile`의 `react.cache` 패턴 재사용, `getProfile()`에서 `company_id`)·`forEachTenant(fn)`(크론용). 160파일을 **디렉터리 단위 래칫**으로: `lib/`(7) → `customers/`(14) → `inspections/`(13) → settings·sheets·holidays·company·billing/status → cron(11) → Edge(3) → 범위 밖 ERP 디렉터리(기계적, AI 일괄).
- **크론 팬아웃**: 본문을 `forEachTenant`로 감싸고 알림은 그 테넌트 admin/manager, 생성자는 `tenants.system_user_id`, `cron_runs` 테넌트별. `sync-holidays`·`law-revision-check`는 전역 1회(`company_id NULL`).
- **캐시**: `sheet-catalog.ts` 태그에 tenantId, `revalidateTag(`·`unstable_cache` 전수 감사.
- **설정**: `'양평군'` → `tenants.settings.default_region`, `message_templates` `(company_id,key)`.

검증: `_gate-tenant-client.mjs`(§5) 허용목록만 통과 · `_probe-tenant-isolation.mjs`(스테이징: 테이블마다 A로 읽으면 A만, 키 없는 raw INSERT 실패, B 경로 스토리지 403) · 기존 E2E 208종 테넌트 #1 초록 + 테넌트 #2에 고객 20·6단계 1바퀴 · 운영 재로그인 1회 후 1주 무변화.
위험: `company_id` 복합 인덱스 선반영(RLS 술어 성능 — 점검 상세 5초 전후 측정) · `unstable_cache` 키 누락 유출 · Supabase JWT 서명키(신규 프로젝트 비대칭 키 — HS256 레거시 비밀 유지 또는 Management API로 민팅, **스테이징 선검증**).

### Stage 2 — 문서·템플릿·발신의 테넌트 정체성 (3~4 인주)
| 영역 | 작업 | 대상 |
|---|---|---|
| 하드코딩 | 전부 `getCompanyProfile()`/테넌트 필드로. 모노그램→`logo_url`/이니셜, 문서번호 접두→`doc_number_prefix`, `fire-plan-scrub`의 "운영사 정체성 보존"=테넌트 정체성으로 재정의 | B1 파일 6곳 |
| 갑지/별지 워크북 | 회사 칸 18개 전부 DB(관리업 등록번호·기술인력·팩스·대표 컬럼 추가), 리터럴→`{회사명}`식 플레이스홀더(기존 패턴 재사용) | `xlsx-anchors.ts:260-277`, `report-workbook*.xlsx` |
| 소방계획서 워크북 | U6·J9·비상연락 카드 → 플레이스홀더 | manifest `:1184,:2964,:3505-3574` |
| 직인 | `tenants.seal_url`(`company-assets/{tenant}/seal.png`), `official.ts:69` 있으면 이미지/없으면 `(직인생략)`, `/company`에 업로드 | `official.ts`, `/company` |
| 문자 | `tenant_sms_settings`(provider·암호화 키·발신번호·dry_run·allowlist·daily_cap), `lib/sms.ts`가 `ctx`를 받음, env는 운영사 폴백 | `lib/sms.ts:62-92` |
| 메일 | 알림 메일은 트랜잭션 제공자(Resend/SES)로 테넌트 표시명·reply-to. `/mail` 받은편지함 모듈은 **SaaS 범위 밖** → 플래그 오프 | `lib/google.ts` |
| 마스터 | `message_templates`는 온보딩 시 `company_id NULL` 마스터에서 복제, 공통문구·용도·점검표는 「테넌트 오버라이드 없으면 전역」 헬퍼 하나 | `sheet-catalog.ts` |
| 법정 상수 | `doc-requirements.ts`·`plan-step-dates.ts`·`holiday-rules.ts`는 법령 → 전역 유지 | — |

검증: 테넌트 #2로 별지 9/10/11·소방계획서·내용증명·증명서 생성 · `git grep "승진소방\|sjfirekorea\|승진" src templates`가 시드/마이그레이션만 · 테넌트 #1 문서 전후 시각 diff 0.
위험: Solapi 발신번호는 번호마다 통신서비스 이용증명원 필요(운영사 계정이면 서류 수집 운영 부담) · xlsx manifest 수정 오류(앵커 테스트 확장).

### Stage 3 — 온보딩·셀프서비스 (6~8 인주)
| 항목 | 작업 |
|---|---|
| 테넌트 생성 | 운영사 전용 `/ops/tenants`(is_system): 생성·마스터 시드·시스템 사용자·첫 관리자 초대. 공개 가입은 **초기엔 없음**(assisted onboarding) |
| 초대 | `auth.admin.inviteUserByEmail` + `app_metadata.tenant_id`, `/accept-invite` |
| 테넌트 관리자 설정 | `/company`를 셀프서비스로: 프로필·로고/마크/직인·문자 설정·문구·회사 공휴일·기본 지역/담당 |
| 워크스페이스 해석 | **단일 호스트 + 로그인에서 테넌트 확정**(서브도메인·피커 없음, 사용자는 테넌트 1개 소속). `proxy.ts`에 `status`(suspended)·모듈 게이트 |
| 기능 플래그 | `tenants.enabled_modules`(기본 `['fire-safety']`), `sidebar.tsx` 필터 + `proxy.ts` 403. 승진소방은 전 모듈. ERP 모듈은 코드 유지·플래그 오프 |
| 모바일 | JWT의 `tenant_id`로 RLS 격리 — 코드 변경 최소. 구 클라이언트 `/api/mobile/min-version` 게이트. 리브랜딩은 후순위 |
| 과금 | 토스페이먼츠 빌링키(카드) 또는 계좌이체+세금계산서(국내 B2B SMB 관행). `subscriptions`·`invoices`, 플랜 한도 `tenants.plan` |
| 미터링·쿼터 | `usage_events(company_id, kind: sms/ai_tokens/pdf/storage, qty, ref)`, `lib/sms.ts`와 `callAnthropic(ctx,…)` 래퍼(B7 직접 호출 2곳 대체), 월 리셋, soft/hard cap |
| 법무 | 이용약관·개인정보 처리위탁 계약(운영사=수탁자)·처리방침 |

검증: 운영사가 테넌트만 만들면 개발자 개입 없이 초대→로그인→설정→고객→점검→문서→문자(dry-run)→사용량 표시까지 스테이징 완주.

### Stage 4 — 규모·운영 (4~6 인주)
- **PDF 큐**: `fire_plan_gen_jobs`→실제 큐(pgmq 또는 `FOR UPDATE SKIP LOCKED`)+같은 코드베이스의 `worker` 컨테이너가 Gotenberg 호출, UI 폴링. **`fireplan-worker.py`(개발 PC·한컴 SDK) 의존 해소** — 서버 측 생성으로 완전 이전(C7).
- **빌드/배포**: GitHub Actions→GHCR 이미지, VPS는 `pull && up -d`, 복제 2개+헬스체크로 무중단, 스테이징은 별도 소형 VPS.
- **테넌트별 관측**: Sentry 태그 `tenant_id`, 구조화 로그, `/ops` 대시보드(사용량·오류·마지막 크론).
- **성능**: 고객 상세 직렬 10왕복→`Promise.all`/RPC, 점검 상세 5초→RPC/집계, `pg_stat_statements`로 `(company_id,…)` 인덱스 검토.
- **개인정보보호법**: 테넌트 단위 내보내기(JSON+스토리지 zip)·삭제(cascade+접두 purge+auth users)·보존기간·접속기록.
- **보안**: 격리 침투 체크리스트, 분기 키 로테이션, docker secrets.

### 공수 합계
| Stage | 인주(1인+AI) | 달력(지원 업무 병행) |
|---|---|---|
| 0 | 3~4 | 1~1.5개월 |
| 1 | 6~8 | 2~2.5개월 |
| 2 | 3~4 | 1개월 |
| 3 | 6~8 | 2개월 |
| 4 | 4~6 | 1.5개월 |
| 합 | **22~30** | **약 7~9개월** |
Stage 2는 Stage 1 래칫 구간과 겹칠 수 있고, 테넌트 #2가 소방계획서를 많이 만들면 Stage 4의 PDF 큐를 앞당긴다.

## 5. 핵심 위험 — service-role 호출 160파일의 전환 메커니즘

왜 「385개 쿼리를 하나씩 고치기」가 아닌가: `service_role`은 `BYPASSRLS`라 어떤 `set_config`로도 정책을 적용시킬 수 없다 → 서버 코드가 **실행되는 Postgres 역할 자체**를 바꿔야 한다.

1. DB 역할 `tenant_app`(NOLOGIN, BYPASSRLS 없음), `authenticated`와 같은 테이블 권한을 `information_schema`에서 스크립트로 복제, RPC `EXECUTE`.
2. 정책 `TO tenant_app USING (company_id = app.tenant_id())`; `company_id` 없는 순수 참조 테이블은 `USING(true)`.
3. `tenantClient(ctx)`: `SUPABASE_JWT_SECRET`으로 5분짜리 HS256 JWT `{role:'tenant_app', tenant_id, sub}` 민팅 → `createClient(url, anonKey, {global:{headers:{Authorization}}})`. **`createAdminClient()`와 호출 표면이 같아** 대부분 한 줄 교체. 스토리지도 같은 클라이언트.
4. `getTenantContext()`(`react.cache`) = `getProfile()`→`{tenantId, userId, role}`. 없으면 throw.
5. `forEachTenant(fn)`: raw admin으로 `tenants WHERE status='active'`만 읽고, 테넌트마다 `tenantClient({tenantId, userId: system_user_id})`로 `fn`, `cron_runs` 기록.
6. Edge Functions: 사용자 JWT 검증→`app_metadata.tenant_id`→같은 방식으로 `tenant_app` JWT 민팅(`_shared/tenant.ts`).
7. 세션 클라이언트 17파일+모바일: 코드 무변경(`authenticated` 정책에 테넌트 술어 추가).
8. 최종 허용목록: `lib/supabase/admin.ts`, `lib/auth.ts`(컨텍스트 이전의 `fetchProfile`), `app/login/*`, `admin/users/actions.ts`(Auth admin API), `lib/supabase/tenant.ts`, `app/ops/*`, `api/cron/*`(단 `forEachTenant` 경유만).

JWT 민팅 가능 여부는 **스테이징에서 먼저 확인**(서명키 로테이션 정책). 막히면 폴백: `request.headers->>'x-tenant-id'`+서버 전용 `tenant_app` API 키(더 약함, JWT 우선).

**정적 게이트** `scripts/_gate-tenant-client.mjs`(기존 `_judge2-r4-static.mjs` 양식, CI+pre-push):
- `createAdminClient()` 사용 파일 − 허용목록 = 0. 전환 중엔 `RATCHET`(스크립트에 커밋, PR마다 내리기만·CI는 `main` 값과 비교) · `SUPABASE_SERVICE_ROLE_KEY`는 `admin.ts`만 · `from('company_profile')`은 `company-profile.ts`만 · 모든 `api/cron/*/route.ts`는 `forEachTenant(` 또는 `GLOBAL_CRONS` · `tenantClient` import 파일은 `getTenantContext(|forEachTenant(` 동반 · 테넌시 마이그레이션 이후 `CREATE TABLE`은 `company_id` 또는 `GLOBAL_TABLES` · ESLint `no-restricted-imports`로 `@/lib/supabase/admin`.

**런타임 프로브** `scripts/_probe-tenant-isolation.mjs`(스테이징 야간 CI): 테넌트 B 시드 → 모든 `company_id` 테이블에서 `A_count + B_count = total`, 교차 update/insert/스토리지 읽기 거절 단언.

## 6. 사용자가 정해야 할 결정
1. 워크스페이스: 단일 호스트+로그인 확정(권장) vs 서브도메인(브랜딩, 와일드카드 DNS/TLS·쿠키 범위).
2. 문자 소유: 운영사 Solapi 계정+테넌트별 발신번호 등록(서류·과금 운영사) vs 테넌트 자기 API 키.
3. 점검표 마스터(~860항목): 전역 법정 마스터+테넌트 오버라이드(권장) vs 테넌트별 전체 복제(법 개정 시 `law-revision-check` 팬아웃 필요).
4. 범위 밖 ERP 모듈: 플래그 오프로 코드 유지(권장, 승진소방은 계속 사용) vs 저장소 분리.
5. 과금: 카드 자동결제(토스 빌링) vs 계좌이체+세금계산서; 좌석당 vs 대상물 수당.
6. 메일: `/mail` 모듈 제외+트랜잭션 제공자 vs 테넌트별 Google OAuth 연결.
7. 모바일: 앱 하나+로그인 테넌트(권장) vs 화이트라벨 빌드.
8. 백업 예산: PITR 애드온 vs 일일 백업+야간 덤프.
9. 격리 수준: 전 테넌트 RLS 공유 DB, 프리미엄/공공은 프로젝트 분리 옵션.
10. 승진소방 컷오버: 강제 재로그인 날짜·백필 읽기전용 창.

## 7. 다음 행동 (이 계획이 승인되면)
- 이번 턴은 **문서 산출**이 목표이므로 코드 변경 없음. 승인 시 이 플랜을 `erp_goal/SaaS_전환_로드맵.md`로 저장소에 옮겨 적고(한글 문서, Edit/Write 도구로), §6 결정 1·2·3·5의 답을 받은 뒤 **Stage 0부터** 착수 계획(0.1 백업·0.2 CI·0.4 관측 순)을 별도 턴에서 세운다.
- 검증(문서 단계): 격차 표의 파일·줄 근거를 임의 5건 재확인(`Grep`), 공수 표 합계 일치, 결정 목록이 로드맵 항목과 1:1 대응.
