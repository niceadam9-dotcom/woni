/** 워크북 시트 제거 수술 (소방계획서_27 Phase 5 / S10-2)
 *
 *  zip 항목 삭제 + 목록 3곳(workbook.xml·workbook.xml.rels·[Content_Types].xml) 정리 —
 *  _probe-sheet-transplant.mts [1] 실측으로 성립 확인(24시트 개방·PDF 정상). 손대지 않은
 *  파트는 바이트 그대로라(JSZip 패치 철학, D-1) 서식·병합·인쇄여백이 구성적으로 보존된다.
 *
 *  ⚠ definedNames의 localSheetId는 <sheets> 목록의 **순서 인덱스**다 — 앞쪽 시트를 빼면
 *  뒤쪽 이름들이 전부 한 칸씩 밀린다. 이 함수는 도너 시트(빌드가 기저 26시트 **뒤에**
 *  덧붙인 것) 제거 전용으로 쓴다: 도너에는 definedName이 없고, 도너 제거는 기저 시트의
 *  인덱스를 움직이지 않는다. 기저 시트 제거에 쓰려면 localSheetId 재번호가 선행이다. */
import JSZip from 'jszip'

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 이름으로 시트를 제거한 새 바이트를 돌려준다 — 대상 미발견은 실패(조용한 오적용 금지) */
export async function removeSheets(
  bytes: Uint8Array, names: string[],
): Promise<{ bytes: Uint8Array; removed: string[] }> {
  if (names.length === 0) return { bytes, removed: [] }
  const zip = await JSZip.loadAsync(bytes)
  let wbXml = await zip.file('xl/workbook.xml')!.async('string')
  let relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  let ctXml = await zip.file('[Content_Types].xml')!.async('string')
  const removed: string[] = []

  for (const name of names) {
    const sm = new RegExp(`<sheet[^>]*name="${escRe(name)}"[^>]*r:id="(rId\\d+)"[^>]*/>`).exec(wbXml)
    if (!sm) throw new Error(`제거 대상 시트 미발견: ${name}`)
    const rid = sm[1]
    const tm = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"[^>]*/>`).exec(relsXml)
    if (!tm) throw new Error(`제거 대상 rels 미발견: ${name} (${rid})`)
    const part = `xl/${tm[1].replace(/^\.\//, '')}`
    wbXml = wbXml.replace(sm[0], '')
    relsXml = relsXml.replace(tm[0], '')
    ctXml = ctXml.replace(new RegExp(`<Override[^>]*PartName="/${escRe(part)}"[^>]*/>`), '')
    zip.remove(part)
    // 시트 전용 rels(그림 등)가 있으면 함께 — 도너는 빌드가 r:id 잔재를 걷어내 없는 것이 정상
    const partRels = part.replace(/worksheets\//, 'worksheets/_rels/') + '.rels'
    if (zip.file(partRels)) zip.remove(partRels)
    removed.push(name)
  }

  zip.file('xl/workbook.xml', wbXml)
  zip.file('xl/_rels/workbook.xml.rels', relsXml)
  zip.file('[Content_Types].xml', ctXml)
  return { bytes: new Uint8Array(await zip.generateAsync({ type: 'uint8array' })), removed }
}

/** 삽입할 시트 한 장 — 워크시트 XML과 그에 딸린 파트(그림·미디어·수정된 styles.xml)를 함께 든다.
 *  파트 이름은 **호출부가 정한다**: 그림 rels가 상대 경로(`../media/…`)로 서로를 가리키므로
 *  이름을 두 곳에서 따로 지으면 갈라진다. */
export type SheetPart = {
  /** 엑셀 탭에 보일 이름 */
  name: string
  /** zip 내 경로 — 예 `xl/worksheets/sheetPhoto.xml` */
  path: string
  xml: string
  /** 시트 전용 rels 내용(있으면 `xl/worksheets/_rels/{base}.rels`에 쓴다) */
  rels?: string
  /** 함께 써 넣을 파트(그림 XML·미디어 바이트·패치된 styles.xml 등) */
  parts?: Array<{ path: string; data: string | Uint8Array }>
  /** 워크시트 자신 외에 [Content_Types]에 Override가 필요한 파트 */
  overrides?: Array<{ partName: string; contentType: string }>
  /** 인쇄영역(`$A$1:$C$18`) — 주면 이 시트 전용 definedName을 만든다 */
  printArea?: string
}

const WORKSHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
/** 시트 참조에 따옴표가 필요한가 — 공백·기호가 있으면 `'이름'!$A$1` */
const refName = (s: string) => (/^[A-Za-z0-9_가-힣]+$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`)
const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** definedName(localSheetId 보유)의 **문서 순서 목록** — 삽입이 옳았는지 판정하는 축.
 *
 *  두 가지로 쓴다: ① 자기검증 — `_xlnm.Print_Area`의 ref가 시트명을 스스로 들고 있으므로
 *  `sheets[localSheetId] === ref 앞 시트명`이 외부 정답표 없이 성립해야 한다 ② 전수 대조 —
 *  삽입 전/후 목록을 ord로 맞대어 **기존 항목의 소속 시트가 한 개도 안 바뀌었는지** 본다.
 *
 *  ⚠ ①은 **Print_Area에만** 성립한다. 이 자산의 localSheetId 510건 중 대부분은 죽은 외부
 *  통합문서 매크로 잔재(`#REF!…`·`[7]토목주소!…`)라 ref 앞이 시트명이 아니다 — 전체에 걸면
 *  삽입 **전** 원본에서도 실패한다(첫 실행에서 실제로 그랬다). 그래서 name을 함께 돌려준다. */
export function localNameMap(wbXml: string): Array<{ ord: number; lsi: number; name: string; sheet: string; refSheet: string | null }> {
  const sheets = [...wbXml.matchAll(/<sheet\s[^>]*\/>/g)].map(m => /\sname="([^"]*)"/.exec(m[0])?.[1] ?? '')
  const out: Array<{ ord: number; lsi: number; name: string; sheet: string; refSheet: string | null }> = []
  let ord = 0
  for (const m of wbXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const lsi = /\blocalSheetId="(\d+)"/.exec(m[1])
    if (!lsi) continue
    const i = Number(lsi[1])
    const ref = /^'?([^'!]+)'?!/.exec(m[2].trim())
    out.push({
      ord: ord++, lsi: i, name: /\bname="([^"]*)"/.exec(m[1])?.[1] ?? '',
      sheet: sheets[i] ?? '(범위밖)', refSheet: ref?.[1] ?? null,
    })
  }
  return out
}

