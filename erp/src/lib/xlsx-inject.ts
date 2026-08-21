/** 갑지 워크북 셀 주입 코어 — JSZip 바이트 패치 (소방계획서_27 S2)
 *
 *  ⚠ 이 저장소에서 SheetJS(xlsx)는 **읽기·검증 전용**이다. `XLSX.write`로 산출물을 만들면
 *  갑지 기준 셀 11,138 → 1,977, 빈 서식 셀 9,162개가 소멸해 서식이 전멸한다(2026-08-21 실측 —
 *  border·font·alignment는 읽기 단계에서 이미 0건이라 쓰기 지원과 무관하게 잃는다).
 *  산출물은 반드시 이 파일의 JSZip 패치로 만든다: 손대지 않은 바이트는 그대로 남으므로
 *  병합·인쇄여백·인쇄영역·그림·조건부서식 무손상이 구성적으로 보장된다.
 *
 *  전파(D-9): LibreOffice는 fullCalcOnLoad를 무시하고 옛 캐시값 <v>를 그대로 보여준다(실측).
 *  그래서 값을 넣을 때 그 셀을 참조하는 수식 셀들의 **캐시값도 함께 갱신**한다. <f>는 보존 —
 *  사용자가 Excel에서 허브를 고치면 그때부터는 수식이 살아 움직인다.
 *  전파 범위는 **이행 폐포**다. 간선이 두 종류(시트 넘김 `'개요'!B14` · 같은 시트 안 `A3`)이고
 *  스포크가 스포크를 참조하는 사슬(완료보고서!B5='계획서'!B5 · 계약서!D24='A3')이 있어서,
 *  1단계만 하면 옛 값이 4회, 시트 내 참조를 빼면 2회 잔존했다(둘 다 넣어 0회). */
import JSZip from 'jszip'

/** null = 명시적 공란(캐시·값 제거). 숫자는 셀 서식(날짜 등)을 살리기 위해 n 타입으로 넣는다 */
export type CellValue = string | number | null

export type InjectTarget = {
  sheet: string
  cell: string
  value: CellValue
  /** 깨진 참조('1번 입력'! 등)를 값으로 대체할 때 — <f>를 지우고 값만 남긴다 */
  dropFormula?: boolean
}

const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** ISO 날짜 → 엑셀 시리얼(1900 체계). 셀의 날짜 서식이 그대로 살도록 숫자로 주입할 때 쓴다 */
export function isoToSerial(iso: string | null | undefined): number | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000)
}

