'use client'

import { useState, useTransition } from 'react'
import { toggleCustomerActiveAction } from '@/app/(dashboard)/customers/actions'

interface Props {
  customerId: string
  isActive: boolean
}

export function ToggleActiveClient({ customerId, isActive }: Props) {
  const [active, setActive] = useState(isActive)
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    const next = !active
    setActive(next)
    startTransition(async () => {
      const res = await toggleCustomerActiveAction(customerId, next)
      if (res.error) {
        setActive(!next) // 실패 시 롤백
        alert(res.error)
      }
    })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${
        active
          ? 'bg-green-50 text-green-700 hover:bg-green-100'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      } ${isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      title={active ? '클릭하면 비활성으로 전환' : '클릭하면 활성으로 전환'}
    >
      {active ? '활성' : '비활성'}
    </button>
  )
}
