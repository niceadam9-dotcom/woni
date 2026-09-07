-- 159: 화면 글자 배율에 4단계 '최대'(xxl = 1.45) 추가 (2026-09-07)
--
-- 왜: 154가 md/lg/xl 3단으로 열었는데, 사용자가 xl(1.3)에서도 "여전히 작다"고 했다
-- (erp_goal/image-65.png — 점검표 입력 화면). 같은 날 배율 적용 범위를 소방계획서 서식에서
-- **앱 전 화면**으로 넓혔지만, 범위와 최대치는 다른 축이다. 한 단계를 더 연다.
--
-- ⚠ 이 마이그레이션이 **먼저** 적용돼야 한다. 앱 코드가 'xxl'을 보내는데 CHECK가 아직
-- 3값이면 저장이 23514로 거절되고 사용자는 "최대를 골랐는데 안 된다"만 본다.
-- 반대 순서(DB 먼저·코드 나중)는 무해하다 — 아무도 xxl을 보내지 않으므로.
-- 그래서 배포는 **DB → 코드** 순으로 한다.
--
-- 값 선택 근거: 1.15 간격을 유지한다(1 · 1.15 · 1.3 · 1.45). 등차라 사용자가 한 칸씩
-- 올릴 때 체감이 일정하고, globals.css의 [data-fs-boost](×1.15)와도 같은 눈금이다.
--
-- 재실행 안전: constraint를 drop 후 add. 기존 행 값(md/lg/xl)은 새 CHECK를 그대로 통과한다.

alter table profiles drop constraint if exists profiles_form_font_scale_check;
alter table profiles add constraint profiles_form_font_scale_check
  check (form_font_scale in ('md', 'lg', 'xl', 'xxl'));

comment on column profiles.form_font_scale is
  '화면 글자 배율(md=1 · lg=1.15 · xl=1.3 · xxl=1.45) — 154에서 신설, 159에서 xxl 추가.
   적용 범위는 앱 전 화면(globals.css @theme inline의 --fs-scale). 쿠키 erp-fs의 정본';
