#!/usr/bin/env bash
# 80회차 운영 배포 — 840dabd4 -> db2bbd9a (1커밋 — 내 것뿐·마이그 0)
#   feat(고객관리): 건물 폼이 저장 후 접히지 않는다 — 신규는 만든 동의 수정 폼으로 전환
#
# 마커 3분법:
#   신규   building-saved-note (data-testid — 저장 후 폼이 안 접히므로 「저장되었습니다.」가
#          유일한 저장됨 피드백) 0 → N. 로컬 프로덕션 빌드 실측 3파일(소스맵 제외)·음성 0.
#   역방향 **없음** — close() 호출 제거는 문자열 리터럴을 지우지 않는다. 지어내지 않는다
#          (61회차 「순수 추가엔 역방향 없음」과 같은 축).
#   존속   mgr171_ · past-anchor-start-notice · 74회차 신규A(9호 힌트 ④제출기록) ·
#          77회차 신규A(소방계획서보고서) 유지
#   음성   zzzNoSuchMarker80 = 0
#
# 행위 판정은 로컬 게이트가 정본: tsc 소스 0·eslint 0·pre-push next build 통과.
# (빌드 첫 실패는 공유 트리 .next/dev/types 부패 잔재 — 지우고 재빌드로 통과)
set -u

EXPECT_HEAD=840dabd492a76566bf7cc809c4d49d65d0599c31
EXPECT_IMG=d65c35eb21a2
TARGET=db2bbd9a
ROLLBACK_TAG=erp-app:rollback-840dabd4
NEXT_ROLLBACK=erp-app:rollback-db2bbd9a

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
    echo \"  $1 신규(building-saved-note)=\$(grep -rlF 'building-saved-note' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(74회차 9호 힌트 ④제출기록)=\$(grep -rlF '④ 소방서 제출 기록, 그것도 없으면 생성일(오늘)로 출력' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(77회차 소방계획서보고서)=\$(grep -rlF '소방계획서보고서' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker80)=\$(grep -rlF 'zzzNoSuchMarker80' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=db2bbd9a · RUNNING=LATEST 교대 · 신규 0→N · 존속 유지 · 음성 0 · login=200"
echo "DONE80"
