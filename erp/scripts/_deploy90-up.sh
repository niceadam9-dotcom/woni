#!/usr/bin/env bash
# 90회차 운영 배포 — 실행 중 이미지 2a72061b4292 → origin/main(a4747d82)
#   a4747d82 feat(동선): 점검달력 ↔ 작업대 왕복을 닫는다 — 급한 단계로 착지·복귀 경로·역링크 (2차)
#
# 🚨 회차는 **이미지 교체 수**로 센다. 89→beead875(2a72061b4292), 이번이 90.
#
# ⚠ 89회차 규약을 그대로 따른다(그쪽 세션이 쓴 것이 더 낫다):
#   · HEAD를 문자열로 박지 않는다 — **「지금 HEAD가 origin/main의 조상인가」**(FF 가능한가)로 묻는다.
#     sha를 옮겨 적다 틀릴 여지가 없다(83·88회차에서 자릿수 불일치로 가드가 두 번 섰다).
#   · 복귀점은 **이름이 아니라 실체**로 찾는다(88회차 교훈 — 회차마다 태그 sha 자릿수가 다르다).
#   · 마커는 `grep -ro`(출현 **횟수**)로 센다 — 파일 수는 같은 청크에 다른 출처가 남으면 안 움직인다.
#
# 마커 3분법 (로컬 프로덕션 .next 선실측 — server/static만):
#   신규  daypanel-step-row     (데이 패널 단계 행 표식 — 달력→작업대 주 동선)      0 → N
#   신규  workbench-back        (작업대 뒤로가기 — from을 따르는 새 링크)            0 → N
#   신규  단계로 이동            (B-2 라벨 — 「N단계로 이동」)                        0 → N
#   존속  daypanel-detail-link  (패널 하단 링크 자체는 종전부터 있다 — 수가 늘 뿐)
#   존속  확정일 +15영업일      (88회차 내 축) · etc-scope- (83회차)
#   음성  zzzNoSuchMarker90     0 = 0
#   ⚠ 역방향은 **`/inspections` 고정 링크**인데 그 문자열은 사이드바 등 다른 자리에도 많다 —
#     리터럴로는 내 변경을 가릴 수 없어 **역방향 마커를 쓰지 않는다**(지어내지 않는다).
#     행위 판정은 `test-calendar-workbench-roundtrip` 12/0이 정본(변이 R-1 2빨강으로 실증).
#
# 행위 판정: tsc 0 · pre-push next build+불변식 통과 · 왕복 12/0 · 마감 축 19/0 ·
#   달력 행 18/0 · h28 24/0 · 리베이스 뒤 재검증 완료.
#
# 실측 결과(2026-09-21 배포 완료 — 전건 초록, 가드 한 번에 통과):
#   가드 OK(HEAD=beead87이 a4747d82의 조상 · RUNNING=LATEST=2a72061b4292 · INFLIGHT 0 ·
#           복귀점 rollback-beead87 — **이름이 아니라 실체로 찾아** 7자 태그도 그대로 잡혔다)
#   before 신규 0·0·0 · 존속 daypanel-detail-link **0** · 확정일+15영업일 4 · etc-scope- 2 · 음성 0
#   after  신규 2·1·2 · 존속 daypanel-detail-link **2** · 4 · 2 유지 · 음성 0
#   FF beead87→a4747d8 · RUNNING=LATEST=f3a5baf81d47 · rollback-a4747d82 · login=200
#   ⭐ `daypanel-detail-link`를 「존속」으로 적었는데 before가 **0**이었다 — 그 표식은 이번에
#     내가 붙인 것이고(종전 링크엔 testid가 없었다) 실은 **신규**다. 분류를 잘못 적어도
#     before를 재 두면 드러난다 — 마커의 값은 이름이 아니라 **재 본 수**가 정한다.
set -u

EXPECT_IMG=2a72061b4292
TARGET=a4747d82

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
H=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)
T=$(sudo docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
  | grep -F 'erp-app:rollback-' | awk -v img="$EXPECT_IMG" '$2 == img {print $1; exit}')
echo "HEAD=$H"; echo "DIRTY=$D"; echo "RUNNING=$R"; echo "LATEST=$L"; echo "ROLLBACK=${T:-(없음)}"
# HEAD가 target의 조상이어야 FF가 가능하다 — sha를 박지 않고 관계로 묻는다
git -C /home/ubuntu/woni merge-base --is-ancestor HEAD "$TARGET" \
  || { echo GUARD_FAIL_NOT_ANCESTOR; exit 21; }
[ "$D" = "0" ]           || { echo GUARD_FAIL_DIRTY; exit 22; }
[ -n "$R" ]              || { echo GUARD_FAIL_RUNNING_EMPTY; exit 23; }
[ "$R" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_LATEST; exit 25; }
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ]    || { echo GUARD_FAIL_INFLIGHT; exit 27; }
[ -n "$T" ]              || { echo GUARD_FAIL_ROLLBACK; exit 26; }
echo "GUARD_OK — 복귀점 $T = $EXPECT_IMG"

mark() { # $1=라벨 $2=run|exec — 출현 **횟수**(grep -ro)로 센다(89회차 규약)
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    echo \"  $1 신규(daypanel-step-row)=\$(grep -ro 'daypanel-step-row' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 신규(workbench-back)=\$(grep -ro 'workbench-back' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 신규(단계로 이동)=\$(grep -ro '단계로 이동' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(daypanel-detail-link)=\$(grep -ro 'daypanel-detail-link' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(확정일 +15영업일)=\$(grep -ro '확정일 +15영업일' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(etc-scope-)=\$(grep -ro 'etc-scope-' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker90)=\$(grep -ro 'zzzNoSuchMarker90' /app/.next 2>/dev/null | wc -l)\"
  "
}

echo "=== MARKER BEFORE ==="
mark before run

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -8
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

sudo docker tag erp-app:latest "erp-app:rollback-$TARGET" && echo "tagged erp-app:rollback-$TARGET"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치)')"
mark after exec

echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "  기대: HEAD=a4747d82 · RUNNING=LATEST 교대 · 신규 3축 0→N · 존속 유지 · 음성 0 · login=200"
echo "DONE90"
