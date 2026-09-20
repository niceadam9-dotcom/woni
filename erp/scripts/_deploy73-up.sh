#!/usr/bin/env bash
# 73회차 운영 배포 — b285701d -> f4ffeae4 (4커밋: 기록 chore 2 + 수리 2)
#   feat(사이드바): 고객 관리 → 점검 업무 → 점검 달력 순 (f9de59af)
#   feat(점검 단계): ④ 소방서 제출을 기본 표시로 — 불량 0건에도 감추지 않는다 (f4ffeae4)
#   구간에 실리는 남의 커밋은 기록용 스크립트 2건뿐(29ee495f·456540f4) — 런타임 의존 0·마이그 0.
#
# 마커 3분법 (로컬 워크트리 .next에서 선실측 후 확정):
#   역방향 ④⑤⑥은 점검표에 = N→0   (작업대 안내 문구의 옛 판)
#   교대짝 ⑤⑥은 점검표에   = 유지  (옛 판의 부분 문자열이라 before도 양수 — ④판 0과 짝으로 교대 증명)
#   순서   NAV 청크 안 「점검 업무」 vs 「점검 달력」 바이트 오프셋 역전 (달력선행 → 업무선행)
#   존속   mgr171_ · evacmap15_zone · past-anchor-start-notice 유지
#   음성   zzzNoSuchMarker73 = 0
#
# ⚠ 실측 후기(2026-09-20): 컨테이너는 BusyBox라 `grep -ob`(바이트 오프셋)가 없다 — 아래 mark()의
#   사이드바 순서 판정이 컨테이너 안에서 빈 값으로 떨어졌다(계측기 고장이지 제품 판정이 아니다).
#   재실측은 청크를 docker cp로 호스트에 꺼내 호스트 grep으로 했다. 판정 결과(전건 초록):
#   역방향 2→0 · 교대짝 2→2 · 사이드바 구=달력선행(달력@8246<업무@8356) → 신=업무선행(업무@8246<달력@8340)
#   · 존속 3·3·2 유지 · 음성 0 · RUNNING=LATEST=ebe5996a6ac9 · rollback-f4ffeae4 확보 · login=200
set -u

EXPECT_HEAD=b285701df13a78ebe09f5eccd4fb3f76e95c67e3
EXPECT_IMG=9bbc1254916b
TARGET=f4ffeae4
ROLLBACK_TAG=erp-app:rollback-b285701d
NEXT_ROLLBACK=erp-app:rollback-f4ffeae4

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

mark() { # $1=라벨 $2=이미지참조방식(run|exec)
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    echo \"  $1 역방향(④⑤⑥은 점검표에)=\$(grep -rlF '④⑤⑥은 점검표에' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 교대짝(⑤⑥은 점검표에)=\$(grep -rlF '⑤⑥은 점검표에' /app/.next 2>/dev/null | wc -l)\"
    f=\$(grep -rlF '지역별 담당 배정' /app/.next/static/chunks 2>/dev/null | head -1)
    if [ -n \"\$f\" ]; then
      a=\$(grep -obF '점검 업무' \"\$f\" | head -1 | cut -d: -f1)
      b=\$(grep -obF '점검 달력' \"\$f\" | head -1 | cut -d: -f1)
      echo \"  $1 사이드바 순서: 업무@\$a 달력@\$b => \$([ \"\$a\" -lt \"\$b\" ] && echo 업무선행 || echo 달력선행)\"
    else echo \"  $1 사이드바 순서: NAV 청크 못 찾음\"; fi
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker73)=\$(grep -rlF 'zzzNoSuchMarker73' /app/.next 2>/dev/null | wc -l)\"
  "
}

echo "=== MARKER BEFORE ==="
mark before run

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
mark after exec

echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "  기대: HEAD=f4ffeae4 · 역방향 N→0 · 교대짝 유지 · 사이드바 달력선행→업무선행 · 존속 유지 · 음성 0 · login=200"
