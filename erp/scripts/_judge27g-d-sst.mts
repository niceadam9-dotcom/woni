/** 판정자 D — S7-6 보충: **셀에 안 보이는 축**. 표본 문서의 잔재가 sharedStrings 고아 항목으로
 *  산출물 바이트에 남아 있는가. (S1-1이 '고아 si 5건'을 한 번 고쳤는데 처방이 **니들 목록**이라
 *  니들 밖 텍스트는 그대로 실려 나간다 — 니들은 표본 고객 하나만 인코딩한다)
 *
 *  실행: npx tsx scripts/_judge27g-d-sst.mts <xlsx> <라벨>
 *  판정 방법(교차 2축):
 *   ① 셀 파싱으로 참조된 si 인덱스 집합을 만들고 여집합을 고아로 본다
 *   ② ①을 믿지 않기 위해, 각 고아 si의 인덱스를 **원시 XML에서 `<v>i</v>` 문자열로 직접 재검색**해
 *      참조가 정말 0인지 다시 확인한다(정규식 파싱 실수로 고아를 지어내는 것을 막는다)
 *   ③ 고아 텍스트가 셀 어딘가에 리터럴(inlineStr)로도 없는지 확인 — 있으면 '보이는 값'이라 별 문제다
 *  결과는 UTF-8 파일로 기록한다. */
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'
import { SCRUB_NEEDLES, SAMPLE_OPINION_NEEDLES } from '../src/lib/xlsx-anchors.ts'

const SRC = process.argv[2] ?? 'templates/report-workbook-full.xlsx'
const LABEL = process.argv[3] ?? 'cur'
const OUT: string[] = []
const say = (s = '') => OUT.push(s)
const unesc = (s: string) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(SRC)))
const sst: string[] = []
const sstXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g))
  sst.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unesc(t[1])).join(''))

const sheetParts = Object.keys(zip.files).filter(n => /xl\/worksheets\/.*\.xml$/.test(n) && !zip.files[n].dir)
const xmls: string[] = []
for (const p of sheetParts) xmls.push(await zip.file(p)!.async('string'))

// ① 셀 파싱 축
const used = new Set<number>()
for (const xml of xmls)
  for (const m of xml.matchAll(/<c r="[A-Z]+\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    if (!/\st="s"/.test(m[1] ?? '')) continue
    const v = /<v>(\d+)<\/v>/.exec(m[2] ?? '')?.[1]
    if (v !== undefined) used.add(Number(v))
  }
const orphanA = sst.map((s, i) => i).filter(i => !used.has(i) && sst[i].trim() !== '')

// ② 원시 문자열 재검색 축 (파싱 실수 방어)
const orphanB = orphanA.filter(i => !xmls.some(x => x.includes(`<v>${i}</v>`)))
// ③ 리터럴(inlineStr)로도 안 보이는가
const invisible = orphanB.filter(i => !xmls.some(x => x.includes(sst[i])))

say(`[대상] ${SRC}`)
say(`sharedStrings ${sst.length}개 · 셀 참조 ${used.size}개`)
say(`고아(①셀파싱) ${orphanA.length} · (②원시재검색 교차) ${orphanB.length} · (③셀에 리터럴로도 없음) ${invisible.length}`)
say('')
say('── 고아이면서 셀 어디에도 안 보이는 텍스트 전량 ──')
for (const i of invisible) say(`  si${i} = ${JSON.stringify(sst[i])}`)
say('')
const needleHit = invisible.filter(i => [...SCRUB_NEEDLES, ...SAMPLE_OPINION_NEEDLES].some(n => sst[i].includes(n)))
say(`니들(SCRUB 7 + 소견 3)로 잡히는 고아: ${needleHit.length}건 — 나머지 ${invisible.length - needleHit.length}건은 **어떤 검사에도 안 걸린다**`)
// 사람 이름/자격번호꼴 구조 판정 — 니들 없이 잡는 축
const NAMEISH = /^[가-힣]{2,4}$/
const LICENSE = /^\d{4}-\d{2}-\d{4,6}[A-Z]?$/
const personish = invisible.filter(i => NAMEISH.test(sst[i].trim()) || LICENSE.test(sst[i].trim()))
say(`구조 판정(한글 2~4자 이름꼴 | 자격번호꼴) 고아: ${personish.length}건 — ${personish.map(i => JSON.stringify(sst[i])).join(', ')}`)

const path = `F:/AI/ERP/_j27d-sst-${LABEL}.txt`
writeFileSync(path, OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
console.log(`(기록: ${path})`)
