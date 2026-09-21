#!/usr/bin/env bash
# 89회차 검증 — before는 롤백 이미지(e65df4ac) 실물, after는 실행 중 컨테이너.
# ⚠ `grep -rl`(파일 수) 말고 `grep -ro`(출현 횟수)로 센다 — 86회차에서 파일 수가 변화를
#   못 보여 준 적이 있다(같은 청크에 다른 출처가 남아 있으면 파일 수는 그대로다).
set -u
echo "=== 실행 상태 ==="
git -C /home/ubuntu/woni log --oneline -1
echo "내 커밋(beead875) 조상? $(git -C /home/ubuntu/woni merge-base --is-ancestor beead875 HEAD && echo YES || echo NO)"
R=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19)
L=$(docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "running=$R latest=$L $([ "$R" = "$L" ] && echo '(일치)' || echo '⚠ 불일치')"
echo "상태: $(docker inspect --format '{{.State.Status}}' erp-app-1)"

a() { docker exec erp-app-1 sh -c "grep -roF '$1' /app/.next 2>/dev/null | wc -l"; }
b() { docker run --rm --entrypoint sh erp-app:rollback-e65df4ac -c "grep -roF '$1' /app/.next 2>/dev/null | wc -l"; }
row() { printf '  %-7s %-46s before=%-4s after=%s\n' "$1" "$2" "$(b "$3")" "$(a "$3")"; }

echo
echo "=== MARKER 3분법 (출현 횟수) ==="
row '신규'  '페이저 새 상자(size-12 border-2)'   'justify-center size-12 rounded-lg border-2'
row '신규'  '순번 새 글꼴(w-14 semibold)'        'font-semibold text-ink-sub w-14 text-center'
row '역방향' '페이저 옛 상자(size-7)  <-0이어야'  'justify-center size-7 rounded-lg border text-form-sm'
row '역방향' '순번 옛 글꼴(w-12)      <-0이어야'  'text-form-2xs text-ink-sub w-12 text-center'
row '존속'  '목록으로 40px(88회차 내 축)'        'size-10'
row '존속'  'specs-close testid'                 'specs-close'
row '음성'  'zzzNoSuchMarker89      <-0이어야'   'zzzNoSuchMarker89'

echo
echo "=== 서빙 (도메인은 Caddyfile의 sjfire.co.kr — erp. 아님) ==="
printf '  /login -> %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 https://sjfire.co.kr/login)"
printf '  로그인 표식(비밀번호) %s건\n' "$(curl -s --max-time 25 https://sjfire.co.kr/login | grep -c '비밀번호')"
echo "=== 에러 로그 ==="
docker logs --since 5m erp-app-1 2>&1 | grep -iE 'error|unhandled' | tail -5 || echo "  (없음)"
echo "=== VERIFY DONE ==="
