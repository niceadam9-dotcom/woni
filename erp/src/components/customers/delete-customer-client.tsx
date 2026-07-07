'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteCustomerAction } from '@/app/(dashboard)/customers/actions'

interface Props {
  customerId: string
  customerName: string
}

export function DeleteCustomerClient({ customerId, customerName }: Props) {
  const [isPending, startTransition] = useTransition()
  const [confirmed, setConfirmed] = useState(false)

  function handleDelete() {
    if (!confirmed) {
      setConfirmed(true)
      setTimeout(() => setConfirmed(false), 3000)
      return
    }
    startTransition(async () => {
      const res = await deleteCustomerAction(customerId)
      if (res.error) alert(res.error)
    })
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${
        confirmed
          ? 'bg-red-100 text-red-700 font-semibold hover:bg-red-200'
          : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
      } ${isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
      title={confirmed ? '한 번 더 클릭하면 삭제됩니다' : `${customerName} 삭제`}
    >
      <Trash2 className="size-3" />
      {confirmed ? '확인?' : ''}
    </button>
  )
}
