#!/usr/bin/env bash
# 88회차 운영 배포 — c32da4bc -> e65df4ac (2커밋·마이그 0)
#   c3c10922 fix(고객관리): 잘 안 보이던 화살표·폭 버튼을 2배 크게·굵게   ← **타 세션 작업**
#   e65df4ac fix(마감일): 달력과 점검업무를 한 축으로 — 총 이행기간 10/20일 반영 + 6단계 연계
#
# ⚠ 구간에 내 것이 아닌 커밋(c3c10922)이 하나 섞였다. 마이그 0·파일 무겹침(UI 크기 조정).
#   그쪽 세션이 먼저 배포하면 아래 가드의 EXPECT_HEAD가 나를 세운다 — 그때 구간을 다시 잰다.
#
# 마커 3분법 (운영 before는 아래 실측란 참조 · 로컬 프로덕션 .next는 server/static만):
#   신규A  '확정일 +15영업일'   (④ 기한 설명 — 축 통일로 문구가 바뀐 자리)   0 → N (로컬 2)
#   신규B  '기간 고치기'        (종전 [종료일 고치기] — 뜻이 바뀌어 개명)     0 → N (로컬 2)
#   신규C  '9호 제출'           (달력 패널 ④ 단계 링크 라벨 — B-1 6단계 연계) 0 → N (로컬 9)
#   역방향 **두 축이 함께 사라진다** — 같은 수리의 서로 다른 표면이라 한 축만 보면 속을 수 있다.
#            A '점검 종료일 +15일'  (④ 기한 설명 옛 문구)
#            B '종료일 고치기'      (옛 버튼 라벨)
#          둘 다 양수 → 0 (로컬 전부 0 확인)
#   존속   83회차(etc-scope-) · 81회차(별지 전용 입력 —) · 80회차(building-saved-note) ·
#          mgr171_ · past-anchor-start-notice 유지
#   음성   zzzNoSuchMarker88 = 0
#
# 행위 판정은 로컬 게이트가 정본: tsc 0 · pre-push next build+불변식 통과 ·
#   test-step-dates 18/0(신설 — 운영 하늘촌 2026-1 6단계 표본 고정·10/20일 갈림) ·
#   test-due-axis-parity 19/0(신설 — 달력↔작업대 전수 대조) · test-inspection-workbench 29/0(등재) ·
#   test-h28-journey-stepper 24/0 · test-calendar-plan-row-entry 18/0 ·
#   변이 P-1(④를 옛 법정 산식으로) 2빨강 · P-2(⑤를 10일 고정으로) 2빨강.
#   리베이스 뒤 재검증 완료(리베이스는 검증을 승계하지 않는다).
#
# 🚨 배포 ssh는 도구 타임아웃(120s)에 끊긴다 — nohup + 로그 폴링으로 돌린다.
# 🚨 EXPECT_HEAD는 **전체 SHA**다(83회차에서 8자 SHA를 `rev-parse --short`와 맞대 가드가 섰다).
#
# 실측 결과(2026-09-21 배포 완료 — 전건 초록):
#   1차 실행은 **GUARD_FAIL_ROLLBACK으로 섰다** — 복귀점 태그가 87회차에서 `rollback-c32da4b`
#   (**7자**)로 붙었는데 내가 8자 이름을 지어 맞댔기 때문이다. 태그는 멀쩡히 있었다.
#   → 가드를 **이름이 아니라 실체**로 바꿨다: 지금 이미지를 가리키는 rollback-* 태그를 **찾는다**.
#      물어야 할 것은 「되돌아갈 곳이 있는가」이지 그 이름이 아니다.
#   가드 OK(HEAD=c32da4bc·RUNNING=LATEST=b3427ad0a6e4·INFLIGHT 0·복귀점 rollback-c32da4b)
#   before 신규A 0·B 0·C 5 · 역방향A 2·B 2 · 존속 2·1·2·3·2 · 음성 0
#   after  신규A 2·B 2·C 9 · **역방향A·B 둘 다 0** · 존속 그대로 · 음성 0
#   FF c32da4b→e65df4a · RUNNING=LATEST=96fba48c28ae · rollback-e65df4ac 태그 · login=200
#   ⭐ 신규C(9호 제출)는 before가 5였다 — 0→N이 아니라 **5→9**(B-1이 링크 라벨을 늘린 자리).
#     「신규」라는 이름에 속지 말 것: 판정은 증가이고, 그래서 before를 반드시 먼저 잰다.
set -u

EXPECT_HEAD=c32da4bc8f5b6ed9c325e461ec0b7d41962d5e50
EXPECT_IMG=b3427ad0a6e4
TARGET=e65df4ac
NEXT_ROLLBACK=erp-app:rollback-e65df4ac
# 🚨 복귀점은 **이름이 아니라 실체**로 묻는다. 회차마다 태그의 SHA 자릿수가 다르다
#   (87회차는 `rollback-c32da4b` 7자, 내 회차들은 8자) — 이름을 지어 맞대면 태그가 멀쩡히
#   있는데도 GUARD_FAIL_ROLLBACK이 선다(이 회차에서 실제로 섰다). 물어야 할 것은
#   「지금 돌고 있는 이미지로 되돌아갈 태그가 하나라도 있는가」이지 그 이름이 아니다.

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)
# 지금 이미지를 가리키는 rollback-* 태그를 **찾는다**(이름을 짓지 않는다)
T=$(sudo docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
  | grep -F "erp-app:rollback-" | awk -v img="$EXPECT_IMG" '$2 == img {print $1; exit}')
echo "HEAD=$H"; echo "DIRTY=$D"; echo "RUNNING=$R"; echo "LATEST=$L"; echo "ROLLBACK=${T:-(없음)}"
[ "$H" = "$EXPECT_HEAD" ] || { echo GUARD_FAIL_HEAD; exit 21; }
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ -n "$R" ]               || { echo GUARD_FAIL_RUNNING_EMPTY; exit 23; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_LATEST; exit 25; }
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }
[ -n "$T" ] || { echo GUARD_FAIL_ROLLBACK; exit 26; }
echo "GUARD_OK — 복귀점 $T = $EXPECT_IMG"

mark() { # $1=라벨 $2=이미지참조방식(run|exec) — BusyBox grep 호환·.map 소스맵 제외
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    echo \"  $1 신규A(확정일 +15영업일)=\$(grep -rlF '확정일 +15영업일' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 신규B(기간 고치기)=\$(grep -rlF '기간 고치기' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 신규C(9호 제출)=\$(grep -rlF '9호 제출' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향A(점검 종료일 +15일)=\$(grep -rlF '점검 종료일 +15일' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 역방향B(종료일 고치기)=\$(grep -rlF '종료일 고치기' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(etc-scope-)=\$(grep -rlF 'etc-scope-' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(별지 전용 입력 —)=\$(grep -rlF '별지 전용 입력 —' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(building-saved-note)=\$(grep -rlF 'building-saved-note' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | grep -v '\.map\$' | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker88)=\$(grep -rlF 'zzzNoSuchMarker88' /app/.next 2>/dev/null | wc -l)\"
  "
}

echo "=== MARKER BEFORE ==="
mark before run

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -8
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치)')"
mark after exec

echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "  기대: HEAD=e65df4ac · RUNNING=LATEST 교대 · 신규 A·B·C 0→N · 역방향 A·B 양수→0 · 존속 유지 · 음성 0 · login=200"
echo "DONE88"
