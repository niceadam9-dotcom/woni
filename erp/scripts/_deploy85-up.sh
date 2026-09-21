#!/usr/bin/env bash
# 85회차 운영 배포 — 14779d0c -> acad464c (2커밋 · 마이그 0)
#   5d72df24 feat(고객관리): 결과보고서 엑셀 버튼 이름을 한 벌로 — 「보고서 엑셀」
#   acad464c fix(점검): 번들 패널 엑셀도 같은 이름으로 — 놓쳤던 5번째 표면
#
# 🚨⭐⭐ **마커를 먼저 의심해서 제품 결함을 찾았다.** 처음엔 신규 마커로 「보고서 엑셀」을
#   잡으려 했는데 착수 판정에서 **before가 0이 아니라 4**로 나왔다 — 툴팁 「결과보고서 엑셀 받기」가
#   그 글자를 부분문자열로 품기 때문이다(grep -F). 못 쓰는 축이라 소스를 다시 훑다가 번들 패널의
#   다섯 번째 표면이 나왔다. **before를 재지 않고 0을 가정했으면 둘 다 놓쳤다.**
#
# 적격성 선실측(배포 전 운영 이미지 실측값):
#   '보고서 엑셀'    4   ← 부적격(툴팁이 품는다). 쓰지 않는다.
#   '엑셀로 받기'    8   ← 부분 역방향. bundle-generate-panel 주석에 이 말이 남아 이번엔 **0이 아니다**
#   'w-[2.6rem]'     9   ← 부분 역방향. 다른 버튼 둘이 같은 클래스를 쓴다 — 0이 되면 **오히려 이상**
#   '소방계획서 엑셀' 5   ← 존속(옆자리 이웃 이름은 안 바뀐다)
#
# 그래서 **툴팁 전문**을 축으로 쓴다 — 이번 변경에만 있는 자구라 부분문자열 충돌이 없다.
#   신규A  '이 회차 결과보고서 엑셀 받기'                0 → N   (회차 카드 툴팁 — 새 자구)
#   역방향A '이 회차를 갑지 서식 엑셀로 받기'             N → 0   (회차 카드 옛 툴팁)
#   역방향B '갑지 서식 통합 워크북 — PDF와 달리 받은 뒤 고칠 수 있습니다'  N → 0  (번들 패널 옛 툴팁)
#   존속   '소방계획서 엑셀'(이웃 이름 불변) · building-saved-note · mgr171_
#   음성   zzzNoSuchMarker85 = 0
#   ⚠ 역방향 A·B는 **before가 0이면 판정 불가**다(원래 없던 걸 0→0으로 보고 「배포됐다」고
#     읽지 않는다). 그 경우 신규A가 정본이다.
#
# 행위 판정은 로컬 게이트가 정본: tsc 0 · pre-push next build + 불변식 전건 통과(2회) ·
#   test-workbook-label 16/16 · 변이 5/5 전건 빨강.
# ⚠ E2E는 이 변경에 대해 **재지 않았다** — dev 서버가 공유 트리(타 세션 진행 중)를 섬긴다.
#   기존 검사는 전부 data-testid로 버튼을 잡아 라벨 변경에 영향 없음(소스 실측).
#
# 🚨 배포 ssh는 도구 기본 타임아웃(120s)에 끊긴다 — nohup + 로그 폴링으로 돌린다.
set -u

EXPECT_HEAD=14779d0c79f0145eb4ab9023ffb51de9fe0ad845
EXPECT_IMG=b599394f919a
TARGET=acad464c
ROLLBACK_TAG=erp-app:rollback-14779d0c
NEXT_ROLLBACK=erp-app:rollback-acad464c

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

mark() { # $1=라벨 $2=run|exec — BusyBox grep 호환 · .map 소스맵 제외
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    n() { echo \"  $1 \$1=\$(grep -rlF \"\$2\" /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"; }
    n '신규A(이 회차 결과보고서 엑셀 받기)' '이 회차 결과보고서 엑셀 받기'
    n '역방향A(이 회차를 갑지 서식 엑셀로 받기)' '이 회차를 갑지 서식 엑셀로 받기'
    n '역방향B(갑지 서식 통합 워크북 — PDF와 달리 받은 뒤 고칠 수 있습니다)' '갑지 서식 통합 워크북 — PDF와 달리 받은 뒤 고칠 수 있습니다'
    n '존속(소방계획서 엑셀 — 이웃 이름 불변)' '소방계획서 엑셀'
    n '존속(building-saved-note)' 'building-saved-note'
    n '존속(mgr171_)' 'mgr171_'
    n '참고(엑셀로 받기 — 주석에 남아 0이 아님)' '엑셀로 받기'
    n '음성(zzzNoSuchMarker85)' 'zzzNoSuchMarker85'
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
echo "  기대: HEAD=acad464c · RUNNING=LATEST 교대 · 신규A 0→N · 역방향 A·B →0 · 존속 유지 · 음성 0 · login=200"
echo "DONE85"
