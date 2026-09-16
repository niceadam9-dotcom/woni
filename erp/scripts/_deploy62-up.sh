#!/usr/bin/env bash
#
# 🚨 **파일명은 62회차인데 본문의 회차 표기와 음성 마커는 61이다 — 일부러 그렇다.**
#    실행 당시 이 스크립트는 `_deploy61-up.sh`였고 음성 마커도 `zzzNoSuchMarker61`로 돌았다
#    (실행 로그: `음성(zzzNoSuchMarker61)=0`). 그런데 **다른 세션이 같은 시각에 「61회차」를
#    선점**했다(b971dbc -> ea02271, 커밋 3fc8607). 그래서 파일명만 62로 올리고 **본문은 돌아간
#    그대로 둔다** — 기록을 예쁘게 고치면 로그와 대조가 안 된다.
#    ⭐ 회차 번호는 전역 자원인데 두 세션이 동시에 집었다. 다음 사람은 up 스크립트를 쓰기 전에
#      `git log --oneline origin/main | grep 회차`로 선점 여부를 먼저 볼 것.
# 61회차 운영 배포 — ea02271 -> 08cdc18 (1커밋, 이번 세션 것뿐)
#   08cdc18 feat(목록): 소방계획서·결과보고서를 첫페이지에서 바로 받는다 — 상세 안쪽에 갇혀 있었다
#
# ✅ 마이그레이션 0건. (구간에 있던 165는 **직전 회차에 이미 실렸고**, 운영 DB에도 적용돼 있다 —
#    2026-09-16 실측: buildings.stair_*_count 4컬럼 REST 200, 대조군 id도 200.)
#
# 🚨 **이 스크립트는 한 번 GUARD_FAIL_HEAD로 섰다.** 정찰(b971dbc) 후 실행 사이에 다른 세션이
#    ea02271로 배포 중이었다(docker compose 41초 경과·가용 메모리 553MB). 4GB VPS에서 동시 빌드는
#    OOM이라 물러나 기다렸고, 그쪽이 끝난 뒤 기대값을 **새 실측으로** 갱신해 재실행한다.
#    그래서 구간이 7커밋 → 1커밋으로 줄었고 마커 분류도 함께 바뀌었다(아래).
#
# 마커 3분법:
#   신규   fire-plan-pdf-link        0 → ≥1   (고객 목록 「PDF」 바로가기)
#   신규   doc-notice-toast          0 → ≥1   (목록용 고지 토스트 — 표 밖으로 뺀 창구)
#   존속   stair_special_count      ≥1 → 같음  (직전 회차 것이 살아 있는가 — 내 배포가 덮지 않았는가)
#   존속   data-a9-blank             2 = 2
#   존속   complete-all-defects      2 = 2
#   음성   zzzNoSuchMarker61         0 = 0
#
# 🚨 **내 변경에는 역방향 마커가 원리적으로 없다** — 목록에 버튼을 «더하기만» 했기 때문이다.
#    없는 것을 있는 척 만들지 않는다. 내 축은 신규 2개로, 남의 축 무손상은 존속 3개로 증명한다.
set -u

EXPECT_HEAD=ea02271985877c4146a10f16a9145654c0e92f85
EXPECT_IMG=77debd07b84f
TARGET=08cdc18
ROLLBACK_TAG=erp-app:rollback-ea02271
NEXT_ROLLBACK=erp-app:rollback-08cdc18

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
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_LATEST; exit 25; }
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 26; }
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "MEM_AVAIL=${AVAIL}MB"
[ "$AVAIL" -ge 800 ] || { echo GUARD_FAIL_MEM; exit 28; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

MARK='
  echo "    신규(fire-plan-pdf-link)=$(grep -rlF "fire-plan-pdf-link" /app/.next 2>/dev/null | wc -l)"
  echo "    신규(doc-notice-toast)=$(grep -rlF "doc-notice-toast" /app/.next 2>/dev/null | wc -l)"
  echo "    존속(stair_special_count)=$(grep -rlF "stair_special_count" /app/.next 2>/dev/null | wc -l)"
  echo "    존속(data-a9-blank)=$(grep -rlF "data-a9-blank" /app/.next 2>/dev/null | wc -l)"
  echo "    존속(complete-all-defects)=$(grep -rlF "complete-all-defects" /app/.next 2>/dev/null | wc -l)"
  echo "    음성(zzzNoSuchMarker61)=$(grep -rlF "zzzNoSuchMarker61" /app/.next 2>/dev/null | wc -l)"
'
echo "=== MARKER BEFORE (구 이미지 실물) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c "$MARK"

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -12
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치)')"
sudo docker exec erp-app-1 sh -c "$MARK"
echo "  HTTP /login = $(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "=== 기대치: 신규 2개 0→≥1 · 존속 3개 그대로 · 음성 0 ==="
