#!/usr/bin/env bash
# 135회차 검증 — 요금 「상담 전화」 서빙, 옛 요금 문구 0, 앱 무변경
set -u
FAIL=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $2"; else echo "  ❌ $1 = $2 (기대 $3)"; FAIL=$((FAIL+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }
SW_HTML=$(curl -s --max-time 20 https://www.sjfire.co.kr/software.html)

chk "software.html 상태" "$(code https://www.sjfire.co.kr/software.html)" 200
chk "요금 안내문 「상담 전화로 안내」" "$(echo "$SW_HTML" | grep -c '요금은 상담 전화로 안내해 드립니다')" 1
chk "요금 표 「상담 전화」" "$(echo "$SW_HTML" | grep -c 'colspan="2">상담 전화')" 1
chk "옛 문구 「도입 상담 시 안내」 0" "$(echo "$SW_HTML" | grep -c '도입 상담 시 안내')" 0
chk "옛 문구 「쓰는 만큼」 0" "$(echo "$SW_HTML" | grep -c '쓰는 만큼')" 0
chk "www /" "$(code https://www.sjfire.co.kr/)" 200
chk "sjfire.co.kr/login" "$(code https://sjfire.co.kr/login)" 200
chk "sjfire.co.kr/api/health" "$(code https://sjfire.co.kr/api/health)" 200
echo "VERIFY_FAIL=$FAIL"
