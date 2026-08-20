-- 145: 소방안전관리자를 '관계인 중 한 명'으로 지목 (2026-08-20 사용자 확정)
--
-- 왜: 별지 9호 2쪽 소방안전정보의 [소방안전관리자 전화번호]는 채울 원천이 아예 없었다.
--     성명은 서식 1.7(fire_plan_forms.sections.managers)에서 오는데 **1.7에는 전화 열이 없고**,
--     그래서 조립부는 "선임자 이름이 대표와 같을 때만 대표 전화를 쓴다"는 우회를 하고 있었다
--     (report9-actions.ts, 타인 전화 오기재 방지). 선임자가 대표와 다른 사람이면 영원히 공란이다.
--
-- 어떻게: 관계인(customer_contacts)을 가리키는 포인터 한 개. 성명·전화가 관계인에서 그대로 따라오므로
--     "이름은 있는데 전화는 못 채우는" 상태가 구조적으로 사라진다. 사람 정보를 두 번 적지도 않는다.
--
-- 정본 관계(확정): 주 선임자 = 이 포인터. 서식 1.7은 **보조자 전용**이 되고 첫 행은 이 값을 읽어 표시만 한다.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS manager_contact_id UUID REFERENCES customer_contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN customers.manager_contact_id IS
  '소방안전관리자로 지목된 관계인 (customer_contacts) — 별지 9호 2쪽 성명·전화의 원천. 관계인 탭 [소방안전관리] 구역에서 지정';

-- 지목된 관계인을 지우면 포인터만 끊긴다(ON DELETE SET NULL) — 고객이 지워지는 일은 없다.
CREATE INDEX IF NOT EXISTS idx_customers_manager_contact ON customers(manager_contact_id);
