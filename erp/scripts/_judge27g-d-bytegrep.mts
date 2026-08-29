/** 판정자 D — 가장 단순한 축: **압축을 푼 전 파트 바이트에 그 문자열이 있는가**.
 *  파싱도 니들 목록도 거치지 않는다. 대조군을 함께 낸다:
 *   · 있어야 하는 것(서식 문구) → 있어야 초록
 *   · SCRUB_NEEDLES(스크럽된 표본 PII) → 없어야 한다
 *   · 표본 답·직원 명단 → 여기 있으면 '셀에서 지웠다'가 바이트에서는 거짓이라는 뜻
 *   · 절대 없는 대조 문자열 → 0이어야 한다(검사가 아무거나 참이라고 하지 않는다는 증명)
 *  실행: npx tsx scripts/_judge27g-d-bytegrep.mts <xlsx> <라벨> */
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = process.argv[2] ?? 'templates/report-workbook-full.xlsx'
const LABEL = process.argv[3] ?? 'cur'
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(SRC)))
const parts: Array<[string, string]> = []
for (const n of Object.keys(zip.files)) {
  if (zip.files[n].dir) continue
  parts.push([n, await zip.file(n)!.async('string')])
}
// ⚠ 자격번호는 **리터럴로 적지 않는다** — 저장소에 없던 값을 검사 코드가 도로 심게 된다.
//   꼴로 잡는 편이 검사로서도 낫다(목록에 없는 새 자격번호까지 걸린다) — 이 판정이 잡은 결함의
//   정체가 바로 '니들 목록은 표본 하나만 인코딩한다'였다. 실측 형태 `YYYY-MM-NNNNNL`.
// ⚠ 단 **자산(템플릿) 축에서만 유효**하다. 산출물에는 그 고객의 점검인력 자격번호가 **정상적으로
//   주입**되므로(픽스처 `2026-01-00001E`) 꼴 검사가 전건 오탐이 된다 — 실제로 sheet1·2·15에서
//   3파트를 물었다. **니들을 넓히는 것과 축을 넓히는 것은 다르다**(이 저장소가 '양호·적합'을
//   소견 니들에 넣자는 제안을 기각했던 것과 같은 형태). 그래서 축으로 갈라 건다.
const ASSET_AXIS = LABEL !== 'out'
const CASES: Array<[string, string | RegExp, boolean]> = [   // [분류, 니들, 있어야 정상인가]
  ['서식문구(대조군: 있어야 한다)', '점검결과', true],
  ['표본 PII(SCRUB_NEEDLES)', '정내과의원', false],
  ['표본 PII(SCRUB_NEEDLES)', '김미진', false],
  ['표본 PII(SCRUB_NEEDLES)', '845.75', false],
  ['표본 답(소견 니들)', '이상없음', false],
  ['표본 답(소견 니들)', '별첨참조', false],
  ['표본 답(실내 위치 니들)', '직원실', false],
  ['표본 문서 점검인력(니들 밖)', '주윤종', false],
  ['표본 문서 점검인력(니들 밖)', '조병석', false],
  ...(ASSET_AXIS ? [['표본 문서 자격번호꼴(자산 축 전용·정규식)', /\d{4}-\d{2}-\d{5}[A-Z]/, false] as [string, RegExp, boolean]] : []),
  ['표본 답 보험기간(니들 밖)', '2024년  1월  1일', false],
  ['대조군(존재할 리 없는 문자열)', 'ZZZ판정자D없는문자열', false],
  ['대조군(있을 리 없는 자격번호꼴)', /9999-99-99999Z/, false],
]
const OUT: string[] = [`[대상] ${SRC} · 파트 ${parts.length}개`]
for (const [kind, s, want] of CASES) {
  const has = (x: string) => typeof s === 'string' ? x.includes(s) : s.test(x)
  const hits = parts.filter(([, x]) => has(x)).map(([n]) => n)
  const ok = want ? hits.length > 0 : hits.length === 0
  OUT.push(`${ok ? '✅' : '❌'} ${kind} '${s}' — ${hits.length}파트${hits.length ? ': ' + hits.slice(0, 3).join(', ') : ''}`)
}
const path = `F:/AI/ERP/_j27d-byte-${LABEL}.txt`
writeFileSync(path, OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
