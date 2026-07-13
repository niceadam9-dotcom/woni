소방업무 유지보수 시스템은 소화·경보·피난 등 소방시설법에 따른 건물 내 소방설비의 점검 이력, 고장 접수, 예방 정비 및 법정 보고서 제출을 전산화해 체계적으로 관리하는 통합 IT 솔루션입니다. 

효율적인 소방 안전 관리를 위해 시스템은 주로 다음과 같은 핵심 기능을 제공합니다:
스마트 점검 관리: 소방시설법에 따른 세대별/건물별 정기점검 및 종합점검 계획 수립, 모바일 앱을 통한 현장 점검, 법정 보고서 자동 생성 및 제출 지원. 

설비 이력 및 생애주기 관리: 소화기, 스프링클러, 감지기 등 소방설비의 설치부터 수리 내역, 교체 주기, 폐기까지의 전 과정을 데이터베이스화. 
실시간 장애 접수 및 처리: 고장 및 이상 발생 시 관리자에게 실시간 알림, 수리 요청 접수, 보수 작업 이력 및 비용 처리 기록. 

▲ 월간점검계획 자동 생성
전월의 점검계획을 참고하여 해당월의 근무달력(근무일,휴일)을 기반으로 월간 점검계획을 자동으로 생성합니다.
점검결과 현장 입력(항목,불량내역,불량사진)
▲ 점검결과 현장 입력(항목,불량내역,불량사진)
MobileDevice(태블릿,스마트폰 등)로 점검결과를 현장에서 입력합니다.
'AI' 활용으로 음성으로 불량내역을 입력하면, 관련 항목을 자동 인식하여 등록합니다.
현장에서 스마트폰으로 불량시설을 촬영하여 등록합니다
▲ 점검 현황 모니터링
점검상태, 점검자, 점검유형 등 다양한 방식으로 특정기간의 점검현황을 조회할 수 있읍니다.
▲ 점검보고서 제출현황 모니터링
점검완료일 기준으로 설정된, 배치신고예정일, 제출예정일 에 기반하여 보고서의 제출현황을 모니터링합니다.
▲ 이행계획/완료 제출현황 모니터링
점검결과의 불량내역을 기반으로 이행계획 제출대상을 조회하여 이행계획을 자동으로 생성하고 제출여부를 모니터링합니다.
이행계획에 기반하여 이행완료보고서를 자동으로 생성하고 제출 여부를 모니터링합니다.
▲ 정산현황 모니터링(회계연동)
점검계획이 생성된 건에 대하여 청구서 생성, 입금, 미납금현황을 모니터링합니다.
▲ 전자세금계산서 발행현황 모니터링
발행된 청구서에 기반하여 세금계산서의 발행 여부를 모니터링합니다.
(선택)부가서비스를 이용하여 전자세금계산서를 발행할 수 있읍니다.
▲ Dash Board (경영정보 모니터링)
관리자의 역할에 맞는 경영정보(점검,회계,인사,결재 등)를 모니터링합니다.

소방안전관리(가장우선)
고객등록
건물등록
문의요청등록
점검계획등록
점검표등록
점검결과등록
점검보고서등록
이행계획서등록
이행완료보고서등록
청구서등록
전자세금계산서발행

My Page
일정등록
ToDo등록
주소록등록
녹음메모장
노트등록
쪽지
나의결재Sign등록

게시판관리
게시물등록
구분등록
회의록등록

영업관리
견적등록
수주등록

