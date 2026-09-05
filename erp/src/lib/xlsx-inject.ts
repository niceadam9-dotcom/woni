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

/** XML 1.0이 **표현할 수 없는** 문자 — 탭·개행·복귀(0x09·0x0A·0x0D)만 합법이고 나머지 C0 제어문자,
 *  DEL~0x9F 구간, 서로게이트 반쪽, 비문자(U+FFFE·U+FFFF)는 어떤 이스케이프로도 담을 수 없다.
 *  ⚠ 그냥 두면 **파일이 열리는데 글자가 안 그려진다**: LibreOffice가 2MB짜리 워크북을 멀쩡히
 *  열면서 고객 상호를 한 글자도 표시하지 않았다(2026-08-24 독립 판정 실측 — 폐포로 전파된
 *  공문 수신 칸까지 전부 공란인데 `missed=0`이고 SheetJS 왕복도 정상이라 기존 검사가 전부 초록).
 *  DB 자유 텍스트에 붙어 들어올 수 있는 부류이므로 **버리지 말고 지운다** — 값을 잃는 것보다
 *  제어문자 한 글자를 잃는 편이 낫다(사용자에게는 보이지도 않는 글자다). */
// ⚠ 문자 클래스를 **이스케이프 문자열**로만 쓴다 — 날 제어문자를 소스에 박으면 에디터·git·복붙이
//    언젠가 조용히 뭉갠다(첫 작성본에 실제로 8개가 박혀 `_verify-ctrl.mts`가 잡았다).
// ⚠ 서로게이트는 **고아만** 지운다. 종전 `\uD800-\uDFFF`는 정상 이모지·CJK 확장B 인명한자의
//    **두 반쪽 모두**에 매치해 글자를 통째로 삭제했다(2026-08-24 독립 판정 실측:
//    `김𡬴수`→`김수` · `소방🔥`→`소방`). 파일은 정상 개봉되고 missed=0이라 조용히 사라진다 —
//    PDF(HTML 렌더러)는 그대로 찍으므로 **D-7이 깨지는 축**이었다. 내가 만든 회귀다.
// ⚠ 0x7F~0x9F도 뺐다 — XML **1.0에서는 합법**이다(제한문자는 1.1). 과잉 제거였다.
const XML_ILLEGAL_RE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]'
  + '|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])'   // 짝 없는 상위 서로게이트
  + '|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]', // 짝 없는 하위 서로게이트
  'g')
