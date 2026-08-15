// 소방계획서_22 S14-1 — MU 16칸 ↔ STD-32 매핑표·롤업 규칙 검증 (읽기 전용, DB 무변경)
// ① 16칸 전부 ≥1 매핑 ② STD-32 각 항목은 정확히 0~1칸 귀속(중복 0) ③ 코드는 법정 44항목 안
// ④ 44항목 전건이 어느 칸에든 귀속(잔여 0 — 우리 매핑은 전건 1칸) ⑤ 롤업 우선순위 X>O>N>공란
// 실행: npx tsx scripts/_probe-mu-std32-map.mts
import { MU_STD32_MAP, deriveMuFromStd32 } from '../src/lib/mu-std32-map'

// 법정 44항목 — _별지4호_현행판_추출.txt:3644-3794 실측(32-A 13 · 32-B 4 · 32-C 16 · 32-D 3 · 32-E 4 · 32-F 1 · 32-G 2 + 32-C-001)
const LEGAL_44 = [
  '32-A-001', '32-A-002', '32-A-003', '32-A-004', '32-A-005',
  '32-A-011', '32-A-012', '32-A-013', '32-A-014', '32-A-015', '32-A-016', '32-A-017', '32-A-018',
  '32-B-001', '32-B-002', '32-B-003', '32-B-011',
  '32-C-001', '32-C-002', '32-C-003', '32-C-004', '32-C-005',
  '32-C-011', '32-C-012',
  '32-C-021', '32-C-022', '32-C-023',
  '32-C-031', '32-C-032',
  '32-C-041', '32-C-042',
  '32-C-051', '32-C-052', '32-C-053',
  '32-D-001', '32-D-002', '32-D-003',
  '32-E-001', '32-E-002', '32-E-003', '32-E-004',
  '32-F-001',
  '32-G-001', '32-G-002',
]

let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail++
}

check('법정 44항목 목록 자체 44건', LEGAL_44.length === 44, String(LEGAL_44.length))

// ① 16칸 전부 존재·≥1 매핑
const muKeys = Array.from({ length: 16 }, (_, i) => `MU-${String(i + 1).padStart(3, '0')}`)
check('MU 16칸 전부 매핑 존재', muKeys.every(k => (MU_STD32_MAP[k] ?? []).length >= 1),
  muKeys.filter(k => !(MU_STD32_MAP[k] ?? []).length).join(',') || '전건')
check('매핑표에 16칸 외 키 없음', Object.keys(MU_STD32_MAP).every(k => muKeys.includes(k)))

// ②③④ 항목 귀속
const all = Object.values(MU_STD32_MAP).flat()
const dup = all.filter((c, i) => all.indexOf(c) !== i)
check('STD-32 항목 중복 귀속 0', dup.length === 0, dup.join(',') || '0건')
const outside = all.filter(c => !LEGAL_44.includes(c))
check('법정 44항목 밖 코드 0', outside.length === 0, outside.join(',') || '0건')
const unmapped = LEGAL_44.filter(c => !all.includes(c))
check('44항목 전건 귀속(잔여 0)', unmapped.length === 0, unmapped.join(',') || '0건')

// ⑤ 롤업 규칙 — X 우세 → O → 전부 N → 응답 없으면 키 없음
const of = (m: Record<string, string>) => (c: string) => m[c]
let d = deriveMuFromStd32(of({ '32-B-011': 'X' }))
check('롤업: X → X', d['MU-004'] === 'X')
d = deriveMuFromStd32(of({ '32-A-001': 'O', '32-A-002': 'X', '32-A-003': 'N' }))
check('롤업: X 우세(O·N 혼재)', d['MU-001'] === 'X')
d = deriveMuFromStd32(of({ '32-A-001': 'O', '32-A-003': 'N' }))
check('롤업: O 우세(N 혼재)', d['MU-001'] === 'O')
d = deriveMuFromStd32(of({ '32-G-001': 'N', '32-G-002': 'N' }))
check('롤업: 전부 N → N', d['MU-016'] === 'N')
d = deriveMuFromStd32(of({}))
check('롤업: 무응답 → 키 없음(공란)', Object.keys(d).length === 0)
d = deriveMuFromStd32(of({ '32-E-004': 'O' }))
check('롤업: 창문(MU-010) ← 32-E-004', d['MU-010'] === 'O' && d['MU-013'] === undefined)

console.log(fail === 0 ? '\n전건 통과' : `\n실패 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
