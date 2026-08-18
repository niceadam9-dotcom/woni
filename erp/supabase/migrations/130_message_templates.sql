-- 130: 발송 문구 관리 (2026-08-12, 소방계획서_21 R7 / #3·#4 D-1)
--
-- 배경: 관계인 보고 메일의 제목·본문·첨부 파일명과 일반 메일 서명이 코드에 리터럴로 박혀 있어
-- 상호('승진소방ENG')가 네 곳에 흩어져 있었다. 상호가 바뀌면 재배포해야 했다.
-- 치환 변수 {회사명}은 company_profile에서 채우므로, 이 테이블 도입으로 상호가 한 곳으로 수렴한다.
--
-- company_profile(단일 행)에 컬럼을 늘리지 않는 이유: 메일 종류가 늘 때마다 스키마가 바뀐다.
-- key는 코드가 아는 값만 쓴다(사용자가 임의로 늘릴 수 없다).
CREATE TABLE IF NOT EXISTS message_templates (
  key             TEXT PRIMARY KEY,
  subject         TEXT,                 -- 서명처럼 제목이 없는 종류는 NULL
  body            TEXT NOT NULL,
  attachment_name TEXT,                 -- owner_report 전용 (첨부 파일명도 대외 노출값이다)
  updated_by      UUID REFERENCES profiles(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE message_templates IS
  '대외 발송 문구 — 관계인 보고(owner_report)·메일 서명(mail_signature). 행이 없으면 코드의 DEFAULT_TEMPLATES로 폴백 (소방계획서_21 R7)';

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message_templates_select_all" ON message_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);
-- 쓰기는 서버 액션(service role)만 — 권한은 permissions.ts의 message_template_manage로 판정한다
CREATE POLICY "message_templates_admin_write" ON message_templates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('manager', 'admin'))
  );

-- 시드 = 현행 문구 그대로. 도입 즉시 발송 동작이 종전과 동일해야 한다.
INSERT INTO message_templates (key, subject, body, attachment_name) VALUES
  ('owner_report',
   '[{회사명}] {고객명} 소방시설 자체점검 결과 보고',
   '{고객명} 관계인님께' || chr(10) || chr(10) ||
   '소방시설 자체점검 결과 보고서(별지 제9호서식)를 송부드립니다.' || chr(10) ||
   '본 메일은 전자우편 송달 동의에 따라 발송되었습니다 (소방시설 설치 및 관리에 관한 법률 시행규칙).' || chr(10) || chr(10) ||
   '{회사명} 드림',
   '{고객명}_자체점검결과보고서'),
  ('mail_signature',
   NULL,
   '---' || chr(10) || '{회사명} {작성자} 드림' || chr(10) || '(본 메일은 회사 공용 계정에서 발송되었습니다)',
   NULL)
ON CONFLICT (key) DO NOTHING;

-- 발송 이력에 **렌더된 본문**을 남긴다. 문구가 가변이 되는 순간 "그때 무엇을 보냈는지"가
-- 복원 불가가 되는데, 관계인 보고는 ③ 단계의 완료 증빙이다.
ALTER TABLE report_deliveries ADD COLUMN IF NOT EXISTS body TEXT;
COMMENT ON COLUMN report_deliveries.body IS
  '발송 시점에 렌더된 본문 전문 — 템플릿이 나중에 바뀌어도 당시 내용을 복원할 수 있게 (소방계획서_21 R7-7)';
