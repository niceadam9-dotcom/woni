-- 157: 대표 관계인 교대(swap) — UNIQUE(customer_id, role) DEFERRABLE 전환 + set_primary_contact 함수
--
-- 배경(2026-09-03 A안): 관계인 카드의 [대표로 지정]을 누르면 그 사람이 role='대표'가 되고
-- 기존 대표는 그 사람의 이전 role을 물려받는다(교대). 관계인 슬롯은 대표·직원1·직원2 세 개뿐이라
-- 셋이 꽉 찬 고객에서는 어느 순서로 UPDATE 두 번을 해도 즉시 검사(IMMEDIATE) 제약에 걸린다 —
-- 빈 슬롯이 없어 중간 상태가 반드시 중복을 지나기 때문. 검사를 트랜잭션 끝으로 미룬다(DEFERRABLE).
-- INITIALLY IMMEDIATE라 평소 동작(등록·수정의 중복 차단 시점)은 종전과 같고,
-- 이 함수 안에서만 SET CONSTRAINTS ... DEFERRED로 잠깐 미룬다.

ALTER TABLE customer_contacts
  DROP CONSTRAINT customer_contacts_customer_id_role_key;
ALTER TABLE customer_contacts
  ADD CONSTRAINT customer_contacts_customer_id_role_key
  UNIQUE (customer_id, role) DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE FUNCTION set_primary_contact(p_customer_id UUID, p_contact_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur_id   UUID;
  v_tgt_role contact_role;
BEGIN
  SET CONSTRAINTS customer_contacts_customer_id_role_key DEFERRED;

  -- 대상은 반드시 이 고객의 관계인 — 남의 고객 관계인 id로 남의 행을 흔들지 못하게 고객 축으로 함께 잠근다
  SELECT role INTO v_tgt_role
    FROM customer_contacts
   WHERE id = p_contact_id AND customer_id = p_customer_id
     FOR UPDATE;
  IF v_tgt_role IS NULL THEN
    RAISE EXCEPTION 'contact % is not a contact of customer %', p_contact_id, p_customer_id;
  END IF;
  IF v_tgt_role = '대표' THEN
    RETURN;  -- 이미 대표 — 멱등
  END IF;

  SELECT id INTO v_cur_id
    FROM customer_contacts
   WHERE customer_id = p_customer_id AND role = '대표'
     FOR UPDATE;

  -- 기존 대표는 대상의 이전 슬롯으로 (대표가 없던 고객이면 이 단계 없음)
  IF v_cur_id IS NOT NULL THEN
    UPDATE customer_contacts SET role = v_tgt_role, updated_at = NOW() WHERE id = v_cur_id;
  END IF;
  UPDATE customer_contacts SET role = '대표', updated_at = NOW() WHERE id = p_contact_id;
END $$;

-- 앱 서버 액션(service_role)만 부른다 — 브라우저 키로 직접 못 부르게 잠근다
REVOKE ALL ON FUNCTION set_primary_contact(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_primary_contact(UUID, UUID) TO service_role;
