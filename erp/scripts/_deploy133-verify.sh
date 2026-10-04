#!/usr/bin/env bash
# 133회차 검증 — 팩스가 서빙되고, 이메일은 회사메일 그대로, 앱 무변경
set -u
FAIL=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $2"; else echo "  ❌ $1 = $2 (기대 $3)"; FAIL=$((FAIL+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }
HOME_HTML=$(curl -s --max-time 20 https://www.sjfire.co.kr/)
SW_HTML=$(curl -s --max-time 20 https://www.sjfire.co.kr/software.html)
JS=$(curl -s --max-time 20 https://www.sjfire.co.kr/assets/site.js)

chk "www / 상태" "$(code https://www.sjfire.co.kr/)" 200
chk "홈 팩스(연락처 칸+바닥)" "$(echo "$HOME_HTML" | grep -o '031-772-2419' | wc -l)" 2
chk "IT S/W 바닥 팩스" "$(echo "$SW_HTML" | grep -o '031-772-2419' | wc -l)" 1
chk "상담 수신처=회사메일" "$(echo "$JS" | grep -c "support@sjfirekorea.co.kr")" 1
chk "개인 주소 노출 0" "$(echo "$HOME_HTML$SW_HTML$JS" | grep -c 'sj78920')" 0
chk "sjfire.co.kr/login" "$(code https://sjfire.co.kr/login)" 200
chk "sjfire.co.kr/api/health" "$(code https://sjfire.co.kr/api/health)" 200
echo "VERIFY_FAIL=$FAIL"
