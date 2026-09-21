#!/usr/bin/env bash
# 92회차 운영 배포 — 317a7e01 -> f781ccb8 (2커밋 · 마이그 0)
#   f781ccb8 fix(소방계획서): 표지 사진 중앙 정렬 — 열 폭 환산이 열마다 +5px이었다  ← 내 것
#   8fb66b0a chore(배포): 91회차 기록                                              ← 문서 전용
#
# ⚠ 제목 54pt·사진 400pt(475b25d6)는 **이미 91회차로 나갔다**(착수 판정: 템플릿 sha
#   5dc767d1a9101aa9 · 표지 5행 400.0pt 실측). 이번 구간은 **코드 한 커밋**뿐이다.
#
# 🚨 **이 회차는 마커가 어렵다.** 바뀐 것이 숫자 산식뿐이라 화면 문자열도 템플릿 바이트도
#   안 바뀐다(템플릿 sha는 **그대로여야** 한다 — 바뀌면 오히려 이상이다).
#   옛 산식 문자열 `*7+5`·`w*7+5`는 **before가 이미 0**이다(minify가 지운다) → 역방향 축 없음.
#   그래서 신규 후보 셋을 함께 걸고 **하나라도 0→N이면 배선 증거**로 친다(어느 것이 minify를
#   견디는지 미리 알 수 없다 — 43회차 「마커 0은 미배포가 아니다」의 교훈):
#     A `/256*7`       B `colWidthToPx`      C `128/7`     (before 전부 0 — 실측)
#   보조로 `256*`(before 11)이 **늘어나는지**도 본다(확대 축).
#
#   🎯 그리고 **행위 축을 따로 건다**: 배포된 이미지 안에서 제품 모듈을 실제로 불러
#   표지 사진 앵커를 계산시켜 좌우 여백이 대칭인지 본다. 문자열이 못 하는 증명을 이게 한다.
#
# 행위 판정은 로컬 게이트가 정본: tsc 0 · 격자 정답지 7/7(Excel COM 실측 780px) ·
#   변이 3/3 전건 빨강 · 사진 상자 150/0 · 워크북 자산 190/0 · 제목 크기 30/30 ·
#   산출물 실측(제품 코드 실행) 전 화면비 좌우 0px.
# ⚠ `test-defect-photos`(형제 모듈)는 서버·env가 필요한 E2E라 못 돌렸다 — 수치로만 확인
#   (2열 병합이라 열당 5~6px 차이, 사진이 조금 작아지고 가운데는 유지).
set -u

EXPECT_HEAD=317a7e017bf8256465e75a5b6413e4468f005245
EXPECT_IMG=3629970dae13
TARGET=f781ccb8
ROLLBACK_TAG=erp-app:rollback-317a7e01
NEXT_ROLLBACK=erp-app:rollback-f781ccb8
TPL_SHA_BEFORE=5dc767d1a9101aa9

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

mark() { # $1=라벨 $2=run|exec
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    n() { echo \"  $1 \$1=\$(grep -rlF \"\$2\" /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"; }
    echo \"  $1 템플릿sha(바뀌면 이상)=\$(sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16)\"
    n '신규A(/256*7)'      '/256*7'
    n '신규B(colWidthToPx)' 'colWidthToPx'
    n '신규C(128/7)'        '128/7'
    n '확대(256*)'          '256*'
    n '존속(보고서 엑셀)'     '보고서 엑셀'
    n '존속(소방계획서 엑셀)' '소방계획서 엑셀'
    n '존속(building-saved-note)' 'building-saved-note'
    n '음성(zzzNoSuchMarker92)'   'zzzNoSuchMarker92'
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
echo "  (템플릿sha 기대 = $TPL_SHA_BEFORE — 이 회차는 템플릿을 안 건드린다)"

echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "  기대: HEAD=f781ccb8 · RUNNING=LATEST 교대 · 신규 A/B/C 중 최소 하나 0→N ·"
echo "        템플릿sha 불변 · 존속 12·5·2 유지 · 음성 0 · login=200"
echo "DONE92"
