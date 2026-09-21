#!/usr/bin/env bash
# 94회차 배포 **착수 실측** — 읽기 전용. 아직 아무것도 바꾸지 않는다.
#
# 구간 e99941f → origin/main(37820ac7, 4커밋 · 마이그 0)
#   352500c4 chore(배포): 93회차 up 스크립트를 기록으로 싣는다        ← 문서 전용
#   6d63efdc feat(점검): 회차 귀속 1.4의 「기타」 7종을 …            ← **타 세션**
#   55f3361d chore(소방계획서): 「기본 문구」 8섹션 등록 스크립트 …   ← 내 것(문서 전용)
#   37820ac7 fix(소방계획서): 공통문구 목록 미리보기 대표 칸         ← 내 것(제품)
#
# 🚨 **내 커밋에는 번들 문자열 마커가 원리적으로 없다** — 새 문자열을 하나도 안 만들고
#   값을 집는 **순서**만 바꿨다(minify가 식별자를 지운다). 지어내지 않는다.
#   내 축의 판정은 ① 서버 HEAD 조상 관계 ② 이미지 교체 ③ **배포본 소스 기준 동작 프로브**
#   (운영 DB 14건에 배포본 함수와 수리본 함수를 각각 걸어 비교 — before 2건 불일치 → after 0)
#   세 가지로 한다. 신규 문자열 마커는 **타 세션 커밋**의 것을 써서 「구간이 도달했는가」만 본다.
set -u
cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }

echo "=== 서버 위치 ==="
echo "HEAD        = $(git -C /home/ubuntu/woni rev-parse --short HEAD)"
git -C /home/ubuntu/woni log --oneline -1
echo "dirty(up.log 제외) = $(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "up since    = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"

echo
echo "=== 🚨 남이 배포 중인가 (4GB VPS — 동시 빌드는 OOM) ==="
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "in-flight docker compose = $INFLIGHT"
ps -eo etime,cmd | grep -F 'docker compose' | grep -v grep || echo "  (없음)"
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' | head -5

echo
echo "=== 원격 최신 · 내 구간 ==="
git -C /home/ubuntu/woni fetch origin --quiet
echo "origin/main = $(git -C /home/ubuntu/woni rev-parse --short origin/main)"
echo "구간 커밋 수 = $(git -C /home/ubuntu/woni rev-list --count HEAD..origin/main)"
git -C /home/ubuntu/woni log --oneline HEAD..origin/main | head -12
echo
echo "내 커밋(37820ac7)이 원격에 있는가: $(git -C /home/ubuntu/woni merge-base --is-ancestor 37820ac7 origin/main && echo YES || echo NO)"
echo "내 커밋이 **이미 서버에** 있는가:  $(git -C /home/ubuntu/woni merge-base --is-ancestor 37820ac7 HEAD && echo YES-이미배포됨 || echo NO-미배포)"

echo
echo "=== MARKER BEFORE (실행 중 이미지 실물) ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo "--- 신규 후보(타 세션 6d63efdc · 0이어야 구간 도달을 증명한다) ---"
echo "  이 회차에 해당하는 기타 시설  = $(c '이 회차에 해당하는 기타 시설')"
echo "  피난·방화시설·방염과 위험물    = $(c '피난·방화시설·방염과 위험물')"
echo "--- 내 축이 실린 모듈이 번들에 있는가(존속 · 라벨은 안 바뀐다) ---"
echo "  공사·정비 내용               = $(c '공사·정비 내용')   <- plan-text-sections의 열 라벨"
echo "  피난 방법 (유형 공통)         = $(c '피난 방법 (유형 공통)')"
echo "--- 존속(93회차 이하 · 유지되어야) ---"
echo "  calendar-step-input         = $(c 'calendar-step-input')   <- 93회차 신규였던 것"
echo "  data-detail-panel           = $(c 'data-detail-panel')      <- 87회차"
echo "  sheet-entry-back            = $(c 'sheet-entry-back')"
echo "  설비 확인 → 점검표           = $(c '설비 확인 → 점검표')"
echo "--- 음성(0이어야) ---"
echo "  zzzNoSuchMarker94           = $(c 'zzzNoSuchMarker94')"

echo
echo "=== 표지 템플릿 자산 sha256 (이 구간엔 변경 없음 — 그대로여야) ==="
echo "  서버 = $(docker exec erp-app-1 sh -c "sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16")"
echo "  기대 = 5dc767d1a9101aa9"

echo
echo "=== 마이그레이션 ==="
git -C /home/ubuntu/woni diff --name-only HEAD origin/main -- supabase/migrations | head -10
echo "  (비어 있으면 DDL 없음)"

echo
echo "=== 롤백 태그 · 자원 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F 'erp-app:rollback-' | head -4
df -h / | tail -1
free -m | head -2
echo "=== BASELINE DONE ==="
