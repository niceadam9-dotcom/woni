import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BarChart3 } from 'lucide-react'
import Link from 'next/link'

export default async function StockStatusPage() {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()
  const { data: items } = await admin
    .from('inventory_items')
    .select(`*, category:category_id (name)`)
    .eq('is_active', true)
    .order('item_code')

  const rows = (items ?? []) as Record<string, unknown>[]
  const totalValue = rows.reduce((s, i) => s + ((i.current_stock as number) * (i.standard_price as number || 0)), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="size-6 text-brand" />
          <div><h1 className="text-xl font-bold text-ink">재고 현황</h1><p className="text-sm text-ink-sub mt-0.5">전체 품목 재고 현황을 조회합니다</p></div>
        </div>
        <div className="flex items-center gap-2 text-sm text-ink-sub">
          <span>재고 평가액: <strong className="text-ink">{totalValue.toLocaleString()}원</strong></span>
        </div>
      </div>

      <div className="flex gap-2 text-xs">
        {[['입고', '/stock/in'], ['출고', '/stock/out'], ['재고조정', '/stock/adjust']].map(([label, href]) => (
          <Link key={href} href={href} className="h-8 px-3 rounded-lg border border-line text-ink-sub hover:bg-paper transition-colors flex items-center">{label}</Link>
        ))}
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-paper">
            <tr>{['품목코드', '품목명', '분류', '단위', '현재고', '기준단가', '재고금액'].map(h => (
              <th key={h} className="py-3 px-4 text-left font-medium text-ink-sub text-xs">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-sm text-ink-sub">등록된 품목이 없습니다</td></tr>
            ) : rows.map((item, i) => {
              const stockValue = (item.current_stock as number) * (item.standard_price as number || 0)
              const isLow = (item.current_stock as number) === 0
              return (
                <tr key={item.id as string} className={`${i > 0 ? 'border-t border-line' : ''} ${isLow ? 'bg-red-50' : 'hover:bg-paper'}`}>
                  <td className="px-4 py-3 font-mono text-xs text-brand">{item.item_code as string}</td>
                  <td className="px-4 py-3 font-medium text-ink">{item.item_name as string}</td>
                  <td className="px-4 py-3 text-xs text-ink-sub">{(item.category as { name: string } | null)?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-ink-sub">{item.unit as string ?? '-'}</td>
                  <td className={`px-4 py-3 text-right font-bold ${isLow ? 'text-red-500' : 'text-ink'}`}>{item.current_stock as number}</td>
                  <td className="px-4 py-3 text-right text-xs text-ink-sub">{item.standard_price ? (item.standard_price as number).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-ink">{stockValue > 0 ? stockValue.toLocaleString() : '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
