#!/usr/bin/env bash
# 91회차 운영 배포 — 실행 중 이미지 f3a5baf81d47 → origin/main(317a7e01)
#   475b25d6 feat(소방계획서): 표지 제목을 절제하고 사진을 주역으로   ← **타 세션 작업**
#   317a7e01 feat(동선): 대장이 비면 설비 확인부터 — 달력→설비→점검표→달력 한 바퀴 (A·B·E)
#
# 🚨 회차는 **이미지 교체 수**로 센다. 90→a4747d82(f3a5baf81d47), 이번이 91.
# ⚠ 89~90회차 규약 그대로: HEAD를 박지 않고 **조상 관계**로 묻고, 복귀점은 **실체로 찾고**,
#   마커는 **출현 횟수**(grep -ro)로 센다.
#
# 마커 3분법 (로컬 프로덕션 .next 선실측 — server/static, 출현 횟수):
#   신규A '설비 확인 → 점검표'   (①의 새 목적지 라벨)            0 → 8
#   신규B 'facilities-to-sheet'  (1.4 전진 버튼)                  0 → 2
#   신규C 'sheet-entry-done'     ([입력 완료] 버튼)               0 → 3
#   신규D 'facilities-stepband'  (① 설비 확인 → ② 점검표 띠)      0 → 2
#   존속  'daypanel-step-row'(90회차 내 축) · '확정일 +15영업일'(88회차)
#   음성  zzzNoSuchMarker91 = 0
#   ⚠ 역방향을 쓰지 않는다 — 걷어낸 것이 `/inspections/${id}` 기본 링크인데 그 꼴은 화면 곳곳에
#     널려 있어 내 변경을 가릴 수 없다. **지어내지 않는다**(61회차 규약).
#     행위 판정은 `test-inspection-one-lap` 20/0이 정본(변이 L-1 2빨강·L-2 3빨강).
#
# 행위 판정: tsc 0 · pre-push 게이트 통과 · 한 바퀴 20/0 · sheet-entry 28/0 ·
#   facility-roundtrip 36/0 · 달력↔작업대 왕복 12/0 · 리베이스 뒤 재검증 완료.
#
# 실측 결과(2026-09-21 배포 완료 — 전건 초록, 가드 한 번에 통과):
#   가드 OK(HEAD=a4747d8이 317a7e01의 조상 · RUNNING=LATEST=f3a5baf81d47 · INFLIGHT 0 ·
#           복귀점 rollback-a4747d82 — 실체로 찾아 잡혔다)
#   before 신규 0·0·0·0 · 존속 2·4 · 음성 0
#   after  신규 4·1·2·1 · 존속 2·4 유지 · 음성 0
#   FF a4747d8→317a7e0 · RUNNING=LATEST=3629970dae13 · rollback-317a7e01 · login=200
#   ⭐ 로컬 선실측은 8·2·3·2였는데 운영 after는 4·1·2·1 — **절반**이다. 로컬 `.next`에는
#     이전 빌드 산출물이 남아 같은 문자열이 두 벌 잡힌다(운영 이미지는 깨끗한 한 벌).
#     그래서 **선실측은 「0인가 아닌가」를 보는 용도**이고, 증가 판정은 운영 before/after로 한다.
set -u

EXPECT_IMG=f3a5baf81d47
TARGET=317a7e01

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

mark() { # $1=라벨 $2=run|exec — 출현 **횟수**로 센다
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    echo \"  $1 신규A(설비 확인 → 점검표)=\$(grep -ro '설비 확인 → 점검표' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 신규B(facilities-to-sheet)=\$(grep -ro 'facilities-to-sheet' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 신규C(sheet-entry-done)=\$(grep -ro 'sheet-entry-done' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 신규D(facilities-stepband)=\$(grep -ro 'facilities-stepband' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(daypanel-step-row)=\$(grep -ro 'daypanel-step-row' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(확정일 +15영업일)=\$(grep -ro '확정일 +15영업일' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker91)=\$(grep -ro 'zzzNoSuchMarker91' /app/.next 2>/dev/null | wc -l)\"
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
echo "  기대: HEAD=317a7e01 · RUNNING=LATEST 교대 · 신규 4축 0→N · 존속 유지 · 음성 0 · login=200"
echo "DONE91"
