# ⚠ 베이스 이미지는 반드시 Alpine 마이너까지 고정한다 — 단일 원천.
#   `node:20-alpine`은 **떠다니는 태그**다. 2026-08-24 이 태그가 Alpine 3.23으로 올라가면서
#   `font-nanum` 패키지가 저장소에서 사라져, 코드 변경이 하나도 없는데 운영 빌드가 실패했다
#   (`ERROR: unable to select packages: font-nanum (no such package)`).
#   Alpine 마이너를 고정하면 패키지 이름·가용성이 안정되고, 그 안에서 패치는 계속 받는다.
#   올릴 때는 의도적으로: 태그를 바꾸고 → 빌드 → `fc-list :lang=ko`가 비지 않는지 확인.
ARG NODE_IMAGE=node:20-alpine3.23

# Stage 1: deps
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: builder
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 3: runner
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 한글 폰트 — 소방차 진입 경로도(static-map-compose.ts)의 SVG 텍스트가 sharp로 래스터화될 때 필요.
# 없으면 캡션('2.4km · 6분')·소방서명·고객명이 두부(□)로 렌더된다 (BLK-6, 독립검증 2026-08-07).
#
# ⚠ 종전 `font-nanum`은 2026-08-24 빌드에서 사라졌다 — 태그 `node:20-alpine`이 떠다니는
#   포인터라 베이스가 Alpine 3.23으로 올라갔고 그 저장소엔 해당 패키지가 없다
#   (`ERROR: unable to select packages: font-nanum (no such package)`).
#   대체는 `font-noto-cjk`. static-map-compose.ts:101의 폰트 체인이
#   `Malgun Gothic, NanumGothic, Noto Sans CJK KR, sans-serif`라 3순위로 이미 지목하고 있어
#   코드 변경 없이 맞물린다. 설치 후 `fc-list :lang=ko`가 비면 안 된다.
RUN apk add --no-cache font-noto-cjk fontconfig && fc-cache -f

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
