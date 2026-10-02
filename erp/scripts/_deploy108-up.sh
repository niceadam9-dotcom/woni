#!/usr/bin/env bash
# 108회차 운영 배포 — c455a0e7 → origin/main(7c07db3c) · 10커밋 · 마이그 1(166, 운영 적용 완료 2026-10-02)
#   8925931f chore(배포): 107회차 기록                                                      (문서·스크립트)
#   eecd1201 / bb6aa33b / f6cd8951 / 84b3a9d7 docs(erp_goal): 비교진단 절 3건·통합 실행계획      (문서 전용)
#   2fdb1b31 / 714de1b9 chore(backup): A1 야간 백업 — deploy/backup/*, cron 파일(서버 crontab은 **이번에 미반영**)
#   586447ea fix(보안): A2 — Caddy rate_limit 자체 이미지(deploy/caddy)·compose·Edge 3함수·upload-guard·config.toml
#   4d61f98f feat(불량→매출 1단계): ⑤ 보수 칸 견적→수주→청구 사슬 + 견적 PDF + 이행기한 크론 수리
#   7c07db3c chore(마이그 166): 적용 스크립트 --only 옵션
#
# 🚨 회차: 착수 실측(2026-10-02) — 서버 HEAD c455a0e·img a750a6ac818a·rollback-c455a0e 존재·inflight 0·dirty 0 → **108**.
# 🚨 Caddy 순서(A2 세션 지시): Caddyfile에 rate_limit이 들어가 **공식 이미지로 뜨면 기동 실패 → HTTPS 전체 다운**.
#    그래서 (1) caddy 이미지 먼저 build → (2) `caddy validate` "Valid configuration" → (3) app build·up. 병렬 금지(4GB VPS).
#    crontab 재설치 없음(A1 서버 준비물 미설치 — 재설치하면 02:00마다 실패 로그만 쌓인다).
# 복귀: erp-app:rollback-c455a0e + /home/ubuntu/rollback-c455a0e/{Caddyfile,docker-compose.prod.yml}(구판) + caddy:2.11.4-alpine 이미지 상존.
# 마커(운영 before 실측 2026-10-02): 번들 repair-sales-chain 0 · unquoted-strip 0 · quote-create-open 0 · 존속 replaceState(null 28 ·
#   form13-station-select 2 · report-gaps-strip- 4 · tab-gap- 4 · cal-toolbar 2 · cal-range-loading 2 · history-progress 2 · xlsx 5dc767d1a9101aa9.
#   저장소 파일: Caddyfile rate_limit 0 · compose sjfire-caddy 0 / caddy:2.11.4-alpine 1 · deploy/backup 0 · upload-guard.ts 0 ·
#   config.toml enable_signup=false 0 · add-defect canTouchInspection 0 · 컨테이너 caddy 이미지 caddy:2.11.4-alpine · crontab 26줄(Sep 5).
set -u
EXPECT_HEAD=c455a0e7
EXPECT_IMG=a750a6ac818a
ROLLBACK_TAG=erp-app:rollback-c455a0e
EXPECT_TARGET=7c07db3cf070ef6956500ce46894c7a90a572bac
EXPECT_MIG=erp/supabase/migrations/166_defect_to_revenue.sql
CADDY_IMG=sjfire-caddy:2.11.4-ratelimit
export COMPOSE_PARALLEL_LIMIT=1

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
echo "=== 복귀점 확보 (앱 이미지 + Caddy 구판 파일) ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "이미 있음: $ROLLBACK_TAG" || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }
mkdir -p /home/ubuntu/rollback-c455a0e
git -C /home/ubuntu/woni show c455a0e7:erp/deploy/Caddyfile > /home/ubuntu/rollback-c455a0e/Caddyfile
git -C /home/ubuntu/woni show c455a0e7:erp/docker-compose.prod.yml > /home/ubuntu/rollback-c455a0e/docker-compose.prod.yml
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF 'caddy:2.11.4-alpine' && echo "caddy 구 이미지 상존 caddy:2.11.4-alpine" || echo "⚠ caddy 구 이미지 없음(복귀 시 pull 필요)"
echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse origin/main)
echo "target = $TARGET"
[ "$TARGET" = "$EXPECT_TARGET" ] || { echo "GUARD_FAIL_TARGET_MOVED:$TARGET"; exit 35; }
for C in 8925931f 586447ea 4d61f98f 7c07db3c; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" origin/main || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
# 마이그 1건(166)만 — 운영 DB 적용은 2026-10-02 _apply-166-both.mjs --only=prod 로 끝났다(cols 16·check 1·idx 3). 다른 게 섞이면 선다.
MIG=$(git -C /home/ubuntu/woni diff --name-only HEAD..origin/main -- erp/supabase/migrations)
[ "$MIG" = "$EXPECT_MIG" ] || { echo "GUARD_FAIL_MIGRATION:[$MIG]"; exit 34; }
git -C /home/ubuntu/woni merge --ff-only origin/main || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD); echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }
echo "=== CADDY BUILD (xcaddy, 수 분) ==="
docker compose -f docker-compose.prod.yml build caddy 2>&1 | tail -8
CB_RC=${PIPESTATUS[0]}; echo "CADDY_BUILD_RC=$CB_RC"
[ "$CB_RC" = "0" ] || { echo CADDY_BUILD_FAIL; exit 41; }
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$CADDY_IMG" || { echo CADDY_IMG_MISSING; exit 42; }
echo "=== CADDY VALIDATE ==="
VAL=$(docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMG" caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -3)
echo "$VAL"
echo "$VAL" | grep -q 'Valid configuration' || { echo CADDY_VALIDATE_FAIL; exit 43; }
echo "=== APP BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
sleep 8
echo "caddy status=$(docker inspect --format '{{.State.Status}}' erp-caddy-1) image=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1)"
echo "caddy unrecognized=$(docker compose -f docker-compose.prod.yml logs caddy --since 5m 2>&1 | grep -c unrecognized)"
echo "=== 다음 회차 복귀점 ==="
SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