/** 지정 시트 **바로 뒤에** 새 시트를 끼운 새 바이트 — removeSheets의 대칭.
 *
 *  ⚠ 이 함수의 위험은 전부 한 곳에 몰려 있다: **`definedName@localSheetId`는 `<sheets>`의 순서
 *  인덱스**라 중간에 한 장을 끼우면 뒤쪽 이름들이 통째로 밀린다(실측 템플릿에서 481곳). 재번호를
 *  빠뜨리면 파일은 멀쩡히 열리고 **남의 인쇄영역**이 적용된다 — 육안으로는 안 보이는 부류다.
 *  치환은 반드시 **한 번의 패스**로 한다(15→16, 14→15… 순차 치환은 같은 값을 두 번 올린다).
 *
 *  ⚠ 호출 시점: `injectWorkbook` **뒤**에 둔다. 주입기는 SCRUB_NEEDLES를 문 캐시 셀을 비우고
 *  참조 0인 공유문자열을 지우므로, 불량명 같은 DB 자유 텍스트가 니들과 우연히 겹치면 새 시트의
 *  캡션만 데이터에 따라 조용히 사라진다. 파이프라인 밖에 두면 그 부류가 구성적으로 0이 된다. */
export async function insertSheetAfter(
  bytes: Uint8Array, afterSheet: string, part: SheetPart,
): Promise<{ bytes: Uint8Array; index: number; renumbered: number }> {
  const zip = await JSZip.loadAsync(bytes)
  let wbXml = await zip.file('xl/workbook.xml')!.async('string')
  let relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  let ctXml = await zip.file('[Content_Types].xml')!.async('string')

  const sheetEls = [...wbXml.matchAll(/<sheet\s[^>]*\/>/g)].map(m => m[0])
  const nameOf = (el: string) => /\sname="([^"]*)"/.exec(el)?.[1] ?? ''
  const at = sheetEls.findIndex(el => nameOf(el) === afterSheet)
  if (at < 0) throw new Error(`삽입 기준 시트 미발견: ${afterSheet}`)
  if (sheetEls.some(el => nameOf(el) === part.name)) throw new Error(`시트 이름 중복: ${part.name}`)
  if (zip.file(part.path)) throw new Error(`파트 이름 충돌: ${part.path}`)
  const index = at + 1

  // ① localSheetId 재번호 — **삽입보다 먼저**, definedNames 블록만 잘라 단일 패스로
  let renumbered = 0
  const dn = /<definedNames>[\s\S]*?<\/definedNames>/.exec(wbXml)
  if (dn) {
    const fixed = dn[0].replace(/(<definedName\b[^>]*?\blocalSheetId=")(\d+)(")/g, (_m, a: string, n: string, b: string) => {
      const v = Number(n)
      if (v < index) return `${a}${n}${b}`
      renumbered++
      return `${a}${v + 1}${b}`
    })
    wbXml = wbXml.slice(0, dn.index) + fixed + wbXml.slice(dn.index + dn[0].length)
  }

  // ② 채번은 **스캔해서** — 하드코딩하면 자산이 갱신될 때 조용히 충돌한다
  const nextSheetId = Math.max(0, ...sheetEls.map(el => Number(/\ssheetId="(\d+)"/.exec(el)?.[1] ?? 0))) + 1
  const nextRid = Math.max(0, ...[...relsXml.matchAll(/\bId="rId(\d+)"/g)].map(m => Number(m[1]))) + 1
  const rid = `rId${nextRid}`

  // ③ <sheets> 삽입 — 기준 원소 문자열 바로 뒤(재번호 후 위치를 다시 찾는다)
  const anchor = sheetEls[at]
  const pos = wbXml.indexOf(anchor)
  if (pos < 0) throw new Error(`삽입 기준 시트 원소 소실: ${afterSheet}`)
  const newEl = `<sheet name="${escAttr(part.name)}" sheetId="${nextSheetId}" state="visible" r:id="${rid}"/>`
  wbXml = wbXml.slice(0, pos + anchor.length) + newEl + wbXml.slice(pos + anchor.length)

  // ④ 인쇄영역 — 이 시트 전용 definedName. 기존 8건과 같은 속성 순서(function hidden localSheetId name)
  if (part.printArea) {
    const el = `<definedName function="false" hidden="false" localSheetId="${index}" name="_xlnm.Print_Area"`
      + ` vbProcedure="false">${escAttr(refName(part.name))}!${part.printArea}</definedName>`
    wbXml = wbXml.includes('</definedNames>')
      ? wbXml.replace('</definedNames>', () => `${el}</definedNames>`)
      : wbXml.replace('</sheets>', () => `</sheets><definedNames>${el}</definedNames>`)
  }

  // ⑤ 관계 + 콘텐츠 타입
  const target = part.path.replace(/^xl\//, '')
  relsXml = relsXml.replace('</Relationships>', () =>
    `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/></Relationships>`)
  const overrides = [{ partName: `/${part.path}`, contentType: WORKSHEET_CT }, ...(part.overrides ?? [])]
  const addOverride = overrides
    .filter(o => !ctXml.includes(`PartName="${o.partName}"`))
    .map(o => `<Override PartName="${o.partName}" ContentType="${o.contentType}"/>`).join('')
  // Default는 **있을 때 또 넣으면 Excel이 복구 대화상자를 띄운다** — 존재 검사 후에만
  const needJpeg = (part.parts ?? []).some(p => p.path.endsWith('.jpeg')) && !/Extension="jpeg"/.test(ctXml)
  ctXml = ctXml.replace('</Types>', () =>
    `${needJpeg ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : ''}${addOverride}</Types>`)

  // ⑥ 파트 쓰기
  zip.file(part.path, part.xml)
  if (part.rels) zip.file(part.path.replace(/worksheets\//, 'worksheets/_rels/') + '.rels', part.rels)
  for (const p of part.parts ?? []) zip.file(p.path, p.data)
  zip.file('xl/workbook.xml', wbXml)
  zip.file('xl/_rels/workbook.xml.rels', relsXml)
  zip.file('[Content_Types].xml', ctXml)

  return { bytes: new Uint8Array(await zip.generateAsync({ type: 'uint8array' })), index, renumbered }
}
