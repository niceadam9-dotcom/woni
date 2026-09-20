#!/usr/bin/env bash
# 76회차 운영 배포 — ea0e6801 -> fb5e32a2 (2커밋: 기록 chore 1 + 수리 1)
#   feat(고객 목록): 「기본/전체 컬럼」 토글 폐지 — 계약일·사용승인일 상시 표시 (fb5e32a2)
#   동승: deb55286(75회차 up 스크립트 기록 chore — 런타임 의존 0·마이그 0)
#
# 마커 3분법 (로컬 워크트리 .next에서 선실측 후 확정 — ⚠ .map 소스맵은 판정에서 뺀다:
#   company-profile.ts 주석 「기본 컬럼만」이 소스맵에만 실려 4건 오검출됐다):
#   역방향 '기본 컬럼' N→0 · '전체 컬럼' N→0  (토글 버튼 라벨 — 이 페이지에만 있던 리터럴)
#   신규   없음(원리적 — 삭제형 커밋, 헤더 배열은 기존 리터럴 재배열)
#   존속   사용승인일 >0 · past-anchor-start-notice · mgr171_ 유지
#   음성   zzzNoSuchMarker76 = 0
#
# 실측 결과(2026-09-20 배포 완료 — 전건 초록):
#   가드 OK(HEAD=ea0e6801·RUNNING=LATEST=d7c619dfa009·INFLIGHT 0·rollback-ea0e6801 확보)
#   역방향 기본 컬럼 1→0 · 전체 컬럼 1→0 · 존속 32·2·3 유지 · 음성 0
#   FF ea0e680→fb5e32a · RUNNING=LATEST=9204aa11722b · rollback-fb5e32a2 태그 · login=200
#   격리 게이트: npm ci·tsc 0·build 0 + test-inline-edit 실측(새 인덱스 [2] 초록 —
#   [1]점검유형·[3]점검계획일 인라인 저장 침묵 실패는 **대조군(ea0e6801)에서도 동일 재현** =
#   선재 결함(이 회차 축 아님·별도 수리 필요). 대조군에선 옛 검사 [2]도 죽어 있었다.
set -u

EXPECT_HEAD=ea0e6801aa7a2c319a5f69b3cf37a78e3bba44ed
EXPECT_IMG=d7c619dfa009
TARGET=fb5e32a2
ROLLBACK_TAG=erp-app:rollback-ea0e6801
NEXT_ROLLBACK=erp-app:rollback-fb5e32a2

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

mark() { # $1=라벨 $2=이미지참조방식(run|exec) — BusyBox grep 호환(-rlF·grep -v만 사용)
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    echo \"  $1 역방향(기본 컬럼)=\$(grep -rlF '기본 컬럼' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향(전체 컬럼)=\$(grep -rlF '전체 컬럼' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(사용승인일)=\$(grep -rlF '사용승인일' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker76)=\$(grep -rlF 'zzzNoSuchMarker76' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=fb5e32a2 · 역방향 두 마커 N→0 · 존속 유지 · 음성 0 · RUNNING=LATEST · login=200"
