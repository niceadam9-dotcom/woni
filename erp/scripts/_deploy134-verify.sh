#!/usr/bin/env bash
# 134회차 검증 — 확인 필요 칸이 운영에서 0, 새 문구 서빙, 앱 무변경
set -u
FAIL=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $2"; else echo "  ❌ $1 = $2 (기대 $3)"; FAIL=$((FAIL+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }
HOME_HTML=$(curl -s --max-time 20 https://www.sjfire.co.kr/)
SW_HTML=$(curl -s --max-time 20 https://www.sjfire.co.kr/software.html)
PV_HTML=$(curl -s --max-time 20 https://www.sjfire.co.kr/privacy.html)

chk "www / 상태" "$(code https://www.sjfire.co.kr/)" 200
chk "확인 필요 칸(class=todo) 0" "$(echo "$HOME_HTML$SW_HTML$PV_HTML" | grep -c 'class="todo"')" 0
chk "홈 숫자 칸 「보고 기한 자동 관리」" "$(echo "$HOME_HTML" | grep -c '소방서 보고 기한 자동 관리')" 1
chk "홈 상담 시간" "$(echo "$HOME_HTML" | grep -c '평일 09:00~18:00')" 1
chk "요금 「도입 상담 시 안내」" "$(echo "$SW_HTML" | grep -c '도입 상담 시 안내')" 1
chk "처리방침 시행일" "$(echo "$PV_HTML" | grep -c '2026년 10월 4일')" 1
chk "처리방침 보호책임자" "$(echo "$PV_HTML" | grep -c '대표이사 김흥준 · 전화')" 1
chk "sjfire.co.kr/login" "$(code https://sjfire.co.kr/login)" 200
chk "sjfire.co.kr/api/health" "$(code https://sjfire.co.kr/api/health)" 200
echo "VERIFY_FAIL=$FAIL"
