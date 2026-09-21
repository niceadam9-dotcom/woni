#!/usr/bin/env bash
# 93회차 배포 **착수 실측** — 읽기 전용. 아직 아무것도 바꾸지 않는다.
#
# ⚠ 타 세션이 `_deploy92-*`를 미리 써 두었다(구간 317a7e01→f781ccb8 · **내 커밋 미포함**).
#   그게 이미 나갔는지 아닌지를 **서버에게 묻는다** — 회차·구간은 추측하지 않는다.
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
echo "최근 빌드 흔적(30분 내 이미지):"
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' | head -5

echo
echo "=== 원격 최신 · 내 구간 ==="
git -C /home/ubuntu/woni fetch origin --quiet
echo "origin/main = $(git -C /home/ubuntu/woni rev-parse --short origin/main)"
echo "구간 커밋 수 = $(git -C /home/ubuntu/woni rev-list --count HEAD..origin/main)"
git -C /home/ubuntu/woni log --oneline HEAD..origin/main | head -12
echo
echo "내 커밋(81028958)이 원격에 있는가: $(git -C /home/ubuntu/woni merge-base --is-ancestor 81028958 origin/main && echo YES || echo NO)"
echo "내 커밋이 **이미 서버에** 있는가:  $(git -C /home/ubuntu/woni merge-base --is-ancestor 81028958 HEAD && echo YES-이미배포됨 || echo NO-미배포)"
echo "92회차 대상(f781ccb8)이 서버에 있는가: $(git -C /home/ubuntu/woni merge-base --is-ancestor f781ccb8 HEAD && echo YES && echo '  → 92회차는 이미 나갔다' || echo NO)"

echo
echo "=== MARKER BEFORE (실행 중 이미지 실물) ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo "--- 내 축(신규 후보 · 0이어야) ---"
echo "  calendar-step-input        = $(c 'calendar-step-input')     <- 달력 단계 [입력] testid(내 커밋이 붙였다)"
echo "--- 타 세션 축(구간에 섞여 나갈 수 있는 것) ---"
echo "  설비 확인 → 점검표          = $(c '설비 확인 → 점검표')"
echo "  배치확인서를 올리거나        = $(c '배치확인서를 올리거나')"
echo "--- 존속(유지되어야) ---"
echo "  data-detail-panel          = $(c 'data-detail-panel')       <- 87회차 내 축"
echo "  표지 제목 크기 조정 불발     = $(c '표지 제목 크기 조정 불발')  <- 87회차 내 축"
echo "  sheet-entry-back           = $(c 'sheet-entry-back')        <- 점검표 [←] 자체"
echo "--- 음성(0이어야) ---"
echo "  zzzNoSuchMarker93          = $(c 'zzzNoSuchMarker93')"

echo
echo "=== 표지 템플릿 자산 sha256 ==="
echo "  서버 = $(docker exec erp-app-1 sh -c "sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16")"
echo "  로컬 = 5dc767d1a9101aa9  (같으면 표지 축은 이미 나갔다)"

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
