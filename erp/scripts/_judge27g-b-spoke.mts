/** 판정자 B 보충 — S0-4 죽은 SPOKE 확인 + drawing 파트 실체 확인 (soffice 미사용) */
import XLSX from 'xlsx'
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'
const OUT: string[] = []
const say = (s = '') => { OUT.push(s); console.log(s) }
const ROOT = 'F:/AI/ERP/erp'

// ① 정보!B4 — 원본 .xls · 기저 자산 · full 자산 세 곳 모두에서 확인
for (const [tag, p] of [['기저자산', `${ROOT}/templates/report-workbook.xlsx`], ['full자산', `${ROOT}/templates/report-workbook-full.xlsx`]] as const) {
  const wb = XLSX.read(readFileSync(p), { cellFormula: true, sheetStubs: true })
  const ws: any = wb.Sheets['정보']
  say(`[${tag}] 정보!B4 = ${JSON.stringify(ws?.B4 ?? null)} · 정보!B5 = ${JSON.stringify(ws?.B5?.v ?? null)}`)
  say(`         정보 시트에서 '개요'!B14를 참조하는 셀: ` +
    (Object.keys(ws ?? {}).filter(k => !k.startsWith('!') && String(ws[k].f ?? '').includes('B14')).join(',') || '(없음)'))
  const z = await JSZip.loadAsync(readFileSync(p))
  const drw = Object.keys(z.files).filter(f => f.includes('drawing'))
  say(`         drawing 매칭 파트 ${drw.length}: ${drw.join(' | ')}`)
  say(`         dir 엔트리 포함 총 ${Object.keys(z.files).length} · 파일만 ${Object.keys(z.files).filter(f => !z.files[f].dir).length}`)
}
// ② 원본 .xls의 정보 시트 실체
const src = XLSX.read(readFileSync(`${ROOT}/보고서 갑지.xls`), { cellFormula: true, sheetStubs: true })
const si: any = src.Sheets['정보']
say(`[원본.xls] 정보 시트 존재=${!!si} · B1~B6 = ` +
  ['B1','B2','B3','B4','B5','B6'].map(k => `${k}:${JSON.stringify(si?.[k]?.v ?? null)}`).join(' '))
writeFileSync(`${ROOT}/scripts/_judge27g-b-spoke.txt`, OUT.join('\n'), 'utf8')
