#!/usr/bin/env bash
# 81회차 운영 배포 — db2bbd9a -> d10089fd (2커밋 — 내 것뿐·마이그 0)
#   fc802dbb feat(고객관리): 3분리 2단계 — 1.1→공통 트리·전년도 업무→보고서 탭·회차 탭 분리
#   d10089fd fix(고객관리): 전년도 확정 안내가 낡은 1.10 자리를 가리켰다 — 보고서 탭으로 정본화
#
# 마커 3분법 (로컬 프로덕션 .next 실측 — server/static만, dev/·.map 제외):
#   신규A  '별지 전용 입력 —' (reports 탭 안내줄, page.tsx) 0 → N (로컬 1)
#   신규B  '보고서 탭에서 확정' (후속 정본화 — 작업대·작성 패널 문구+링크 라벨) 0 → N (로컬 5)
#          ⚠ 원래 후보 '회차 탭에서 보기'는 프로덕션 청크가 문자열을 보존하지 않아 부적격(로컬 0)
#   역방향 'tab=plan&form=1.10&from=report9' (작업대 낡은 확정 링크) 양수 → 0 (로컬 0 확인)
#          — fc802dbb만으로는 성립하지 않았다. d10089fd 후속 수리가 이 리터럴을 지웠다.
#   존속   mgr171_ · past-anchor-start-notice · 74회차 신규A(9호 힌트 ④제출기록) ·
#          77회차 신규A(소방계획서보고서) · 80회차 신규(building-saved-note) 유지
#   음성   zzzNoSuchMarker81 = 0
#
# 행위 판정은 로컬 게이트가 정본: tsc 0·pre-push next build+불변식 통과(d10089fd 푸시 게이트)·
# E2E 배터리 전건 초록(fc802dbb 커밋 메시지)·_probe-44-e2e 재조준 14/0(:3211).
#
# 실측 결과(2026-09-21 배포 완료 — 전건 초록):
#   가드 OK(HEAD=db2bbd9a·RUNNING=LATEST=3eaf5753eb69·INFLIGHT 0·rollback-db2bbd9a 확보)
#   before 신규A 0·신규B 0·역방향 5·존속 3·2·3·1·2·음성 0
#   after  신규A 1·신규B 5·역방향 0·존속 3·2·3·1·2 유지·음성 0
#   FF db2bbd9→d10089f · RUNNING=LATEST=bcdf849ce3d5 · rollback-d10089fd 태그 · login=200
#   🚨 ssh 클라이언트가 도구 기본 타임아웃(120s)으로 먼저 끊겨 스크립트 출력이 BUILD에서 유실
#      — 서버 프로세스는 살아서 끝까지 돌았고(태그까지 완료) after는 _mark81.sh 재실측으로 판정.
#      다음부턴 배포 ssh를 긴 타임아웃 백그라운드로 걸거나 서버측 nohup+로그 파일로 돌릴 것.
set -u

EXPECT_HEAD=db2bbd9af9988b028406f87cbf77830483feb564
EXPECT_IMG=3eaf5753eb69
TARGET=d10089fd
ROLLBACK_TAG=erp-app:rollback-db2bbd9a
NEXT_ROLLBACK=erp-app:rollback-d10089fd

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
    echo \"  $1 신규A(별지 전용 입력 —)=\$(grep -rlF '별지 전용 입력 —' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 신규B(보고서 탭에서 확정)=\$(grep -rlF '보고서 탭에서 확정' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향(tab=plan&form=1.10&from=report9)=\$(grep -rlF 'tab=plan&form=1.10&from=report9' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(74회차 9호 힌트 ④제출기록)=\$(grep -rlF '④ 소방서 제출 기록, 그것도 없으면 생성일(오늘)로 출력' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(77회차 소방계획서보고서)=\$(grep -rlF '소방계획서보고서' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(80회차 building-saved-note)=\$(grep -rlF 'building-saved-note' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker81)=\$(grep -rlF 'zzzNoSuchMarker81' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=d10089fd · RUNNING=LATEST 교대 · 신규A/B 0→N · 역방향 양수→0 · 존속 유지 · 음성 0 · login=200"
echo "DONE81"
