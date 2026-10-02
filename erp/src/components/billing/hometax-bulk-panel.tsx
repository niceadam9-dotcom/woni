'use client'

import { useRef, useState, useTransition } from 'react'
import { Download, Upload, Loader2, ExternalLink, AlertTriangle } from 'lucide-react'
import {
  getHometaxExportAction, applyHometaxResultAction,
  type HometaxExport, type HometaxImportResult,
} from '@/app/(dashboard)/tax-invoices/hometax-actions'
import { HOMETAX_GUIDE_ROWS, HOMETAX_HEADERS, parseHometaxResult } from '@/lib/hometax-bulk'

/** B2-2 홈택스 일괄발급 — ① 그 달 미발행 청구를 홈택스 양식 엑셀로 ② 홈택스 발급 결과 엑셀을 올려 승인번호를 한 번에.
 *  국세청 전송은 사람이 홈택스에서 한다(ERP는 파일을 만들고 결과를 받아 적을 뿐). */
export function HometaxBulkPanel({ months, defaultMonth }: { months: string[]; defaultMonth: string }) {
  const [month, setMonth] = useState(defaultMonth)
  const [exp, setExp] = useState<HometaxExport | null>(null)
  const [imp, setImp] = useState<HometaxImportResult | null>(null)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function exportXlsx() {
    setErr(''); setImp(null)
    start(async () => {
      const res = await getHometaxExportAction(month)
      if ('error' in res) { setErr(res.error); return }
      setExp(res)
      if (res.rows.length === 0) return
      const XLSX = await import('xlsx')
      // 1~5행 안내문 · 6행 머리글 · 7행부터 데이터 — 양식 행 위치를 지킨다(수식·서식 없음)
      const aoa: (string | number)[][] = [...HOMETAX_GUIDE_ROWS.map(g => [g]), HOMETAX_HEADERS, ...res.rows]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      // 사업자번호·작성일자·코드는 텍스트로 — 앞자리 0이 숫자 변환에 사라지지 않게
      for (let r = 6; r < aoa.length; r++) {
        for (const c of [0, 1, 2, 10, 22, 58]) {
          const ref = XLSX.utils.encode_cell({ r, c })
          if (ws[ref]) { ws[ref].t = 's'; ws[ref].v = String(ws[ref].v) }
        }
      }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
      XLSX.writeFile(wb, `홈택스_일괄발급_${month.replace('.', '-')}.xlsx`)
    })
  }

  function importResult(file: File) {
    setErr(''); setImp(null)
    start(async () => {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
        const parsed = parseHometaxResult(grid)
        if (parsed.error) { setErr(parsed.error); return }
        const res = await applyHometaxResultAction(parsed.rows)
        if ('error' in res) { setErr(res.error); return }
        setImp(res)
      } catch (e) {
        setErr(`파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (fileRef.current) fileRef.current.value = ''
      }
    })
  }

  return (
    <div className="bg-surface rounded-xl border p-4 space-y-3" data-testid="hometax-bulk-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">홈택스 일괄발급</span>
        <select value={month} onChange={e => { setMonth(e.target.value); setExp(null) }}
          className="h-8 rounded-lg border border-brand-line px-2 text-xs" data-testid="hometax-month">
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={exportXlsx} disabled={pending || !month} data-testid="hometax-export"
          className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium disabled:opacity-50">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} 홈택스 엑셀
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={pending} data-testid="hometax-import"
          className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-brand-line text-xs font-medium text-ink-sub hover:border-brand disabled:opacity-50">
          <Upload className="size-3.5" /> 발급 결과 가져오기
        </button>
        <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) importResult(f) }} />
        <a href="https://www.hometax.go.kr" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-brand hover:underline ml-auto">
          홈택스 열기 <ExternalLink className="size-3" />
        </a>
      </div>
      <p className="text-form-2xs text-ink-meta">
        ① 엑셀을 받아 홈택스 「전자세금계산서 → 일괄발급」에 올립니다(파일당 100건, 서명 1회 50건). ② 발급 뒤 「목록조회 → 매출」 엑셀을 내려받아
        「발급 결과 가져오기」로 올리면 승인번호가 청구에 기록됩니다(작성일자·사업자번호·합계금액으로 짝).
      </p>

      {err && <p className="text-xs text-red-600">❌ {err}</p>}

      {exp && (
        <div className="space-y-1 text-xs" data-testid="hometax-export-result">
          <p className={exp.rows.length ? 'text-green-700' : 'text-ink-sub'}>
            {exp.month} 미발행 {exp.rows.length + exp.skipped.length + exp.truncated}건 중 <b>{exp.rows.length}건</b>을 엑셀에 담았습니다
            {exp.rows.length === 0 && ' — 내려받을 파일이 없습니다'}.
          </p>
          {exp.truncated > 0 && <p className="text-amber-700">100건을 넘는 {exp.truncated}건은 빠졌습니다 — 홈택스 「일괄발급(100건 초과)」 메뉴를 쓰거나 나눠 받으세요.</p>}
          {exp.supplierProblems.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
              <p className="font-medium flex items-center gap-1"><AlertTriangle className="size-3.5" /> 공급자(본사) 정보 미비 — 홈택스 업로드에서 거부될 수 있습니다</p>
              <ul className="list-disc pl-5">{exp.supplierProblems.map(p => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {exp.skipped.length > 0 && (
            <details className="rounded-lg bg-paper px-2 py-1.5" open={exp.rows.length === 0}>
              <summary className="cursor-pointer text-amber-700" data-testid="hometax-skipped">사업자정보 미비 {exp.skipped.length}건 — 엑셀에서 뺐습니다</summary>
              <ul className="mt-1 space-y-0.5">
                {exp.skipped.slice(0, 50).map(s => <li key={s.billId}>{s.customerName} — {s.reason}</li>)}
                {exp.skipped.length > 50 && <li className="text-ink-meta">외 {exp.skipped.length - 50}건</li>}
              </ul>
              <p className="mt-1 text-ink-meta">고객 상세 「청구·수금」 탭 「사업자정보」에서 사업자등록번호와 수신 이메일을 입력하면 다음 내보내기에 들어갑니다.</p>
            </details>
          )}
        </div>
      )}

      {imp && (
        <div className="space-y-1 text-xs" data-testid="hometax-import-result">
          <p className="text-green-700">승인번호 <b>{imp.applied}건</b> 기록{imp.alreadyIssued > 0 ? ` · 이미 기록된 승인번호 ${imp.alreadyIssued}건은 건너뜀` : ''}.</p>
          {imp.ambiguous.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
              <p className="font-medium">후보가 둘 이상이라 고르지 않은 {imp.ambiguous.length}건 — 발행 화면에서 직접 입력하세요</p>
              <ul className="list-disc pl-5">{imp.ambiguous.map(a => <li key={a.row.approvalNo}>{a.row.approvalNo} ({a.row.writeDate} · {a.row.total.toLocaleString('ko-KR')}원) → {a.customerNames.join(', ')}</li>)}</ul>
            </div>
          )}
          {imp.unmatched.length > 0 && (
            <details className="rounded-lg bg-paper px-2 py-1.5">
              <summary className="cursor-pointer text-ink-sub">ERP 청구와 짝을 찾지 못한 {imp.unmatched.length}건</summary>
              <ul className="mt-1 space-y-0.5">{imp.unmatched.slice(0, 50).map(u => <li key={u.approvalNo}>{u.approvalNo} · {u.writeDate} · {u.buyerBizNo} · {u.total.toLocaleString('ko-KR')}원</li>)}</ul>
              <p className="mt-1 text-ink-meta">홈택스에서 직접 발행한 건, 청구일과 작성일자가 다른 건, 금액을 고쳐 발행한 건이 여기 남습니다.</p>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
