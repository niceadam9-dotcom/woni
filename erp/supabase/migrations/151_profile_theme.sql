-- 151: 개인별 화면 테마 (2026-08-28, 소방계획서_29 S1-1)
--
-- 왜: 설정 화면에서 개인별로 「화이트(현재)/다크」를 선택한다(2026-08-28 사용자 지시).
-- 정본은 이 컬럼이고 쿠키(erp-theme)는 첫 페인트용 캐시다 — 기기 간 동기화는 이 컬럼이 한다.
-- 기본 'light' = 기존 사용자 전원 현재 화면 그대로(다크는 opt-in).
--
-- ⚠ 배포 순서 자유 규약: 앱 코드는 이 컬럼을 PROFILE_COLS(lib/auth.ts)에 넣지 않고
-- 관용(tolerant) 별도 조회로만 읽는다 — 컬럼이 없어도 로그인·화면이 깨지지 않는다.
-- (없는 컬럼 select는 조용한 실패가 되어 getProfile 전멸 = 전원 로그인 불가가 되기 때문)
--
-- 재실행 안전: add column if not exists + constraint는 drop 후 add.

alter table profiles add column if not exists theme text not null default 'light';

alter table profiles drop constraint if exists profiles_theme_check;
alter table profiles add constraint profiles_theme_check check (theme in ('light', 'dark'));

comment on column profiles.theme is '개인 화면 테마(light|dark) — 소방계획서_29. 쿠키 erp-theme의 정본';
