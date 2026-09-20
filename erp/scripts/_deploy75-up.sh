#!/usr/bin/env bash
# 75회차 운영 배포 — f294a345 -> ea0e6801 (1커밋: 고객 등록 버튼 제목 옆 이사 + 프로브)
#   feat(고객 관리): [+ 고객 등록]을 제목 바로 옆으로 — 데스크탑 마우스 동선 (ea0e6801)
#   구간에 남의 커밋 없음(직전 74회차가 f294a345까지 소진) — 마이그 0.
#
# 마커 3분법:
#   구조교대  customers 페이지 서버 청크('행을 클릭하면 상세로 이동' 포함 파일)에서
#             '고객 등록' vs '전체 점검유형' 바이트 오프셋: 구=등록 후행(검색줄) → 신=등록 선행(제목 옆)
#             ⚠ 컨테이너는 BusyBox라 grep -ob 불가(73회차 실측) — docker cp로 꺼내 호스트 grep으로 잰다
#   존속      mgr171_ · evacmap15_zone · ⑤⑥은 점검표에(73회차 신규) 유지
#   음성      zzzNoSuchMarker75 = 0
set -u

EXPECT_HEAD=f294a3451c02d56cdd78d231c49cbe12f7dd48fd
EXPECT_IMG=ea4a6254e1fc
TARGET=ea0e6801
ROLLBACK_TAG=erp-app:rollback-f294a345
NEXT_ROLLBACK=erp-app:rollback-ea0e6801

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)
T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
echo "HEAD=$H"; echo "DIRTY=$D"; echo "RUNNING=$R"; echo "LATEST=$L"; echo "ROLLBACK=$T"
[ "$H" = "$EXPECT_HEAD" ] || { echo GUARD_FAIL_HEAD; exit 21; }
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ -n "$R" ]               || { echo GUARD_FAIL_RUNNING_EMPTY; exit 23; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_LATEST; exit 25; }
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 26; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

# 페이지 서버 청크에서 '고객 등록' vs '전체 점검유형' 오프셋 판정 — 호스트 grep(-obF)으로.
# $1=라벨 $2=이미지(예: erp-app:latest) — 이미지에서 꺼낸다(실행 중 컨테이너와 무관하게 동작)
order() {
  f=$(sudo docker run --rm --entrypoint sh "$2" -c "grep -rlF '행을 클릭하면 상세로 이동' /app/.next/server 2>/dev/null | head -1")
  if [ -z "$f" ]; then echo "  $1 구조교대: 페이지 청크 못 찾음"; return; fi
  sudo docker create --name tmpo75 "$2" >/dev/null
  sudo docker cp "tmpo75:$f" /tmp/pg75.js 2>/dev/null
  sudo docker rm tmpo75 >/dev/null
  a=$(grep -obF '고객 등록' /tmp/pg75.js | head -1 | cut -d: -f1)
  b=$(grep -obF '전체 점검유형' /tmp/pg75.js | head -1 | cut -d: -f1)
  echo "  $1 구조교대: 등록@${a:--} 유형@${b:--} => $([ -n "$a" ] && [ -n "$b" ] && { [ "$a" -lt "$b" ] && echo 등록선행=제목옆 || echo 등록후행=검색줄; } || echo 판정불가)"
  rm -f /tmp/pg75.js
}
cnt() { # $1=라벨
  sudo docker run --rm --entrypoint sh erp-app:latest -c "
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(⑤⑥은 점검표에)=\$(grep -rlF '⑤⑥은 점검표에' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker75)=\$(grep -rlF 'zzzNoSuchMarker75' /app/.next 2>/dev/null | wc -l)\"
  "
}

echo "=== MARKER BEFORE ==="
order before erp-app:latest
cnt before

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -8
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치)')"
order after erp-app:latest
cnt after

echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "  기대: HEAD=ea0e6801 · 구조교대 등록후행→등록선행 · 존속 유지 · 음성 0 · login=200"
