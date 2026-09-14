/** 소스 단언용 — **설명하는 글을 걷어내고 하는 일만 남긴다**.
 *
 *  왜 필요한가: 소스에 리터럴이 있는지 묻는 단언은, 그 리터럴이 **주석에도** 적혀 있으면
 *  코드를 지워도 초록으로 통과한다. 이 저장소는 주석에 결함 내력을 길게 적는 규약이라
 *  ("종전엔 `.in('plan_type', ['monthly','event'])`였다") 그 함정을 특히 잘 밟는다.
 *
 *  🚨 2026-09-14 — 이 함수의 종전 사본들이 **CRLF 파일에서 한 줄도 안 걷어내고 있었다**.
 *     `/(^|[^:])\/\/.*$/`의 `.`는 `\r`을 먹지 않고 `$`는 `\r` 앞에서 멈추지 않는다.
 *     그래서 `\r\n` 파일에서는 **매치 자체가 실패**한다. 실측(`_probe-codeonly-crlf.mjs`):
 *       · `calendar/page.tsx` — 지운 글자 **0**, 줄주석 38줄 생존
 *       · `inspection-calendar-client.tsx` — 줄주석 115줄 생존
 *     이 저장소 소스는 전부 CRLF라 **모든 사본이 죽어 있었다**. 방어를 일부러 써 놓고
 *     그것이 동작하지 않는 것이 가장 나쁜 종류의 결함이다 — 그래서 사본을 없애고 여기로 올린다.
 *
 *  ⚠ 호출부는 `assertStripped()`로 **계측기가 실제로 물었는지** 먼저 단언할 것.
 *    "걷어냈다고 믿는 것"과 "걷어낸 것"은 다르다. */

/** 블록 주석과 줄 주석을 지운다. `://`(URL)은 남긴다. */
export function codeOnly(src: string): string {
  return src
    // ⭐ 가장 먼저 줄끝을 정규화한다 — 이걸 빼면 아래 줄주석 제거가 CRLF에서 통째로 불발한다
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
}

/** 계측기 자기 검사 — 걷어낸 결과에 **줄 주석이 하나도 없어야** 한다.
 *  @returns 남은 줄주석 수(0이어야 정상)와 지운 글자 수 */
export function strippedStats(raw: string): { leftover: number; removed: number } {
  const out = codeOnly(raw)
  return {
    leftover: out.split('\n').filter(l => /^\s*\/\//.test(l)).length,
    removed: raw.replace(/\r\n?/g, '\n').length - out.length,
  }
}
