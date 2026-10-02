#!/usr/bin/env bash
# 114회차 운영 배포 — 0ca796a4 → 4c5c7f08 · 3커밋 · 마이그 0 · **앱 코드 0**(compose·문서·배포 기록뿐)
#   435101bd A5 — 컨테이너 메모리 상한·헬스체크 + 스테이징을 운영 네트워크에서 분리(통합 실행계획 A5)
#   c5f08fa8 113회차 기록 · 4c5c7f08 체크리스트
#
# 🚨 회차: 착수 실측(2026-10-02) — 서버 HEAD 0ca796a·img 50ed7f922870·inflight 0·서버 스크립트 112까지 → **114**
#   (113 스크립트는 c5f08fa8에 있어 서버엔 아직 없다).
# 🚨 앱 이미지는 다시 굽지 않는다(`up -d`, --build 없음) — 코드가 같으므로 컨테이너만 새 설정으로 재생성된다.
#   app·gotenberg-prod·caddy 셋이 재생성되며 수 초 끊김이 있을 수 있다.
# 🚨 순서: 이 운영 up이 erp_staging_edge 네트워크를 만든다. 스테이징은 꺼져 있고 이번 범위가 아니다
#   (스테이징을 올릴 때는 그 체크아웃이 435101bd 이후여야 한다 — 배포순서.md 「인프라 위생」).
set -u
EXPECT_HEAD=0ca796a4
EXPECT_IMG=50ed7f922870   # 113회차 after 이미지
ROLLBACK_TAG=erp-app:rollback-0ca796a
EXPECT_TARGET=4c5c7f08be427bb8757cc557c1fcae69daf4fc37
EXPECT_CADDY=sjfire-caddy:2.11.4-ratelimit
ROLLBACK_DIR=/home/ubuntu/rollback-0ca796a
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
mkdir -p "$ROLLBACK_DIR" && cp docker-compose.prod.yml docker-compose.staging.yml deploy/Caddyfile "$ROLLBACK_DIR"/ \
  && echo "compose·Caddyfile 구판 → $ROLLBACK_DIR" || { echo ROLLBACK_COPY_FAIL; exit 26; }

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$EXPECT_TARGET
echo "target = $TARGET (origin/main=$(git -C /home/ubuntu/woni rev-parse --short origin/main))"
git -C /home/ubuntu/woni merge-base --is-ancestor "$TARGET" origin/main || { echo GUARD_FAIL_TARGET_NOT_IN_ORIGIN; exit 35; }
git -C /home/ubuntu/woni merge-base --is-ancestor 435101bd "$TARGET" || { echo "A5_NOT_IN_TARGET"; exit 32; }
# 앱 코드·마이그가 섞이면 선다 — 이 회차는 compose만 바꾸므로 이미지를 다시 굽지 않는다
CODE=$(git -C /home/ubuntu/woni diff --name-only HEAD.."$TARGET" -- erp/src erp/Dockerfile erp/package.json erp/package-lock.json erp/next.config.ts erp/supabase/migrations erp/public erp/templates erp/assets | wc -l)
[ "$CODE" = "0" ] || { echo "GUARD_FAIL_CODE_IN_RANGE:$CODE"; exit 34; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD); echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }

echo "=== CONFIG CHECK ==="
docker compose -f docker-compose.prod.yml config --quiet || { echo CONFIG_FAIL; exit 36; }

echo "=== UP (재빌드 없음) ==="
docker compose -f docker-compose.prod.yml up -d 2>&1 | tail -15
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo UP_FAIL; exit 40; }

echo "=== healthy 대기(최대 150초) ==="
for i in $(seq 1 30); do
  A=$(docker inspect --format '{{.State.Health.Status}}' erp-app-1 2>/dev/null)
  G=$(docker inspect --format '{{.State.Health.Status}}' gotenberg-prod 2>/dev/null)
  echo "  t=$((i*5))s app=$A gotenberg=$G"
  [ "$A" = "healthy" ] && [ "$G" = "healthy" ] && break
  sleep 5
done

echo "=== 다음 회차 복귀점 ==="
SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
