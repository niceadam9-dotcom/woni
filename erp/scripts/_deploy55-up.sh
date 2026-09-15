#!/usr/bin/env bash
# 55회차 운영 배포 — 5d7cde0 -> a963008 (2커밋 = 내 것뿐)
#   8b47f5d test(경계): 법정 기본 3순위가 저장 경로로 새지 않도록 음성 단언으로 막는다
#   a963008 fix(갑지 엑셀): 이행조치 일자에 46299가 인쇄됐다 — 4행 중 한 행만 날짜 서식이었다
#
# 🚨 회차는 **이미지 교체 수**로 셌다(52회차 규약). 52→4d19849, 53→e3245e8, 54→5d7cde0,
#    이번이 55. rollback 태그 **전수 개수(72)는 회차가 아니다** — 옛 태그가 섞여 있다.
#
# 🚨 **이번 변경의 주 마커는 `.next` 문자열이 아니다.**
#    a963008은 템플릿 **바이너리**(완료보고서 일자 4행 numFmt)를 고쳤고, 8b47f5d는 주석·검사뿐이라
#    소스에 새 리터럴이 없다. 그래서 유일한 배포 마커는 **컨테이너 안 xlsx sha256**이다.
#      before bb465a2688d8fe8320e22a44  (패치 전 — 실측 확인)
#      after  feaa5190be21efc4          (원격 자산·매니페스트와 일치 실측)
#    `.next`만 뒤지면 「배포됐는데 마커 0」으로 보여 배포 실패로 오판한다(16회차 교훈의 변형).
set -u

EXPECT_HEAD=5d7cde082963c051a4f5fed1c1cb506d0510bf49
EXPECT_IMG=ea43ed9342e7
TARGET=a963008
ROLLBACK_TAG=erp-app:rollback-5d7cde0
NEXT_ROLLBACK=erp-app:rollback-a963008
TPL=/app/templates/report-workbook-full.xlsx
SHA_BEFORE=bb465a2688d8fe8320e22a44
SHA_AFTER=feaa5190be21efc4

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
# 복귀점이 없으면 **지금 만든다**(51회차가 안 남겨 52회차가 만들었던 그 상황 방지)
if [ -z "$T" ]; then
  echo "복귀점 없음 — 현재 latest를 $ROLLBACK_TAG 로 태그"
  sudo docker tag erp-app:latest "$ROLLBACK_TAG" || { echo GUARD_FAIL_TAG; exit 28; }
  T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" | cut -c8-19)
fi
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 26; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

echo "=== MARKER BEFORE (구 이미지 실물에서 잰다 — 전이를 증명하려면 before가 있어야 한다) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c "
  echo \"  before 주마커 템플릿 sha256=\$(sha256sum $TPL 2>/dev/null | cut -c1-24)\"
  echo \"  before 존속(complete-all-defects · 52회차 남의 축)=\$(grep -rlF 'complete-all-defects' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(legalActionRange · 51회차 남의 축)=\$(grep -rlF 'legalActionRange' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 음성(zzzNoSuchMarker55)=\$(grep -rlF 'zzzNoSuchMarker55' /app/.next 2>/dev/null | wc -l)\"
"

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
echo "HEAD_NOW=$NEW"

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
sudo docker exec erp-app-1 sh -c "
  echo \"  after 주마커 템플릿 sha256=\$(sha256sum $TPL 2>/dev/null | cut -c1-24)\"
  echo \"  after 존속(complete-all-defects)=\$(grep -rlF 'complete-all-defects' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(legalActionRange)=\$(grep -rlF 'legalActionRange' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 음성(zzzNoSuchMarker55)=\$(grep -rlF 'zzzNoSuchMarker55' /app/.next 2>/dev/null | wc -l)\"
"
echo "=== 기대치 ==="
echo "  주마커: $SHA_BEFORE → ${SHA_AFTER}…  (바뀌어야 성공)"
echo "  존속 2건은 before와 같아야 하고, 음성은 0이어야 한다"
