#!/usr/bin/env bash
# 98회차 운영 배포 — ac9cbed7 → origin/main(a804d283) · 4커밋 · 마이그 0
#   e5634978 chore(배포): 97회차 기록                                           (문서 전용)
#   53806ec1 feat(점검달력): 보고서 고지 제거 + 고객 등록은 페이지로·사이드바 복귀 (R9 — 제품)
#   74399f84 test(점검달력): R9 변이 두 벌 재작성                               (scripts 전용)
#   a804d283 test(점검달력): R9 실화면 왕복 프로브                              (scripts 전용)
#
# 🚨 회차: 착수 실측(2026-09-23 `_deploy98-baseline.sh`) — 서버 HEAD ac9cbed7·img b10509516a78·
#   롤백 태그 최신 rollback-ac9cbed·inflight 0 → 97회차가 마지막, 이번이 **98**.
# 🚨 마이그레이션 0 · 템플릿 xlsx 불변(5dc767d1a9101aa9 — 변하면 오히려 이상).
#
# 마커 3분법 (배포 전 **실행 중 컨테이너에서 실측한 before**):
#   신규    initialDayPanelDate                0 → N  (달력 서버가 ?day= 되읽기 — ㉢)
#   신규    등록하면 점검달력으로 돌아갑니다     0 → N  (등록 페이지 복귀 약속)
#   신규    returnHref                         0 → N  (등록 폼 복귀 주소)
#   역방향  calendar-new-customer-modal        2 → 0  (달력 위 등록 모달 폐지)
#   역방향  daypanel-workbook-resume           2 → 0  (「입력을 마치고 돌아오셨습니다」 띠)
#   역방향  calendar-created-banner            2 → 0  (「등록 완료」 띠 — 돌아온 사이드바가 증언)
#   역방향  created-started / created-planned  2 → 0
#   존속    daypanel-new-customer 2 · calendar-new-customer 2 · calendar-cell-new-customer 2 ·
#           daypanel-workbook 2 · daypanel-fireplan 2 · doc-notice-list 2 · doc-notice-chip 2 ·
#           workbook-xlsx 14 · 채우면 다음 발행에 반영됩니다 2 · anchor-date-modal 2 ·
#           daypanel-closed 2 · new-anchor-provisional 3   (≥ — 등호 아님)
#   음성    zzzNoSuchMarker98 0
#
# ⚠ `채우면 다음 발행에 반영됩니다`는 **역방향이 아니라 존속**이다 — 소방계획서 칩이 같은 글자를
#   계속 쓴다(보고서 축만 뺐다). 공유 부품 함정(86회차 전례).
# ⚠ HEAD 비교는 **full sha 접두**로 한다(97회차: --short 7자 vs 8자 표기로 헛되이 섰다).
set -u

EXPECT_HEAD=ac9cbed7
EXPECT_IMG=b10509516a78
ROLLBACK_TAG=erp-app:rollback-ac9cbed

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
  && echo "이미 있음: $ROLLBACK_TAG" \
  || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse origin/main)
echo "target = $TARGET"
for C in 53806ec1 74399f84 a804d283; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" origin/main || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
MIG=$(git -C /home/ubuntu/woni diff --name-only HEAD..origin/main -- erp/supabase/migrations | wc -l)
[ "$MIG" = "0" ] || { echo "GUARD_FAIL_MIGRATION:$MIG"; exit 34; }
git -C /home/ubuntu/woni merge --ff-only origin/main || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD)
echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }

echo "=== BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== 다음 회차 복귀점 ==="
SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"

echo "=== UP DONE — 마커는 별도 verify로 잰다 ==="
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