1. 고객 테이블 (Customer)
고객사 및 관리 대상 업체 정보를 저장하는 테이블입니다.
컬럼명	데이터 형식	필수 여부	설명
cust_id	VARCHAR(20)	PK	고객 고유 코드 (예: CUST-20260625-001)
cust_name	VARCHAR(100)	Yes	고객사(상호)명 또는 고객명
biz_reg_no	VARCHAR(20)	No	사업자등록번호
ceo_name	VARCHAR(50)	No	대표자명
manager_name	VARCHAR(50)	Yes	담당자 이름
manager_phone	VARCHAR(20)	Yes	담당자 연락처
email	VARCHAR(100)	No	담당자 이메일
address	VARCHAR(255)	Yes	본사 또는 주소지
status	VARCHAR(10)	Yes	계약 상태 (Y: 정상, N: 해지, H: 보류)
created_at	DATETIME	Yes	등록일시
________________________________________
2. 건물 테이블 (Building)
고객이 보유하고 관리해야 하는 실제 소방 대상물(빌딩/현장) 테이블입니다.
컬럼명	데이터 형식	필수 여부	설명
bldg_id	VARCHAR(20)	PK	건물 고유 코드
cust_id	VARCHAR(20)	FK	고객 고유 코드 (Customer 테이블 참조)
bldg_name	VARCHAR(100)	Yes	건물명 (예: OO빌딩, OO아파트)
bldg_address	VARCHAR(255)	Yes	실제 소방점검/유지보수 대상 건물 주소
bldg_type	VARCHAR(20)	Yes	건물 용도 (근린생활시설, 아파트, 공장 등)
area	DECIMAL(10,2)	No	연면적 (m²)
floor_count	INT	No	층수 (지하 / 지상)
built_date	DATE	No	준공연도
memo	TEXT	No	특이사항 및 진입 조건 등
________________________________________
3. 문의요청 테이블 (Inquiry)
A/S 요청, 점검 일정 조율, 견적 문의 등 고객의 소통 내역을 기록하는 테이블입니다.
컬럼명	데이터 형식	필수 여부	설명
inq_id	VARCHAR(20)	PK	문의요청 고유 코드
cust_id	VARCHAR(20)	FK	고객 고유 코드
bldg_id	VARCHAR(20)	FK	관련 건물 고유 코드 (선택)
inq_type	VARCHAR(20)	Yes	문의 구분 (AS: 수리, SCH: 일정, EST: 견적, ETC)
title	VARCHAR(200)	Yes	문의 제목
content	TEXT	Yes	문의 상세 내용
status	VARCHAR(20)	Yes	처리 상태 (접수, 처리중, 보류, 완료)
priority	VARCHAR(10)	Yes	중요도 (상, 중, 하)
created_at	DATETIME	Yes	접수 일시
resolved_at	DATETIME	No	처리 완료 일시
________________________________________
4. 소방유지보수 테이블 (Maintenance)
소방시설 점검 및 정기/수시 유지보수 작업 이력을 관리하는 테이블입니다.
컬럼명	데이터 형식	필수 여부	설명
maint_id	VARCHAR(20)	PK	유지보수 작업 고유 코드
bldg_id	VARCHAR(20)	FK	대상 건물 고유 코드
maint_type	VARCHAR(20)	Yes	점검 종류 (정기점검, 수시점검, 긴급보수)
work_date	DATE	Yes	작업(점검) 예정일 또는 완료일
inspector	VARCHAR(50)	Yes	점검자/엔지니어 이름
facility_type	VARCHAR(50)	Yes	점검 설비 (소화설비, 경보설비, 피난설비 등)
checklist	JSON	No	점검 체크리스트 결과 (정상/불량 여부)
action_taken	TEXT	No	조치 및 수리 내용
next_maint_date	DATE	No	차기 점검 예정일
result_status	VARCHAR(20)	Yes	점검 결과 (양호, 주의, 불량, 조치완료)
1. 고객 및 건물 등록
[고객 테이블 (Client)]
고객사 관리 및 청구/세금계산서 발행의 기준이 되는 테이블입니다.
컬럼명	데이터 타입	설명	비고
CLIENT_ID	VARCHAR(20)	고객사코드	PK
CLIENT_NAME	VARCHAR(100)	고객사명(상호)	
BIZ_REG_NUM	VARCHAR(20)	사업자등록번호	
CEO_NAME	VARCHAR(50)	대표자명	
TEL_NUM	VARCHAR(20)	대표전화번호	
EMAIL	VARCHAR(100)	세금계산서 수신 이메일	
[건물 테이블 (Building)]
고객사 산하에 있는 대상물(건물) 정보를 관리합니다.
컬럼명	데이터 타입	설명	비고
BUILDING_ID	VARCHAR(20)	건물코드	PK
CLIENT_ID	VARCHAR(20)	고객사코드	FK
BUILDING_NAME	VARCHAR(100)	대상물명	
ADDRESS	VARCHAR(255)	소재지	
BLDG_AREA	DECIMAL(10,2)	연면적 (m²)	
FLOORS	INT	층수 (지하/지상)	
2. 소통 및 계획
[문의요청 테이블 (Inquiry)]
고객의 점검, A/S, 수리 등의 문의 및 요청사항입니다.
컬럼명	데이터 타입	설명	비고
INQUIRY_ID	VARCHAR(20)	문의요청코드	PK
BUILDING_ID	VARCHAR(20)	건물코드	FK
REQ_DATE	DATETIME	요청일시	
REQ_TYPE	VARCHAR(20)	요청구분 (A/S, 점검, 견적 등)	
CONTENT	TEXT	요청내용	
STATUS	VARCHAR(20)	처리상태 (접수, 처리중, 완료)	
[점검계획 테이블 (Inspection_Plan)]
연간 또는 분기별 소방시설 작동/종합점검 계획입니다.
컬럼명	데이터 타입	설명	비고
PLAN_ID	VARCHAR(20)	점검계획코드	PK
BUILDING_ID	VARCHAR(20)	건물코드	FK
PLAN_DATE	DATE	점검예정일	
INSP_TYPE	VARCHAR(20)	점검종류 (작동, 종합 등)	소방시설법 기준

