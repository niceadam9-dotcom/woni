#!/usr/bin/env bash
# 133회차 — www 사이트 팩스 추가(f4c3acd6) · git ff만(앱 빌드 0·caddy 재시작 0·마이그 0) · c8dc786d → f4c3acd6
#   사이트 폴더는 caddy에 디렉터리 bind mount(132)라 ff만으로 즉시 반영된다.
#   범위에 실리는 타 커밋: 73f4be01(131 기록)·042dd1cd(132 기록) — 스크립트·문서뿐.
set -u
EXPECT_HEAD=c8dc786d
EXPECT_IMG=b9659468f7b3
EXPECT_TARGET=f4c3acd6
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
