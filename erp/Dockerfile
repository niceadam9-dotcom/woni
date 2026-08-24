# ⚠ 베이스 이미지는 반드시 Alpine 마이너까지 고정한다 — 단일 원천.
#   `node:20-alpine`은 **떠다니는 태그**다. 2026-08-24 이 태그가 Alpine 3.23으로 올라가면서
#   `font-nanum` 패키지가 저장소에서 사라져, 코드 변경이 하나도 없는데 운영 빌드가 실패했다
#   (`ERROR: unable to select packages: font-nanum (no such package)`).
#   Alpine 마이너를 고정하면 패키지 이름·가용성이 안정되고, 그 안에서 패치는 계속 받는다.
#
# Node 20 → 24 (2026-08-24). 두 가지가 겹쳐서 올렸다.
#   ① Node 20은 2026-04-30 EOL이다 — 넉 달째 런타임 보안 패치가 없었다.
#   ② '마이너 고정이면 패치는 계속 받는다'가 20 라인에선 이미 거짓이었다. Docker Hub 실측
#      `node:20-alpine3.23`의 last_updated는 **2026-04-15**로, EOL에 맞춰 발행이 멈춰 있다.
#      즉 종전 핀은 '고정'이 아니라 **동결**이었고 Alpine 패키지 패치도 함께 멎어 있었다.
#      (대조: `node:24-alpine3.23`은 2026-08-03 갱신 — 살아 있는 태그다)
#
#   왜 22가 아니라 24인가 — v22는 이미 Maintenance(보안 수정만)이고 2027-04-30 EOL이라
#   여덟 달 뒤 같은 작업을 반복하게 된다. v24(Krypton)는 Active LTS, 2028-04-30 EOL이다.
#   개발 PC의 node도 v24라 이 전환으로 개발·운영 런타임이 처음으로 일치한다.
#   v26은 2026-10-28에 LTS가 되지만, 그때까지 EOL 런타임을 더 굴리는 값이 더 크다.
#
#   요구 사항 확인: next@16.2.9 engines `>=20.9.0`(상한 없음) · sharp@0.34.5 `>=21.0.0`.
#   올릴 때는 의도적으로: 태그를 바꾸고 → 빌드. 폰트가 깨지면 아래 렌더 단언이 빌드를 세운다
#   (종전엔 사람이 `fc-list`를 눈으로 확인했다).
ARG NODE_IMAGE=node:24-alpine3.23

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
# ⚠ 배포판 패키지에 기대지 않는다 — 폰트의 단일 원천은 이 저장소다.
#   2026-08-24 운영 빌드가 `font-nanum (no such package)`로 깨진 근본 원인은 폰트가 아니라
#   **베이스가 우리 모르게 움직인 것**이었다(떠다니는 `node:20-alpine` → Alpine 3.23).
#   `font-noto-cjk`로 갈아타는 건 같은 지뢰를 다음 베이스 이동 때 다시 밟는 임시방편이라,
#   폰트 파일 자체를 `assets/fonts/`에 넣어 apk 패키지 **이름**에 대한 의존을 끊었다.
#   이제 베이스가 Alpine 몇이든 Node 몇이든 폰트는 불변이다.
#
#   패밀리명은 `NanumGothic` — static-map-compose.ts:101의 체인
#   `Malgun Gothic, NanumGothic, Noto Sans CJK KR, sans-serif`에서 **2순위로 이름이 맞물린다**
#   (sans-serif로 흘러 '우연히' 렌더되는 게 아니다). 라이선스는 OFL 1.1, OFL.txt 동봉.
RUN apk add --no-cache fontconfig
COPY assets/fonts/ /usr/share/fonts/nanum/
RUN fc-cache -f

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 폰트 검증은 '설치됐는가'가 아니라 '찍히는가'로 한다 (소방계획서_서버.md §15.3).
#   apk/COPY 성공은 두부(□) 렌더를 배제하지 못하고, 잉크 픽셀 수로도 판정할 수 없다
#   — 종전엔 사람이 PNG를 눈으로 봤다. 그 판정을 여기로 옮겼다.
#   이 RUN이 실패하면 이미지가 아예 만들어지지 않는다. standalone 복사 뒤라 sharp를 쓴다.
COPY scripts/assert-korean-glyphs.mjs ./scripts/
RUN node scripts/assert-korean-glyphs.mjs --font-dir=/usr/share/fonts/nanum

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
