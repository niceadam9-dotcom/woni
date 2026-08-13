-- 127: 선임 형태 기본값 '업무대행감독' + 기존 미입력 백필 (소방계획서_19 A9-4 입력 개선)
-- 전 고객이 업무대행 계약(19 Q-3 confirmed)이라 '업무대행감독'이 사실과 일치 — 2026-08-12 사용자 확정
-- ("일괄 백필 + 신규 기본값" 채택). 예외 고객(겸직·자격자 등)은 계획서 정보 패널에서 수동 수정.
-- 값은 124의 CHECK 5종(소방기술자격·소방안전관리자수첩·업무대행감독·겸직·기타)에 포함된다.

alter table customers alter column manager_appointment_type set default '업무대행감독';

update customers
set manager_appointment_type = '업무대행감독'
where manager_appointment_type is null;
