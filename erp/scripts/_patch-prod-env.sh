#!/bin/bash
# 운영 .env.production에 ACCOUNT_ENC_KEY(서버에서 생성)·GOTENBERG_URL 추가 (2026-07-16)
# 멱등: 이미 있으면 건드리지 않음. 키 값은 출력하지 않는다.
set -e
cd /home/ubuntu/woni/erp

if [ -n "$(tail -c 1 .env.production)" ]; then
  echo "" >> .env.production   # 개행 없이 끝나는 파일 보호 (2026-07-13 사고 재발 방지)
fi

if grep -q '^ACCOUNT_ENC_KEY=' .env.production; then
  echo "ACCOUNT_ENC_KEY: 이미 존재 — 유지"
else
  printf 'ACCOUNT_ENC_KEY=%s\n' "$(openssl rand -hex 32)" >> .env.production
  echo "ACCOUNT_ENC_KEY: 신규 생성·추가됨"
fi

if grep -q '^GOTENBERG_URL=' .env.production; then
  echo "GOTENBERG_URL: 이미 존재 — 유지"
else
  echo 'GOTENBERG_URL=http://gotenberg-prod:3000' >> .env.production
  echo "GOTENBERG_URL: 추가됨"
fi

tail -n 2 .env.production | sed 's/=.\{10,\}/=***set***/'
