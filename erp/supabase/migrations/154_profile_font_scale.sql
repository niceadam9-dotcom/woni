-- 154: 개인별 소방계획서 화면 글자 배율 (2026-08-29, 소방계획서_35 S4-1)
--
-- 왜: 소방안전관리 실무 시니어 사용자가 서식 화면(특히 1.4 소방시설 세부제원) 글씨를
-- 읽기 어렵다고 했다. S3에서 기본 크기를 한 단계 올렸지만 시력은 사람마다 달라
-- 고정 크기 하나로는 부족하다 — 「보통/크게/아주 크게」를 개인별로 고른다.
-- 정본은 이 컬럼이고 쿠키(erp-fs)는 첫 페인트용 캐시다. 기기 간 동기화는 이 컬럼이 한다.
-- 기본 'md' = 기존 사용자 전원 S3 상태 그대로(확대는 opt-in).
--
-- ⚠ 배포 순서 자유 규약(151과 동일): 앱 코드는 이 컬럼을 PROFILE_COLS(lib/auth.ts)에
-- 넣지 않고 관용(tolerant) 별도 조회(lib/font-scale.ts)로만 읽는다 — 컬럼이 없어도
-- 로그인·화면이 깨지지 않는다. 없는 컬럼 select는 **조용한 실패**가 되어 getProfile
-- 전멸 = 전원 로그인 불가가 되기 때문이다.
--
-- 재실행 안전: add column if not exists + constraint는 drop 후 add.

alter table profiles add column if not exists form_font_scale text not null default 'md';

alter table profiles drop constraint if exists profiles_form_font_scale_check;
alter table profiles add constraint profiles_form_font_scale_check
  check (form_font_scale in ('md', 'lg', 'xl'));

comment on column profiles.form_font_scale is
  '소방계획서 서식 화면 글자 배율(md=1 · lg=1.15 · xl=1.3) — 소방계획서_35. 쿠키 erp-fs의 정본';
