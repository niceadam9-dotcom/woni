-- 104: 서식 1.1 신규 필드 (2026-07-23, 소방계획서_4.md §3-1.1 / P6 — 별지 9호 1~2쪽 연계)
-- buildings: 피난용승강기·계단·경사로 / customers: 대표자 구분·소방안전관리자 자격구분·최근 교육이수일

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS evac_elevator_count INTEGER,      -- 피난용승강기(대) — 별지 9호 2쪽 승강기 행
  ADD COLUMN IF NOT EXISTS stairs_count        INTEGER,      -- 계단(개소)
  ADD COLUMN IF NOT EXISTS ramp_count          INTEGER;      -- 경사로(개소)

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS rep_role              TEXT CHECK (rep_role IN ('소유자', '관리자', '점유자')),  -- 별지 9호 2쪽 대표자 구분
  ADD COLUMN IF NOT EXISTS manager_license_grade TEXT CHECK (manager_license_grade IN ('특급', '1급', '2급', '3급')),  -- 소방안전관리자 자격구분 (대상물 등급 building_grade와 별개)
  ADD COLUMN IF NOT EXISTS manager_edu_date      DATE;       -- 최근 교육이수일 — 별지 9호 2쪽 {{mgr_edu_date}}
