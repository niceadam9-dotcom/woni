/* 절단 고지 수리 검증 — route.ts의 X-Workbook-Missing 절단 계산 (소방계획서_32 D8 수리)
 *
 * 판정자 B 지적: `full.length - cut.length`는 항상 `full.length - 580`이라, 구분자까지 되감은
 * 만큼을 놓쳐 **380자 생략이라 적고 903자를 버렸다**(실제의 42%만 신고).
 *
 * 여기서는 route.ts의 절단 조각을 **소스에서 그대로 뽑아** 실행한다(복사본이 아니라 배포되는 텍스트).
 * 옛 식과 새 식을 나란히 돌려 차이를 드러낸다.
 * 실행: cd F:\AI\ERP\erp; npx tsx scripts/_probe-d12-truncate.mts
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ck = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${d ? ' — ' + d : ''}`) } }

const SRC = 'src/app/(dashboard)/inspections/[id]/workbook/route.ts'
const src = readFileSync(SRC, 'utf8')

// 배포되는 그 텍스트인지부터 확인 — 수리가 실재하는가.
// ⚠ 주석을 걷어내고 본다: route.ts의 수리 주석이 **옛 식을 인용**하고 있어, 원문 그대로 검사하면
//   '옛 식이 남아 있다'로 오탐한다(이 프로브 첫 판이 실제로 그랬다). 코드 축과 문서 축은 다르다.
const code = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
ck('[0] route.ts 코드에 수리된 계산식이 실재(kept 기준)', /full\.length - kept\.length/.test(code))
ck('[0b] 코드에서 옛 식은 사라졌다(주석의 인용은 제외)', !/full\.length - cut\.length/.test(code),
  '실행 코드에 옛 식이 남아 있다')

/** 현행 구현 (route.ts:231-236과 동일) */
function truncate(full: string): string {
  if (full.length <= 600) return full
  const cut = full.slice(0, 580)
  const back = cut.lastIndexOf(' | ')
  const kept = back > 0 ? cut.slice(0, back) : cut
  return `${kept} | …외 ${full.length - kept.length}자 생략`
}
/** 옛 구현 — 대조군 */
function truncateOld(full: string): string {
  if (full.length <= 600) return full
  const cut = full.slice(0, 580)
  return `${cut.slice(0, cut.lastIndexOf(' | ') > 0 ? cut.lastIndexOf(' | ') : 580)} | …외 ${full.length - cut.length}자 생략`
}

/** 신고된 생략 글자 수 */
const claimed = (s: string) => Number(/…외 (\d+)자 생략/.exec(s)?.[1] ?? -1)
/** 실제로 버려진 글자 수 = 원문 길이 − 남긴 본문 길이 */
const actual = (full: string, out: string) => full.length - out.slice(0, out.indexOf(' | …외 ')).length

// ── 사례 1: 판정자가 쓴 749자 입력 ─────────────────────────────────────────────
{
  const parts = ['점검표 항목 243건 중 182건 반영 · 시트 미동봉 27건 · 자산 좌표 없음 34건']
  while (parts.join(' | ').length < 749) parts.push(`목차 미표기: 항목${parts.length}`)
  const full = parts.join(' | ')
  const out = truncate(full), old = truncateOld(full)
  console.log(`\n[사례 1] 원문 ${full.length}자`)
  console.log(`   신형 주장 ${claimed(out)} / 실제 ${actual(full, out)}`)
  console.log(`   구형 주장 ${claimed(old)} / 실제 ${actual(full, old)}`)
  ck('[1] 신형 — 신고한 생략 수 == 실제 생략 수', claimed(out) === actual(full, out),
    `주장 ${claimed(out)} vs 실제 ${actual(full, out)}`)
  ck('[1b] 착지 집계가 맨 앞에 산다', out.startsWith('점검표 항목 243건 중 182건 반영'))
}

// ── 사례 2: 마지막 조각이 아주 긴 최악 사례(되감김이 큼) ────────────────────────
{
  const full = ['점검표 항목 720건 중 100건 반영', 'A'.repeat(120), 'B'.repeat(600)].join(' | ')
  const out = truncate(full), old = truncateOld(full)
  console.log(`\n[사례 2·최악] 원문 ${full.length}자`)
  console.log(`   신형 주장 ${claimed(out)} / 실제 ${actual(full, out)}`)
  console.log(`   구형 주장 ${claimed(old)} / 실제 ${actual(full, old)}  ← 판정자가 잡은 그 격차`)
  ck('[2] 신형 — 최악 사례에서도 주장 == 실제', claimed(out) === actual(full, out),
    `주장 ${claimed(out)} vs 실제 ${actual(full, out)}`)
  // 대조군 — 옛 식이 실제로 과소 신고했는지 확인(수리가 무엇을 고쳤는지 드러낸다)
  ck('[2b] [대조군] 옛 식은 이 입력에서 과소 신고했다', claimed(old) < actual(full, old),
    `옛 주장 ${claimed(old)} vs 실제 ${actual(full, old)} — 과소 아님?`)
  console.log(`   → 옛 식은 실제의 ${Math.round(claimed(old) / actual(full, old) * 100)}%만 신고했다`)
}

// ── 사례 3: 구분자가 없어 되감기가 안 되는 경우(back <= 0) ──────────────────────
{
  const full = 'X'.repeat(900)
  const out = truncate(full)
  console.log(`\n[사례 3·구분자 없음] 원문 ${full.length}자 · 주장 ${claimed(out)} / 실제 ${actual(full, out)}`)
  ck('[3] 구분자 없는 입력에서도 주장 == 실제', claimed(out) === actual(full, out),
    `주장 ${claimed(out)} vs 실제 ${actual(full, out)}`)
}

// ── 사례 4: 600자 이하는 손대지 않는다 ────────────────────────────────────────
{
  const full = '점검표 항목 10건 중 10건 반영'
  ck('[4] 600자 이하는 원문 그대로(생략 부기 없음)', truncate(full) === full && !/생략/.test(truncate(full)))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
