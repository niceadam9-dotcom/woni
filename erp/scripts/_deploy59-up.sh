#!/usr/bin/env bash
# 59회차 운영 배포 — 68f87bb -> 24e061f (2커밋)
#   f0e2606 fix(별지10호): 법정 기본 이행기간이 PDF에선 영영 안 깔렸다   (남의 것 · 이미 origin)
#   24e061f fix(소방계획서 엑셀): 체크박스가 글씨를 덮고, 여러 줄 칸은 아예 못 눌렀다  (내 것)
#
# 🚨 회차는 **이미지 교체 수**로 센다. 57→9717e60, 58→63f897c, 서버는 지금 그 둘보다 뒤인
#    68f87bb(이미지 4187c9c393d5)를 돌리고 있으므로 이번이 최소 59다. up.log는 회차를 안 적고
#    **rollback 태그 수(80)는 회차가 아니다**(옛 태그가 섞여 있다) — 번호는 이 근거까지만 주장한다.
# ✅ 이 구간에 **마이그레이션 0건**(git diff --name-only 로 확인). 스키마 선행 적용이 필요 없다.
#
# 마커 3분법:
#   주    templates/fire-plan-workbook.xlsx 의 sha256   7b65d1e8… → 9c89bdb0…
#         ⭐ 이번 변경의 본체는 **자산**이다. 소스 리터럴만 보면 자산 교체를 증명하지 못한다
#           (43회차 교훈: 「.next에 신규 리터럴 0개 — 컨테이너 안 xlsx sha256만이 배포 마커」).
#   신규  AR19                0 → N   (1.1 열 경계가 밀려 생긴 새 앵커 주소)
#   역방향 AS19               N → 0   (그 자리의 옛 주소 — 신규만 보면 구 코드 잔존을 못 본다)
#   존속  data-a9-blank       before = after   (57회차 남의 축이 살아 있는가)
#   존속  complete-all-defects before = after  (52회차 남의 축)
#   음성  zzzNoSuchMarker59   0 = 0   (grep 자체가 거짓 양성을 내지 않는가)
set -u

EXPECT_HEAD=68f87bbd1c548784b9536cdccec847d35e39bd0f
EXPECT_IMG=4187c9c393d5
TARGET=24e061f345db9d8e82334bd1db4064beb7d65888
ROLLBACK_TAG=erp-app:rollback-68f87bb
NEXT_ROLLBACK=erp-app:rollback-24e061f
NEW_XLSX_SHA=9c89bdb0783193fb325f5ba666d3311682b6bb759f089a5672e00d65fb9905d3

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)
T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
echo "HEAD=$H"; echo "DIRTY=$D"; echo "RUNNING=$R"; echo "LATEST=$L"; echo "ROLLBACK($ROLLBACK_TAG)=$T"
[ "$H" = "$EXPECT_HEAD" ] || { echo GUARD_FAIL_HEAD; exit 21; }
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ -n "$R" ]               || { echo GUARD_FAIL_RUNNING_EMPTY; exit 23; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_LATEST; exit 25; }
# 남이 배포 중이면 얹지 않는다(16회차 사고 방지) — 4GB VPS에서 동시 빌드는 OOM이다
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }
# 복귀점이 없으면 지금 만든다
if [ -z "$T" ]; then
  echo "복귀점 없음 — 현재 latest를 $ROLLBACK_TAG 로 태그"
  sudo docker tag erp-app:latest "$ROLLBACK_TAG" || { echo GUARD_FAIL_TAG; exit 28; }
  T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" | cut -c8-19)
fi
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 26; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

echo "=== MARKER BEFORE (구 이미지 실물에서 잰다 — 전이를 증명하려면 before가 있어야 한다) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  f=$(find /app -name fire-plan-workbook.xlsx 2>/dev/null | head -1)
  echo "  before 자산경로=$f"
  echo "  before xlsx sha256=$(sha256sum "$f" 2>/dev/null | cut -c1-16)"
  echo "  before 신규(AR19)=$(grep -rlF "AR19" /app/.next 2>/dev/null | wc -l)"
  echo "  before 역방향(AS19)=$(grep -rlF "AS19" /app/.next 2>/dev/null | wc -l)"
  echo "  before 존속(data-a9-blank)=$(grep -rlF "data-a9-blank" /app/.next 2>/dev/null | wc -l)"
  echo "  before 존속(complete-all-defects)=$(grep -rlF "complete-all-defects" /app/.next 2>/dev/null | wc -l)"
  echo "  before 음성(zzzNoSuchMarker59)=$(grep -rlF "zzzNoSuchMarker59" /app/.next 2>/dev/null | wc -l)"
'

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -20
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== 새 이미지 태그(다음 회차 복귀점) ==="
sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치 — 새 이미지가 안 돌고 있다)')"
sudo docker exec erp-app-1 sh -c '
  f=$(find /app -name fire-plan-workbook.xlsx 2>/dev/null | head -1)
  echo "  after 자산경로=$f"
  echo "  after xlsx sha256=$(sha256sum "$f" 2>/dev/null | cut -c1-16)"
  echo "  after 신규(AR19)=$(grep -rlF "AR19" /app/.next 2>/dev/null | wc -l)"
  echo "  after 역방향(AS19)=$(grep -rlF "AS19" /app/.next 2>/dev/null | wc -l)"
  echo "  after 존속(data-a9-blank)=$(grep -rlF "data-a9-blank" /app/.next 2>/dev/null | wc -l)"
  echo "  after 존속(complete-all-defects)=$(grep -rlF "complete-all-defects" /app/.next 2>/dev/null | wc -l)"
  echo "  after 음성(zzzNoSuchMarker59)=$(grep -rlF "zzzNoSuchMarker59" /app/.next 2>/dev/null | wc -l)"
'
echo "=== 기대치 ==="
echo "  주 마커: xlsx sha256 이 ${NEW_XLSX_SHA:0:16} 이어야 한다 (아니면 자산이 안 바뀌었다)"
echo "  신규 AR19: 0 → 1 이상 / 역방향 AS19: N → 0"
echo "  존속 2건은 before와 같아야 하고, 음성은 0이어야 한다"
