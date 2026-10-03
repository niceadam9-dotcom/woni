-- 175: 소민터 등록 명칭·소재지 (통합 실행계획 B4 마무리, 2026-10-03)
--
-- 배경: 소방민원센터(소민터) 「한글파일 업로드 → 자동 입력」은 별지 9호의 대상물 명칭·소재지가 소민터에 등록된
--   대상물과 **한 글자라도 다르면** 「소방대상물을 찾을 수 없습니다」로 거부한다(소방청 매뉴얼 2026-02-23).
--   ERP 고객명은 사내 부르는 이름(약칭·동 표기)이라 소민터 등록명과 어긋날 수 있다.
--   ERP가 소민터 등록명을 미리 알 길은 없으므로(API 없음) 다를 때만 사람이 적는 선택 열을 둔다.
--
-- 두 열 다 **비우면 종전 그대로**(고객명·주소로 인쇄). 값이 있으면 「소민터용 한글파일」(/inspections/[id]/hwpx)만
--   그 값으로 인쇄한다 — PDF 별지 9호·갑지 엑셀은 바꾸지 않는다(관계인에게 주는 문서는 사내 표기를 유지).
-- 새 열이라 백필 없음.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS somin_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS somin_address TEXT;

COMMENT ON COLUMN customers.somin_name IS
  '소민터 등록 대상물 명칭 — 고객명과 다를 때만. 소민터용 별지 9호 한글파일의 명칭 칸에만 쓴다 (175, B4)';
COMMENT ON COLUMN customers.somin_address IS
  '소민터 등록 소재지 — 주소와 다를 때만. 소민터용 별지 9호 한글파일의 소재지 칸에만 쓴다 (175, B4)';
