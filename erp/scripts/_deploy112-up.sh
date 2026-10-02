#!/usr/bin/env bash
# 112회차 운영 배포 — 6d1c6787 → fad207e1(EXPECT_TARGET까지만 ff) · 3커밋 · 마이그 1(170, 스테이징·운영 적용 완료 2026-10-02)
#   a84b5af2·27b7e6b7 ci·마이그 규율(타 세션 A4, CI·스크립트·문서만 — 앱 무영향) · fad207e1 불량→매출 2단계(관계인 열람·승인 링크 /p/{token})
#
# 🚨 회차: 착수 실측(2026-10-02) — 서버 HEAD 6d1c678·img cf5361245c7c·rollback-6d1c678 존재·inflight 0 → **112**(111=erp-7a B2).
# origin/main은 bf0b1459(111 기록 2커밋, 문서 전용)까지 앞서 있다 — EXPECT_TARGET(fad207e1)까지만 ff.
# 마커(운영 before 실측): 신규 share-links-section·share-link-create·share-page·share-approve-submit·share-quote-table 0 ·
#   존속 repair-sales-page 5·quote-preview 2·send-submit 2·repair-sales-chain 7·replaceState(null 28·form13-station-select 2 · xlsx 5dc767d1a9101aa9.
#   /p/{43자} 은 before 307→/login(공개 경로 아님) — after는 404(유효 토큰 없음)여야 한다.
#
set -u
EXPECT_HEAD=6d1c6787
EXPECT_IMG=cf5361245c7c   # 111회차(erp-7a) after 이미지
ROLLBACK_TAG=erp-app:rollback-6d1c678
EXPECT_TARGET=fad207e1afaaacb472de1f92ffcbb72da1f91a73
EXPECT_MIG=erp/supabase/migrations/170_share_links.sql
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
for C in a84b5af2 27b7e6b7 fad207e1; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
# 마이그 1건(170) — 스테이징·운영 적용 완료. 다른 게 섞이면 선다.
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