const stripIllegal = (s: string) => s.replace(XML_ILLEGAL_RE, '')
const escXml = (s: string) =>
  stripIllegal(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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
      let f = /<f[^>]*>([^<]*)<\/f>/.exec(m[2] ?? '')?.[1]
      if (!f) continue
      // 자기 교차 수식(`개요!B13 개요!B13` — 정보!J17 세대수·I16 사용승인일, 원본 갑지 실측) —
      // 교차 연산이지만 두 참조가 같으면 값이 그 셀 그대로라 단일 참조와 등가다. 접지 않으면
      // 폐포 밖이라 캐시가 빈 채 나가, 재계산 없는 뷰어(LibreOffice, D-9)에서 값이 있어도
      // 공란으로 보였다(2026-09-05 — Excel은 열면서 재계산해 이 갈라짐이 안 보인다).
      const selfX = /^(\S+)\s+\1$/.exec(f)
      if (selfX) f = selfX[1]
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

/** **복합 수식 포함** 전체 참조 그래프 — 단일 참조 그래프(buildRefGraph)는 값을 전파할 수 있는
 *  간선만 담지만, 이것은 `개요!G10+5`·`SUM(개요!B1:B8)`·교차 연산 같은 복합 수식의 참조도 담는다.
 *  값 전파에는 못 쓰고(계산 불가) **낡은 캐시 색출**에 쓴다: 허브에서 이 그래프로 닿는데 단일 참조
 *  폐포 밖인 셀의 캐시는 표본 잔재다(2026-08-21 판정 실측 — 정보!I16 교차 수식이 표본 교육이수일
 *  40719를, 완료보고서!G25 `개요!G10+5`가 표본 이행조치일 46237을 전 고객 문서에 인쇄할 뻔했다).
 *  범위(B1:B8)는 사각형 전개(2,000셀 상한). 함수명 오인(LOG10→G10)은 lookbehind로 차단 */
export async function buildFullRefGraph(zip: JSZip, files: Map<string, string>): Promise<Map<string, Array<{ sheet: string; cell: string }>>> {
  const edges = new Map<string, Array<{ sheet: string; cell: string }>>()
  const REF = /(?<![A-Za-z0-9가-힣_$.!])(?:'([^'!]+)'!|([A-Za-z가-힣][A-Za-z0-9가-힣_. ]*)!)?(\$?[A-Z]{1,3}\$?\d{1,7})(?::(\$?[A-Z]{1,3}\$?\d{1,7}))?/g
  const colNum = (s: string) => s.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
  const colStr = (n: number) => { let s = ''; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }
  for (const [sheet, path] of files) {
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async('string')
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2] ?? '')?.[1]
      if (!f) continue
      for (const r of f.matchAll(REF)) {
        const refSheet = r[1] ?? r[2] ?? sheet
        const cells: string[] = []
        if (r[4]) {
          const a = /(\$?)([A-Z]+)(\$?)(\d+)/.exec(r[3])!, b = /(\$?)([A-Z]+)(\$?)(\d+)/.exec(r[4])!
          const c1 = colNum(a[2]), c2 = colNum(b[2]), r1 = Number(a[4]), r2 = Number(b[4])
          if ((Math.abs(c2 - c1) + 1) * (Math.abs(r2 - r1) + 1) <= 2000) {
            for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
              for (let row = Math.min(r1, r2); row <= Math.max(r1, r2); row++) cells.push(`${colStr(c)}${row}`)
          } else { cells.push(r[3].replace(/\$/g, ''), r[4].replace(/\$/g, '')) }
        } else cells.push(r[3].replace(/\$/g, ''))
        for (const c of cells) {
          const from = `${refSheet}!${c}`
          const arr = edges.get(from) ?? []
          arr.push({ sheet, cell: m[1] })
          edges.set(from, arr)
        }
      }
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
  // ⚠ 함수 치환 필수 — repl에 사용자 값이 들어가므로 문자열로 주면 `$'`·`$&` 같은 치환 패턴이
  //   해석돼 문서 꼬리가 셀 안으로 복제되고 값이 유실된다(2026-08-22 판정 실측, missed=0 무음)
  return { xml: xml.replace(re, () => repl), hit: true }
}

export type InjectResult = {
  bytes: Uint8Array
  /** XML에서 찾지 못한 대상 — 조용히 버리지 않는다. 호출부가 실패 처리할 것 */
  missed: string[]
  /** 전파로 함께 갱신된 캐시 셀 수 */
  propagated: number
  /** 니들 안전망(D-10)이 비운 곳 — 셀(`시트!셀`) 또는 공유문자열(`sharedStrings!si<i>`) */
  scrubbed: string[]
  /** 구조 안전망이 비운 **참조 0인** 공유문자열(`sharedStrings!si<i>`).
   *  ⚠ scrubbed와 **합치지 말 것** — 니들 축(목록에 적힌 것)과 구조 축(참조 여부)은 다른 축이고,
   *  섞으면 '니들이 N칸 지웠다'는 단언이 고아 수에 오염돼 조용히 무의미해진다 */
  scrubbedOrphans: string[]
  /** 이번 주입이 실제로 쓴 셀 전부(직접 + 전파) — 검증이 '비대상 무변경'을 단언하는 축 */
  touched: string[]
}

