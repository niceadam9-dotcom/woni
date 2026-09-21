#!/usr/bin/env bash
# 95회차 운영 배포 — 37820ac → origin/main · 마이그 0
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
# ─────────────────────────────────────────────────────────────────────────────
# 🚨🚨 **이 파일은 실제로 돌았다 — 다만 내가 돌린 게 아니다.** (2026-09-21 사후 정정)
#   나는 이 스크립트를 ssh+nohup으로 띄우려다 실패했고(`/tmp/_d95up.log`가 빈 채로 끝),
#   「안 돌았다」고 단정해 **이 파일을 지웠다가 되살렸다**. 서버 증거가 반대였다:
#     · `/tmp/_deploy95-up.sh` (20:27) = 이 파일 그대로
#     · `/tmp/_deploy95.log`   (20:29) = `GUARD … (기대 37820ac) · (기대 2a3f6ae58941)` — **내 값**
#     · 그 로그가 `Updating 37820ac..5ae147d  Fast-forward`로 배포를 완주했다
#   타 세션이 「준비만 되고 안 돌린 up이 `ff-only origin/main`이라 같은 배」라 판단하고
#   **이 파일을 그대로 실행**했다. 그래서 target은 머리말의 f615cb7c가 아니라 **5ae147d**다
#   (origin이 그사이 또 움직였고, 스크립트가 실행 시점에 `rev-parse origin/main`을 다시 읽는다).
#   ⭐ 교훈 둘:
#     ① **「내 로그가 비었다」는 「안 돌았다」가 아니다.** 내 *실행 경로*가 죽은 것과 *스크립트*가
#        안 돈 것은 다른 사실이다. 판정은 서버의 실행 흔적(/tmp 로그·GUARD 값·up.log)에 묻는다.
#     ② **돌았을지 모르는 배포 스크립트를 지우지 않는다.** 지우면 무엇이 운영에 무엇을 했는지
#        추적할 근거가 사라진다. 낡은 EXPECT 값이 걱정이면 지우지 말고 **머리말에 적는다**.
# ─────────────────────────────────────────────────────────────────────────────
#
# 마커 3분법 (배포 전 실행 중 컨테이너에서 실측한 before를 박아 둔다 · after는 실측 확인됨):
#   신규  multiday-end            0 → 2   (점검기간 종료일 칸 testid — 내 커밋)
#   신규  multiday-warn           0 → 2   (5일 초과 경고 — 내 커밋)
#   신규  다일 점검은 최대          0 → 3   (그 경고 문구 — 내 커밋)
#   신규  점검 일수                0 → 2   (일수 칸 aria-label — 내 커밋)
#   신규  daypanel-workbook       0 → 2   (남의 커밋 — 구간 전체가 나갔는지 함께 본다)
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
