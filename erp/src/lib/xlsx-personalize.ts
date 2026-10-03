import JSZip from 'jszip'
import { applyLiteralRules, type LiteralRule } from '@/lib/company-literals'

/** 생성된 .xlsx 바이트의 운영사 고정 문구를 회사정보로 바꾼다 (통합 실행계획 C5 2차, 2026-10-02)
 *
 *  **주입이 끝난 최종 바이트**에 적용한다. 주입 전 템플릿에만 적용하면 안 되는 이유: 입력이 없는 칸은
 *  템플릿 원문을 다시 주입한다(fire-plan-xlsx-values `placeholderCell` — 1.11.2 교보재 예문 등).
 *  그래서 공유 문자열(<si>)·인라인 문자열(<is>)·수식 문자열 캐시(t="str"의 <v>)를 모두 본다.
 *
 *  ⚠ 고객이 입력한 값이 운영사 문구와 **글자까지 같으면** 그것도 바뀐다(예: 관리자 전화가 운영사 대표번호).
 *    승진소방 테넌트에게는 같은 값으로의 치환이라 무변화이고, 다른 회사의 고객 값이 승진소방 리터럴과
 *    정확히 같을 일은 사실상 없다 — 그래서 셀 단위 예외 목록을 두지 않는다.
 *  ⚠ 바뀐 공유 문자열은 서식 런(<r>)을 하나로 합친다 — 운영사 문구 칸은 런 하나라(실측) 모양이 변하지 않는다. */
export type PersonalizeResult = { bytes: Uint8Array; changed: string[] }

const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const encode = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;')
const joinT = (inner: string) => [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('')

export async function personalizeWorkbook(bytes: Uint8Array, rules: LiteralRule[]): Promise<PersonalizeResult> {
  const live = rules.filter(r => r.from !== r.to)
  if (live.length === 0) return { bytes, changed: [] }
  const zip = await JSZip.loadAsync(bytes)
  const changed: string[] = []

  const sst = zip.file('xl/sharedStrings.xml')
  if (sst) {
    let i = 0
    const xml = (await sst.async('string')).replace(/<si>([\s\S]*?)<\/si>/g, (whole, inner: string) => {
      const idx = i++
      // 발음 표기(<rPh>)는 텍스트가 아니다 — 본문 <t>만 본다
      const body = inner.replace(/<rPh[\s\S]*?<\/rPh>/g, '')
      const text = joinT(body)
      const next = applyLiteralRules(text, live)
      if (next === text) return whole
      changed.push(`sharedStrings!si${idx}`)
      return `<si><t xml:space="preserve">${encode(next)}</t></si>`
    })
    zip.file('xl/sharedStrings.xml', xml)
  }

  for (const path of Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
    const src = await zip.file(path)!.async('string')
    let dirty = false
    // 인라인 문자열
    let xml = src.replace(/(<c r="([A-Z]+\d+)"[^>]*t="inlineStr"[^>]*>)<is>([\s\S]*?)<\/is>/g, (whole, open: string, ref: string, inner: string) => {
      const text = joinT(inner)
      const next = applyLiteralRules(text, live)
      if (next === text) return whole
      dirty = true; changed.push(`${path}!${ref}`)
      return `${open}<is><t xml:space="preserve">${encode(next)}</t></is>`
    })
    // 수식 문자열 캐시(t="str") — 운영사 칸을 참조하는 수식의 캐시도 같이 바뀌어야 인쇄가 맞는다
    //   셀 경계(</c>)를 넘지 않는다 — <v> 없는 수식 칸 뒤의 다른 칸 <v>를 집어 오지 않게
    xml = xml.replace(/(<c r="([A-Z]+\d+)"[^>]*t="str"[^>]*>)((?:(?!<\/c>)[\s\S])*?)<v>([\s\S]*?)<\/v>/g, (whole, open: string, ref: string, mid: string, v: string) => {
      const text = decode(v)
      const next = applyLiteralRules(text, live)
      if (next === text) return whole
      dirty = true; changed.push(`${path}!${ref}`)
      return `${open}${mid}<v>${encode(next)}</v>`
    })
    if (dirty) zip.file(path, xml)
  }

  if (changed.length === 0) return { bytes, changed }
  // 주입기(xlsx-inject)와 같은 옵션으로 묶는다 — 파트 압축 방식이 둘 사이에서 갈리지 않게
  const out = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  return { bytes: out, changed }
}
