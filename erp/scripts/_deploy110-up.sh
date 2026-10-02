#!/usr/bin/env bash
# 110회차 운영 배포 — 493f9777 → origin/main(624e016c) · 1커밋 · 마이그 0 (109회차=erp-7a B1이 493f9777까지 선반영 — 회차 선점 전례 61→62와 동일)
#   cf60f197 / 493f9777 feat(법정 외부 연계 1단계): 제출 기록 3열·배치신고 조회 열·복사 카드 (erp-7a 세션, 푸시됨)
#   4b04f4f1 chore(배포): 108회차 기록                                                   (문서·스크립트)
#   624e016c feat(불량→매출): 보수 견적 전용 페이지 — 작성·미리보기·메일 발송·송부 이력
#
# 🚨 회차: 착수 실측(2026-10-02) — 서버 HEAD 7c07db3·img 964ded47f11e·rollback-493f977 존재(109회차 통지로 확인)·inflight 0·dirty 0 → **109**.
# Caddy는 108회차에 sjfire-caddy:2.11.4-ratelimit로 교체돼 이번엔 재빌드 불필요(compose 변경 없음) — 통상 up만.
# 마커(운영 before 실측 2026-10-02): 신규 repair-sales-page·quote-preview·send-submit·open-repair-page·delivery-list 전부 0 ·
#   존속 repair-sales-chain 2·unquoted-strip 2·replaceState(null 28·form13-station-select 2·history-progress 2 · xlsx 5dc767d1a9101aa9.
set -u
EXPECT_HEAD=493f9777
EXPECT_IMG=9eee0f21be91   # 109회차(erp-7a) after 이미지 — 2026-10-02 서버 실측
ROLLBACK_TAG=erp-app:rollback-493f977
EXPECT_TARGET=624e016cd8060fbfb71e7453506731758c9fcba2
EXPECT_MIG=   # 493f9777..624e016c 마이그 0 — 빈 값이어야 한다
EXPECT_CADDY=sjfire-caddy:2.11.4-ratelimit
export COMPOSE_PARALLEL_LIMIT=1

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }
echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1 2>/dev/null)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "HEAD=$H (기대 $EXPECT_HEAD*) · dirty=$D · img=$R (기대 $EXPECT_IMG) · caddy=$CI · inflight=$INFLIGHT"
case "$H" in $EXPECT_HEAD*) ;; *) echo GUARD_FAIL_HEAD; exit 21;; esac
[ "$D" = "0" ]              || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ]    || { echo GUARD_FAIL_IMG; exit 23; }
[ "$CI" = "$EXPECT_CADDY" ] || { echo GUARD_FAIL_CADDY; exit 25; }
[ "$INFLIGHT" = "0" ]       || { echo GUARD_FAIL_INFLIGHT; exit 24; }
echo "=== 복귀점 확보 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "이미 있음: $ROLLBACK_TAG" || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }
echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
# origin은 그 위로 움직일 수 있다(2026-10-02 A3 4b7d2b84·마이그 168이 먼저 올라옴) — 승인 범위는 624e016c까지라
# origin/main이 아니라 **EXPECT_TARGET까지만** ff한다(109회차 erp-7a와 같은 방식). 조상이 아니면 선다.
TARGET=$EXPECT_TARGET
echo "target = $TARGET (origin/main=$(git -C /home/ubuntu/woni rev-parse --short origin/main))"
git -C /home/ubuntu/woni merge-base --is-ancestor "$TARGET" origin/main || { echo GUARD_FAIL_TARGET_NOT_IN_ORIGIN; exit 35; }
for C in 624e016c; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
# 마이그 0건 — 섞이면 선다.
MIG=$(git -C /home/ubuntu/woni diff --name-only HEAD.."$TARGET" -- erp/supabase/migrations)
[ "$MIG" = "$EXPECT_MIG" ] || { echo "GUARD_FAIL_MIGRATION:[$MIG]"; exit 34; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD); echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }
echo "=== BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
sleep 8
echo "caddy status=$(docker inspect --format '{{.State.Status}}' erp-caddy-1) image=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1)"
echo "=== 다음 회차 복귀점 ==="
SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
