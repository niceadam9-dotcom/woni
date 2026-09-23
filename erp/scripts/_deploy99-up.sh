#!/usr/bin/env bash
# 99회차 운영 배포 — a804d283 → origin/main(0cd7a69a) · 7커밋 · 마이그 0
#   29ff1344 chore(배포): 98회차 기록                                            (문서 전용)
#   5e219da1 feat(고객 등록): 한 줄기 · 고객명 첫 커서
#   c94c10de feat(고객): 등록·기본정보 그룹 상자 · 기준일 강조 · 넓게 (1차)
#   7cdd430a feat(고객): 건물·시설·관계인 그룹 상자 · 저장 상시 · 담당 칸 (2차)
#   52f67b90 fix(소방계획서 3장): routes 없는 부분 저장값 크래시
#   ae6273be fix(소방계획서 1.11): headcount 없는 부분 저장값 크래시
#   0cd7a69a feat(고객): 나머지 탭 저장 줄 한 벌(SaveBar) · 청구·수금·이력 넓게
#
# 🚨 회차: 착수 실측(2026-09-23 `_deploy99-baseline.sh`) — 서버 HEAD a804d283·img 0268216f6efc·
#   롤백 태그 최신 rollback-a804d28·inflight 0 → 98회차가 마지막, 이번이 **99**.
# 🚨 마이그 0 · 템플릿 xlsx 불변(5dc767d1a9101aa9).
#
# 마커 3분법 (배포 전 실행 중 컨테이너에서 실측한 before):
#   신규    info-save-bar · building-keydates · fsm-keyrow · new-keydates · info-keydates ·
#           data-save-bar · contacts-group · building-group            전부 0 → N
#   역방향  「담당 배정 · 추가 관계인 · 계약일 · 사용승인일」(옛 등록 화면 선택 항목 머리)   2 → 0
#   존속    fp-info-save 2 · form14-save 4 · specs-save 4 · fsm-save 2 · etc-items-save 2 ·
#           annex-status-save 2 · form14-multi-use-save 4 · daypanel-new-customer 2 ·
#           initialDayPanelDate 3 · returnHref 3 · 1.11.1 연간 훈련·교육 계획 2   (≥)
#   음성    zzzNoSuchMarker99 0
# ⚠ 3장·1.11 수리(52f67b90·ae6273be)는 고유 마커가 **원리적으로 없다**(정규화 함수명은 minify가 지운다) → 조상 관계.
set -u
EXPECT_HEAD=a804d283
EXPECT_IMG=0268216f6efc
ROLLBACK_TAG=erp-app:rollback-a804d28

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }
echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "HEAD=$H (기대 $EXPECT_HEAD*) · dirty=$D · img=$R (기대 $EXPECT_IMG) · inflight=$INFLIGHT"
case "$H" in $EXPECT_HEAD*) ;; *) echo GUARD_FAIL_HEAD; exit 21;; esac
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_IMG; exit 23; }
[ "$INFLIGHT" = "0" ]     || { echo GUARD_FAIL_INFLIGHT; exit 24; }
echo "=== 복귀점 확보 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "이미 있음: $ROLLBACK_TAG" || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }
echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse origin/main)
echo "target = $TARGET"
for C in 5e219da1 c94c10de 7cdd430a 52f67b90 ae6273be 0cd7a69a; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" origin/main || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
MIG=$(git -C /home/ubuntu/woni diff --name-only HEAD..origin/main -- erp/supabase/migrations | wc -l)
[ "$MIG" = "0" ] || { echo "GUARD_FAIL_MIGRATION:$MIG"; exit 34; }
git -C /home/ubuntu/woni merge --ff-only origin/main || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD); echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }
echo "=== BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
echo "=== 다음 회차 복귀점 ==="
SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
