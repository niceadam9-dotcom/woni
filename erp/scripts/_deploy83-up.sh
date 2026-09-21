#!/usr/bin/env bash
# 83회차 운영 배포 — b5f30c44 -> 3a74ea40 (3커밋·마이그 0)
#   6aa8919d chore(배포): 82회차 up 스크립트를 기록으로 (기록 커밋 — 제품 무변경)
#   b02eaf4b feat(고객관리): 소방계획서 「생성 바」에 생성을 되돌린다  ← **타 세션 작업**
#   3a74ea40 fix(별지): 「기타」 3종 체크가 대장을 안 보고 있었다 — 두 축 복원 + 배지 항목 단위
#
# ⚠ 구간에 **내 것이 아닌 커밋(b02eaf4b)** 이 하나 섞여 있다. 마이그는 0이고 파일도 내 것과
#   겹치지 않는다(fire-plan-view·plan-tab-view·fire-plan-doc-urls 등). 그쪽 세션이 먼저 배포하면
#   아래 가드의 EXPECT_HEAD가 나를 세운다 — 그때는 구간을 다시 재고 스크립트를 고쳐 쓴다.
#
# 마커 3분법 (운영 현재 이미지 before 실측 + 로컬 프로덕션 .next after 예측):
#   신규A  'etc-scope-'              (종합점검 전용 칩 testid)        0 → N (로컬 2)
#   신규B  'data-sheet-href'         (칩에 실은 목적지 — 두 갈래 공통 계약) 0 → N
#   신규C  'getEtcSheetProgressAction' (항목 단위 진행 서버 액션)     0 → N (로컬 7)
#   역방향 **없음** — 체크 축 교체는 판정식(`mk === 'O' || mk === 'X'`)을 바꾼 것이지
#          문자열을 지우지 않는다. 옮긴 매핑 표(31-A-001 등)도 lib/etc-sheet-map에 그대로 산다.
#          61회차 「순수 추가엔 역방향이 없다」와 같은 축 — **지어내지 않는다**.
#          (행위 판정은 아래 게이트가 정본이다.)
#   ⚠ 후보였던 '종합점검 전용'은 **부적격** — 전용 입력 화면(sheet-item-editor)이 이미 쓰던
#          문자열이라 운영 before가 **4**다. 로컬에서 6이라고 「신규」로 읽으면 오판이었다.
#   존속   81회차(별지 전용 입력 — · 보고서 탭에서 확정) · 80회차(building-saved-note) ·
#          mgr171_ · past-anchor-start-notice 유지
#   음성   zzzNoSuchMarker83 = 0
#
# 행위 판정은 로컬 게이트가 정본: tsc 0 · pre-push next build+불변식 통과 ·
#   test-etc-axis 15/0(신설·표본 둘) · _probe-form14-etc 36/0 · test-annex-sheet-blanks 19/0 ·
#   test-workbook-e2e 27/0 · test-preview-pane 19/0 · 변이 M-a 2빨강 · M-b 3빨강(종합 표본 보탠 뒤).
#   리베이스 뒤 재검증 완료(리베이스는 검증을 승계하지 않는다).
#
# 🚨 배포 ssh는 도구 타임아웃(120s)에 끊긴다 — nohup + 로그 폴링으로 돌린다(81회차 교훈).
#
# 실측 결과(2026-09-21 배포 완료 — 전건 초록):
#   1차 실행은 **GUARD_FAIL_HEAD로 섰다** — 아래 EXPECT_HEAD에 8자 SHA를 적고 `rev-parse --short`
#   (7자)와 맞댔기 때문이다. 내 스크립트 버그였고 가드가 제 일을 했다(자릿수가 다르면 영영 불일치).
#   전체 SHA + `rev-parse HEAD`로 고쳐 재실행.
#   가드 OK(HEAD=b5f30c44·RUNNING=LATEST=16e740ab1a7a·INFLIGHT 0·rollback-b5f30c44 확보)
#   before 신규 A·B·C 각 0 · 존속 1·5·2·3·2 · 참고(종합점검 전용) 4 · 음성 0
#   after  신규 A=2 · B=2 · C=7 · 존속 그대로 · 참고 4→6(기존 4 + 신규 2 — **신규 마커로 못 쓰는 이유**) · 음성 0
#   FF b5f30c4→3a74ea4 · RUNNING=LATEST=a4defc131fcd · rollback-3a74ea40 태그 · login=200
set -u

# ⚠ 전체 SHA다. 1차 실행에서 짧은 SHA(8자)를 적고 `rev-parse --short`(7자)와 맞대 GUARD_FAIL_HEAD로
#   섰다 — 내 스크립트 버그였고, 가드가 제 일을 한 것이다(자릿수가 다르면 영영 불일치).
EXPECT_HEAD=b5f30c442c2773086bde35f75242195ca3bd47b9
EXPECT_IMG=16e740ab1a7a
TARGET=3a74ea40
ROLLBACK_TAG=erp-app:rollback-b5f30c44
NEXT_ROLLBACK=erp-app:rollback-3a74ea40

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
    echo \"  $1 신규A(etc-scope-)=\$(grep -rlF 'etc-scope-' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 신규B(data-sheet-href)=\$(grep -rlF 'data-sheet-href' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 신규C(getEtcSheetProgressAction)=\$(grep -rlF 'getEtcSheetProgressAction' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(별지 전용 입력 —)=\$(grep -rlF '별지 전용 입력 —' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(보고서 탭에서 확정)=\$(grep -rlF '보고서 탭에서 확정' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(building-saved-note)=\$(grep -rlF 'building-saved-note' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 참고(종합점검 전용·기존4)=\$(grep -rlF '종합점검 전용' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker83)=\$(grep -rlF 'zzzNoSuchMarker83' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=3a74ea40 · RUNNING=LATEST 교대 · 신규 A·B·C 0→N · 존속 유지 · 음성 0 · login=200"
echo "DONE83"
