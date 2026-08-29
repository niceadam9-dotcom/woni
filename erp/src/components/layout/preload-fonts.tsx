'use client'

import ReactDOM from 'react-dom'

/** 한글 웹폰트 선행 로드 (소방계획서_35 S1-5)
 *
 *  Pretendard는 dynamic-subset 92조각이라 브라우저가 **글자를 만난 뒤에야**
 *  해당 조각을 받는다. 그동안 한글은 맑은 고딕으로 그려지고(font-display: swap),
 *  조각이 도착하는 순간 다시 그려진다 — 밀집 표에서 눈에 띄는 리플로우다.
 *  가장 많이 쓰는 조각만 미리 받아 그 구간을 줄인다.
 *
 *  ⚠ 이 3개는 **추측이 아니라 실측**이다. `scripts/_s35-preload-pick.mjs`가
 *  소방계획서 화면 16파일의 한글 22,946자를 조각별로 세었다:
 *      90 → 46.8% · 89 → +17.8% · 91 → +16.1%  (누적 80.7%, 78.8KB)
 *  쓰인 조각은 92개 중 23개뿐이고, 4번째부터는 한 조각이 8% 미만이라
 *  용량 대비 이득이 급격히 떨어진다. 조각 번호는 코드포인트 내림차순
 *  분할이라 직관과 다르다 — 문구가 크게 바뀌면 스크립트를 다시 돌릴 것.
 *
 *  ⚠ 전부 preload하면 2.82MB를 통째로 받아 dynamic-subset의 의미가 사라진다.
 *
 *  raw <link rel="preload">를 쓰지 않는 이유: Next 16 문서(generate-metadata.md
 *  §Resource hints)가 이 경우 ReactDOM.preload를 쓰라고 명시한다.
 *  crossOrigin은 폰트에 필수다 — 같은 출처라도 CORS 모드로 받으므로,
 *  빠지면 preload한 것과 실제 요청이 **다른 캐시 항목**이 되어 두 번 받는다.
 */
const PRELOAD_SUBSETS = [90, 89, 91]

export function PreloadFonts() {
  for (const n of PRELOAD_SUBSETS) {
    ReactDOM.preload(`/fonts/pretendard/woff2/PretendardVariable.subset.${n}.woff2`, {
      as: 'font',
      type: 'font/woff2',
      crossOrigin: 'anonymous',
    })
  }
  return null
}
