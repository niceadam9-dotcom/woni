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
