'use client'

import { useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { CustomerCombobox, type ComboboxCustomer } from '@/components/ui/customer-combobox'

interface BuildingsFilterBarProps {
  customers: ComboboxCustomer[]
  defaultQ: string
  defaultCustomer: string
  defaultActive: string
  defaultPerPage: string
}

export function BuildingsFilterBar({
  customers,
  defaultQ,
  defaultCustomer,
  defaultActive,
  defaultPerPage,
}: BuildingsFilterBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [q, setQ] = useState(defaultQ)
  const [customerId, setCustomerId] = useState(defaultCustomer)
  const [active, setActive] = useState(defaultActive)
  const [perPage, setPerPage] = useState(defaultPerPage)
  const inputRef = useRef<HTMLInputElement>(null)

  function buildUrl(overrides: Record<string, string> = {}) {
    const sp = new URLSearchParams(searchParams.toString())
    const merged = { q, customer: customerId, active, per_page: perPage, ...overrides }
    sp.delete('page')
    Object.entries(merged).forEach(([k, v]) => {
      if (v && !(k === 'active' && v === 'active') && !(k === 'per_page' && v === '25')) {
        sp.set(k, v)
      } else {
        sp.delete(k)
      }
    })
    const qs = sp.toString()
    return `/buildings${qs ? `?${qs}` : ''}`
  }

  function handleCustomerChange(id: string) {
    setCustomerId(id)
    router.push(buildUrl({ customer: id }))
  }

  function handleActiveChange(val: string) {
    setActive(val)
    router.push(buildUrl({ active: val }))
  }

  function handlePerPageChange(val: string) {
    setPerPage(val)
    router.push(buildUrl({ per_page: val }))
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    router.push(buildUrl())
  }

  function handleReset() {
    setQ(''); setCustomerId(''); setActive('active'); setPerPage('25')
    router.push('/buildings')
  }

  const isDirty = q || customerId || active !== 'active' || perPage !== '25'

  return (
    <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-2">
      {/* 텍스트 검색 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="건물명·주소·용도·고객명 검색"
          className="h-9 pl-8 pr-3 rounded-lg border border-[#d0ccf5] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-56"
        />
      </div>

      {/* 고객사 자동완성 */}
      <CustomerCombobox
        customers={customers}
        value={customerId}
        onChange={handleCustomerChange}
        placeholder="전체 고객사"
        className="w-48"
      />

      {/* 상태 필터 */}
      <select
        value={active}
        onChange={e => handleActiveChange(e.target.value)}
        className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
      >
        <option value="all">전체 상태</option>
        <option value="active">활성</option>
        <option value="inactive">비활성</option>
      </select>

      {/* 페이지 크기 */}
      <select
        value={perPage}
        onChange={e => handlePerPageChange(e.target.value)}
        className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
      >
        <option value="25">25건</option>
        <option value="50">50건</option>
        <option value="0">전체</option>
      </select>

      <button
        type="submit"
        className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
      >
        검색
      </button>

      {isDirty && (
        <button
          type="button"
          onClick={handleReset}
          className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
        >
          초기화
        </button>
      )}
    </form>
  )
}