INSPECTOR_ID	VARCHAR(20)	담당점검자코드	FK
3. 점검 수행 및 보고
[점검표 테이블 (Inspection_Sheet)]
점검 항목 및 세부 기준을 정의하는 마스터 테이블입니다.
컬럼명	데이터 타입	설명	비고
SHEET_ID	VARCHAR(20)	점검표코드	PK
SHEET_VERSION	VARCHAR(10)	버전정보	
ITEM_CODE	VARCHAR(20)	점검항목코드	
ITEM_NAME	VARCHAR(255)	점검설비명 (예: 소화기, 수신기)	
CHECK_METHOD	TEXT	점검방법/기준	
[점검결과 테이블 (Inspection_Result)]
실제 점검 수행 후 입력한 개별 점검 항목에 대한 결과입니다.
컬럼명	데이터 타입	설명	비고
RESULT_ID	VARCHAR(20)	점검결과코드	PK
PLAN_ID	VARCHAR(20)	점검계획코드	FK
SHEET_ID	VARCHAR(20)	점검표코드	FK
STATUS	VARCHAR(20)	판정 (정상, 불량, 해당없음)	
REMARK	TEXT	지적사항 및 조치요구사항	
[점검보고서 테이블 (Inspection_Report)]
점검이 완료된 후 발급되는 최종 보고서 문서 데이터입니다.
컬럼명	데이터 타입	설명	비고
REPORT_ID	VARCHAR(20)	점검보고서코드	PK
PLAN_ID	VARCHAR(20)	점검계획코드	FK
ISSUE_DATE	DATE	보고서발행일	
REPORT_FILE_URL	VARCHAR(255)	최종 보고서 PDF 파일경로	
4. 사후 조치 및 이행
[이행계획서 테이블 (Action_Plan)]
점검 시 지적된 불량사항에 대한 고객사의 조치 계획입니다.
컬럼명	데이터 타입	설명	비고
ACTION_PLAN_ID	VARCHAR(20)	이행계획서코드	PK
BUILDING_ID	VARCHAR(20)	건물코드	FK
REPORT_ID	VARCHAR(20)	점검보고서코드	FK
PLAN_DATE	DATE	계획제출일	소방민원센터 제출용
COMPLETION_TARGET	DATE	조치완료목표일	
[이행완료보고서 테이블 (Action_Complete_Report)]
지적사항 수리/개선 완료 후 관할 소방서 등에 제출하는 보고서입니다.
컬럼명	데이터 타입	설명	비고
COMPLETE_ID	VARCHAR(20)	이행완료보고서코드	PK
ACTION_PLAN_ID	VARCHAR(20)	이행계획서코드	FK
REPORT_FILE_URL	VARCHAR(255)	완료보고서 첨부파일 경로	
SUBMIT_DATE	DATETIME	제출일시	
5. 청구 및 정산
[청구서 테이블 (Billing)]
점검 및 유지보수에 대한 비용 청구서입니다.
컬럼명	데이터 타입	설명	비고
BILL_ID	VARCHAR(20)	청구서코드	PK
CLIENT_ID	VARCHAR(20)	고객사코드	FK
BILL_DATE	DATE	청구발행일	
SUPPLY_VALUE	DECIMAL(15,2)	공급가액	
TAX_VALUE	DECIMAL(15,2)	부가세	
TOTAL_AMOUNT	DECIMAL(15,2)	청구총액	
[세금계산서 테이블 (Tax_Invoice)]
국세청 전송 기준에 맞춘 세금계산서 발행 이력 테이블입니다.
컬럼명	데이터 타입	설명	비고
INVOICE_ID	VARCHAR(20)	세금계산서코드	PK
BILL_ID	VARCHAR(20)	청구서코드	FK
ISSUE_DATE	DATE	발행일자	
APPROVAL_NUM	VARCHAR(50)	국세청 승인번호	
INVOICE_STATUS	VARCHAR(20)	상태 (발행완료, 취소, 전송대기)	

