#!/usr/bin/env bash
# 95회차 실행기 — up 스크립트는 **서버에 없다**(배포 뒤에 기록으로 커밋하는 규약이라 로컬 미커밋).
#   그래서 본문을 그대로 싣고 /tmp에 풀어 nohup으로 띄운다. 빌드가 수 분이라 ssh 한 번에
#   붙들면 출력이 잘린다(78회차 전례) — 로그만 남기고 즉시 빠진 뒤 폴링으로 본다.
set -u
cat > /tmp/_deploy95-up.sh <<'EOSCRIPT95'
#!/usr/bin/env bash
# 95회차 운영 배포 — 37820ac → origin/main(f615cb7c · 5커밋 · 마이그 0)
#   fb22bbd3 fix(달력): 패널 하단 [N단계로 이동] 복귀 시 우측바가 닫혀 있었다        ← 내 것
#   007db617 fix(검사): 공통문구 관리 E2E가 실데이터 ⭐를 지우고 있었다              ← 남의 것
#   fceb11e9 fix(점검): 점검 기간 종료일↔일수 양방향                                 ← 내 것
#   f615cb7c feat(점검달력): 사이드 패널에서 [보고서 엑셀]을 떠나지 않고 받는다      ← 남의 것
#   e8e04bb4 chore(배포): 94회차 기록                                               ← 문서 전용
#
# 🚨 회차는 **이미지 교체 수**로 셌다(착수 실측 2026-09-21): 롤백 태그 최신이 `rollback-37820ac`이고
#   서버 HEAD도 37820ac다 — 94회차가 실제로 나가 있다. 그래서 이번이 **95**다.
# 🚨 마이그레이션 없음(37820ac..origin/main의 supabase/migrations 변경 0건 — 실측).
# 🚨 템플릿(xlsx) 불변: 서버 sha가 이미 5dc767d1a9101aa9다. 이 회차에 **변하면 오히려 이상**이다.
#
# 마커 3분법 (배포 전 실행 중 컨테이너에서 실측한 before를 박아 둔다):
#   신규  multiday-end            0 → N   (점검기간 종료일 칸 testid — 내 커밋)
#   신규  multiday-warn           0 → N   (5일 초과 경고 — 내 커밋)
#   신규  다일 점검은 최대          0 → N   (그 경고 문구 — 내 커밋)
#   신규  점검 일수                0 → N   (일수 칸 aria-label — 내 커밋)
#   신규  daypanel-workbook       0 → N   (남의 커밋 f615cb7c — 구간 전체가 나갔는지 함께 본다)
#   존속  calendar-step-input     2 = 2
#   존속  daypanel-detail-link    2 = 2   (내가 고친 그 링크 — **사라지면 안 된다**)
#   존속  sheet-entry-back        2 = 2
#   존속  설비 확인 → 점검표       4 = 4
#   존속  배치확인서를 올리거나     4 = 4
#   존속  data-detail-panel       2 = 2
#   자산  templates xlsx sha  5dc767d1a9101aa9 = 그대로
#   음성  zzzNoSuchMarker95       0 = 0
#
# ⚠ **`fb22bbd3`에는 문자열 마커가 없다.** 복귀 주소 조립을 한 곳으로 합친 변경이라 새 문자열이
#   생기지 않고, 지워진 쪽(`const back = …`)도 minify가 식별자를 지운다. 지어내지 않는다 —
#   그 축의 정본은 로컬 게이트다(step2 왕복 14/0 · 왕복 16/0 · 변이 4/4). 배포 착지는
#   **커밋이 서버 HEAD의 조상인가**로 증명한다(아래 FF 검사 + verify의 조상 판정).
set -u

EXPECT_HEAD=37820ac
EXPECT_IMG=2a3f6ae58941
ROLLBACK_TAG=erp-app:rollback-37820ac

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "HEAD=$H (기대 $EXPECT_HEAD) · dirty=$D · img=$R (기대 $EXPECT_IMG) · inflight=$INFLIGHT"
[ "$H" = "$EXPECT_HEAD" ] || { echo GUARD_FAIL_HEAD; exit 21; }
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_IMG; exit 23; }
[ "$INFLIGHT" = "0" ]     || { echo GUARD_FAIL_INFLIGHT; exit 24; }

echo "=== 복귀점 확보 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "이미 있음: $ROLLBACK_TAG" \
  || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse --short origin/main)
echo "target = $TARGET"
# 내 커밋 둘이 정말 그 안에 있는지 — 배포하고도 안 나가는 일을 막는다(회차마다 물린 적이 있다)
for C in fb22bbd3 fceb11e9; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" origin/main || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
# 마이그레이션이 섞여 들어왔으면 멈춘다 — 이 회차는 0건이어야 한다(착수 실측)
MIG=$(git -C /home/ubuntu/woni diff --name-only HEAD..origin/main -- erp/supabase/migrations | wc -l)
[ "$MIG" = "0" ] || { echo "GUARD_FAIL_MIGRATION:$MIG"; exit 34; }
git -C /home/ubuntu/woni merge --ff-only origin/main || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }

echo "=== BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== 다음 회차 복귀점 ==="
docker tag erp-app:latest "erp-app:rollback-$NEW" && echo "tagged erp-app:rollback-$NEW"

echo "=== UP DONE — 마커는 별도 verify로 잰다 ==="
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
EOSCRIPT95
rm -f /tmp/_deploy95.log
nohup bash /tmp/_deploy95-up.sh > /tmp/_deploy95.log 2>&1 &
echo "LAUNCHED pid=$!"
sleep 8
echo "--- 첫 8초 ---"
cat /tmp/_deploy95.log
