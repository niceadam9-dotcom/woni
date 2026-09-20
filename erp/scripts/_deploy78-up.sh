#!/usr/bin/env bash
# 78회차 운영 배포 — fbcf3aa2 -> ff9ef29b (4커밋: 고객관리 탭 재편 feat 3 + 77회차 기록 chore 1)
#   feat 4d4105b1: [공통] 탭 신설(구 소방계획서 1.4) · 별지서식→보고서 개명 · 1.4 「기타」 7종 분할
#   feat f2e77e59: 탭 라벨 「공통」 확정 — 소방계획서 3분리(공통/보고서/소방계획서)
#   feat ff9ef29b: 3분리 구간 탭 순서 — 공통 → 보고서 → 소방계획서 (사용자 지정)
#   동승: fe325fd7(77회차 기록) — 마이그레이션 0건(구간 전수 확인).
#
# 마커 3분법 (로컬 검증: 신규A·B는 워크트리 dev .next에 실림 확인 — dev 캐시는 옛 청크가 남아
#   역방향 대조군으론 무효, 컨테이너 판정은 77회차 규약대로 .map 제외):
#   신규A  보고서 탭 「기타 점검대상」 카드 제목 = 0 → 양수
#   신규B  공통 탭 안내줄 '공통 서식이 늘면 이 탭에 추가됩니다' = 0 → 양수
#   역방향 구 딥링크 리터럴 'tab=plan&form=1.4' = 양수 → 0
#          (annex-compose-panel·plan-annex-sheet-tree·plan-form14 기본값 세 곳이 tab=facilities로
#           정본화 — 소스 잔존 4곳은 전부 주석이라 프로덕션 번들에서 소멸)
#   존속   mgr171_ · past-anchor-start-notice · 77회차 신규A(소방계획서보고서) 유지
#   음성   zzzNoSuchMarker78 = 0
set -u

EXPECT_HEAD=fbcf3aa27d91b86671931d403e66e95a6ee9fcce
EXPECT_IMG=26adf05752e7
TARGET=ff9ef29b
ROLLBACK_TAG=erp-app:rollback-fbcf3aa2
NEXT_ROLLBACK=erp-app:rollback-ff9ef29b

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

mark() { # $1=라벨 $2=이미지참조방식(run|exec) — BusyBox grep 호환·.map 소스맵 제외(76회차 규약)
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    echo \"  $1 신규A(보고서 탭 기타 점검대상)=\$(grep -rlF '기타 점검대상' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 신규B(공통 탭 안내줄)=\$(grep -rlF '공통 서식이 늘면 이 탭에 추가됩니다' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향(구 딥링크 tab=plan&form=1.4)=\$(grep -rlF 'tab=plan&form=1.4' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(77회차 신규A 소방계획서보고서)=\$(grep -rlF '소방계획서보고서' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker78)=\$(grep -rlF 'zzzNoSuchMarker78' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=ff9ef29b · 신규A/B 0→양수 · 역방향 양수→0 · 존속 유지 · 음성 0 · RUNNING=LATEST · login=200"
echo "DONE78"