/** 값 주입 + 폐포 전파. 원본 bytes는 변형하지 않는다.
 *
 *  opts.forbidden(D-10 안전망): 주입이 끝난 뒤에도 이 니들을 물고 있는 캐시 셀이 남아 있으면
 *  <v>·<is>를 **비운다**(<f>·스타일은 보존). 폐포는 단일 참조 수식만 따라가므로 복합 수식의
 *  캐시는 기계적으로 전파할 수 없고, 템플릿이 갱신되면 표본 값이 그런 캐시에 되살아날 수 있다 —
 *  빈칸이 남의 상호·이름보다 낫다. 단 **이번 주입이 쓴 셀은 건드리지 않는다**: 표본과 같은
 *  이름의 실고객(정내과의원 본인 등)의 정당한 값을 지우면 안 된다. */
export async function injectWorkbook(
  templateBytes: Uint8Array, targets: InjectTarget[], opts?: { forbidden?: string[] },
): Promise<InjectResult> {
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
  // ⚠ 직접 타깃이 전파를 이긴다 — 템플릿에 B10→B11(발신일자→문서번호 칸) 같은 간선이 있어,
  //   전파가 직접 타깃 칸을 덮으면 배열 순서에 따라 문서번호 칸에 날짜 시리얼이 남는다
  //   (종전엔 ANCHORS 순서 덕에 우연히 맞았다 — 순서 의존 제거, 2026-08-22 판정 관찰)
  const direct = new Set(targets.map(t => `${t.sheet}!${t.cell}`))
  let propagated = 0
  for (const t of targets) {
    push(t.sheet, t.cell, t.value, t.dropFormula ?? false)
    for (const d of transitiveClosure(edges, t.sheet, t.cell)) {
      if (direct.has(`${d.sheet}!${d.cell}`)) continue
      push(d.sheet, d.cell, t.value, false)   // 캐시만 갱신, <f> 보존
      propagated++
    }
  }

  const missed: string[] = []
  const written = new Set<string>()
  for (const [sheet, patches] of bySheet) {
    const path = files.get(sheet)
    if (!path || !zip.file(path)) { missed.push(...patches.map(p => `${sheet}!${p.cell}`)); continue }
    let xml = await zip.file(path)!.async('string')
    for (const p of patches) {
      const r = setCell(xml, p.cell, p.value, p.dropFormula)
      if (!r.hit) { missed.push(`${sheet}!${p.cell}`); continue }
      xml = r.xml
      written.add(`${sheet}!${p.cell}`)
    }
    zip.file(path, xml)
  }

  // ── 안전망(D-10) — 주입이 안 닿은 캐시에 니들이 남았으면 비운다 ──
  // 판정 실측(2026-08-22)으로 막은 사각 두 축: ① t="s" 셀은 <v>가 공유문자열 **인덱스**라
  // 원문을 대조해야 보인다(LibreOffice 재변환 템플릿은 t="s"가 기본) ② <is>가 서식 런으로
  // 쪼개지면(<r><t>정내</t></r><r><t>과의원</t></r>) 첫 <t>만 봐서는 못 잡는다 — 전 <t> 연결로 판정
  const scrubbed: string[] = []
  const forbidden = opts?.forbidden ?? []
  const joinT = (s: string) => [...s.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')
  // 공유문자열 원문 — 니들을 문 si는 텍스트 자체를 비운다(고아든 참조든: .xlsx는 zip이라
  // 셀에 안 보여도 파트 바이트에 실려 나간다). 참조 셀은 아래 셀 스캔이 함께 비운다
  const sstPath = 'xl/sharedStrings.xml'
  const sst: string[] = []
  let sstXml: string | null = null
  let sstDirty = false
  const sstFile = zip.file(sstPath)
  if (sstFile) {
    sstXml = await sstFile.async('string')
    let idx = 0
    sstXml = sstXml.replace(/<si>([\s\S]*?)<\/si>/g, (whole, inner: string) => {
      const text = joinT(inner)
      sst.push(text)
      const i = idx++
      if (!forbidden.some(n => text.includes(n))) return whole
      sstDirty = true
      scrubbed.push(`sharedStrings!si${i}`)
      return '<si><t/></si>'
    })
  }
  if (forbidden.length) {
    for (const [sheet, path] of files) {
      const file = zip.file(path)
      if (!file) continue
      let xml = await file.async('string')
      let dirty = false
      for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const key = `${sheet}!${m[1]}`
        if (written.has(key)) continue
        const inner = m[3] ?? ''
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        let cached: string | undefined
        if (/\st="s"/.test(m[2] ?? '') && v !== undefined) cached = sst[Number(v)] ?? v
        else if (inner.includes('<is>')) cached = joinT(inner)
        else cached = v
        if (cached === undefined || !forbidden.some(n => cached.includes(n))) continue
        const r = setCell(xml, m[1], null, false)
        if (r.hit) { xml = r.xml; dirty = true; scrubbed.push(key) }
      }
      if (dirty) zip.file(path, xml)
    }
  }

  // ── 구조 안전망 — 참조 0인 공유문자열(고아 si)을 비운다 ──
  // 위 니들 축은 **목록에 적힌 문자열만** 지운다. 니들은 표본 고객 하나만 인코딩하므로 직원
  // 실명·자격번호처럼 목록 밖 원문은 그대로 남았다. 앵커가 셀을 덮어도 그 셀이 가리키던 si는
  // 참조 0인 고아로 파트에 남아 **압축만 풀면 읽히는 상태로** 매 산출물에 실려 나갔다
  // (2026-08-30 독립 판정 C·D가 서로 다른 축에서 같은 결론에 도달 — 직원 9명 성명·자격번호
  //  7건·표본 소견·'( 3 )층 실명( 직원실 )'). externalLinks를 니들이 아니라 '파트 존재 자체
  // 금지'로 닫은 것과 같은 규약이다 — 내용이 아니라 **구조**로 판정한다.
  // ⚠ 참조 집합은 zip의 worksheet 파트를 **직접** 훑는다. workbook.xml 등재 목록(sheetFileMap)을
  //   쓰면 등재 밖 파트가 참조하는 si를 고아로 오판해 살아 있는 텍스트를 지운다 — 이 검사는
  //   **과소 소거가 과대 소거보다 안전**하므로 참조 판정을 넓게 잡는다.
  // ⚠ si 개수는 바꾸지 않는다(인덱스가 밀리면 전 시트의 t="s" 참조가 어긋난다). 자리를 유지한
  //   채 텍스트만 비우므로 <sst count·uniqueCount>도 그대로 유효하다.
  const scrubbedOrphans: string[] = []
  if (sstXml !== null) {
    const referenced = new Set<number>()
    for (const name of Object.keys(zip.files)) {
      if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue
      const wx = await zip.file(name)!.async('string')
      for (const m of wx.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (!/\st="s"/.test(m[1] ?? '')) continue
        const v = /<v>(\d+)<\/v>/.exec(m[2] ?? '')
        if (v) referenced.add(Number(v[1]))
      }
    }
    let at = 0
    sstXml = sstXml.replace(/<si>([\s\S]*?)<\/si>/g, (whole, inner: string) => {
      const i = at++
      // 이미 빈 항목은 건드리지 않는다 — scrubbed가 잡음으로 부풀면 실제 소거를 못 읽는다
      if (referenced.has(i) || !joinT(inner)) return whole
      sstDirty = true
      scrubbedOrphans.push(`sharedStrings!si${i}`)
      return '<si><t/></si>'
    })
  }
  if (sstDirty && sstXml !== null) zip.file(sstPath, sstXml)

  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  return { bytes, missed, propagated, scrubbed, scrubbedOrphans, touched: [...written] }
}
