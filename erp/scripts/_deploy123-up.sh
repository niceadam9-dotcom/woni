#!/usr/bin/env bash
# 123회차 운영 배포 — 1b16e6b1 → 021482de(EXPECT_TARGET까지만 ff) · 1커밋 · 마이그 0
#   021482de 모바일 /api/mobile/* — 앱 Bearer 요청이 proxy에서 /login 307되던 결함, 라우트가 직접 인증(requireMobileUser)
#   origin에 위로 얹힌 f3003b0f(erp-08 C3 3단계 설비 QR 1단계)·f9c188ce(122 기록)는 이 회차에 싣지 않는다 — 그 세션 몫.
#
# 착수 실측(2026-10-03): 서버 HEAD 1b16e6b·img 5086b8def17a·healthy·rollback-1b16e6b 존재·inflight 0.
# 마커(운영 before 실측): 신규 「사용할 수 없는 계정입니다」 0 · 내부 무인증 POST /api/mobile/classify-defects 307 →(기대) 401 ·
#   존속 seal-preview 2·somin-hwpx 2·equipment-ledger 4·owner-report-quote-line 2.
set -u
EXPECT_HEAD=1b16e6b1
EXPECT_IMG=5086b8def17a   # 122회차(erp-a3 B4 마무리) after 이미지
ROLLBACK_TAG=erp-app:rollback-1b16e6b
EXPECT_TARGET=021482dec4d7c1d2d2ad3b353e79a629f60e2011
# 마이그 0건 — 섞이면 선다.
EXPECT_MIG=
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
TARGET=$EXPECT_TARGET
echo "target = $TARGET (origin/main=$(git -C /home/ubuntu/woni rev-parse --short origin/main))"
git -C /home/ubuntu/woni merge-base --is-ancestor "$TARGET" origin/main || { echo GUARD_FAIL_TARGET_NOT_IN_ORIGIN; exit 35; }
for C in 021482de; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
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
