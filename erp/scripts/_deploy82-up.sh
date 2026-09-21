#!/usr/bin/env bash
# 82회차 운영 배포 — d10089fd -> b5f30c44 (1커밋 — 내 것뿐·마이그 0)
#   feat(고객관리): 회차 탭에서 점검표 블록을 없앤다 — 미입력 집계는 서버 축으로 이관
#
# 마커 3분법 (로컬 프로덕션 .next 실측 — server/static만, dev/·.map 제외):
#   신규   '점검표 미입력 여부를 확인하지 못했습니다' (발행 가드의 unknown 분기 — 서버 집계가
#          실패했을 때 0으로 떨어뜨리지 않고 확인만 받는 새 경로) 0 → N (로컬 2)
#   역방향 **세 축이 함께 사라진다** — 걷어낸 블록의 서로 다른 세 표면이라 한 축만 보면
#          minify·청크 분할에 속을 수 있다(43회차 「마커 0은 미배포가 아니다」의 반대 방향).
#            A '현장 결과를 설비별로 입력'  (점검표 진행 블록 부제)
#            B 'annex-sheet-entry-link'     (머리줄 진입 링크 testid)
#            C '설비별 진행'                (트리 요약줄)
#          셋 다 양수 → 0 (로컬 전부 0 확인)
#   존속   81회차 신규A(별지 전용 입력 —)·신규B(보고서 탭에서 확정) ·
#          80회차(building-saved-note) · mgr171_ · past-anchor-start-notice 유지
#   음성   zzzNoSuchMarker82 = 0
#
# 행위 판정은 로컬 게이트가 정본: tsc 0 · pre-push next build 통과 ·
#   test-annex-sheet-blanks 19/0(부재 6 + 서버 집계 2 + 발행 가드 4 + 진입구 생존 2) ·
#   test-annex-interaction 39/0 · allpass 23/0 · prev-round-hint 21/0 · facility-roundtrip 36/0 ·
#   sheet-entry-page 28/0 · _probe-annex-tab 22/0 ·
#   변이 M-a(서버 sheetBlanks 0 고정) 2빨강 · M-b(머리줄 부활) 두 스위트 각 2빨강.
#
# ⚠ pre-push 불변식 INV-D6c 1건은 **내 축이 아니다** — 타 스위트(test-plan-tab)가 스테이징에
#   남긴 E2E 픽스처 고객 「플랜탭E2E일반」이다(운영 DB와 무관·코드 변경과 무관). 지우지 않고 보고만 한다.
#
# 🚨 배포 ssh는 도구 기본 타임아웃(120s)에 끊긴다(81회차 실측) — 서버에서 nohup + 로그 파일로
#   돌리고 완료를 폴링한다(이 회차는 그렇게 해서 출력을 한 줄도 잃지 않았다).
#
# 실측 결과(2026-09-21 배포 완료 — 전건 초록):
#   가드 OK(HEAD=d10089fd·RUNNING=LATEST=bcdf849ce3d5·INFLIGHT 0·rollback-d10089fd 확보)
#   before 신규 0 · 역방향 A·B·C 각 2 · 존속 1·5·2·3·2 · 음성 0
#   after  신규 2 · 역방향 A·B·C **전부 0** · 존속 1·5·2·3·2 유지 · 음성 0
#   FF d10089f→b5f30c4 · RUNNING=LATEST=16e740ab1a7a · rollback-b5f30c44 태그 · login=200
#   ⭐ 역방향을 세 축으로 건 것이 값을 했다 — 셋이 **같은 값(2→0)으로 함께** 떨어져야
#     「그 블록이 진짜 사라졌다」가 된다(한 축만 보면 청크 분할·minify에 속을 수 있다).
set -u

EXPECT_HEAD=d10089fd3d4d6b117ecd8aa93f75ab27ca0b167e
EXPECT_IMG=bcdf849ce3d5
TARGET=b5f30c44
ROLLBACK_TAG=erp-app:rollback-d10089fd
NEXT_ROLLBACK=erp-app:rollback-b5f30c44

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
    echo \"  $1 신규(미입력 여부를 확인하지 못했습니다)=\$(grep -rlF '점검표 미입력 여부를 확인하지 못했습니다' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향A(현장 결과를 설비별로 입력)=\$(grep -rlF '현장 결과를 설비별로 입력' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향B(annex-sheet-entry-link)=\$(grep -rlF 'annex-sheet-entry-link' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향C(설비별 진행)=\$(grep -rlF '설비별 진행' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(별지 전용 입력 —)=\$(grep -rlF '별지 전용 입력 —' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(보고서 탭에서 확정)=\$(grep -rlF '보고서 탭에서 확정' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(building-saved-note)=\$(grep -rlF 'building-saved-note' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker82)=\$(grep -rlF 'zzzNoSuchMarker82' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=b5f30c44 · RUNNING=LATEST 교대 · 신규 0→N · 역방향 A·B·C 전부 →0 · 존속 유지 · 음성 0 · login=200"
echo "DONE82"
