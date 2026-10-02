#!/usr/bin/env bash
# 109회차 운영 배포 — 7c07db3c → origin/main(493f9777) · 3커밋 · 마이그 1(167, 운영 적용 완료 2026-10-02 _apply-167-both.mjs: 열 11·백필 2=폴드 2·단계 지문 불변)
#   cf60f197 feat(법정 외부 연계 1단계): 제출 기록 3열·배치신고 조회 열·외부 대상물 번호 + ②④ 칸·달력 하루 5건 경고·제출현황 보드
#   4b04f4f1 chore(배포): 108회차 기록 (문서·스크립트 전용)
#   493f9777 fix(법정 외부 연계 1단계): 배치신고 조회 열 쓰기 병렬화 + 167 적용 스크립트
#
# 🚨 회차: 착수 실측(2026-10-02) — 서버 HEAD 7c07db3c·img 964ded47f11e·rollback-7c07db3 존재·inflight 0·dirty 0 → **109**.
# 108과 달리 Caddy·compose 변경 0 — caddy 빌드 단계 없음. 앱 빌드·교체만.
# 마커(운영 before 실측 2026-10-02): 신규 placement-card 0·submit9-via 0·somin-link 0·placement-extra 0·calendar-placement-over 0 ·
#   존속 repair-sales-chain 2·replaceState(null 28 · xlsx 5dc767d1a9101aa9 · caddy sjfire-caddy:2.11.4-ratelimit running.
# 복귀: erp-app:rollback-7c07db3 상존(108이 태깅). compose·Caddyfile 불변이라 이미지 되돌림만으로 충분.
set -u
EXPECT_HEAD=7c07db3c
EXPECT_IMG=964ded47f11e
ROLLBACK_TAG=erp-app:rollback-7c07db3
EXPECT_TARGET=493f9777c5bd3b3758da0059c02a8113fefd98b3
EXPECT_MIG=erp/supabase/migrations/167_legal_link_records.sql
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
echo "=== 복귀점 확인 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "복귀 태그 상존: $ROLLBACK_TAG" || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }
echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
# ⚠ origin/main은 493f9777 푸시 **뒤에** 타 세션의 624e016c(보수 견적 페이지)가 또 올라가 움직였다.
# 승인받은 109회차 범위는 B1까지다 — origin/main 끝이 아니라 **EXPECT_TARGET까지만** ff한다.
# (첫 실행이 GUARD_FAIL_TARGET_MOVED로 선 것이 이 가드의 일이다. 624e016c는 다음 회차 몫.)
git -C /home/ubuntu/woni merge-base --is-ancestor "$EXPECT_TARGET" origin/main || { echo "TARGET_NOT_ON_MAIN:$EXPECT_TARGET"; exit 35; }
TARGET=$EXPECT_TARGET
echo "target = $TARGET (origin/main=$(git -C /home/ubuntu/woni rev-parse --short origin/main))"
for C in cf60f197 4b04f4f1 493f9777; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
# 마이그 1건(167)만 — 운영 DB 적용은 2026-10-02 _apply-167-both.mjs --only=prod 로 끝났다. 다른 게 섞이면 선다.
MIG=$(git -C /home/ubuntu/woni diff --name-only "HEAD..$TARGET" -- erp/supabase/migrations)
[ "$MIG" = "$EXPECT_MIG" ] || { echo "GUARD_FAIL_MIGRATION:[$MIG]"; exit 34; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD); echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }
echo "=== APP BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
sleep 8
echo "app status=$(docker inspect --format '{{.State.Status}}' erp-app-1)"
echo "caddy status=$(docker inspect --format '{{.State.Status}}' erp-caddy-1) image=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1)"
echo "=== 다음 회차 복귀점 ==="
SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
