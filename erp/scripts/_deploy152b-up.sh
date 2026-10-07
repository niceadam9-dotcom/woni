#!/usr/bin/env bash
# 152회차 재시도(152b) — 2320b179 · 앱 재빌드 · 마이그 0 · caddy 무접촉
#
# 1차(152) 사고: `up -d --build` 빌드 중 호스트 스래싱 → 14:32 무응답 → 14:39 하드 리셋. 운영 무응답 ~15분.
#   착수 availMB 2038로 가드(1500)는 통과했었다 — 착수 가드는 빌드 피크를 못 막는다(126 교훈 재확인).
#   재부팅 뒤 앱은 구 이미지로 정상 기동, 서버 git HEAD만 2320b179로 앞서 있다(ff는 1차에서 이미 끝).
#
# 이번 수(사용자 승인 「나」):
#   ① 빌드 동안 스테이징 컨테이너 2개를 끈다 — 끝나면 성공·실패 무관하게 다시 켠다(trap EXIT)
#   ② **빌드에 메모리 상한** — 레거시 빌더 `--memory 2600m --memory-swap 3200m`. 넘으면 빌드 컨테이너만
#      OOM으로 죽고 빌드가 실패한다(호스트는 살고, 운영 앱은 구 이미지 그대로). BuildKit(docker 드라이버)은
#      빌드 메모리 상한을 못 건다.
#   ③ 빌드가 성공했을 때만 `compose up -d --no-build app`으로 갈아 끼운다
#   ④ 15초마다 availMB·swap 기록(사후 판정용)
set -u
EXPECT_HEAD=2320b179
EXPECT_IMG=c56dc4ff5f51
ROLLBACK_TAG=erp-app:rollback-5bef8844
EXPECT_CADDY=sjfire-caddy:2.11.4-ratelimit
STAGING="erp-staging-app gotenberg-staging"
export COMPOSE_PARALLEL_LIMIT=1

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1 2>/dev/null)
INFLIGHT=$(ps -eo cmd | grep -E 'docker (compose|build)' | grep -v grep | wc -l)
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "HEAD=$H · dirty=$D · img=$R · caddy=$CI · inflight=$INFLIGHT · availMB=$AVAIL"
case "$H" in $EXPECT_HEAD*) ;; *) echo GUARD_FAIL_HEAD; exit 21;; esac
[ "$D" = "0" ]              || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ]    || { echo GUARD_FAIL_IMG; exit 23; }
[ "$CI" = "$EXPECT_CADDY" ] || { echo GUARD_FAIL_CADDY; exit 25; }
[ "$INFLIGHT" = "0" ]       || { echo GUARD_FAIL_INFLIGHT; exit 24; }
[ "$AVAIL" -ge 2500 ]       || { echo GUARD_FAIL_LOWMEM; exit 26; }
RB=$(docker inspect --format '{{.Id}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
[ "$RB" = "$EXPECT_IMG" ] || { echo "GUARD_FAIL_ROLLBACK:$RB"; exit 27; }
echo "복귀점 $ROLLBACK_TAG = $RB"

MONPID=""
restore() {
  [ -n "$MONPID" ] && kill "$MONPID" 2>/dev/null
  docker start $STAGING >/dev/null 2>&1
  echo "스테이징 재기동: $(docker ps --filter name=staging --format '{{.Names}}={{.Status}}' | tr '\n' ' ')"
}
trap restore EXIT

echo "=== 스테이징 정지 ==="
docker stop $STAGING
echo "availMB(정지 후)=$(free -m | awk '/^Mem:/{print $7}')"
( while true; do echo "mem $(date +%T) avail=$(free -m | awk '/^Mem:/{print $7}') swapUsed=$(free -m | awk '/^Swap:/{print $3}')"; sleep 15; done ) &
MONPID=$!

echo "=== BUILD (메모리 상한 2600m/3200m) ==="
DOCKER_BUILDKIT=0 docker build --memory=2600m --memory-swap=3200m -t erp-app:latest -f Dockerfile . 2>&1 | tail -12
BRC=${PIPESTATUS[0]}; echo "BUILD_RC=$BRC"
[ "$BRC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== UP (no-build, app만) ==="
docker compose -f docker-compose.prod.yml up -d --no-build app 2>&1 | tail -6
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo UP_FAIL; exit 41; }
sleep 8
echo "app img=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19) status=$(docker inspect --format '{{.State.Status}}' erp-app-1)"
SHORT=$(git -C /home/ubuntu/woni rev-parse --short=8 HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"
echo UP_SCRIPT_DONE
