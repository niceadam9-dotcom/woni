/** 갑지 자산 수술 — 여러 줄이 들어가는 칸에 `wrapText`를 강제한다.
 *
 *  왜 필요한가 (2026-09-01 사용자 신고): 「현5」(별지 9호 8쪽 불량 세부)는 그룹당 1행 고정이라
 *  ERP가 여러 불량을 **줄바꿈으로 접어** 넣는다(DEFECT_ROWS_PER_GROUP=5). 그런데 그 14칸의
 *  스타일이 `wrapText="false"`여서 Excel이 0x0A를 줄바꿈이 아니라 **네모(두부)로 그렸다**:
 *      01■1-B-011■2-
 *  서식 자신은 접기를 전제하고 있었다 — 행 높이가 `ht="77.25"`(헤더 36.75의 2배 ≈ 5줄)이고
 *  **바로 옆 라벨칸(A열)은 `wrapText="true"`**다. 정렬 속성만 그걸 못 받고 있던 것이다.
 *
 *  왜 런타임이 아니라 자산인가: 런타임에서 styles.xml을 건드리면 `test-xlsx-inject`의
 *  '주입 전후 styles.xml 바이트 동일' 불변식이 깨진다. 그 불변식은 주입이 서식을 망가뜨리지
 *  않음을 지키는 축이라 이 수리를 위해 약화시키지 않는다.
 *
 *  왜 xf를 새로 만들지 않고 제자리에서 고치는가: 대상 6개 xf는 **현5 전용**이다(실측
 *  `scripts/_p4-style-blast.mts` — 336:5 · 337:5 · 339:1 · 340:1 · 342:1 · 343:1 = 정확히 14칸,
 *  다른 시트 사용 0). 복제·재지정은 파급이 0인 곳에서 인덱스만 늘린다.
 */

/** 현5 B·C열(점검번호·불량내용) 14칸이 쓰는 cellXfs 인덱스 — `_p4-style-blast.mts` 실측.
 *  ⚠ 서식이 갱신돼 이 인덱스가 밀리면 아래 `forceWrapText`가 **0건 변경**을 돌려주고,
 *    빌드/패치가 그걸 실패로 다룬다(조용한 무동작 금지). */
export const HYEON5_WRAP_XFS = [336, 337, 339, 340, 342, 343] as const

/** cellXfs의 지정 인덱스에 `wrapText="true"`를 강제. 반환은 **실제로 바뀐 개수**.
 *  이미 true면 세지 않는다 — 재실행해도 같은 결과가 되는 멱등 변환이다. */
export function forceWrapText(stylesXml: string, indices: readonly number[]): { xml: string; changed: number } {
  const m = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)
  if (!m) throw new Error('styles.xml에 <cellXfs>가 없다 — 자산 구조가 바뀌었다')
  const blockStart = m.index + m[0].indexOf(m[1])

  // ⚠ 자기닫힘 `<xf .../>`를 **분기로** 받는다. `\/?>` 하나로 뭉뚱그리면 빈 xf의 body가
  //   다음 `</xf>`까지 삼켜 인덱스가 통째로 밀린다(소방계획서_27.md:197이 셀에서 겪은 함정).
  const hits = [...m[1].matchAll(/<xf\s[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)]

  const want = new Set(indices)
  /** ⚠ 조각을 join으로 재조립하지 않는다 — xf 사이의 공백·개행을 삼켜 파일이 망가진다.
   *  원문 좌표에 **뒤에서부터** 갈아끼워 앞쪽 인덱스가 밀리지 않게 한다.
   *  ⚠ `String.replace`의 치환 문자열도 쓰지 않는다 — `$&`·`$1`이 해석된다(이 저장소가
   *    빌드 ④b에서 `$16`으로 이미 한 번 데인 함정). 전부 slice 결합으로 처리한다. */
  const edits: Array<{ from: number; to: number; text: string }> = []
  for (const [i, h] of hits.entries()) {
    if (!want.has(i)) continue
    const xf = h[0]
    if (/<alignment[^>]*\swrapText="(?:true|1)"/.test(xf)) continue   // 이미 옳다 — 멱등
    let next: string
    const al = /<alignment(\s[^>]*?)\/>/.exec(xf)
    if (al) {
      // alignment가 있으면 그 속성만 갈아끼운다(vertical 등 나머지는 보존)
      const attrs = /\swrapText="/.test(al[1])
        ? al[1].replace(/\swrapText="[^"]*"/, ' wrapText="true"')
        : `${al[1]} wrapText="true"`
      next = xf.slice(0, al.index) + `<alignment${attrs}/>` + xf.slice(al.index + al[0].length)
    } else if (xf.endsWith('/>')) {
      next = `${xf.slice(0, -2)} applyAlignment="true"><alignment wrapText="true"/></xf>`
    } else {
      next = `${xf.slice(0, -'</xf>'.length)}<alignment wrapText="true"/></xf>`
    }
    const from = blockStart + h.index
    edits.push({ from, to: from + xf.length, text: next })
  }

  if (edits.length === 0) return { xml: stylesXml, changed: 0 }
  let xml = stylesXml
  for (const e of edits.reverse()) xml = xml.slice(0, e.from) + e.text + xml.slice(e.to)
  return { xml, changed: edits.length }
}
