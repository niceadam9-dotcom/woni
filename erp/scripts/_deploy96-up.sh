#!/usr/bin/env bash
# 96회차 운영 배포 — 5ae147d → origin/main(94c1646e) · 9커밋 · 마이그 0
#   e0011940 feat(점검달력): 점검일자를 달력에서 고친다        (R8a — 없는 기능을 만든다)
#   ee8b294d feat(점검달력): 달력에서 날짜를 짚어 고객을 등록  (R1)
#   ab4356b7 fix(점검달력): 미래 날짜를 정직하게               (R2)
#   e6d5945f feat(보고서): 엑셀 고지 분류 — 순수 모듈·화면 0   (R4)
#   4070b9d7 feat(점검달력): 고지를 채우러 가는 입구로         (R5)
#   94c1646e feat(점검달력): 패널에 소방계획서 엑셀 + 칩       (R6)
#   4b01ed90·a2fea72f·150f6410 chore(배포): 95회차 기록        (문서 전용)
#
# 🚨 회차는 **이미지 교체 수**로 셌다(착수 실측 2026-09-22 15:07): 롤백 태그 최신이
#   `rollback-5ae147d`(09-21 20:29)이고 서버 HEAD도 5ae147d다 — 95회차가 실제로 나가 있다.
#   그래서 이번이 **96**이다. 선점한 타 세션 없음(inflight=0 · /tmp에 _deploy96-* 없음).
# 🚨 마이그레이션 없음(5ae147d..origin/main의 supabase/migrations 변경 0건 — 실측).
# 🚨 템플릿(xlsx) 불변: 서버 sha가 5dc767d1a9101aa9다. 이 회차에 **변하면 오히려 이상**이다.
#
# 마커 3분법 (배포 전 **실행 중 컨테이너에서 실측한 before**를 박아 둔다):
#   신규  anchor-date-preview         0 → N   (점검일자 재계산 미리보기 — R8a)
#   신규  anchor-date-save            0 → N   (저장 버튼 — R8a)
#   신규  anchor-date-modal-blocked   0 → N   (2단계 완료면 사유 표시 — R8a)
#   신규  점검일자 고치기              0 → N   (그 진입 버튼 글씨 — R8a)
#   신규  calendar-new-customer-modal 0 → N   (달력에서 고객 등록 — R1)
#   신규  daypanel-new-customer       0 → N   (데이 패널 등록 버튼 — R1)
#   신규  calendar-created-banner     0 → N   (등록 후 띠 — R1)
#   신규  anchor-future-note          0 → N   (미래 날짜 안내 — R2)
#   신규  doc-notice-chip             0 → N   (고지 칩 = 채우러 가는 입구 — R5)
#   신규  doc-notice-caps             0 → N   (채울 수 없는 것 덩이 — R5)
#   신규  daypanel-workbook-resume    0 → N   (채우고 돌아왔다 배너 — R5)
#   신규  daypanel-fireplan           0 → N   (패널 소방계획서 엑셀 — R6)
#   존속  calendar-step-input         2 = 2
#   존속  daypanel-detail-link        2 = 2
#   존속  sheet-entry-back            2 = 2
#   존속  data-detail-panel           2 = 2
#   존속  daypanel-workbook           2 = 2   (95회차 축 — 이번에 줄면 안 된다)
#   존속  multiday-end                2 = 2   (95회차 축)
#   존속  flex gap-6 items-start      4 = 4
#   자산  templates xlsx sha  5dc767d1a9101aa9 = 그대로
#   음성  zzzNoSuchMarker96           0 = 0
#
# ⚠ **`e6d5945f`(R4)에는 고유 마커가 없다.** 화면 변경 0인 순수 모듈이라 새 문자열이 UI에
#   안 나오고, 함수명은 minify가 지운다. 지어내지 않는다 — 착지는 **조상 관계**로 증명하고,
#   그 모듈이 실제로 도는지는 그 위에 얹힌 R5 마커(doc-notice-chip·doc-notice-caps)로 본다.
#   R5가 뜨면 R4의 분류표가 돈 것이다(그 칩이 분류 결과로만 만들어진다).
set -u

EXPECT_HEAD=5ae147d
EXPECT_IMG=7ab4339df187
ROLLBACK_TAG=erp-app:rollback-5ae147d

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
# 구간 6커밋이 정말 그 안에 있는지 — 배포하고도 안 나가는 일을 막는다(회차마다 물린 적이 있다)
for C in e0011940 ee8b294d ab4356b7 e6d5945f 4070b9d7 94c1646e; do
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
echo UP_SCRIPT_DONE
