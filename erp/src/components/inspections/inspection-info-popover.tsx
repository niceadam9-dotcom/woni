'use client'

import { useState } from 'react'
import { Building2, User, Calendar, ChevronDown, ChevronUp } from 'lucide-react'
import { AddressMapButton } from '@/components/ui/address-map-button'
import { formatTel } from '@/lib/format-contact'

/** 점검 기본정보 — 헤더 접이식 (소방계획서_21 R5-5 / D-1).
 *  사용자가 "중요도 하"로 꼽은 블록이라 상단 카드에서 헤더의 접힌 요약으로 내렸다.
 *  점검 중에는 볼 일이 적고, 필요할 때만 펼친다. */
export type InspectionInfo = {
  customerName: string
  employee: string
  startDate: string
  contactRole?: string | null
  contactName?: string | null
  contactPhone?: string | null
  address?: string | null
  notes?: string | null
}

export function InspectionInfoPopover({ info }: { info: InspectionInfo }) {
  const [open, setOpen] = useState(false)

  const rows: Array<{ icon: React.ReactNode; label: string; value: string }> = [
    { icon: <Building2 className="size-3.5" />, label: '고객', value: info.customerName },
    { icon: <User className="size-3.5" />, label: '담당자', value: info.employee },
    { icon: <Calendar className="size-3.5" />, label: '시작일', value: info.startDate },
  ]
  if (info.contactName) {
    rows.push({
      icon: <User className="size-3.5" />,
      label: `관계인${info.contactRole ? ` (${info.contactRole})` : ''}`,
      value: `${info.contactName}${info.contactPhone ? ` · ${formatTel(info.contactPhone)}` : ''}`,
    })
  }

  return (
    <div className="shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#514b81] hover:bg-[#f5f4ff] hover:text-[#7b68ee] transition-colors"
        title="고객·담당자·관계인·주소 등 기본정보"
      >
        기본정보
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-2 z-10 px-0">
          <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] p-4">
            <div className="grid grid-cols-2 gap-3">
              {rows.map(r => (
                <div key={r.label} className="flex items-center gap-2 min-w-0">
                  <span className="text-[#b0acd6] shrink-0">{r.icon}</span>
                  <span className="text-xs text-[#514b81] shrink-0">{r.label}</span>
                  <span className="text-sm text-[#090c1d] truncate">{r.value}</span>
                </div>
              ))}
              {info.address && (
                <div className="col-span-2 flex items-start gap-2">
                  <span className="text-xs text-[#514b81] shrink-0 mt-0.5">주소</span>
                  <span className="text-xs text-[#514b81]">{info.address}</span>
                  {/* 방문 준비 — 주소를 읽는 것과 "거기가 어디쯤인가"는 다른 일이다(S5-7 확산) */}
                  <AddressMapButton customerName={info.customerName} address={info.address} className="mt-0.5" />
                </div>
              )}
              {info.notes && (
                <div className="col-span-2 flex items-start gap-2">
                  <span className="text-xs text-[#514b81] shrink-0 mt-0.5">비고</span>
                  <span className="text-xs text-[#514b81]">{info.notes}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
