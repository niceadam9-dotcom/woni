# Pretendard Variable (셀프호스팅) — 소방계획서_35 S1

## 무엇이고 왜 여기 있나

ERP 화면의 **한글 본문 폰트**다. 2026-08-29 이전까지 이 저장소에는 한글 웹폰트가
하나도 없었다(`@font-face` 0건). `src/app/layout.tsx`가 next/font로 로드하는
Plus Jakarta Sans·Inter는 둘 다 `subsets: ["latin"]`이라 **한글 글리프가 없어**,
화면의 모든 한글이 OS 폰트(Windows = 맑은 고딕)로 폴백되고 있었다.
시니어 사용자가 "글씨가 흐려서 안 보인다"고 한 것의 절반 이상이 이 폴백이었다.

`erp/assets/fonts/NanumGothic-*.ttf`와 혼동하지 말 것 — **그쪽은 서버 전용**이다
(Gotenberg PDF·정적 지도 합성, `Dockerfile`·`lib/static-map-compose.ts`).
웹으로 서빙되지 않으며 이 디렉터리와 용도가 다르다.

## 버전·라이선스

| 항목 | 값 |
|---|---|
| 출처 | https://github.com/orioncactus/pretendard |
| 버전 | **v1.3.9** (고정 — 떠다니는 태그 금지) |
| 배포판 | Variable · **dynamic-subset** (woff2 92조각, 총 2.82MB) |
| 라이선스 | SIL Open Font License 1.1 — `OFL.txt` |

> 버전을 고정하는 이유: 이 저장소는 `node:20-alpine` 같은 떠다니는 태그가
> **코드가 그대로인데 빌드를 깬 전례**가 있다. 폰트도 같은 규약을 따른다.

## 재생성 방법

`src/app/pretendard.css`는 **생성물**이다. 손으로 고치지 말고 아래로 다시 만든다.

```powershell
$V    = "v1.3.9"
$base = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@$V/packages/pretendard/dist/web/variable/woff2-dynamic-subset"
$dst  = "erp\public\fonts\pretendard\woff2"
New-Item -ItemType Directory -Force -Path $dst | Out-Null

# 1) woff2 92조각
foreach ($i in 0..91) {
  Invoke-WebRequest -Uri "$base/PretendardVariable.subset.$i.woff2" `
    -OutFile "$dst\PretendardVariable.subset.$i.woff2" -UseBasicParsing
}

# 2) 라이선스
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@$V/LICENSE" `
  -OutFile "erp\public\fonts\pretendard\OFL.txt" -UseBasicParsing

# 3) CSS — url()만 우리 경로로 치환하고 나머지는 원본 그대로
$css = (Invoke-WebRequest -UseBasicParsing `
  -Uri "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@$V/dist/web/variable/pretendardvariable-dynamic-subset.css").Content
$css = $css -replace [regex]::Escape('../../../packages/pretendard/dist/web/variable/woff2-dynamic-subset/'), '/fonts/pretendard/woff2/'
# → src/app/pretendard.css 의 머리주석 아래에 이어붙인다 (주석은 보존할 것)
```

그 다음 반드시:

```powershell
cd erp
node scripts/assert-web-korean-font.mjs      # 자산·서빙 축 (sha256 목록도 여기서 갱신)
node scripts/_s35-preload-pick.mjs           # preload 3조각 재산정 → preload-fonts.tsx 반영
```

## 배선 지점

| 파일 | 역할 |
|---|---|
| `src/app/pretendard.css` | `@font-face` 92개 (생성물) |
| `src/app/globals.css` | `@import` + body·heading 폰트 스택 |
| `src/components/layout/preload-fonts.tsx` | 상위 3조각 `ReactDOM.preload` |
| `next.config.ts` | `/fonts/:path*` → `immutable` 1년 캐시 |
| `scripts/assert-web-korean-font.mjs` | 회귀 검사 (`npm run test:all` 등재) |

## ⚠ 스택에서 폰트를 앞으로 옮기지 말 것

`globals.css`의 폰트 스택에서 `'Pretendard Variable'`은 **후미**에 있다.
라틴·숫자는 Plus Jakarta Sans/Inter가 먼저 잡고, 한글만 Pretendard로 내려온다.

맨 앞으로 옮기면 **영문·숫자 글리프까지 Pretendard가 그린다.** 그러면
`tabular-nums`의 자릿수 폭이 바뀌어 1.4 소방시설 세부제원 표의 칸 폭 계산
(44px 열 → content 28px)이 무너지고, ERP 전 화면의 영문 UI 폭이 함께 흔들린다.
"한글만 예뻐진다"가 이 배치의 요점이자 회귀 표면을 좁게 유지하는 장치다.
