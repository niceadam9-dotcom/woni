#!/usr/bin/env bash
# 135회차 — www 요금 문구 「상담 전화」 · git ff만(앱 빌드 0·caddy 재시작 0·마이그 0) · f3276280 → 5a643c4b
#   사이트 폴더는 caddy에 디렉터리 bind mount(132)라 ff만으로 즉시 반영된다.
#   범위: 134 기록(58bba196) + software.html
set -u
EXPECT_HEAD=f3276280
EXPECT_IMG=b9659468f7b3
EXPECT_TARGET=5a643c4b
ALLOWED_RE='^(erp/deploy/site/|erp/scripts/_deploy[0-9]+-(up|verify)\.sh$|erp_goal/.*\.md$)'

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "HEAD=$H (기대 $EXPECT_HEAD*) · dirty=$D · img=$R (기대 $EXPECT_IMG) · inflight=$INFLIGHT"
case "$H" in $EXPECT_HEAD*) ;; *) echo GUARD_FAIL_HEAD; exit 21;; esac
[ "$D" = "0" ]           || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_IMG; exit 23; }
[ "$INFLIGHT" = "0" ]    || { echo GUARD_FAIL_INFLIGHT; exit 24; }

echo "=== FETCH · 범위 ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse "$EXPECT_TARGET") || { echo GUARD_FAIL_TARGET_UNKNOWN; exit 35; }
git -C /home/ubuntu/woni merge-base --is-ancestor "$TARGET" origin/main || { echo GUARD_FAIL_TARGET_NOT_IN_ORIGIN; exit 35; }
# quotepath=off — 한글 경로가 "erp_goal/C1_\353..." 꼴로 따옴표·8진수 이스케이프되면 허용 정규식이 못 맞춘다(1차 실행 GUARD_FAIL_SCOPE 오탐)
CHANGED=$(git -C /home/ubuntu/woni -c core.quotepath=off diff --name-only HEAD.."$TARGET")
echo "$CHANGED"
OUTSIDE=$(echo "$CHANGED" | grep -v -E "$ALLOWED_RE" | grep -v '^$' || true)
[ -z "$OUTSIDE" ] || { echo "GUARD_FAIL_SCOPE:"; echo "$OUTSIDE"; exit 34; }

echo "=== FF ==="
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse HEAD)"
echo "app img now=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19) (기대 불변 $EXPECT_IMG)"
echo UP_SCRIPT_DONE
