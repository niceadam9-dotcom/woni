// S7-0 이동 충실성 — HEAD의 assembleReport9(+헬퍼) 원문과 lib 추출본이 자구 동일한지 대조.
// 도큐 주석·본문 전부 포함, 유일한 허용 차이는 `export ` 접두 5곳.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const GIT = 'C:/Users/dwhwang/Tools/MinGit/cmd/git.exe'
const head = execFileSync(GIT, ['-C', 'F:/AI/ERP', 'show', 'HEAD:erp/src/app/(dashboard)/inspections/report9-actions.ts'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, '\n')
const lib = readFileSync('src/lib/report9-assemble.ts', 'utf8').replace(/\r\n/g, '\n')

const cut = (s, from, to) => {
  const i = s.indexOf(from), j = s.indexOf(to)
  if (i < 0 || j < 0 || j <= i) throw new Error(`marker fail: ${from.slice(0, 20)}`)
  return s.slice(i, j).trimEnd()
}
const A_START = 'function kdate(iso: string): string {'
const A_END = '/** 별지 10·11호 데이터 조립'
const B_START = '/** 별지 9호 데이터 조립 — 워커 process_report9'
const B_END = '/** 별지 4호(소방시설등점검표) 데이터 조립'

const headA = cut(head, A_START, A_END)
const headB = cut(head, B_START, B_END)
// lib에서 같은 구간 — export 접두를 걷어내고 비교
const norm = s => s
  .replace('export function kdate', 'function kdate')
  .replace('export async function pageAll', 'async function pageAll')
  .replace('export async function loadAnnexInputs', 'async function loadAnnexInputs')
  .replace('export function fstr', 'function fstr')
  .replace('export async function assembleReport9', 'async function assembleReport9')
const libN = norm(lib)
const libA = cut(libN, A_START, B_START)
const libB = libN.slice(libN.indexOf(B_START)).trimEnd()

const eq = (a, b, name) => {
  const ok = a === b
  console.log(`${ok ? 'OK' : 'DIFF'} ${name} — head ${a.length}ch / lib ${b.length}ch`)
  if (!ok) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log('first diff at', i, JSON.stringify(a.slice(i - 40, i + 40)), 'vs', JSON.stringify(b.slice(i - 40, i + 40))); break }
    }
  }
  return ok
}
const ok1 = eq(headA, libA, 'helpers(kdate..fstr)')
const ok2 = eq(headB, libB, 'assembleReport9')
process.exit(ok1 && ok2 ? 0 : 1)
