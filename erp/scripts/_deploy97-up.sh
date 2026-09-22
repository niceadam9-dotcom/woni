#!/usr/bin/env bash
# 97회차 운영 배포 — 94c1646e → origin/main(ac9cbed7) · 5커밋 · 마이그 0
#   e3add004 chore(배포): 96회차 기록                              (문서 전용)
#   c6ce07a9 feat(점검달력): 패널에 점검기간 접힌 한 줄            (R3)
#   8276cf4f feat(점검달력): 한 바퀴 끝난 회차를 「종료됨」으로     (R7)
#   92401c55 feat(점검달력): 1단계 칩 드래그로 점검일자 이동       (R8b)
#   ac9cbed7 feat(고객·점검달력): 잠정 기산점 — 사용승인일 미입력  (신규)
#
# 🚨 회차는 **이미지 교체 수**로 셌다(착수 실측 2026-09-22): 롤백 태그 최신이 `rollback-5ae147d`,
#   서버 HEAD가 `94c1646`이고 서버에 남은 up 스크립트 최신이 95다. 로컬 git에 96이 있으니
#   이번이 **97**이다. 선점한 타 세션 없음(inflight=0).
# 🚨 마이그레이션 없음(94c1646..origin/main의 supabase/migrations 변경 0건 — 실측).
# 🚨 템플릿(xlsx) 불변: 서버 sha가 5dc767d1a9101aa9다. 이 회차에 **변하면 오히려 이상**이다.
#
# 마커 3분법 (배포 전 **실행 중 컨테이너에서 실측한 before**를 박아 둔다):
#   신규  daypanel-period            0 → N   (패널 점검기간 접힌 줄 — R3)
#   신규  daypanel-period-mismatch   0 → N   (저장 일수와 어긋남 표식 — R3)
#   신규  daypanel-closed            0 → N   (회차 패널 「종료됨」 배지 — R7)
#   신규  daypanel-row-closed        0 → N   (데이 패널 목록 「종료됨」 칩 — R7)
#   신규  종료됨                      0 → N   (그 글씨 — R7)
#   신규  new-anchor-legal           0 → N   (등록 폼 「법정 기산점」 안내 — 잠정)
#   신규  new-anchor-provisional     0 → N   (등록 폼 「잠정 배치」 안내 — 잠정)
#   신규  anchor-provisional         0 → N   (고객 수정 배지 — 잠정)
#   신규  customer-row-provisional   0 → N   (목록 행 「잠정」 칩 — 잠정)
#   신규  calendar-cell-new-customer 0 → N   (달력 칸 + 입구 — 잠정)
#   신규  잠정 기산점만               0 → N   (목록 필터 선택지 — 잠정)
#   신규  잠정 배치                   0 → N   (등록 폼 문구 — 잠정)
#   존속  daypanel-new-customer       2 ≥ 2  (96회차 축 — 이번에 줄면 안 된다)
#   존속  daypanel-workbook           2 ≥ 2
#   존속  daypanel-fireplan           2 ≥ 2
#   존속  daypanel-detail-link        2 ≥ 2
#   존속  daypanel-step-row           2 ≥ 2
#   존속  anchor-date-modal           2 ≥ 2  (R8b가 재사용하는 R8a 모달 — 없어지면 드래그가 죽는다)
#   존속  anchor-date-save            2 ≥ 2
#   존속  anchor-date-edit            2 ≥ 2
#   존속  legal-schedule-badge        4 ≥ 4
#   존속  calendar-sms-day            2 ≥ 2
#   자산  templates xlsx sha  5dc767d1a9101aa9 = 그대로
#   음성  zzzNoSuchMarker97           0 = 0
#
# ⚠ **존속은 등호가 아니라 「줄지 않았다」(≥)로 판정한다** — 96회차 교훈. 신규 문자열이 기존
#   문자열을 **부분문자열로 품으면** 파일 수가 정당하게 늘 수 있다. 여기선 특히
#   `daypanel-period`가 `daypanel-period-mismatch`를 품는다. 등호로 걸면 멀쩡한 배포가 빨강이 된다.
#
# ⚠ **`92401c55`(R8b)에는 고유 마커가 없다.** 드롭이 R8a의 기존 모달(`anchor-date-modal`)을
#   그대로 재사용하고(새 규칙을 안 짰다는 뜻이기도 하다), 판정 모듈 `calendar-drag`의 함수명은
#   minify가 지운다. 96회차 R4와 **같은 부류**다. 지어내지 않는다 — 착지는 **조상 관계**로
#   증명하고, 동작은 같은 파일·같은 배에 실린 R3·R7 마커가 대신 증언한다
#   (그 마커가 뜨면 같은 번들 안에 R8b 코드도 들어가 있다).
#
# ⚠ **`점검기간`은 마커로 쓰지 않는다** — 착수 실측 before가 **15**다(별지 등에 이미 있다).
#   96회차 `결과보고서 엑셀`(before 4)과 같은 부류의 부적격 후보다. 후보는 운영 이미지에 먼저 묻는다.
set -u

EXPECT_HEAD=94c1646
EXPECT_IMG=b2ba83ee5dd3
ROLLBACK_TAG=erp-app:rollback-94c1646

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
# 구간 4커밋이 정말 그 안에 있는지 — 배포하고도 안 나가는 일을 막는다(회차마다 물린 적이 있다)
for C in c6ce07a9 8276cf4f 92401c55 ac9cbed7; do
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
