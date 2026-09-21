#!/usr/bin/env bash
# 84회차 운영 배포 — 3a74ea40 -> 14779d0c (3커밋 · 마이그 0)
#   14779d0c feat(소방계획서): 표지 제목 = 납품본과 같은 HY헤드라인M 32pt 가운데   ← 내 것
#   680fd3ac test(문서): 배선 전수 불변식            — 검사 전용(런타임 0)
#   aa57bb5d chore(배포): 83회차 up 기록             — 문서 전용(런타임 0)
#   구간 실측: erp/src·templates 변경은 **내 세 파일뿐**(xlsx-build.ts · manifest.json · 템플릿).
#
# ⭐⭐ 마커가 여느 회차와 다르다 — 이번 산출물은 **문자열이 아니라 바이너리 자산**이다.
#   표지 제목 글꼴은 `templates/fire-plan-workbook.xlsx` 안에만 있고 .next 번들엔 안 실린다
#   (`COVER_TITLE_FONT`는 빌드 스크립트 상수라 앱 번들에 없다). 그래서 주 마커를
#   **컨테이너 안 xlsx의 sha256**으로 잡는다(50회차 「주 마커 = 컨테이너 안 xlsx sha256」과 같은 축).
#
#   주 마커   /app/templates/fire-plan-workbook.xlsx sha256
#               9c89bdb0783193fb → 890b560579ef8215   (before는 착수 판정에서 **실측**했다)
#   기능 확인  그 xlsx의 xl/styles.xml 안에 <name val="HY헤드라인M"/>  0 → 1
#             🎯 해시는 「무언가 바뀌었다」만 말한다. **글꼴이 실제로 들어갔는가**는 이 줄이 답한다.
#   신규      .next 안 manifest 지문 '890b560579ef82154e855f5d4db54ad8'  0 → N
#   역방향    .next 안 옛 지문      '9c89bdb0783193fb325f5ba666d33116'  N → 0
#             ⚠ before가 0이면 그 문자열은 번들에 원래 없는 것이니 **이 두 축은 판정에서 뺀다**
#               (있지도 않은 걸 0→0으로 보고 「배포됐다」고 읽지 않는다). 주 마커가 정본이다.
#   존속      building-saved-note · mgr171_ · past-anchor-start-notice · '별지 전용 입력 —'
#   음성      zzzNoSuchMarker84 = 0
#
# 행위 판정은 로컬 게이트가 정본: tsc 0 · pre-push next build + 불변식 전건 통과 ·
#   표지 제목 글꼴 8/8 · 워크북 자산 190/0(자산 sha == manifest) · 미리보기 352/0 · 앵커 64/0 ·
#   변이 4/4 전건 빨강 · Excel COM 실측(HY헤드라인M/32pt/가운데/A3:BH3, 대조군 본문 칸 무변) ·
#   격리 워크트리에서 커밋 단독 재검증.
#   ⚠ test-etc-axis 7/8은 **내 축이 아니다** — origin/main(내 커밋 없음)에서 같은 7/8이 나오는 걸
#     대조군으로 확인했다(선재). 지우지 않고 보고만 한다.
#
# 🚨 배포 ssh는 도구 기본 타임아웃(120s)에 끊긴다(81회차 실측) — nohup + 로그 폴링으로 돌린다.
set -u

EXPECT_HEAD=3a74ea40a3ec684070adc93ce56e67538544a7ee
EXPECT_IMG=a4defc131fcd
TARGET=14779d0c
ROLLBACK_TAG=erp-app:rollback-3a74ea40
NEXT_ROLLBACK=erp-app:rollback-14779d0c

SHA_OLD=9c89bdb0783193fb325f5ba666d33116
SHA_NEW=890b560579ef82154e855f5d4db54ad8

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
    echo \"  $1 주마커(xlsx sha256)=\$(sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16)\"
    rm -rf /tmp/mk$1 && mkdir -p /tmp/mk$1 && cd /tmp/mk$1 && \
      unzip -o -q /app/templates/fire-plan-workbook.xlsx xl/styles.xml 2>/dev/null
    echo \"  $1 기능(styles.xml 안 HY헤드라인M)=\$(grep -cF 'HY헤드라인M' /tmp/mk$1/xl/styles.xml 2>/dev/null || echo 0)\"
    echo \"  $1 기능(sz val=32)=\$(grep -oF '<sz val=\\\"32\\\"/>' /tmp/mk$1/xl/styles.xml 2>/dev/null | wc -l)\"
    rm -rf /tmp/mk$1
    echo \"  $1 신규(.next 새 지문)=\$(grep -rlF '$SHA_NEW' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향(.next 옛 지문)=\$(grep -rlF '$SHA_OLD' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(building-saved-note)=\$(grep -rlF 'building-saved-note' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(별지 전용 입력 —)=\$(grep -rlF '별지 전용 입력 —' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker84)=\$(grep -rlF 'zzzNoSuchMarker84' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=14779d0c · RUNNING=LATEST 교대 · 주마커 9c89bdb0→890b5605 ·"
echo "        기능 HY헤드라인M 0→1 · 존속 유지 · 음성 0 · login=200"
echo "DONE84"
