/** 생성물 파일 → 문서 단위 그룹 + 조회 순서 (소방계획서_5 ⑩ R11의 순수 로직 분리, 2026-08-20)
 *
 *  같은 생성 타임스탬프의 hwp/pdf/html을 한 문서로 묶고, 화면이 그릴 순서대로 정렬한다.
 *  렌더는 components/inspections/generated-doc-list, 회귀 고정은 scripts/_probe-doc-order.mts.
 *  (컴포넌트 안에 두면 프로브가 lucide·React까지 끌어와야 해서 검증이 안 된다 — 순수 로직만 여기.) */

import { GENERATED_DOC_KINDS, generatedDocRank } from '@/lib/doc-requirements'

export type GeneratedDocFile = { name: string; path: string; createdAt: string | null }

export type DocGroup = {
  key: string            // kind_stamp
  kind: string           // report9 | report10 | report11 | exterior | … (규칙 밖 파일은 '')
  label: string
  full: string           // 풀네임 툴팁
  createdAt: string | null
  hwp?: GeneratedDocFile
  pdf?: GeneratedDocFile
  html?: GeneratedDocFile
  others: GeneratedDocFile[]
}

export function groupFiles(files: GeneratedDocFile[]): DocGroup[] {
  const map = new Map<string, DocGroup>()
  for (const f of files) {
    const m = f.name.match(/^([a-z0-9_]+?)_(\d+)\.(hwpx?|pdf|html?)$/i)
    if (!m) {
      // 규칙 밖 파일 — 자체 그룹으로 (업로드 슬롯 등은 호출부에서 이미 제외)
      map.set(f.name, { key: f.name, kind: '', label: f.name, full: f.name, createdAt: f.createdAt, others: [f] })
      continue
    }
    const [, kind, stamp, extRaw] = m
    const ext = extRaw.toLowerCase().startsWith('htm') ? 'html' : extRaw.toLowerCase().startsWith('hwp') ? 'hwp' : 'pdf'
    const key = `${kind}_${stamp}`
    const known = GENERATED_DOC_KINDS[kind]
    let g = map.get(key)
    if (!g) {
      g = { key, kind, label: known?.label ?? kind, full: known?.full ?? kind, createdAt: f.createdAt, others: [] }
      map.set(key, g)
    }
    if (f.createdAt && (!g.createdAt || f.createdAt > g.createdAt)) g.createdAt = f.createdAt
    if (ext === 'hwp') g.hwp = f
    else if (ext === 'pdf') g.pdf = f
    else g.html = f
  }
  // 문서 종류는 **고정 순서**(GENERATED_DOC_ORDER = 인쇄 번들과 같은 축), 같은 종류 안에서만 최신 먼저.
  // 종전엔 `kind_stamp` 문자열 하나로 정렬해 종류가 알파벳 역순으로 섞였고(주석은 "최신 우선"이라
  // 적혀 있었다), 위임장·소방계획서가 이행계획서(10호) 아래로 밀렸다.
  // ⚠ 화면의 '최신 1건 추림'이 **종류 안 내림차순**에 기대므로 그 부분은 유지해야 한다.
  return [...map.values()].sort((a, b) => {
    const r = generatedDocRank(a.kind) - generatedDocRank(b.kind)
    if (r !== 0) return r
    return a.key > b.key ? -1 : a.key < b.key ? 1 : 0
  })
}
