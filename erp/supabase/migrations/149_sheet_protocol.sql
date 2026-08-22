-- 149: 점검 건에 점검표 입력 규약을 새긴다 (2026-08-21, 소방계획서_23 S9-1 재설계 — 사용자 확정)
--
-- 왜: 재생성 차단(22 S15)의 종전 축은 날짜 상수(CUTOFF)였다. 2026-08-18에 기입하자마자
-- 전건 차단(스테이징 26/26·운영 8/8)이 났고 되돌렸다. 표면 원인은 'DB 적용일 ≠ 배포일'이지만
-- 근본 결함은 축 자체다 — 가드가 보는 날짜는 점검 **실시일**인데 규약은 **입력 행위**의 속성이다.
-- 어떤 날짜를 넣어도 실시일과 입력일이 다른 회차에서 어긋난다.
--
-- 새 축: inspections.sheet_protocol
--   'blank_unanswered' — 신규약(무응답=공란·미점검) 하에 입력. 신규 회차는 DEFAULT로 자동.
--   'legacy_na'        — 구규약(무응답=해당없음 ／) 하에 입력이 확정된 건. 수동 스탬프만.
--   NULL               — 미상(이 컬럼 도입 전 생성). 백필하지 않는다 — 사실을 모르는데 지어내지 않는다.
--                        가드는 'NULL + 응답 있음'을 보수적으로 차단한다(보관함 원본 사용).
--
-- ⚠ 순서가 규약이다: ADD COLUMN(무DEFAULT — 기존 행 전부 NULL) → 그 다음 SET DEFAULT(신규 행만).
--   순서를 바꾸거나 ADD COLUMN ... DEFAULT로 한 줄에 쓰면 PG가 기존 행을 전부 신규약으로
--   채워버린다 — 구규약 입력분까지 재생성이 열려 이 마이그레이션의 목적 자체가 무너진다.
--
-- 재실행 안전: ADD COLUMN IF NOT EXISTS + SET DEFAULT는 멱등.

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS sheet_protocol TEXT
    CHECK (sheet_protocol IN ('legacy_na', 'blank_unanswered'));

ALTER TABLE inspections
  ALTER COLUMN sheet_protocol SET DEFAULT 'blank_unanswered';

COMMENT ON COLUMN inspections.sheet_protocol IS
  '점검표 입력 규약 — blank_unanswered(신규약: 무응답=공란) / legacy_na(구규약: 무응답=해당없음) / NULL(미상 — 응답 있으면 재생성 차단). 149';
