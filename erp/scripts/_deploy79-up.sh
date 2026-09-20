#!/usr/bin/env bash
# 79회차 운영 배포 — ff9ef29b -> 840dabd4 (1커밋 — 내 것뿐·마이그 0)
#   feat(별지 10·11호): 이상없음·해당없음 행에는 이행기간을 찍지 않는다 — PDF·엑셀 동일 (⑤판)
#
# 마커 3분법:
#   신규·역방향 **없음** — 서버 로직 변경(조립 조건·엑셀 값 조건)이라 제품에 문자열 리터럴이
#   생기지도 사라지지도 않는다. 지어내지 않는다(61회차 「순수 추가엔 역방향 없음」과 같은 축).
#   행위 판정은 격리 게이트가 정본: test-report10-plan-rows 62/62·test-annex-total-period 77/77
#   (D-2 신설)·test-annex-done-rows 66/66·변이 12/12(M10 조립본·M11 덧칠·M12 엑셀)·tsc 0·build 0.
#   여기서는 HEAD·이미지 교대 + 존속 + 음성 + login으로 「그 커밋이 서빙되는가」만 판정한다.
#   존속   mgr171_ · past-anchor-start-notice · 74회차 신규A(9호 힌트 ④제출기록) ·
#          77회차 신규A(소방계획서보고서) 유지
#   음성   zzzNoSuchMarker79 = 0
#
# 실측 결과(2026-09-20 배포 완료 — 전건 초록):
#   가드 OK(HEAD=ff9ef29b·RUNNING=LATEST=222997d229fc·INFLIGHT 0·rollback-ff9ef29b 확보)
#   존속 3·2·3·1 유지 · 음성 0 · FF ff9ef29→840dabd · RUNNING=LATEST=d65c35eb21a2
#   rollback-840dabd4 태그 · login=200
#   ⭐ 착수 관망이 맞았다: 타 세션이 탭 개편 3커밋을 78회차로 먼저 실어(222997d229fc),
#   이 회차는 내 1커밋만 남은 깨끗한 구간이 됐다(동시 빌드 충돌 0).
set -u

EXPECT_HEAD=ff9ef29ba0fbc8b32b10b0a7663310f730f76a99
EXPECT_IMG=222997d229fc
TARGET=840dabd4
ROLLBACK_TAG=erp-app:rollback-ff9ef29b
NEXT_ROLLBACK=erp-app:rollback-840dabd4

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

mark() { # $1=라벨 $2=이미지참조방식(run|exec) — BusyBox grep 호환·.map 소스맵 제외
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(74회차 9호 힌트 ④제출기록)=\$(grep -rlF '④ 소방서 제출 기록, 그것도 없으면 생성일(오늘)로 출력' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(77회차 소방계획서보고서)=\$(grep -rlF '소방계획서보고서' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker79)=\$(grep -rlF 'zzzNoSuchMarker79' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=840dabd4 · RUNNING=LATEST 교대 · 존속 유지 · 음성 0 · login=200"
echo "DONE79"
