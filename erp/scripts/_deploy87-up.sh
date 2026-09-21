#!/usr/bin/env bash
# 87회차 운영 배포 — f112ef18 → origin/main(c32da4bc, 2커밋 · 둘 다 내 것)
#   b96dccb feat(고객관리): 트리·탭을 키보드로 오간다 — Tab이 트리에 갇혀 13번 눌러야 했다
#   c32da4b feat(소방계획서): 엑셀 표지를 「사진 표지」로 — 제목이 이름 길이에 맞춰 커진다
#
# 🚨 회차는 **이미지 교체 수**로 센다(롤백 태그 개수가 아니다). 86→f112ef18(d3e099d697db), 이번이 87.
# 🚨 이번 구간에 **마이그레이션 없음**(supabase/migrations 변경 0건 — baseline에서 실측). DDL 대기 불필요.
#
# 마커 3분법 (배포 전 실행 중 컨테이너에서 실측한 before를 박아 둔다 — 2026-09-21):
#   신규  data-detail-panel        0 → N   (트리에서 Enter로 들어갈 착지점 — 키보드 커밋)
#   신규  표지 제목 크기 조정 불발   0 → N   (표지 고지 문구 · 한글이라 minify가 못 지운다)
#   확대  aria-modal               4 → >4  (⚠ **0이 아니다** — 다른 모달이 이미 쓴다.
#                                           0을 기대하면 잘못된 빨강이 된다. 미저장 확인창이 하나 더 는다)
#   자산  templates xlsx sha256  890b5605 → dd7ced22
#                                          (표지 개편의 **주 마커** — 표지 구조·사진 상자는 코드가 아니라
#                                           템플릿 바이트에 산다. 이게 안 바뀌면 표지는 종전 그대로다)
#   존속  xlsx-notice-chip         2 = 2   (86회차 남의 축이 살아 있는가)
#   존속  reports-round-label      1 = 1   (85회차 축)
#   존속  fire-plan-xlsx          10 = 10  (남의 축 포함 넓은 축)
#   존속  저장하지 않은 변경이…    22 = 22  (확인창 자체는 원래 있다 — 내가 고친 건 키보드 거동뿐)
#   음성  zzzNoSuchMarker87        0 = 0   (grep이 거짓 양성을 내지 않는가)
#
# ⚠ **탭 순서(회차를 소방계획서 뒤로)는 마커로 증명할 수 없다** — 새 문자열이 없는 배열 순서 변경이라
#   minify된 번들에서 잴 방법이 없다. 그 축은 `_probe-annex-tab`이 로컬에서 22/0으로 붙들고 있고,
#   운영에서는 화면을 눈으로 본다(운영 DB엔 E2E 계정이 없어 자동 로그인 검사를 못 돈다).
set -u

EXPECT_HEAD=f112ef1
EXPECT_IMG=d3e099d697db
ROLLBACK_TAG=erp-app:rollback-f112ef1

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
# 내 커밋 **둘 다** 그 안에 정말 있는지 — 배포하고도 안 나가는 일을 막는다(회차마다 물린 적이 있다)
git -C /home/ubuntu/woni merge-base --is-ancestor b96dccb1 origin/main || { echo MINE_KBD_NOT_IN_TARGET; exit 32; }
git -C /home/ubuntu/woni merge-base --is-ancestor c32da4bc origin/main || { echo MINE_COVER_NOT_IN_TARGET; exit 33; }
git -C /home/ubuntu/woni merge --ff-only origin/main || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 34; }

echo "=== BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== 다음 회차 복귀점 ==="
docker tag erp-app:latest "erp-app:rollback-$NEW" && echo "tagged erp-app:rollback-$NEW"

echo "=== UP DONE — 마커는 별도 verify로 잰다 ==="
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
