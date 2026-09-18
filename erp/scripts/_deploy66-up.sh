#!/usr/bin/env bash
# 66회차 운영 배포 — bf7ff2bc -> 2a26773d (3커밋 = 65회차 이후 증분 「모아서」)
#   1564fff0 65회차 기록 · d49c78e8 1.11.2 세부계획 16칸 · 2a26773d 2.5 주방 블록 6상자.
#   마이그 0 · xlsx 자산 변경 0(착수 실측).
#
# 마커 3분법 (로컬 .next 자기검증 완료):
#   신규   train2_scenario(1.11.2) · cmd25_(2.5 — 템플릿 접두)   0 → ≥1
#   존속   promoPlan · rec1114_content                          유지
#   음성   zzzNoSuchMarker66                                     0 = 0
# ⚠ `cmd25_L5`는 템플릿 리터럴로 조립돼 번들에 안 남는다 — **접두 `cmd25_`로 센다**
#   (자기검증이 이 함정을 잡았다: 마커를 잘못 고르면 성공을 실패로 오판한다).
# ⚠ HEAD 비교는 **full sha**로 한다(65회차에서 `--short` 7자와 8자 기대값이 어긋나 섰다).
set -u

EXPECT_HEAD=bf7ff2bc39eede93e438c1e57743b41d2f3755f1
EXPECT_IMG=551d17647a8e
TARGET=2a26773d
ROLLBACK_TAG=erp-app:rollback-bf7ff2bc
NEXT_ROLLBACK=erp-app:rollback-2a26773d

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

echo "=== MARKER BEFORE (구 이미지 실물) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c "
  echo \"  before 신규(train2_scenario)=\$(grep -rlF 'train2_scenario' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 신규(cmd25_)=\$(grep -rlF 'cmd25_' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(promoPlan)=\$(grep -rlF 'promoPlan' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(rec1114_content)=\$(grep -rlF 'rec1114_content' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 음성(zzzNoSuchMarker66)=\$(grep -rlF 'zzzNoSuchMarker66' /app/.next 2>/dev/null | wc -l)\"
"

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -12
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== 새 이미지 태그(다음 회차 복귀점) ==="
sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치 — 옛 이미지가 떠 있다)')"
sudo docker exec erp-app-1 sh -c "
  echo \"  after 신규(train2_scenario)=\$(grep -rlF 'train2_scenario' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 신규(cmd25_)=\$(grep -rlF 'cmd25_' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(promoPlan)=\$(grep -rlF 'promoPlan' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(rec1114_content)=\$(grep -rlF 'rec1114_content' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 음성(zzzNoSuchMarker66)=\$(grep -rlF 'zzzNoSuchMarker66' /app/.next 2>/dev/null | wc -l)\"
"
echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "=== 기대치 ==="
echo "  신규 2종 0→≥1 · 존속 2종 유지 · 음성 0 · login=200"
