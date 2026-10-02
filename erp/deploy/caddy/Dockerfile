# Caddy + rate_limit 플러그인 (A2 2026-10-02) — 공식 이미지에는 레이트리밋이 없어 xcaddy로 한 번 굽는다.
# 버전은 docker-compose.prod.yml의 종전 고정값(2.11.4)과 같다. 올릴 때는 두 FROM을 함께 바꾼다.
FROM caddy:2.11.4-builder AS builder
RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:2.11.4-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
