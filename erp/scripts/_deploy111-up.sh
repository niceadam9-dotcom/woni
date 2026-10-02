#!/usr/bin/env bash
# 111회차 운영 배포 — 624e016c → 6d1c6787 · 7커밋 · 마이그 3(163·168·169 — 전부 운영 DB에 이미 존재, 2026-10-02 실측)
#   906bca8c / 6d1c6787 feat·fix(세금계산서 B2): 발행 결함 셋(169) + 홈택스 일괄발급 엑셀·승인번호 가져오기      (erp-7a)
#   4b7d2b84 feat(관측 A3): 크론 공용 래퍼(cron_runs 168)·/api/health·instrumentation(Sentry — 운영 DSN 없음 → init 건너뜀)
#   036c3c8e ci(A4) · e8e46f51 docs · 1cb3902e / dc8e58f7 배포 기록                                         (앱 무영향)
#   ⚠ origin/main 끝(27b7e6b7, CI 전용 2커밋)은 넣지 않는다 — EXPECT_TARGET까지만 ff(109회차와 같은 규약).
# 🚨 회차: 착수 실측(2026-10-02) — 서버 HEAD 624e016c·img e8e1d702e506·rollback-624e016 존재·inflight 0·dirty 0 → **111**.
# caddy·compose 변경 0 → 앱만 재빌드. crontab 재설치 없음(크론 라우트 코드만 바뀐다).
# 마커(운영 before 실측 2026-10-02): 신규 hometax-bulk-panel 0·hometax-export 0·buyer-bizno 0·company-tax-fields 0 ·
#   존속 placement-card 2·repair-sales-chain 7·replaceState(null 28 · xlsx 5dc767d1a9101aa9.
# 복귀: erp-app:rollback-624e016 상존. compose·Caddyfile 불변이라 이미지 되돌림만으로 충분.
set -u
EXPECT_HEAD=624e016c
EXPECT_IMG=e8e1d702e506
ROLLBACK_TAG=erp-app:rollback-624e016
EXPECT_TARGET=6d1c678707fa13337eeadc97be23f69dcd51332a
EXPECT_MIG='erp/supabase/migrations/163_customer_agency.sql
erp/supabase/migrations/168_cron_runs.sql
erp/supabase/migrations/169_company_tax_fields.sql'
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
# ⚠ origin/main은 6d1c6787 뒤에 CI 전용 2커밋(a84b5af2·27b7e6b7)이 더 있다.
# 승인받은 111회차 범위는 B2까지다 — origin/main 끝이 아니라 **EXPECT_TARGET까지만** ff한다.
# (CI 전용이라 앱 무영향 — 다음 회차에 자연히 실린다.)
git -C /home/ubuntu/woni merge-base --is-ancestor "$EXPECT_TARGET" origin/main || { echo "TARGET_NOT_ON_MAIN:$EXPECT_TARGET"; exit 35; }
TARGET=$EXPECT_TARGET
echo "target = $TARGET (origin/main=$(git -C /home/ubuntu/woni rev-parse --short origin/main))"
for C in 4b7d2b84 906bca8c 6d1c6787; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
# 마이그 3건(163·168·169)만 — 셋 다 운영 DB에 이미 있다(2026-10-02 실측). 다른 게 섞이면 선다.
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
