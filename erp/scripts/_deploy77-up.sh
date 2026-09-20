#!/usr/bin/env bash
# 77회차 운영 배포 — fb5e32a2 -> fbcf3aa2 (3커밋: 라벨 feat 274a5b30 + 기록 chore 2)
#   feat(목록): 문서 바로가기 열에 이름을 단다 — 고객관리 「소방계획서보고서」·점검업무 「보고서」
#   동승: 747b2d2e(76회차 기록)·fbcf3aa2(74회차 기록) — 런타임 의존 0·마이그 0.
#
# 마커 3분법 (로컬 워크트리 .next 선실측: 신규A=4·신규B=2 — .map 소스맵 포함 수치,
#   컨테이너 판정은 76회차 규약대로 .map 제외):
#   신규A  고객관리 머리글 「소방계획서보고서」 = 0 → 양수
#   신규B  점검업무 머리글쌍 '"상태","보고서"' = 0 → 양수 (minify된 헤더 배열의 인접쌍 —
#          「보고서」 단독은 어디에나 있어 마커 부적격)
#   역방향 없음 — 빈 머리글('')을 글자로 바꾼 순수 추가라 사라지는 문자열이 없다(지어내지 않는다)
#   존속   mgr171_ · past-anchor-start-notice · 74회차 신규A(9호 힌트 ④제출기록) 유지
#   음성   zzzNoSuchMarker77 = 0
#
# 실측 결과(2026-09-20 배포 완료 — 전건 초록):
#   가드 OK(HEAD=fb5e32a2·RUNNING=LATEST=9204aa11722b·INFLIGHT 0·rollback-fb5e32a2 확보)
#   신규A 0→1 · 신규B 0→1 (컨테이너 판정은 .map 제외라 로컬 선실측 4·2보다 적은 게 정상 —
#   standalone 서버 청크 한 파일씩) · 존속 3·2·3 유지 · 음성 0
#   FF fb5e32a→fbcf3aa · RUNNING=LATEST=26adf05752e7 · rollback-fbcf3aa2 태그 · login=200
set -u

EXPECT_HEAD=fb5e32a2c00123864f47d16bac2bb39b570d60e0
EXPECT_IMG=9204aa11722b
TARGET=fbcf3aa2
ROLLBACK_TAG=erp-app:rollback-fb5e32a2
NEXT_ROLLBACK=erp-app:rollback-fbcf3aa2
PAIR='"상태","보고서"'

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
    echo \"  $1 신규A(고객관리 머리글 소방계획서보고서)=\$(grep -rlF '소방계획서보고서' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 신규B(점검업무 머리글쌍 상태·보고서)=\$(grep -rlF '${PAIR}' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(74회차 9호 힌트 ④제출기록)=\$(grep -rlF '④ 소방서 제출 기록, 그것도 없으면 생성일(오늘)로 출력' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker77)=\$(grep -rlF 'zzzNoSuchMarker77' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=fbcf3aa2 · 신규A/B 0→양수 · 존속 유지 · 음성 0 · RUNNING=LATEST · login=200"
echo "DONE77"