/** workbook.xml + rels에서 시트 이름 → zip 내 경로 매핑 */
export async function sheetFileMap(zip: JSZip): Promise<Map<string, string>> {
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relTarget = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget.set(m[1], m[2])
  const map = new Map<string, string>()
  for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const t = relTarget.get(m[2]) ?? ''
    map.set(m[1], t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`)
  }
  return map
}

/** 단일 셀 참조 수식의 의존 그래프 — `'개요'!B14`(시트 넘김)과 `A3`(같은 시트) 두 간선 모두.
 *
 *  ⚠ **XML에서 직접** 만든다 — SheetJS로 만들면 안 된다(2026-08-21 실측 두 가지):
 *  ① 스크럽으로 캐시 <v>가 사라진 수식 셀을 SheetJS가 **통째로 건너뛴다**(840 → 679셀).
 *     템플릿의 스포크가 정확히 그 상태라, SheetJS 기반 그래프는 간선을 잃고 전파가 0이 된다.
 *  ② LibreOffice는 한글 시트명을 따옴표 없이 쓴다(`개요!B14`) — 패턴은 양쪽을 다 받아야 한다.
 *  패치와 같은 층(XML)에서 읽으므로 보는 것과 고치는 것이 어긋나지 않는다. */
export async function buildRefGraph(zip: JSZip, files: Map<string, string>): Promise<Map<string, Array<{ sheet: string; cell: string }>>> {
  const edges = new Map<string, Array<{ sheet: string; cell: string }>>()
  for (const [sheet, path] of files) {
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async('string')
    // ⚠ 자기닫힘(<c …/>)을 반드시 함께 받는다 — 안 받으면 그 셀의 [^>]*가 "/"까지 삼킨 뒤
    //   다음 짝셀의 </c>까지 내용으로 먹어, 수식이 **엉뚱한 좌표로 귀속**된다(2026-08-21 실측:
    //   계약서!A3의 수식이 앞 빈 셀에 붙어 폐포에서 빠졌다)
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const f = /<f[^>]*>([^<]*)<\/f>/.exec(m[2] ?? '')?.[1]
      if (!f) continue
      const cross = /^'?([^'!]+)'?!(\$?[A-Z]+\$?\d+)$/.exec(f)
      const local = /^(\$?[A-Z]+\$?\d+)$/.exec(f)
      if (!cross && !local) continue
      const from = cross ? `${cross[1]}!${cross[2].replace(/\$/g, '')}` : `${sheet}!${local![1].replace(/\$/g, '')}`
      const arr = edges.get(from) ?? []
      arr.push({ sheet, cell: m[1] })
      edges.set(from, arr)
    }
  }
  return edges
}

/** from 셀에서 출발하는 이행 폐포 */
export function transitiveClosure(
  edges: Map<string, Array<{ sheet: string; cell: string }>>, sheet: string, cell: string,
): Array<{ sheet: string; cell: string }> {
  const out: Array<{ sheet: string; cell: string }> = []
  const seen = new Set<string>()
  const queue = [`${sheet}!${cell}`]
  while (queue.length) {
    for (const d of edges.get(queue.shift()!) ?? []) {
      const key = `${d.sheet}!${d.cell}`
      if (seen.has(key)) continue
      seen.add(key); out.push(d); queue.push(key)
    }
  }
  return out
}

/** 대상 셀의 내용을 교체. 스타일 인덱스(s=)는 반드시 보존한다 — 잃으면 그 칸만 서식이 빠진다 */
function setCell(xml: string, ref: string, value: CellValue, dropFormula: boolean): { xml: string; hit: boolean } {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`)
  const m = re.exec(xml)
  if (!m) return { xml, hit: false }
  const attrs = (m[1] ?? '').replace(/\st="[^"]*"/, '')
  const inner = m[2] ?? ''
  const f = dropFormula ? '' : (/<f[^>]*>[\s\S]*?<\/f>|<f[^>]*\/>/.exec(inner)?.[0] ?? '')
  let repl: string
  if (value === null) {
    repl = f ? `<c r="${ref}"${attrs}>${f}</c>` : `<c r="${ref}"${attrs}/>`
  } else if (typeof value === 'number') {
    repl = `<c r="${ref}"${attrs}>${f}<v>${value}</v></c>`
  } else {
    // 수식이 남는 셀의 문자열 캐시는 t="str", 수식 없는 값 셀은 inlineStr
    repl = f
      ? `<c r="${ref}"${attrs} t="str">${f}<v>${escXml(value)}</v></c>`
      : `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${escXml(value)}</t></is></c>`
  }
  return { xml: xml.replace(re, repl), hit: true }
}

export type InjectResult = {
  bytes: Uint8Array
  /** XML에서 찾지 못한 대상 — 조용히 버리지 않는다. 호출부가 실패 처리할 것 */
  missed: string[]
  /** 전파로 함께 갱신된 캐시 셀 수 */
  propagated: number
}

/** 값 주입 + 폐포 전파. 원본 bytes는 변형하지 않는다. */
export async function injectWorkbook(templateBytes: Uint8Array, targets: InjectTarget[]): Promise<InjectResult> {
  const zip = await JSZip.loadAsync(templateBytes)
  const files = await sheetFileMap(zip)
  const edges = await buildRefGraph(zip, files)

  // 시트별로 모아 한 번에 패치 — 같은 시트 XML을 대상마다 다시 읽지 않는다
  const bySheet = new Map<string, Array<{ cell: string; value: CellValue; dropFormula: boolean }>>()
  const push = (sheet: string, cell: string, value: CellValue, dropFormula: boolean) => {
    const arr = bySheet.get(sheet) ?? []
    arr.push({ cell, value, dropFormula })
    bySheet.set(sheet, arr)
  }
  let propagated = 0
  for (const t of targets) {
    push(t.sheet, t.cell, t.value, t.dropFormula ?? false)
    for (const d of transitiveClosure(edges, t.sheet, t.cell)) {
      push(d.sheet, d.cell, t.value, false)   // 캐시만 갱신, <f> 보존
      propagated++
    }
  }

  const missed: string[] = []
  for (const [sheet, patches] of bySheet) {
    const path = files.get(sheet)
    if (!path || !zip.file(path)) { missed.push(...patches.map(p => `${sheet}!${p.cell}`)); continue }
    let xml = await zip.file(path)!.async('string')
    for (const p of patches) {
      const r = setCell(xml, p.cell, p.value, p.dropFormula)
      if (!r.hit) { missed.push(`${sheet}!${p.cell}`); continue }
      xml = r.xml
    }
    zip.file(path, xml)
  }

  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  return { bytes, missed, propagated }
}
