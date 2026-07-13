// 갑지.xls → xlsx(수식 보존) 변환 후 스테이징 Storage(reports/templates/)에 업로드 (P32-2)
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const wb = xlsx.readFile('F:/AI/ERP/erp_goal/_Data/보고서 갑지.xls', { cellFormula: true, cellNF: true, cellStyles: true })
const buf = xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' })
console.log('변환 크기:', buf.length, 'bytes / 시트', wb.SheetNames.length)

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const path = 'templates/operational_v2025.xlsx'
const { error } = await admin.storage.from('reports').upload(path, buf, {
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true,
})
console.log(error ? '업로드 실패: ' + error.message : `업로드 완료 — reports/${path}`)
