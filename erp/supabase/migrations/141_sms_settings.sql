-- 141: 사전 안내 SMS 문구 시드 + 배너 시점 규칙 (2026-08-18, 소방계획서_24 S1)
--
-- 130은 이미 운영에 적용됐으므로 수정하지 않는다 — 새 번호로만 덧붙인다.

-- ── ① SMS 문구를 message_templates로 이관 (Q-6 / P-6) ─────────
-- 종전 문구는 컴포넌트 상수 + 개인 브라우저 localStorage('sms_default_content')에만 있었다.
-- 직원마다 다른 문구를 쓰게 되고, 상호가 바뀌면 재배포해야 했으며, 치환 변수가 없어
-- 고객명·점검일을 넣을 수 없었다 — 그래서 고객은 문자를 받아도 "언제 오는지"를 몰랐다.
--
-- 문구는 **시점을 몇 개 만들든 한 장**이다. {디데이}가 발송 시점과 방문일의 차이로
-- 오늘/내일/모레/N일 후로 자동 치환되므로, 시점마다 문구를 복제할 이유가 없다(Q-13).
--
-- 길이 주의: 90바이트를 넘으면 LMS로 전환돼 요금이 2~3배가 된다. 아래 시드는 약 62바이트.
INSERT INTO message_templates (key, subject, body, attachment_name) VALUES
  ('inspection_sms',
   NULL,
   '[{회사명}] {디데이} {점검일짧게}' || chr(10) ||
   '소방시설 점검을 위해 방문합니다.' || chr(10) ||
   '문의 {회사전화}',
   NULL)
ON CONFLICT (key) DO NOTHING;

-- ── ② 배너 시점 규칙 (Q-13) ───────────────────────────────────
-- 관리자가 "며칠 전에 안내 배너를 띄울지"를 정한다. 숫자 배열 — 0=당일, 1=내일, 3=3일 후.
-- 화면의 칩(당일·내일·모레·3일·7일)은 단축키일 뿐 제약이 아니다(숫자 자유 입력).
--
-- JSONB 배열로 두는 이유: 시점을 늘려도 스키마가 안 바뀐다. 종전 설계안의 '시점별 유형 대상'은
-- 자동 발송 전제의 비용 통제책이었는데, 승인 방식에서는 승인 버튼에 실통수가 찍히므로 뺐다(G-8).
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS sms_lead_rules JSONB NOT NULL DEFAULT '[1]'::jsonb;
COMMENT ON COLUMN company_profile.sms_lead_rules IS
  '사전 안내 배너 시점 — 방문 며칠 전에 띄울지의 숫자 배열(0=당일). 기본 [1]=내일 (소방계획서_24 Q-13)';

-- 기존 단일 행에도 기본값을 채운다(컬럼 추가 시 DEFAULT가 적용되지만 명시적으로 고정)
UPDATE company_profile SET sms_lead_rules = '[1]'::jsonb WHERE sms_lead_rules IS NULL;
