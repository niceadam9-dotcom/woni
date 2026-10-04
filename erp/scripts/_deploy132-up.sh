#!/usr/bin/env bash
# 132회차 — www.sjfire.co.kr 정적 사이트 · caddy만 재생성(앱 빌드 0·마이그 0) · fe114ebc → c8dc786d
#   c8dc786d: Caddyfile www 301 → file_server /srv/site · compose caddy에 ./deploy/site:/srv/site:ro · deploy/site 5파일
#   C1 세션(fe114ebc까지)이 먼저 배포한 뒤, 그 HEAD에서 c8dc786d 하나만 ff 한다.
# 순서(108 규약): 새 Caddyfile을 **ff 전에** 현 caddy 이미지로 validate → ff → caddy만 재생성 → 검증.
#   validate 실패면 ff조차 하지 않고 멈춘다(HTTPS 전체가 caddy 하나에 걸려 있다).
set -u
EXPECT_HEAD=fe114ebc      # 131회차(C1 E, mobile-inspection-checklist-offline 세션) after HEAD
EXPECT_IMG=b9659468f7b3   # 131회차 after 앱 이미지(서버 실측) — 이 회차는 앱을 건드리지 않으므로 끝나도 같아야 한다
EXPECT_TARGET=c8dc786d    # 실행 전 전체 sha로 바꿔도 된다
EXPECT_CADDY=sjfire-caddy:2.11.4-ratelimit
ALLOWED_RE='^erp/(deploy/site/|deploy/Caddyfile$|docker-compose\.prod\.yml$)'
export COMPOSE_PARALLEL_LIMIT=1

[ "$EXPECT_HEAD" != "TBD" ] && [ "$EXPECT_IMG" != "TBD" ] || { echo "GUARD_FAIL_TBD — EXPECT_HEAD·EXPECT_IMG를 실측으로 채울 것"; exit 20; }
cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
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

echo "=== FETCH · 범위 확인 ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse "$EXPECT_TARGET") || { echo GUARD_FAIL_TARGET_UNKNOWN; exit 35; }
git -C /home/ubuntu/woni merge-base --is-ancestor "$TARGET" origin/main || { echo GUARD_FAIL_TARGET_NOT_IN_ORIGIN; exit 35; }
git -C /home/ubuntu/woni merge-base --is-ancestor HEAD "$TARGET" || { echo GUARD_FAIL_NOT_FF; exit 36; }
CHANGED=$(git -C /home/ubuntu/woni diff --name-only HEAD.."$TARGET")
echo "$CHANGED"
OUTSIDE=$(echo "$CHANGED" | grep -v -E "$ALLOWED_RE" | grep -v '^$' || true)
[ -z "$OUTSIDE" ] || { echo "GUARD_FAIL_SCOPE — 사이트·caddy 밖 변경이 섞임(앱 빌드가 필요한 회차다):"; echo "$OUTSIDE"; exit 34; }

echo "=== 복귀점(구판 설정 보관) ==="
RB=/home/ubuntu/rollback-www-$(git -C /home/ubuntu/woni rev-parse --short HEAD)
mkdir -p "$RB" && cp deploy/Caddyfile docker-compose.prod.yml "$RB"/ && echo "saved $RB"

echo "=== VALIDATE (ff 전, 새 Caddyfile + 새 사이트 폴더) ==="
TMP=$(mktemp -d)
git -C /home/ubuntu/woni show "$TARGET:erp/deploy/Caddyfile" > "$TMP/Caddyfile"
VAL=$(docker run --rm -v "$TMP/Caddyfile:/etc/caddy/Caddyfile:ro" "$EXPECT_CADDY" caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -3)
echo "$VAL"
echo "$VAL" | grep -q "Valid configuration" || { echo VALIDATE_FAIL; rm -rf "$TMP"; exit 41; }
rm -rf "$TMP"

echo "=== FF ==="
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse HEAD)"
ls deploy/site deploy/site/assets

echo "=== CADDY만 재생성(앱·빌드 손대지 않음) ==="
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build caddy 2>&1 | tail -8
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo "CADDY_UP_FAIL — 복귀: cp $RB/* 원위치 후 git reset --hard $H, up -d --no-deps --no-build caddy"; exit 40; }
sleep 5
echo "caddy status=$(docker inspect --format '{{.State.Status}}' erp-caddy-1) image=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1)"
echo "app img now=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19) (기대 불변 $EXPECT_IMG)"
echo UP_SCRIPT_DONE
